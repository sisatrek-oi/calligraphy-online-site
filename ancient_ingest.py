#!/usr/bin/env python3
"""Recoverable local ingestion for scanned Chinese rare-book PDFs."""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path


PAGE_FILE_RE = re.compile(r"^page_(\d+)\.txt$", re.IGNORECASE)
JOB_ID_RE = re.compile(r"^[a-f0-9]{12}$")
PDF_ID_RE = re.compile(r"^[a-f0-9]{16}$")


class IngestError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _workspace_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (candidate / "FOLDER-USAGE-CHECKLIST.md").exists():
            return candidate
    return start


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    )
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def _run(args: list[str], *, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise IngestError(f"缺少处理工具：{args[0]}", 503) from exc
    except subprocess.TimeoutExpired as exc:
        raise IngestError(f"处理超时：{Path(args[0]).name}", 504) from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip().splitlines()
        message = detail[-1] if detail else "命令执行失败"
        raise IngestError(message[:300], 502) from exc


def _clean_ocr_text(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\x0c", "")
    lines = [re.sub(r"[ \t]+", "", line).strip() for line in text.splitlines()]
    compact: list[str] = []
    for line in lines:
        if line or (compact and compact[-1]):
            compact.append(line)
    return "\n".join(compact).strip() + ("\n" if any(compact) else "")


class AncientIngestService:
    def __init__(self, app_root: Path) -> None:
        self.app_root = app_root.resolve()
        self.workspace_root = _workspace_root(self.app_root)
        self.inbox_root = Path(
            os.environ.get("CALLIGRAPHY_INBOX_ROOT", self.workspace_root / "inbox")
        ).resolve()
        self.runtime_root = self.app_root / ".runtime" / "ancient-ingest"
        self.jobs_root = self.runtime_root / "jobs"
        self.preview_root = self.runtime_root / "previews"
        self._lock = threading.RLock()
        self._workers: dict[str, threading.Thread] = {}

    def capabilities(self) -> dict:
        commands = {
            name: shutil.which(name) or ""
            for name in ("pdfinfo", "pdftoppm", "pdftotext", "tesseract")
        }
        languages: list[str] = []
        if commands["tesseract"]:
            try:
                output = _run([commands["tesseract"], "--list-langs"], timeout=20)
                languages = [line.strip() for line in output.stdout.splitlines()[1:] if line.strip()]
            except IngestError:
                languages = []
        vertical = [name for name in ("chi_tra_vert", "chi_sim_vert") if name in languages]
        horizontal = [name for name in ("chi_tra", "chi_sim") if name in languages]
        # Mixing simplified and traditional models made historical scans less stable.
        # Prefer the traditional vertical model and fall back one model at a time.
        selected = vertical[:1] or horizontal[:1]
        return {
            "commands": {key: bool(value) for key, value in commands.items()},
            "languages": languages,
            "ocrLanguages": "+".join(selected),
            "verticalReady": bool(vertical),
            "ocrReady": all(commands[name] for name in ("pdfinfo", "pdftoppm", "tesseract")) and bool(selected),
        }

    def _pdf_paths(self) -> list[Path]:
        if not self.inbox_root.exists():
            return []
        paths = [path for path in self.inbox_root.rglob("*.pdf") if path.is_file()]
        return sorted(
            paths,
            key=lambda path: (
                len(path.relative_to(self.inbox_root).parts),
                -path.stat().st_mtime,
                str(path.relative_to(self.inbox_root)).lower(),
            ),
        )

    def _pdf_id(self, path: Path) -> str:
        relative = path.resolve().relative_to(self.inbox_root).as_posix()
        return hashlib.sha256(relative.encode("utf-8")).hexdigest()[:16]

    def _pdf_path(self, pdf_id: str) -> Path:
        if not PDF_ID_RE.fullmatch(str(pdf_id or "")):
            raise IngestError("PDF 标识无效")
        for path in self._pdf_paths():
            if self._pdf_id(path) == pdf_id:
                return path
        raise IngestError("PDF 不存在或已移出 inbox", 404)

    def _pdf_info(self, path: Path) -> dict:
        output = _run(["pdfinfo", str(path)], timeout=30).stdout
        raw: dict[str, str] = {}
        for line in output.splitlines():
            key, separator, value = line.partition(":")
            if separator:
                raw[key.strip()] = value.strip()
        try:
            pages = int(raw.get("Pages", "0"))
        except ValueError:
            pages = 0
        return {
            "title": raw.get("Title") or path.stem,
            "author": raw.get("Author", ""),
            "pages": pages,
            "encrypted": raw.get("Encrypted", "no").lower().startswith("yes"),
        }

    def _has_text_layer(self, path: Path, pages: int) -> bool:
        if not shutil.which("pdftotext"):
            return False
        try:
            output = _run(
                ["pdftotext", "-f", "1", "-l", str(min(max(pages, 1), 3)), str(path), "-"],
                timeout=40,
            ).stdout
            return bool(re.sub(r"\s+", "", output))
        except IngestError:
            return False

    def _duplicate_dirs(self, source: Path) -> list[Path]:
        signature = (source.name, source.stat().st_size)
        return sorted({
            path.parent.resolve()
            for path in self._pdf_paths()
            if (path.name, path.stat().st_size) == signature
        })

    def _reusable_pages(self, source: Path) -> dict[int, Path]:
        pages: dict[int, Path] = {}
        for directory in self._duplicate_dirs(source):
            for path in directory.rglob("page_*.txt"):
                match = PAGE_FILE_RE.fullmatch(path.name)
                if match and path.is_file():
                    pages.setdefault(int(match.group(1)), path)
        return pages

    def list_pdfs(self) -> dict:
        items = []
        seen_signatures: dict[tuple[str, int], str] = {}
        for path in self._pdf_paths():
            stat = path.stat()
            info = self._pdf_info(path)
            signature = (path.name, stat.st_size)
            duplicate_of = seen_signatures.get(signature, "")
            seen_signatures.setdefault(signature, self._pdf_id(path))
            reusable = self._reusable_pages(path)
            items.append({
                "id": self._pdf_id(path),
                "name": path.name,
                "relativePath": path.relative_to(self.inbox_root).as_posix(),
                "size": stat.st_size,
                "modifiedAt": dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat(),
                "duplicateOf": duplicate_of,
                "hasTextLayer": self._has_text_layer(path, info["pages"]),
                "existingTxtCount": len(reusable),
                "existingTxtMin": min(reusable) if reusable else None,
                "existingTxtMax": max(reusable) if reusable else None,
                **info,
            })
        return {"inbox": str(self.inbox_root), "capabilities": self.capabilities(), "pdfs": items}

    def _job_path(self, job_id: str) -> Path:
        if not JOB_ID_RE.fullmatch(str(job_id or "")):
            raise IngestError("任务标识无效")
        return self.jobs_root / job_id / "ocr-manifest.json"

    def _load_job(self, job_id: str) -> dict:
        path = self._job_path(job_id)
        if not path.exists():
            raise IngestError("入库任务不存在", 404)
        return json.loads(path.read_text(encoding="utf-8"))

    def _save_job(self, job: dict) -> None:
        with self._lock:
            job["updatedAt"] = _now()
            _atomic_json(self._job_path(job["id"]), job)

    def list_jobs(self) -> dict:
        jobs = []
        if self.jobs_root.exists():
            for manifest in sorted(self.jobs_root.glob("*/ocr-manifest.json"), key=lambda path: path.stat().st_mtime, reverse=True):
                try:
                    jobs.append(json.loads(manifest.read_text(encoding="utf-8")))
                except (OSError, json.JSONDecodeError):
                    continue
        return {"jobs": jobs[:30]}

    def get_job(self, job_id: str) -> dict:
        return self._load_job(job_id)

    def create_job(self, payload: dict) -> dict:
        source = self._pdf_path(str(payload.get("pdfId") or ""))
        info = self._pdf_info(source)
        start = int(payload.get("startPage") or 1)
        end = int(payload.get("endPage") or info["pages"])
        offset = int(payload.get("pageOffset") or 0)
        if start < 1 or end < start or end > info["pages"]:
            raise IngestError("PDF 页码范围无效")
        if abs(offset) > info["pages"] + 100:
            raise IngestError("书页偏移超出允许范围")
        reuse = payload.get("reuseExisting") is not False
        run_ocr = payload.get("ocrMissing") is not False
        capabilities = self.capabilities()
        reusable = self._reusable_pages(source) if reuse else {}
        missing = [page for page in range(start, end + 1) if page - offset not in reusable]
        if missing and run_ocr and not capabilities["ocrReady"]:
            raise IngestError("缺少可用的中文 OCR 运行时；当前只能复用已有 TXT", 409)
        if missing and not run_ocr:
            raise IngestError(f"所选范围有 {len(missing)} 页既无 TXT，也未启用 OCR", 409)

        job_id = uuid.uuid4().hex[:12]
        records = []
        for pdf_page in range(start, end + 1):
            printed_page = pdf_page - offset
            records.append({
                "pdfPage": pdf_page,
                "printedPage": printed_page,
                "sourceFile": f"page_{printed_page}.txt",
                "status": "pending",
                "method": "",
                "characters": 0,
                "error": "",
            })
        job = {
            "id": job_id,
            "sourcePdfId": self._pdf_id(source),
            "sourceName": source.name,
            "sourceRelativePath": source.relative_to(self.inbox_root).as_posix(),
            "status": "queued",
            "phase": "ocr",
            "createdAt": _now(),
            "updatedAt": _now(),
            "startedAt": "",
            "completedAt": "",
            "startPage": start,
            "endPage": end,
            "pageOffset": offset,
            "reuseExisting": reuse,
            "ocrMissing": run_ocr,
            "ocrLanguages": capabilities["ocrLanguages"],
            "verticalOcr": capabilities["verticalReady"],
            "total": len(records),
            "completed": 0,
            "reused": 0,
            "ocrCount": 0,
            "failed": 0,
            "currentPage": None,
            "pauseRequested": False,
            "extractionStatus": "idle",
            "extractedPages": [],
            "extractedCount": 0,
            "evidenceRows": [],
            "extractionErrors": [],
            "currentExtractionPage": None,
            "records": records,
            "outputs": {
                "pagesCsv": "pages.csv",
                "evidenceCsv": "evidence.csv",
                "manifest": "ocr-manifest.json",
            },
        }
        self._save_job(job)
        self.resume_job(job_id)
        return self._load_job(job_id)

    def resume_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            running = self._workers.get(job_id)
            if running and running.is_alive():
                return job
            if job["status"] == "complete":
                return job
            job["pauseRequested"] = False
            job["status"] = "queued"
            self._save_job(job)
            worker = threading.Thread(target=self._run_job, args=(job_id,), daemon=True)
            self._workers[job_id] = worker
            worker.start()
            return job

    def pause_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            if job["status"] in {"complete", "failed"}:
                return job
            job["pauseRequested"] = True
            job["status"] = "pausing"
            self._save_job(job)
            return job

    def start_extraction(self, job_id: str, extractor) -> dict:
        with self._lock:
            job = self._load_job(job_id)
            if not any(item["status"] == "complete" for item in job["records"]):
                raise IngestError("还没有可抽取的 OCR/TXT 页面", 409)
            worker_key = f"extract-{job_id}"
            running = self._workers.get(worker_key)
            if running and running.is_alive():
                return job
            job.setdefault("extractedPages", [])
            job.setdefault("evidenceRows", [])
            job.setdefault("extractionErrors", [])
            job["phase"] = "extraction"
            job["extractionStatus"] = "running"
            job["currentExtractionPage"] = None
            self._save_job(job)
            worker = threading.Thread(
                target=self._run_extraction,
                args=(job_id, extractor),
                daemon=True,
            )
            self._workers[worker_key] = worker
            worker.start()
            return job

    def _run_extraction(self, job_id: str, extractor) -> None:
        try:
            job = self._load_job(job_id)
            completed_records = [item for item in job["records"] if item["status"] == "complete"]
            extracted_pages = {int(page) for page in job.get("extractedPages", [])}
            for record in completed_records:
                printed_page = int(record["printedPage"])
                if printed_page in extracted_pages:
                    continue
                with self._lock:
                    job = self._load_job(job_id)
                    job["currentExtractionPage"] = printed_page
                    self._save_job(job)
                path = self.jobs_root / job_id / "source-pages" / record["sourceFile"]
                text = path.read_text(encoding="utf-8") if path.exists() else ""
                rows = []
                extraction_error = ""
                try:
                    rows = extractor(text, record, job)
                    if not isinstance(rows, list):
                        raise IngestError("模型没有返回候选列表", 502)
                except Exception as exc:
                    extraction_error = str(exc)[:300]

                with self._lock:
                    job = self._load_job(job_id)
                    existing = {
                        (str(item.get("source_file") or ""), str(item.get("quote") or ""),
                         str(item.get("书家") or ""), str(item.get("书体/可能书体") or ""))
                        for item in job.get("evidenceRows", [])
                    }
                    if extraction_error:
                        job.setdefault("extractionErrors", []).append({
                            "printedPage": printed_page,
                            "error": extraction_error,
                        })
                    else:
                        for row in rows:
                            key = (
                                str(row.get("source_file") or ""), str(row.get("quote") or ""),
                                str(row.get("书家") or ""), str(row.get("书体/可能书体") or ""),
                            )
                            if key not in existing:
                                job.setdefault("evidenceRows", []).append(row)
                                existing.add(key)
                    if printed_page not in job.setdefault("extractedPages", []):
                        job["extractedPages"].append(printed_page)
                    job["extractedCount"] = len(job.get("evidenceRows", []))
                    self._save_job(job)
                self._write_tables(job)
            with self._lock:
                job = self._load_job(job_id)
                job["extractionStatus"] = "complete" if not job.get("extractionErrors") else "complete_with_errors"
                job["currentExtractionPage"] = None
                job["extractedCount"] = len(job.get("evidenceRows", []))
                self._save_job(job)
            self._write_tables(job)
        except Exception as exc:
            try:
                with self._lock:
                    job = self._load_job(job_id)
                    job["extractionStatus"] = "failed"
                    job["currentExtractionPage"] = None
                    job.setdefault("extractionErrors", []).append({"printedPage": None, "error": str(exc)[:300]})
                    self._save_job(job)
            except Exception:
                pass

    def _run_job(self, job_id: str) -> None:
        try:
            with self._lock:
                job = self._load_job(job_id)
                source = self._pdf_path(job["sourcePdfId"])
                reusable = self._reusable_pages(source) if job["reuseExisting"] else {}
                job["status"] = "running"
                job["startedAt"] = job["startedAt"] or _now()
                self._save_job(job)
            for record in job["records"]:
                with self._lock:
                    job = self._load_job(job_id)
                    if job.get("pauseRequested"):
                        job["status"] = "paused"
                        job["currentPage"] = None
                        self._save_job(job)
                        self._write_tables(job)
                        return
                    record = next(item for item in job["records"] if item["pdfPage"] == record["pdfPage"])
                    if record["status"] == "complete":
                        continue
                    job["currentPage"] = record["pdfPage"]
                    self._save_job(job)
                try:
                    text, method = self._process_page(job, record, source, reusable)
                    output = self.jobs_root / job_id / "source-pages" / record["sourceFile"]
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text(text, encoding="utf-8")
                    result = {
                        "status": "complete", "method": method,
                        "characters": len(text.strip()), "error": "",
                    }
                except IngestError as exc:
                    result = {
                        "status": "failed", "method": "ocr",
                        "characters": 0, "error": str(exc),
                    }
                with self._lock:
                    job = self._load_job(job_id)
                    current_record = next(
                        item for item in job["records"] if item["pdfPage"] == record["pdfPage"]
                    )
                    current_record.update(result)
                    job["completed"] = sum(item["status"] == "complete" for item in job["records"])
                    job["reused"] = sum(item["method"] == "reused" for item in job["records"])
                    job["ocrCount"] = sum(
                        item["method"] == "ocr" and item["status"] == "complete"
                        for item in job["records"]
                    )
                    job["failed"] = sum(item["status"] == "failed" for item in job["records"])
                    self._save_job(job)
                self._write_tables(job)
            with self._lock:
                job = self._load_job(job_id)
                job["status"] = "complete" if not job["failed"] else "complete_with_errors"
                job["completedAt"] = _now()
                job["currentPage"] = None
                self._save_job(job)
            self._write_tables(job)
        except Exception as exc:  # Worker failures must stay visible in the persisted job.
            try:
                with self._lock:
                    job = self._load_job(job_id)
                    job["status"] = "failed"
                    job["error"] = str(exc)[:500]
                    job["currentPage"] = None
                    self._save_job(job)
            except Exception:
                pass

    def _process_page(self, job: dict, record: dict, source: Path, reusable: dict[int, Path]) -> tuple[str, str]:
        existing = reusable.get(record["printedPage"])
        if existing:
            return existing.read_text(encoding="utf-8"), "reused"
        if not job["ocrMissing"]:
            raise IngestError("该页没有可复用 TXT")
        job_dir = self.jobs_root / job["id"]
        render_dir = job_dir / "rendered"
        render_dir.mkdir(parents=True, exist_ok=True)
        prefix = render_dir / f"pdf-{record['pdfPage']}"
        image = prefix.with_suffix(".png")
        _run([
            "pdftoppm", "-f", str(record["pdfPage"]), "-l", str(record["pdfPage"]),
            "-r", "300", "-png", "-singlefile", str(source), str(prefix),
        ], timeout=180)
        psm = "5" if job.get("verticalOcr") else "6"
        result = _run([
            "tesseract", str(image), "stdout", "-l", job["ocrLanguages"], "--psm", psm,
        ], timeout=240)
        text = _clean_ocr_text(result.stdout)
        if not text.strip():
            raise IngestError("OCR 未识别出文字")
        return text, "ocr"

    def _write_tables(self, job: dict) -> None:
        with self._lock:
            job = self._load_job(job["id"])
            job_dir = self.jobs_root / job["id"]
            token = f"{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}"
            pages_csv = job_dir / "pages.csv"
            pages_tmp = job_dir / f".pages.{token}.tmp"
            with pages_tmp.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=[
                    "job_id", "source_pdf", "pdf_page", "printed_page", "source_file",
                    "status", "method", "characters", "text", "error",
                ])
                writer.writeheader()
                for record in job["records"]:
                    text_path = job_dir / "source-pages" / record["sourceFile"]
                    text = text_path.read_text(encoding="utf-8") if text_path.exists() else ""
                    writer.writerow({
                        "job_id": job["id"], "source_pdf": job["sourceName"],
                        "pdf_page": record["pdfPage"], "printed_page": record["printedPage"],
                        "source_file": record["sourceFile"], "status": record["status"],
                        "method": record["method"], "characters": record["characters"],
                        "text": text, "error": record["error"],
                    })
            pages_tmp.replace(pages_csv)
            evidence_csv = job_dir / "evidence.csv"
            evidence_tmp = job_dir / f".evidence.{token}.tmp"
            evidence_fields = [
                "附表", "材料ID", "来源数据", "书家", "书体/可能书体", "quote",
                "page_no", "source_file", "原文命中", "证据等级", "门禁",
                "进入主表建议", "问题/隐患", "备注",
            ]
            with evidence_tmp.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=evidence_fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(job.get("evidenceRows", []))
            evidence_tmp.replace(evidence_csv)

    def page_content(self, job_id: str, printed_page: int) -> dict:
        job = self._load_job(job_id)
        record = next((item for item in job["records"] if item["printedPage"] == printed_page), None)
        if not record:
            raise IngestError("任务中没有该书页", 404)
        path = self.jobs_root / job_id / "source-pages" / record["sourceFile"]
        return {"record": record, "text": path.read_text(encoding="utf-8") if path.exists() else ""}

    def save_page_content(self, job_id: str, printed_page: int, text: str) -> dict:
        if len(text) > 200_000:
            raise IngestError("单页文本过长", 413)
        with self._lock:
            job = self._load_job(job_id)
            record = next((item for item in job["records"] if item["printedPage"] == printed_page), None)
            if not record:
                raise IngestError("任务中没有该书页", 404)
            path = self.jobs_root / job_id / "source-pages" / record["sourceFile"]
            path.parent.mkdir(parents=True, exist_ok=True)
            normalized = text.replace("\r\n", "\n").replace("\r", "\n")
            previous = path.read_text(encoding="utf-8") if path.exists() else None
            method = record.get("method") if previous == normalized and record.get("method") in {"reused", "ocr", "edited"} else "edited"
            path.write_text(normalized, encoding="utf-8")
            record.update(status="complete", method=method, characters=len(normalized.strip()), error="")
            job["completed"] = sum(item["status"] == "complete" for item in job["records"])
            job["reused"] = sum(item["method"] == "reused" for item in job["records"])
            job["ocrCount"] = sum(
                item["method"] == "ocr" and item["status"] == "complete"
                for item in job["records"]
            )
            job["failed"] = sum(item["status"] == "failed" for item in job["records"])
            self._save_job(job)
        self._write_tables(job)
        return self.page_content(job_id, printed_page)

    def output_path(self, job_id: str, name: str) -> Path:
        allowed = {"pages.csv", "evidence.csv", "ocr-manifest.json"}
        if name not in allowed:
            raise IngestError("输出文件不存在", 404)
        path = self.jobs_root / job_id / name
        if not path.exists():
            raise IngestError("输出文件尚未生成", 404)
        return path

    def preview_path(self, job_id: str, printed_page: int) -> Path:
        job = self._load_job(job_id)
        record = next((item for item in job["records"] if item["printedPage"] == printed_page), None)
        if not record:
            raise IngestError("任务中没有该书页", 404)
        path = self.jobs_root / job_id / "previews" / f"page-{printed_page}.jpg"
        if path.exists():
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        source = self._pdf_path(job["sourcePdfId"])
        prefix = path.with_suffix("")
        _run([
            "pdftoppm", "-f", str(record["pdfPage"]), "-l", str(record["pdfPage"]),
            "-r", "150", "-jpeg", "-singlefile", str(source), str(prefix),
        ], timeout=120)
        if not path.exists():
            raise IngestError("扫描页预览生成失败", 502)
        return path

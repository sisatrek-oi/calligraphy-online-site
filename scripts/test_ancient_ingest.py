import io
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from ancient_ingest import AncientIngestService, IngestError


PDFINFO = """Title: Test Book
Author: Research Room
Pages: 12
Encrypted: no
"""


def fake_run(args, **_kwargs):
    if args[0] == "pdfinfo":
        return subprocess.CompletedProcess(args, 0, PDFINFO, "")
    if args[0] == "pdftotext":
        return subprocess.CompletedProcess(args, 0, "\f", "")
    if args[0].endswith("tesseract") and "--list-langs" in args:
        return subprocess.CompletedProcess(args, 0, "List of available languages\nchi_tra_vert\n", "")
    raise AssertionError(args)


class AncientIngestTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "inbox" / "book").mkdir(parents=True)
        self.top_pdf = self.root / "inbox" / "test.pdf"
        self.nested_pdf = self.root / "inbox" / "book" / "test.pdf"
        self.top_pdf.write_bytes(b"same-pdf")
        self.nested_pdf.write_bytes(b"same-pdf")
        (self.nested_pdf.parent / "page_3.txt").write_text("原文第三页", encoding="utf-8")
        self.service = AncientIngestService(self.root)

    def tearDown(self):
        self.temporary.cleanup()

    @patch("ancient_ingest._run", side_effect=fake_run)
    @patch("ancient_ingest.shutil.which", side_effect=lambda name: f"/bin/{name}")
    def test_inventory_marks_duplicate_scan_and_reusable_pages(self, _which, _run):
        payload = self.service.list_pdfs()
        self.assertEqual(len(payload["pdfs"]), 2)
        self.assertTrue(payload["capabilities"]["verticalReady"])
        self.assertFalse(payload["pdfs"][0]["hasTextLayer"])
        self.assertEqual(payload["pdfs"][0]["existingTxtCount"], 1)
        self.assertEqual(payload["pdfs"][0]["existingTxtMin"], 3)
        self.assertTrue(payload["pdfs"][1]["duplicateOf"])

    @patch("ancient_ingest._run", side_effect=fake_run)
    @patch("ancient_ingest.shutil.which", side_effect=lambda name: f"/bin/{name}")
    def test_job_maps_pdf_pages_to_printed_pages_and_can_edit_text(self, _which, _run):
        pdf_id = self.service._pdf_id(self.top_pdf)
        with patch.object(self.service, "resume_job", side_effect=lambda job_id: self.service.get_job(job_id)):
            job = self.service.create_job({
                "pdfId": pdf_id,
                "startPage": 5,
                "endPage": 5,
                "pageOffset": 2,
                "reuseExisting": True,
                "ocrMissing": False,
            })
        self.assertEqual(job["records"][0]["printedPage"], 3)
        persisted = self.service._load_job(job["id"])
        persisted["records"][0].update(status="complete", method="reused", characters=5)
        persisted.update(completed=1, reused=1, ocrCount=0)
        page_path = self.service.jobs_root / job["id"] / "source-pages" / job["records"][0]["sourceFile"]
        page_path.parent.mkdir(parents=True, exist_ok=True)
        page_path.write_text("原文第三页", encoding="utf-8")
        self.service._save_job(persisted)
        unchanged = self.service.save_page_content(job["id"], 3, "原文第三页")
        self.assertEqual(unchanged["record"]["method"], "reused")
        unchanged_job = self.service.get_job(job["id"])
        self.assertEqual(unchanged_job["reused"], 1)
        self.assertEqual(unchanged_job["ocrCount"], 0)
        saved = self.service.save_page_content(job["id"], 3, "校改文本")
        self.assertEqual(saved["record"]["method"], "edited")
        self.assertEqual(saved["text"], "校改文本")
        edited_job = self.service.get_job(job["id"])
        self.assertEqual(edited_job["reused"], 0)
        pages_csv = self.service.output_path(job["id"], "pages.csv").read_text(encoding="utf-8-sig")
        self.assertIn("校改文本", pages_csv)

        def fake_extractor(_text, record, created_job):
            return [{
                "附表": "附表B｜古籍 OCR 候选可审",
                "材料ID": "OCR-1",
                "来源数据": created_job["sourceName"],
                "书家": "王羲之",
                "书体/可能书体": "草书",
                "quote": "校改文本",
                "page_no": str(record["printedPage"]),
                "source_file": record["sourceFile"],
                "原文命中": "exact",
                "证据等级": "中",
                "门禁": "checkpoint-source",
                "进入主表建议": "候选可审",
                "问题/隐患": "",
                "备注": "",
            }]

        self.service.start_extraction(job["id"], fake_extractor)
        for _ in range(100):
            extracted = self.service.get_job(job["id"])
            if extracted["extractionStatus"] != "running":
                break
            time.sleep(0.01)
        self.assertEqual(extracted["extractionStatus"], "complete")
        self.assertEqual(extracted["extractedCount"], 1)
        evidence_csv = self.service.output_path(job["id"], "evidence.csv").read_text(encoding="utf-8-sig")
        self.assertIn("王羲之", evidence_csv)

    def queued_job(self, **overrides):
        payload = dict(pdfId=self.service._pdf_id(self.top_pdf), startPage=3,
                       endPage=3, reuseExisting=True, ocrMissing=False,
                       bookTitle="书论", edition="初版", sourceNote="测试材料")
        payload.update(overrides)
        with patch("ancient_ingest._run", side_effect=fake_run), patch("ancient_ingest.shutil.which", return_value="/bin/tool"), patch.object(self.service, "capabilities", return_value={"ocrReady": True, "ocrLanguages": "chi_tra_vert", "verticalReady": True}), patch.object(self.service, "resume_job"):
            return self.service.create_job(payload)

    def completed_job(self):
        job = self.queued_job()
        with patch.object(self.service, "_process_page", return_value=("原始识别文本", "ocr")):
            self.service._run_job(job["id"])
        return self.service.get_job(job["id"])

    @patch("ancient_ingest._run", side_effect=fake_run)
    def test_same_name_and_size_different_pdf_never_reuses_other_version(self, _run):
        self.top_pdf.write_bytes(b"diff-pdf")
        self.assertEqual(len(self.top_pdf.read_bytes()), len(self.nested_pdf.read_bytes()))
        self.assertEqual(self.service._reusable_pages(self.top_pdf), {})
        items = self.service.list_pdfs()["pdfs"]
        self.assertTrue(all(not item["duplicateOf"] for item in items))

    def test_upload_deduplicates_content_and_rejects_invalid_input(self):
        data = b"%PDF-1.4\nnew document"
        with patch.object(self.service, "_pdf_info", return_value={"pages": 1, "encrypted": False}):
            first = self.service.import_pdf(io.BytesIO(data), len(data), "版本甲.pdf")
            second = self.service.import_pdf(io.BytesIO(data), len(data), "版本乙.pdf")
            self.assertFalse(first["duplicate"])
            self.assertTrue(second["duplicate"])
            self.assertEqual(first["pdfId"], second["pdfId"])
            for content, size, name in [(b"html", 4, "a.pdf"), (data, len(data)+2, "a.pdf"), (data, len(data), "../a.pdf")]:
                with self.assertRaises(IngestError):
                    self.service.import_pdf(io.BytesIO(content), size, name)
        self.assertEqual(list((self.service.runtime_root / "uploads").glob("*.pdf")), [])

    def test_repeated_job_creation_reuses_job_and_version_names_are_distinct(self):
        first = self.queued_job()
        again = self.queued_job()
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(first["edition"], "初版")
        self.top_pdf.write_bytes(b"different version")
        different = self.queued_job(reuseExisting=False, ocrMissing=True)
        self.assertNotEqual(first["sourceSha256"], different["sourceSha256"])
        self.assertNotEqual(first["records"][0]["sourceFile"], different["records"][0]["sourceFile"])

    def test_raw_text_revision_and_candidates_survive_or_invalidate_correctly(self):
        job = self.completed_job()
        record = job["records"][0]
        job.update(extractedPages=[3], evidenceRows=[{"source_file": record["sourceFile"], "quote": "原始识别文本"}], extractedCount=1)
        self.service._save_job(job)
        saved = self.service.save_page_content(job["id"], 3, "人工校订文本", expected_revision=1)
        self.assertEqual(saved["rawText"], "原始识别文本")
        self.assertEqual(saved["record"]["revision"], 2)
        self.assertEqual(saved["record"]["edits"][0]["previousText"], "原始识别文本")
        with self.assertRaises(IngestError) as conflict:
            self.service.save_page_content(job["id"], 3, "过期覆盖", expected_revision=1)
        self.assertEqual(conflict.exception.status, 409)
        current = self.service.get_job(job["id"])
        self.assertEqual(current["extractedPages"], [])
        self.assertEqual(current["evidenceRows"], [])
        csv = self.service.output_path(job["id"], "pages.csv").read_text(encoding="utf-8-sig")
        self.assertIn("人工校订文本", csv)
        self.assertIn("原始识别文本", csv)
        self.assertIn("初版", csv)

    def test_restart_pauses_interrupted_job_and_resume_keeps_finished_pages(self):
        job = self.completed_job()
        job.update(status="running", extractionStatus="running")
        self.service._save_job(job)
        restarted = AncientIngestService(self.root)
        restored = restarted.get_job(job["id"])
        self.assertEqual(restored["status"], "paused")
        self.assertEqual(restored["extractionStatus"], "failed")
        with patch.object(restarted, "_process_page") as process:
            restarted._run_job(job["id"])
            process.assert_not_called()
        self.assertEqual(restarted.page_content(job["id"], 3)["text"], "原始识别文本")

    def test_failed_ocr_can_retry_and_changed_source_is_rejected(self):
        job = self.queued_job()
        with patch.object(self.service, "_process_page", side_effect=IngestError("OCR 超时")):
            self.service._run_job(job["id"])
        self.assertEqual(self.service.get_job(job["id"])["status"], "complete_with_errors")
        with patch.object(self.service, "_process_page", return_value=("重试成功", "ocr")):
            self.service._run_job(job["id"])
        self.assertEqual(self.service.get_job(job["id"])["failed"], 0)
        self.top_pdf.write_bytes(b"changed source")
        with self.assertRaises(IngestError):
            self.service._verified_source(self.service.get_job(job["id"]))

    def test_failed_extraction_remains_retryable(self):
        job = self.completed_job()
        def fail(*_):
            raise IngestError("temporary")
        self.service._run_extraction(job["id"], fail)
        self.assertEqual(self.service.get_job(job["id"])["extractedPages"], [])
        self.service._run_extraction(job["id"], lambda *_: [])
        current = self.service.get_job(job["id"])
        self.assertEqual(current["extractedPages"], [3])
        self.assertEqual(current["extractionErrors"], [])
        self.assertEqual(current["extractionStatus"], "complete")

    def test_symlink_outside_inbox_is_not_listed(self):
        external = self.root / "external.pdf"
        external.write_bytes(b"%PDF-external")
        (self.root / "inbox" / "escape.pdf").symlink_to(external)
        self.assertNotIn(self.root / "inbox" / "escape.pdf", self.service._pdf_paths())


if __name__ == "__main__":
    unittest.main()

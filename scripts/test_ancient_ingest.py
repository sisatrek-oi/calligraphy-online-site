import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from ancient_ingest import AncientIngestService


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
        page_path = self.service.jobs_root / job["id"] / "source-pages" / "page_3.txt"
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


if __name__ == "__main__":
    unittest.main()

import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from ancient_ingest import AncientIngestService


class QuietHandler(server.WorkspaceHandler):
    def log_message(self, *_args):
        pass


class IngestHttpTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = AncientIngestService(Path(self.temp.name))
        self.mock = patch.object(server, 'ancient_ingest_service', return_value=self.service)
        self.mock.start()
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}/api/ancient-ingest/pdfs/import'

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.mock.stop()
        self.temp.cleanup()

    def upload(self, data=b'%PDF-1.4\nexample', **headers):
        request = urllib.request.Request(self.url, data=data, headers={
            'Content-Type': 'application/pdf', 'X-PDF-Filename': 'book.pdf', **headers})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as exc:
            response = exc
        return response.status, json.loads(response.read())

    def test_upload_and_duplicate_are_persisted_via_http(self):
        with patch.object(self.service, '_pdf_info', return_value={'pages': 1, 'encrypted': False}):
            status, first = self.upload()
            self.assertEqual(status, 200)
            status, again = self.upload()
            self.assertEqual(status, 200)
            self.assertTrue(again['duplicate'])
            self.assertEqual(first['pdfId'], again['pdfId'])
            self.assertTrue(self.service._pdf_path(first['pdfId']).exists())

    def test_invalid_pdf_type_origin_and_name_rejected(self):
        self.assertEqual(self.upload(data=b'not a pdf')[0], 400)
        self.assertEqual(self.upload(**{'Content-Type':'application/json'})[0], 415)
        self.assertEqual(self.upload(**{'Origin':'https://example.com'})[0], 403)
        self.assertEqual(self.upload(**{'X-PDF-Filename':'../escape.pdf'})[0], 400)
        self.assertFalse(list(self.service.inbox_root.rglob('*.pdf')))

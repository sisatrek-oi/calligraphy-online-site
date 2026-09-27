"""Real HTTP auth/isolation tests; OCR is mocked here and separately rehearsed on scans."""
import http.cookiejar
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from simulation_auth import SimulationStore
from simulation_server import SimulationHTTPServer


class SimulationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name).resolve()
        cls.store = SimulationStore(cls.root)
        cls.credentials = dict(cls.store.seed_five())
        cls.http = SimulationHTTPServer(('127.0.0.1', 0), cls.store)
        cls.http.RequestHandlerClass.log_message = lambda *_: None
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.clients = {}
        for user, password in cls.credentials.items():
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            cls.clients[user] = client
            status, _ = cls.request(client, 'POST', '/api/simulation/login', {'account': user, 'password': password})
            assert status == 200
        cls.jobs = {}
        for user in cls.credentials:
            svc = cls.http.service_for(user)
            svc.inbox_root.mkdir(parents=True)
            source = svc.inbox_root / f'{user}.pdf'
            source.write_bytes(b'%PDF-1.4\n' + user.encode())
            with patch.object(svc, '_pdf_info', return_value={'title': user, 'pages': 1, 'encrypted': False}), patch.object(svc, 'capabilities', return_value={'ocrReady': True, 'ocrLanguages': 'chi_tra_vert', 'verticalReady': True}), patch.object(svc, 'resume_job'):
                job = svc.create_job({'pdfId': svc._pdf_id(source), 'reuseExisting': False})
            with patch.object(svc, '_process_page', return_value=(f'原始 OCR {user}', 'ocr')):
                svc._run_job(job['id'])
            cls.jobs[user] = svc.get_job(job['id'])

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()
        cls.temp.cleanup()

    @classmethod
    def request(cls, client, method, path, payload=None, user=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else (b'' if method in {'POST', 'PUT'} else None)
        hdrs = {'Origin': cls.base, 'Content-Type': 'application/json'}
        if user: hdrs['X-Simulation-User'] = user
        hdrs.update(headers or {})
        req = urllib.request.Request(cls.base + path, data=data, headers=hdrs, method=method)
        try:
            response = client.open(req, timeout=10)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            raw = response.read()
            try: body = json.loads(raw)
            except (ValueError, UnicodeError): body = raw
            return response.status, body

    def test_five_private_stores_persist_and_compare_revision(self):
        for user, client in self.clients.items():
            status, old = self.request(client, 'GET', '/api/simulation/storage', user=user)
            self.assertEqual(status, 200)
            payload = {'items': {'calligraphy-private': user}, 'revision': old['revision'], 'userId': 'test01'}
            self.assertEqual(self.request(client, 'PUT', '/api/simulation/storage', payload, user)[0], 200)
            self.assertEqual(self.request(client, 'PUT', '/api/simulation/storage', payload, user)[0], 409)
            self.assertEqual(SimulationStore(self.root).read(user)['items'], {'calligraphy-private': user})

    def test_twenty_cross_user_pairs_cannot_read_write_download_or_control(self):
        attempts = 0
        for viewer, client in self.clients.items():
            status, data = self.request(client, 'GET', '/api/ancient-ingest/jobs', user=viewer)
            self.assertEqual(status, 200)
            self.assertEqual([x['id'] for x in data['jobs']], [self.jobs[viewer]['id']])
            for owner, job in self.jobs.items():
                if viewer == owner: continue
                prefix = f"/api/ancient-ingest/jobs/{job['id']}"
                operations = [('GET', prefix, None), ('GET', prefix+'/pages/1', None),
                    ('GET', prefix+'/pages/1/preview', None), ('GET', prefix+'/outputs/pages.csv', None),
                    ('GET', prefix+'/outputs/evidence.csv', None), ('GET', prefix+'/outputs/ocr-manifest.json', None),
                    ('POST', prefix+'/pages/1', {'text': '越权覆盖', 'revision': 1}),
                    ('POST', prefix+'/pause', None), ('POST', prefix+'/resume', None)]
                for method, path, payload in operations:
                    with self.subTest(viewer=viewer, owner=owner, method=method, path=path):
                        self.assertEqual(self.request(client, method, path, payload, viewer)[0], 404)
                        attempts += 1
        self.assertEqual(attempts, 180)
        for owner, job in self.jobs.items():
            self.assertEqual(self.http.service_for(owner).page_content(job['id'], 1)['text'], f'原始 OCR {owner}')

    def test_owner_can_read_save_export_and_reject_stale_revision(self):
        user = 'test01'; client = self.clients[user]; job = self.jobs[user]
        prefix = f"/api/ancient-ingest/jobs/{job['id']}"
        page = self.request(client, 'GET', prefix+'/pages/1', user=user)[1]
        payload = {'text': '本人校订', 'revision': page['record']['revision']}
        self.assertEqual(self.request(client, 'POST', prefix+'/pages/1', payload, user)[0], 200)
        self.assertEqual(self.request(client, 'POST', prefix+'/pages/1', payload, user)[0], 409)
        status, csv = self.request(client, 'GET', prefix+'/outputs/pages.csv', user=user)
        self.assertEqual(status, 200); self.assertIn('本人校订', csv.decode('utf-8-sig'))
        # Restore content, preserving revision history, so matrix assertion remains independent.
        latest = self.http.service_for(user).page_content(job['id'], 1)
        self.http.service_for(user).save_page_content(job['id'], 1, '原始 OCR test01', latest['record']['revision'])

    def test_unauthenticated_api_and_forged_identity_are_rejected(self):
        anonymous = urllib.request.build_opener()
        for path in ['/api/ancient-ingest/jobs', '/api/simulation/storage', '/api/config']:
            self.assertEqual(self.request(anonymous, 'GET', path, user='test01')[0], 401)
        client = self.clients['test02']
        self.assertEqual(self.request(client, 'GET', '/api/simulation/storage', user='test01')[0], 409)
        self.assertEqual(self.request(client, 'PUT', '/api/simulation/storage', {'items': {}, 'revision': 0})[0], 409)

    def test_wrong_password_logout_expiry_and_missing_origin(self):
        jar = http.cookiejar.CookieJar()
        client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.assertEqual(self.request(client, 'POST', '/api/simulation/login', {'account': 'tongji', 'password': '123456'})[0], 401)
        credentials = {'account': 'test05', 'password': self.credentials['test05']}
        self.assertEqual(self.request(client, 'POST', '/api/simulation/login', credentials)[0], 200)
        cookie = next(iter(jar))
        self.assertIn('HttpOnly', cookie._rest)
        self.assertEqual(cookie._rest['SameSite'], 'Strict')
        old_token = cookie.value
        self.assertEqual(self.request(client, 'POST', '/api/simulation/logout', user='test05')[0], 200)
        self.assertIsNone(self.store.user(old_token))
        self.assertEqual(self.request(client, 'GET', '/api/simulation/storage')[0], 401)
        self.assertEqual(self.request(client, 'POST', '/api/simulation/login', credentials, headers={'Origin': ''})[0], 403)
        token = self.store.login('test05', credentials['password'])
        with self.store.connect() as db: db.execute('UPDATE sessions SET expires=0 WHERE username=?', ('test05',))
        self.assertIsNone(self.store.user(token))

    def test_static_bypass_csrf_and_shared_model_endpoints_blocked(self):
        client = self.clients['test01']
        for path in ['/.runtime/model-config.json', '/server.py', '/simulation_auth.py', '/.git/config',
                     '/cloud-config.json', '/src/../server.py', '/src/%2e%2e/server.py',
                     '/api/ancient-ingest/../../server.py', '/src/', '/data/sample/main.csv']:
            self.assertEqual(self.request(client, 'GET', path, user='test01')[0], 404, path)
        self.assertEqual(self.request(client, 'HEAD', '/server.py', user='test01')[0], 405)
        self.assertEqual(self.request(client, 'GET', '/api/simulation/storage', user='test01', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request(client, 'GET', '/api/simulation/storage', user='test01', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request(client, 'GET', '/api/model-config', user='test01')[0], 404)
        self.assertEqual(self.request(client, 'POST', '/api/ai/extract', {}, 'test01')[0], 404)
        self.assertEqual(self.request(client, 'GET', '/src/main.js')[0], 200)

    def test_cannot_create_job_from_another_users_pdf(self):
        for viewer, client in self.clients.items():
            for owner, job in self.jobs.items():
                if viewer == owner: continue
                status, _ = self.request(client, 'POST', '/api/ancient-ingest/jobs',
                    {'pdfId': job['sourcePdfId'], 'userId': owner}, viewer)
                self.assertEqual(status, 404)

    def test_seed_is_idempotent_and_no_shared_env_directory(self):
        self.assertEqual(self.store.seed_five(), [])
        roots = {self.http.service_for(u).runtime_root for u in self.credentials}
        self.assertEqual(len(roots), 5)
        self.assertTrue(all(p.is_relative_to(self.root / 'users') for p in roots))
        self.assertEqual((self.root / '测试账号.md').stat().st_mode & 0o777, 0o600)

if __name__ == '__main__': unittest.main()

"""Book work orders stay shared while access is scoped to the authenticated actor."""
import http.cookiejar
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from simulation_auth import AuthError, SimulationStore
from simulation_server import SimulationHTTPServer


class TeamTaskStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = SimulationStore(Path(self.temp.name))
        self.store.seed_five()

    def tearDown(self):
        self.temp.cleanup()

    def test_books_ranges_roles_and_revision(self):
        book = self.store.create_book('test01', {'title': '书谱', 'totalPages': 20, 'sourceNote': '扫描本'})
        with self.assertRaises(AuthError):
            self.store.create_book('test01', {'title': ' 书谱 ', 'totalPages': 20})
        other = self.store.create_book('test01', {'title': '续书谱', 'totalPages': 10})
        with self.assertRaises(AuthError):
            self.store.create_book('test02', {'title': '越权', 'totalPages': 3})
        a = self.store.add_unit('test01', book['id'], {'stage': 'proofread', 'startPage': 1, 'endPage': 10, 'assignee': 'test02', 'materialText': '待校原文'})
        with self.assertRaises(AuthError):
            self.store.add_unit('test01', book['id'], {'stage': 'proofread', 'startPage': 10, 'endPage': 15, 'assignee': 'test03'})
        b = self.store.add_unit('test01', book['id'], {'stage': 'screen', 'startPage': 1, 'endPage': 10, 'assignee': 'test03'})
        self.store.add_unit('test01', other['id'], {'stage': 'proofread', 'startPage': 1, 'endPage': 10, 'assignee': 'test04'})
        self.store.publish_book('test01', book['id'])
        self.assertEqual(self.store.get_unit('test02', a['id'])['materialText'], '待校原文')
        self.assertEqual([x['id'] for x in self.store.list_books('test02')], [book['id']])
        self.assertEqual([x['id'] for x in self.store.list_units('test02', book['id'])], [a['id']])
        with self.assertRaises(AuthError):
            self.store.get_unit('test02', b['id'])
        with self.assertRaises(AuthError):
            self.store.save_unit('test03', a['id'], {'revision': 0, 'text': '越权'})
        saved = self.store.save_unit('test02', a['id'], {'revision': 0, 'text': '已校原文'})
        self.assertEqual(saved['revision'], 1)
        with self.assertRaises(AuthError) as stale:
            self.store.save_unit('test02', a['id'], {'revision': 0, 'text': '旧稿'})
        self.assertEqual(stale.exception.status, 409)
        submitted = self.store.submit_unit('test02', a['id'], {'revision': 1})
        self.assertEqual(submitted['status'], 'submitted')
        returned = self.store.decide_unit('test01', a['id'], {'revision': 2, 'decision': 'return', 'reason': '请核第 8 页'})
        self.assertEqual(returned['status'], 'returned')
        with self.assertRaises(AuthError):
            self.store.submit_unit('test02', a['id'], {'revision': 3})
        revised = self.store.save_unit('test02', a['id'], {'revision': 3, 'text': '已重校第 8 页'})
        self.store.submit_unit('test02', a['id'], {'revision': revised['revision']})
        accepted = self.store.decide_unit('test01', a['id'], {'revision': 5, 'decision': 'accept'})
        self.assertEqual(accepted['status'], 'accepted')
        with self.assertRaises(AuthError):
            self.store.save_unit('test02', a['id'], {'revision': 6, 'text': '不可更改'})
        self.assertEqual([e['action'] for e in self.store.get_unit('test01', a['id'])['events']],
                         ['assigned', 'saved', 'submitted', 'returned', 'saved', 'submitted', 'accepted'])
        self.assertEqual(self.store.get_unit('test02', a['id'])['events'], [])
        self.assertEqual(self.store.list_books('test05'), [])

    def test_publish_requires_a_material_reference(self):
        book = self.store.create_book('test01', {'title': '无来源书', 'totalPages': 2})
        self.store.add_unit('test01', book['id'], {'stage': 'screen', 'startPage': 1, 'endPage': 2, 'assignee': 'test02'})
        with self.assertRaises(AuthError):
            self.store.publish_book('test01', book['id'])

    def test_reassignment_preserves_history_and_survives_restart(self):
        book = self.store.create_book('test01', {'title': '甲书', 'totalPages': 4, 'sourceNote': '纸本底本'})
        unit = self.store.add_unit('test01', book['id'], {'stage': 'proofread', 'startPage': 1, 'endPage': 4, 'assignee': 'test02'})
        self.store.publish_book('test01', book['id'])
        self.store.save_unit('test02', unit['id'], {'revision': 0, 'text': '旧负责人的校稿'})
        reassigned = self.store.assign_unit('test01', unit['id'], {'revision': 1, 'assignee': 'test03'})
        self.assertEqual(reassigned['assignee'], 'test03')
        with self.assertRaises(AuthError):
            self.store.get_unit('test02', unit['id'])
        reopened = SimulationStore(self.store.root)
        self.assertEqual(reopened.get_unit('test03', unit['id'])['text'], '旧负责人的校稿')
        self.assertEqual(reopened.get_unit('test01', unit['id'])['events'][-1]['action'], 'reassigned')


class TeamTaskHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.store = SimulationStore(Path(cls.temp.name))
        credentials = dict(cls.store.seed_five())
        cls.http = SimulationHTTPServer(('127.0.0.1', 0), cls.store)
        cls.http.RequestHandlerClass.log_message = lambda *_: None
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'
        cls.clients = {}
        for user, password in credentials.items():
            client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            cls.clients[user] = client
            cls.request(client, 'POST', '/api/simulation/login', {'account': user, 'password': password})

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join(); cls.temp.cleanup()

    @classmethod
    def request(cls, client, method, path, payload=None, user=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else (b'' if method == 'POST' else None)
        hdrs = {'Origin': cls.base, 'Content-Type': 'application/json'}
        if user: hdrs['X-Simulation-User'] = user
        hdrs.update(headers or {})
        request = urllib.request.Request(cls.base + path, data=data, headers=hdrs, method=method)
        try: response = client.open(request, timeout=10)
        except urllib.error.HTTPError as error: response = error
        with response:
            content = response.read()
            try: body = json.loads(content)
            except ValueError: body = content
            return response.status, body

    def test_http_publication_and_worker_visibility(self):
        manager = self.clients['test01']; worker = self.clients['test02']; other = self.clients['test03']
        self.assertEqual(self.request(worker, 'POST', '/api/team-tasks/books', {'title': '越权', 'totalPages': 2}, 'test02')[0], 403)
        status, book = self.request(manager, 'POST', '/api/team-tasks/books', {'title': '书谱', 'totalPages': 10, 'sourceNote': '共享扫描本'}, 'test01')
        self.assertEqual(status, 200)
        status, unit = self.request(manager, 'POST', f"/api/team-tasks/books/{book['id']}/units",
                                    {'stage': 'proofread', 'startPage': 1, 'endPage': 10, 'assignee': 'test02'}, 'test01')
        self.assertEqual(status, 200)
        self.assertEqual(self.request(worker, 'GET', '/api/team-tasks', user='test02')[1]['books'], [])
        self.assertEqual(self.request(manager, 'POST', f"/api/team-tasks/books/{book['id']}/publish", {}, 'test01')[0], 200)
        self.assertEqual(self.request(worker, 'GET', '/api/team-tasks', user='test02')[1]['books'][0]['id'], book['id'])
        self.assertEqual(self.request(other, 'GET', f"/api/team-tasks/units/{unit['id']}", user='test03')[0], 404)
        self.assertEqual(self.request(worker, 'POST', f"/api/team-tasks/units/{unit['id']}/save",
                                      {'revision': 0, 'text': '校稿'}, 'test02')[0], 200)
        self.assertEqual(self.request(worker, 'POST', f"/api/team-tasks/units/{unit['id']}/save",
                                      {'revision': 0, 'text': '旧稿'}, 'test02')[0], 409)
        self.assertEqual(self.request(other, 'POST', f"/api/team-tasks/units/{unit['id']}/submit",
                                      {'revision': 1}, 'test03')[0], 404)
        self.assertEqual(self.request(worker, 'POST', f"/api/team-tasks/units/{unit['id']}/submit",
                                      {'revision': 1}, 'test02')[0], 200)
        self.assertEqual(self.request(manager, 'POST', f"/api/team-tasks/units/{unit['id']}/decide",
                                      {'revision': 2, 'decision': 'accept'}, 'test01')[0], 200)
        self.assertEqual(self.request(manager, 'GET', '/team-tasks.html')[0], 200)
        self.assertEqual(self.request(urllib.request.build_opener(), 'GET', '/api/team-tasks', user='test01')[0], 401)
        self.assertEqual(self.request(manager, 'POST', '/api/team-tasks/books', {'title': '跨站', 'totalPages': 2}, 'test01', {'Origin': 'https://evil.example'})[0], 403)


if __name__ == '__main__': unittest.main()

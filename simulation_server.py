#!/usr/bin/env python3
"""Local rehearsal only. Not a public/production server."""
import argparse
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
import json
import re
from pathlib import Path
import threading
import time
from urllib.parse import urlparse, unquote

from ancient_ingest import AncientIngestService
from server import ROOT, WorkspaceHandler
from simulation_auth import AuthError, SimulationStore

COOKIE = 'shulun_sim_session'


class SimulationHTTPServer(ThreadingHTTPServer):
    def __init__(self, address, store):
        if address[0] != '127.0.0.1':
            raise ValueError('模拟服务器只允许监听 127.0.0.1')
        self.store = store
        self.services = {}
        self.service_lock = threading.Lock()
        self.login_failures = []
        self.login_lock = threading.Lock()
        super().__init__(address, SimulationHandler)

    def service_for(self, username):
        with self.service_lock:
            if username not in self.services:
                root = self.store.root / 'users' / username
                self.services[username] = AncientIngestService(ROOT, inbox_root=root / 'inbox', runtime_root=root / 'ingest')
            return self.services[username]


class SimulationHandler(WorkspaceHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
            return cookie[COOKIE].value if COOKIE in cookie else ''
        except Exception:
            return ''

    def _boundary(self):
        hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        host = self.headers.get('Host', '')
        if host not in hosts:
            raise AuthError('主机地址无效', 403)
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{host}':
            raise AuthError('不允许跨站访问', 403)
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise AuthError('不允许跨站访问', 403)
        if self.command in {'POST', 'PUT', 'DELETE'} and origin != f'http://{host}':
            raise AuthError('修改操作需要同源请求', 403)

    def _authenticated(self):
        username = self.server.store.user(self.token())
        if not username:
            raise AuthError('请先登录测试账号', 401)
        expected = self.headers.get('X-Simulation-User')
        if self.command in {'POST', 'PUT', 'DELETE'} and expected != username:
            raise AuthError('账号已切换，请刷新页面后操作', 409)
        if expected and expected != username:
            raise AuthError('账号已切换，请刷新页面后操作', 409)
        self.username = username
        return username

    def _ingest_service(self):
        return self.server.service_for(self.username)

    def _ingest_request_allowed(self):
        return bool(getattr(self, 'username', None))

    def _body(self, maximum=10000):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > maximum:
                raise AuthError('请求大小无效', 413)
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise AuthError('需要 JSON 请求', 415)
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError()
            return payload
        except (ValueError, UnicodeError):
            raise AuthError('请求格式无效')

    def _session_json(self, payload, token=''):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        # HTTP is accepted only for the loopback rehearsal; production requires HTTPS.
        self.send_header('Set-Cookie', f'{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={28800 if token else 0}')
        self.end_headers()
        self.wfile.write(body)

    def _static(self):
        path = unquote(urlparse(self.path).path)
        if path in {'/review.html', '/team-tasks.html', '/screening.html'}:
            # Independent static file exchange UI, containing no server/private data.
            super().do_GET()
            return
        if path in {'/', '/index.html'}:
            page = (ROOT / 'index.html').read_text()
            page = page.replace('<script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>', '')
            page = page.replace('<div id="app"></div>', '<div id="app"></div>\n<script src="/src/simulation-session.js?v=20260929-unified-login"></script>')
            data = page.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        target = (ROOT / path.lstrip('/')).resolve()
        if (path.startswith('/screening-data/') and target.is_relative_to(ROOT / 'screening-data')
                and target.suffix.lower() in {'.json', '.txt', '.pdf', '.jpg', '.jpeg'} and target.is_file()):
            super().do_GET()
            return
        if (not path.startswith('/src/') or not target.is_relative_to(ROOT / 'src')
                or target.suffix not in {'.js', '.css', '.png'} or not target.is_file()):
            raise AuthError('not found', 404)
        super().do_GET()

    def _dispatch(self):
        try:
            self._boundary()
            path = urlparse(self.path).path
            method = self.command
            if method == 'GET' and path == '/api/simulation/me':
                user = self.server.store.user(self.token())
                self._send_json({'user': user, 'role': self.server.store.task_role(user) if user else None, 'simulation': True})
                return
            if method == 'POST' and path == '/api/simulation/login':
                payload = self._body()
                # Serialize bounded password checks to avoid unbounded parallel PBKDF work.
                with self.server.login_lock:
                    now = time.monotonic()
                    self.server.login_failures = [t for t in self.server.login_failures if now - t < 60]
                    if len(self.server.login_failures) >= 10:
                        raise AuthError('登录尝试过多，请一分钟后重试', 429)
                    try:
                        token = self.server.store.login(payload.get('account'), payload.get('password'))
                    except AuthError:
                        self.server.login_failures.append(now)
                        raise
                self.server.store.logout(self.token())
                self._session_json({'ok': True}, token)
                return
            if method == 'GET' and not path.startswith('/api/'):
                self._static()
                return
            self._authenticated()
            if method == 'POST' and path == '/api/simulation/logout':
                self.server.store.logout(self.token())
                self._session_json({'ok': True})
            elif method == 'GET' and path == '/api/simulation/storage':
                self._send_json(self.server.store.read(self.username))
            elif method == 'PUT' and path == '/api/simulation/storage':
                self._send_json(self.server.store.write(self.username, self._body(17_000_000)))
            elif method == 'GET' and path == '/api/config':
                self._send_json({'enabled': False, 'aiEnabled': False, 'simulation': True})
            elif path.startswith('/api/team-tasks'):
                store = self.server.store
                book_units = re.fullmatch(r'/api/team-tasks/books/([a-f0-9]{16})/units', path)
                book_publish = re.fullmatch(r'/api/team-tasks/books/([a-f0-9]{16})/publish', path)
                unit = re.fullmatch(r'/api/team-tasks/units/([a-f0-9]{16})(?:/(save|submit|decide|assign))?', path)
                if method == 'GET' and path == '/api/team-tasks':
                    self._send_json({'user': self.username, 'role': store.task_role(self.username),
                                     'books': store.list_books(self.username)})
                elif method == 'POST' and path == '/api/team-tasks/books':
                    self._send_json(store.create_book(self.username, self._body()))
                elif book_units and method == 'GET':
                    self._send_json({'units': store.list_units(self.username, book_units[1])})
                elif book_units and method == 'POST':
                    self._send_json(store.add_unit(self.username, book_units[1], self._body(1_500_000)))
                elif book_publish and method == 'POST':
                    self._body()
                    self._send_json(store.publish_book(self.username, book_publish[1]))
                elif unit and method == 'GET' and not unit[2]:
                    self._send_json(store.get_unit(self.username, unit[1]))
                elif unit and method == 'POST' and unit[2] in {'save', 'submit', 'decide', 'assign'}:
                    payload = self._body(1_500_000)
                    action = {'save': store.save_unit, 'submit': store.submit_unit,
                              'decide': store.decide_unit, 'assign': store.assign_unit}[unit[2]]
                    self._send_json(action(self.username, unit[1], payload))
                else:
                    raise AuthError('not found', 404)
            elif path.startswith('/api/ancient-ingest/') and method in {'GET', 'POST'}:
                valid = re.fullmatch(r'/api/ancient-ingest/(?:pdfs(?:/import)?|jobs(?:/[a-f0-9]{12}(?:/(?:pause|resume|extract)|/pages/-?\d+(?:/preview)?|/outputs/(?:pages\.csv|evidence\.csv|ocr-manifest\.json))?)?)', path)
                if not valid:
                    raise AuthError('not found', 404)
                if path.endswith('/extract'):
                    raise AuthError('模拟环境未接入付费模型；请使用已有候选或手工测试数据演练审核。', 501)
                if method == 'GET':
                    super().do_GET()
                else:
                    super().do_POST()
            else:
                raise AuthError('模拟环境未启用此接口', 404)
        except AuthError as exc:
            self.close_connection = True
            self._send_json({'error': str(exc)}, exc.status)
        except Exception:
            self.close_connection = True
            self._send_json({'error': '模拟服务处理失败'}, 500)

    do_GET = _dispatch
    do_POST = _dispatch
    do_PUT = _dispatch
    do_DELETE = _dispatch

    def do_HEAD(self):
        self.send_error(405)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8773)
    args = parser.parse_args()
    if args.data_root.resolve().is_relative_to(ROOT):
        parser.error('模拟数据必须保存在代码仓库之外')
    store = SimulationStore(args.data_root)
    store.seed_five()
    http = SimulationHTTPServer(('127.0.0.1', args.port), store)
    print(f'Local simulation: http://127.0.0.1:{http.server_port}/index.html#ingest', flush=True)
    print(f'Account file: {store.root / "测试账号.md"}', flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        http.server_close()


if __name__ == '__main__':
    main()

"""Persistent identity and storage for the loopback-only five-user rehearsal."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time


class AuthError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class SimulationStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / 'accounts.sqlite3'
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS storage (
                    username TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
            ''')
        os.chmod(self.path, 0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    @staticmethod
    def digest(password, salt):
        return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()

    def seed_five(self):
        """Only create missing accounts; never reset existing credentials or data."""
        created = []
        with self.connect() as db:
            for n in range(1, 6):
                username = f'test{n:02d}'
                if db.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
                    continue
                password = secrets.token_urlsafe(12)
                salt = secrets.token_hex(16)
                db.execute('INSERT INTO users VALUES (?,?,?)', (username, salt, self.digest(password, salt)))
                db.execute('INSERT INTO storage VALUES (?,0,?)', (username, '{}'))
                created.append((username, password))
        if created:
            path = self.root / '测试账号.md'
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, 'w') as out:
                out.write('# 本地模拟账号（仅用于本轮测试，不用于正式上线）\n\n| 账号 | 密码 |\n|---|---|\n')
                for username, password in created:
                    out.write(f'| {username} | {password} |\n')
                out.write('\n各账号独立保存材料与工作区。共同内置样例不是私人数据。\n')
        return created

    def login(self, username, password):
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > 256:
            raise AuthError('账号或密码不正确', 401)
        with self.connect() as db:
            row = db.execute('SELECT salt,digest FROM users WHERE username=?', (username,)).fetchone()
            candidate = self.digest(password, row[0] if row else '00' * 16)
            if not row or not hmac.compare_digest(candidate, row[1]):
                raise AuthError('账号或密码不正确', 401)
            token = secrets.token_urlsafe(32)
            db.execute('DELETE FROM sessions WHERE expires < ?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES (?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), username, time.time() + 8 * 3600))
        return token

    def user(self, token):
        with self.connect() as db:
            row = db.execute('SELECT username FROM sessions WHERE token_hash=? AND expires>?',
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return row[0] if row else None

    def logout(self, token):
        with self.connect() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))

    def read(self, username):
        with self.connect() as db:
            row = db.execute('SELECT revision,payload FROM storage WHERE username=?', (username,)).fetchone()
        if not row:
            raise AuthError('账号不存在', 401)
        return {'revision': row[0], 'items': json.loads(row[1])}

    def write(self, username, payload):
        items, revision = payload.get('items'), payload.get('revision')
        if (type(revision) is not int or not isinstance(items, dict)
                or len(items) > 1000 or any(not isinstance(k, str) or not k.startswith('calligraphy-')
                or not isinstance(v, str) for k, v in items.items())):
            raise AuthError('工作区数据无效')
        serialized = json.dumps(items, ensure_ascii=False)
        if len(serialized.encode()) > 16_000_000:
            raise AuthError('模拟工作区超过 16 MB，请先导出备份', 413)
        with self.connect() as db:
            changed = db.execute('UPDATE storage SET revision=revision+1,payload=? WHERE username=? AND revision=?',
                                 (serialized, username, revision))
            if changed.rowcount != 1:
                raise AuthError('其他页面已更新工作区；请先导出本页备份，再刷新。', 409)
        return {'revision': revision + 1}

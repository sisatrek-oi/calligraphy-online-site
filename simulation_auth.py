"""Persistent identity and storage for the loopback-only five-user rehearsal."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
import unicodedata


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
                CREATE TABLE IF NOT EXISTS book_tasks (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, total_pages INTEGER NOT NULL,
                    source_note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
                    created_by TEXT NOT NULL, created_at REAL NOT NULL, published_at REAL);
                CREATE TABLE IF NOT EXISTS work_units (
                    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES book_tasks(id),
                    stage TEXT NOT NULL, start_page INTEGER NOT NULL, end_page INTEGER NOT NULL,
                    assignee TEXT NOT NULL REFERENCES users(username), status TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0, material_text TEXT NOT NULL DEFAULT '',
                    draft_text TEXT NOT NULL DEFAULT '',
                    return_reason TEXT NOT NULL DEFAULT '', updated_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS work_unit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id TEXT NOT NULL REFERENCES work_units(id),
                    actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS idx_work_units_book ON work_units(book_id, stage, start_page);
                CREATE INDEX IF NOT EXISTS idx_work_units_assignee ON work_units(assignee, status);
            ''')
        os.chmod(self.path, 0o600)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

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

    @staticmethod
    def task_role(username):
        return 'admin' if username == 'test01' else 'worker'

    @staticmethod
    def _short(value, label, maximum=200, required=True):
        if not isinstance(value, str):
            raise AuthError(f'{label}无效')
        result = value.strip()
        if len(result) > maximum or (required and not result):
            raise AuthError(f'{label}无效')
        return result

    @staticmethod
    def _page(value, label):
        if type(value) is not int or value < 1 or value > 100000:
            raise AuthError(f'{label}无效')
        return value

    @staticmethod
    def _manager(actor):
        if actor != 'test01':
            raise AuthError('只有管理员可以执行此操作', 403)

    @staticmethod
    def _book(db, book_id):
        book = db.execute('SELECT * FROM book_tasks WHERE id=?', (book_id,)).fetchone()
        if not book:
            raise AuthError('古籍任务不存在', 404)
        return book

    @staticmethod
    def _unit(db, unit_id):
        unit = db.execute('SELECT u.*, b.status AS book_status FROM work_units u JOIN book_tasks b ON b.id=u.book_id WHERE u.id=?', (unit_id,)).fetchone()
        if not unit:
            raise AuthError('工作项不存在', 404)
        return unit

    @staticmethod
    def _revision(unit, payload):
        if type(payload.get('revision')) is not int or payload['revision'] != unit['revision']:
            raise AuthError('工作项已被更新，请重新读取后合并修改', 409)

    @staticmethod
    def _event(db, unit_id, actor, action, note=''):
        db.execute('INSERT INTO work_unit_events(unit_id,actor,action,note,at) VALUES (?,?,?,?,?)',
                   (unit_id, actor, action, note, time.time()))

    @staticmethod
    def _book_json(book):
        return {'id': book['id'], 'title': book['title'], 'totalPages': book['total_pages'],
                'sourceNote': book['source_note'], 'status': book['status'],
                'createdBy': book['created_by'], 'createdAt': book['created_at'],
                'publishedAt': book['published_at']}

    @staticmethod
    def _unit_json(unit):
        return {'id': unit['id'], 'bookId': unit['book_id'], 'stage': unit['stage'],
                'startPage': unit['start_page'], 'endPage': unit['end_page'],
                'assignee': unit['assignee'], 'status': unit['status'],
                'revision': unit['revision'], 'materialText': unit['material_text'], 'text': unit['draft_text'],
                'returnReason': unit['return_reason'], 'updatedAt': unit['updated_at']}

    def create_book(self, actor, payload):
        self._manager(actor)
        title = self._short(unicodedata.normalize('NFKC', payload.get('title')) if isinstance(payload.get('title'), str) else None, '书名')
        pages = self._page(payload.get('totalPages'), '总页数')
        note = self._short(payload.get('sourceNote', ''), '来源说明', 1000, False)
        book_id = secrets.token_hex(8)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            normalized = ' '.join(title.split()).casefold()
            if any(' '.join(row['title'].split()).casefold() == normalized
                   for row in db.execute('SELECT title FROM book_tasks')):
                raise AuthError('该古籍任务已存在', 409)
            db.execute('INSERT INTO book_tasks VALUES (?,?,?,?,?,?,?,NULL)',
                       (book_id, title, pages, note, 'draft', actor, time.time()))
            return self._book_json(self._book(db, book_id))

    def add_unit(self, actor, book_id, payload):
        self._manager(actor)
        stage = payload.get('stage')
        if stage not in {'proofread', 'screen', 'review'}:
            raise AuthError('处理环节无效')
        start = self._page(payload.get('startPage'), '起始页')
        end = self._page(payload.get('endPage'), '结束页')
        assignee = self._short(payload.get('assignee'), '负责人', 80)
        material = self._short(payload.get('materialText', ''), '原始材料', 200000, False)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            book = self._book(db, book_id)
            if book['status'] != 'draft':
                raise AuthError('任务发布后不可再拆分', 409)
            if end < start or end > book['total_pages']:
                raise AuthError('页段超出古籍范围')
            if not db.execute('SELECT 1 FROM users WHERE username=?', (assignee,)).fetchone() or assignee == 'test01':
                raise AuthError('负责人必须是现有工作人员')
            overlap = db.execute('SELECT 1 FROM work_units WHERE book_id=? AND stage=? AND start_page<=? AND end_page>=?',
                                 (book_id, stage, end, start)).fetchone()
            if overlap:
                raise AuthError('同一环节的页段不能重叠', 409)
            unit_id = secrets.token_hex(8)
            db.execute('INSERT INTO work_units(id,book_id,stage,start_page,end_page,assignee,status,material_text,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
                       (unit_id, book_id, stage, start, end, assignee, 'assigned', material, time.time()))
            self._event(db, unit_id, actor, 'assigned', assignee)
            return self._unit_json(self._unit(db, unit_id))

    def publish_book(self, actor, book_id):
        self._manager(actor)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            book = self._book(db, book_id)
            if book['status'] != 'draft':
                raise AuthError('古籍任务已发布', 409)
            if not db.execute('SELECT 1 FROM work_units WHERE book_id=?', (book_id,)).fetchone():
                raise AuthError('请先拆分至少一个工作项')
            if not book['source_note'] and db.execute('SELECT 1 FROM work_units WHERE book_id=? AND material_text=?',
                                                      (book_id, '')).fetchone():
                raise AuthError('请填写来源说明，或给每个工作项附上原始材料')
            db.execute('UPDATE book_tasks SET status=?,published_at=? WHERE id=?', ('published', time.time(), book_id))
            return self._book_json(self._book(db, book_id))

    def list_books(self, actor):
        with self.connect() as db:
            if self.task_role(actor) == 'admin':
                books = db.execute('SELECT * FROM book_tasks ORDER BY created_at DESC').fetchall()
            else:
                books = db.execute('''SELECT DISTINCT b.* FROM book_tasks b JOIN work_units u ON u.book_id=b.id
                                      WHERE b.status='published' AND u.assignee=? ORDER BY b.created_at DESC''', (actor,)).fetchall()
            return [self._book_json(book) for book in books]

    def list_units(self, actor, book_id):
        with self.connect() as db:
            book = self._book(db, book_id)
            if self.task_role(actor) != 'admin' and book['status'] != 'published':
                raise AuthError('古籍任务不存在', 404)
            if self.task_role(actor) == 'admin':
                units = db.execute('SELECT * FROM work_units WHERE book_id=? ORDER BY stage,start_page', (book_id,)).fetchall()
            else:
                units = db.execute('SELECT * FROM work_units WHERE book_id=? AND assignee=? ORDER BY stage,start_page', (book_id, actor)).fetchall()
                if not units:
                    raise AuthError('古籍任务不存在', 404)
            return [self._unit_json(unit) for unit in units]

    def get_unit(self, actor, unit_id):
        with self.connect() as db:
            unit = self._unit(db, unit_id)
            if self.task_role(actor) != 'admin' and (unit['book_status'] != 'published' or unit['assignee'] != actor):
                raise AuthError('工作项不存在', 404)
            result = self._unit_json(unit)
            result['events'] = ([dict(item) for item in db.execute('SELECT actor,action,note,at FROM work_unit_events WHERE unit_id=? ORDER BY id', (unit_id,))]
                                if self.task_role(actor) == 'admin' else [])
            return result

    def save_unit(self, actor, unit_id, payload):
        text = payload.get('text')
        if not isinstance(text, str) or len(text) > 200000:
            raise AuthError('工作文本无效')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            unit = self._unit(db, unit_id)
            if unit['book_status'] != 'published' or unit['assignee'] != actor:
                raise AuthError('工作项不存在', 404)
            self._revision(unit, payload)
            if unit['status'] not in {'assigned', 'in_progress', 'returned'}:
                raise AuthError('当前状态不可保存', 409)
            db.execute('UPDATE work_units SET draft_text=?,status=?,revision=revision+1,updated_at=? WHERE id=?',
                       (text, 'in_progress', time.time(), unit_id))
            self._event(db, unit_id, actor, 'saved')
            return self._unit_json(self._unit(db, unit_id))

    def submit_unit(self, actor, unit_id, payload):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            unit = self._unit(db, unit_id)
            if unit['book_status'] != 'published' or unit['assignee'] != actor:
                raise AuthError('工作项不存在', 404)
            self._revision(unit, payload)
            if unit['status'] != 'in_progress' or not unit['draft_text'].strip():
                raise AuthError('请先保存工作内容', 409)
            db.execute('UPDATE work_units SET status=?,revision=revision+1,updated_at=? WHERE id=?',
                       ('submitted', time.time(), unit_id))
            self._event(db, unit_id, actor, 'submitted')
            return self._unit_json(self._unit(db, unit_id))

    def decide_unit(self, actor, unit_id, payload):
        self._manager(actor)
        decision = payload.get('decision')
        if decision not in {'accept', 'return'}:
            raise AuthError('验收决定无效')
        reason = self._short(payload.get('reason', ''), '退回理由', 1000, decision == 'return')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            unit = self._unit(db, unit_id)
            self._revision(unit, payload)
            if unit['status'] != 'submitted':
                raise AuthError('仅待验收工作项可处理', 409)
            new_status = 'accepted' if decision == 'accept' else 'returned'
            db.execute('UPDATE work_units SET status=?,return_reason=?,revision=revision+1,updated_at=? WHERE id=?',
                       (new_status, reason, time.time(), unit_id))
            self._event(db, unit_id, actor, 'accepted' if decision == 'accept' else 'returned', reason)
            return self._unit_json(self._unit(db, unit_id))

    def assign_unit(self, actor, unit_id, payload):
        self._manager(actor)
        assignee = self._short(payload.get('assignee'), '负责人', 80)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            unit = self._unit(db, unit_id)
            self._revision(unit, payload)
            if unit['status'] == 'accepted':
                raise AuthError('已验收工作项不可改派', 409)
            if assignee == 'test01' or not db.execute('SELECT 1 FROM users WHERE username=?', (assignee,)).fetchone():
                raise AuthError('负责人必须是现有工作人员')
            if assignee == unit['assignee']:
                raise AuthError('负责人未变化')
            db.execute('UPDATE work_units SET assignee=?,status=?,return_reason=?,revision=revision+1,updated_at=? WHERE id=?',
                       (assignee, 'assigned', '', time.time(), unit_id))
            self._event(db, unit_id, actor, 'reassigned', f"{unit['assignee']} → {assignee}")
            return self._unit_json(self._unit(db, unit_id))

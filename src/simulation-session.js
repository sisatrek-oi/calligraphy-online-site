/* Loaded only by simulation_server.py. No credentials or private data in browser storage. */
(() => {
  const rawFetch = window.fetch.bind(window);
  let items = {}, revision = 0, generation = 0, savedGeneration = 0;
  let saving = null, failure = '', timer = 0;
  const session = { user: null, storage: null, ready: null };
  const statusId = 'simulation-save-status';

  function status() {
    let node = document.getElementById(statusId);
    if (!node) {
      node = document.createElement('div');
      node.id = statusId;
      node.setAttribute('role', 'status');
      Object.assign(node.style, { position: 'fixed', bottom: '8px', right: '8px', zIndex: '9999',
        background: '#fff8e8', color: '#403927', border: '1px solid #c9b994', borderRadius: '6px',
        padding: '6px 10px', fontSize: '12px', maxWidth: 'calc(100vw - 16px)' });
      document.body.append(node);
    }
    node.textContent = `本地隔离模拟${session.user ? ` · ${session.user}` : ''} · ${failure || (!session.user ? '请登录测试账号' : generation !== savedGeneration ? '工作区保存中…' : '工作区已保存')}`;
    if (failure) {
      const backup = document.createElement('button');
      backup.textContent = '下载本页备份';
      backup.onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ user: session.user, items }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `${session.user}-recovery.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      node.append(backup);
    }
  }

  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (session.user && url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('X-Simulation-User', session.user);
      options = { ...options, headers };
    }
    return rawFetch(input, options);
  };

  async function api(path, options) {
    const response = await fetch(path, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  }

  async function flush() {
    clearTimeout(timer);
    if (failure) throw new Error(failure);
    if (saving) { await saving; return flush(); }
    if (generation === savedGeneration) return;
    const target = generation;
    const body = JSON.stringify({ revision, items });
    saving = api('/api/simulation/storage', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      .then(data => { revision = data.revision; savedGeneration = target; })
      .catch(error => { failure = error.message; throw error; })
      .finally(() => { saving = null; status(); });
    await saving;
    if (generation !== savedGeneration) await flush();
  }

  function changed() {
    if (!session.user) throw new Error('请先登录');
    if (failure) throw new Error(failure);
    generation += 1;
    status(); clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), 150);
  }

  session.storage = {
    get length() { return Object.keys(items).length; },
    key(index) { return Object.keys(items)[index] ?? null; },
    getItem(key) { return Object.hasOwn(items, key) ? items[key] : null; },
    setItem(key, value) { if (items[key] === String(value)) return; changed(); items[key] = String(value); },
    removeItem(key) { if (Object.hasOwn(items, key)) { changed(); delete items[key]; } }
  };
  session.flush = flush;
  session.login = async (account, password) => {
    await api('/api/simulation/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) });
    window.localStorage.setItem('simulation-identity-changed', String(Date.now()));
    location.reload();
  };
  session.logout = async () => {
    await flush();
    await api('/api/simulation/logout', { method: 'POST' });
    window.localStorage.setItem('simulation-identity-changed', String(Date.now()));
    location.reload();
  };
  session.ready = (async () => {
    const me = await api('/api/simulation/me');
    session.user = me.user;
    if (session.user) {
      const stored = await api('/api/simulation/storage');
      items = stored.items; revision = stored.revision;
    }
    status();
  })();
  window.addEventListener('beforeunload', event => {
    if (generation !== savedGeneration) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'simulation-identity-changed') return;
    clearTimeout(timer);
    if (generation === savedGeneration) location.reload();
    else {
      failure = '账号已切换；本页停止保存，请下载备份后刷新。';
      document.getElementById('app').hidden = true;
      status();
    }
  });
  window.CalligraphySession = session;
})();

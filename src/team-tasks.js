(() => {
  const app = document.querySelector('#teamTasksApp');
  const state = { user: null, role: null, books: [], units: [], bookId: '', unitId: '', unit: null,
    draft: '', dirty: false, error: '', notice: '', loading: false, offline: false };
  const labels = { proofread: '原文校对', screen: '全书初筛', review: '条目审核',
    assigned: '待处理', in_progress: '进行中', submitted: '待验收', returned: '需修改', accepted: '已验收',
    draft: '草稿', published: '已发布' };
  const loginUrl = './index.html?login=1&next=team-tasks';
  const esc = (value = '') => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const label = (value) => labels[value] || value;

  async function api(path, method = 'GET', payload) {
    const headers = {};
    if (state.user) headers['X-Simulation-User'] = state.user;
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { method, headers, cache: 'no-store',
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload || {}) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  }

  function messages() {
    return `${state.error ? `<p class="message error" role="alert">${esc(state.error)}</p>` : ''}
      ${state.notice ? `<p class="message success" role="status">${esc(state.notice)}</p>` : ''}`;
  }

  function shell(content) {
    app.innerHTML = `<div class="team-shell">
      <aside class="team-app-sidebar" id="teamAppSidebar" aria-label="工作区导航">
        <a class="team-sidebar-brand" href="./index.html#home"><img src="./src/assets/shulun-mark.png" alt="" /><span><strong>书论工作区</strong><small>团队任务</small></span></a>
        <nav class="team-sidebar-nav" aria-label="平台导航">
          <a href="./index.html#home">工作台</a>
          <a href="./index.html#ingest">材料准备</a>
          <a class="active" href="./team-tasks.html" aria-current="page">团队任务</a>
          <span class="team-sidebar-section">整理与审校</span>
          <a href="./index.html#detail">统一主表</a>
          <a href="./index.html#review">回检修订</a>
          <a href="./review.html">文件审核</a>
        </nav>
        ${state.user ? `<div class="team-sidebar-account"><span>${esc(state.user)} · ${state.role === 'admin' ? '管理员' : '工作人员'}</span><button type="button" data-logout>退出登录</button></div>` : ''}
      </aside>
      <button type="button" class="team-sidebar-scrim" data-sidebar-close aria-label="关闭导航"></button>
      <div class="team-content"><header class="team-mobile-header"><button type="button" data-sidebar-toggle aria-controls="teamAppSidebar" aria-expanded="false" aria-label="打开工作区导航">☰</button><strong>团队任务</strong></header>
        <main>${messages()}${content}</main>
      </div>
    </div>`;
  }

  function offline() {
    const ranges = [[1, 258], [259, 527], [528, 776], [777, 1052]];
    shell(`<section class="intro narrow"><span class="eyebrow">静态团队任务 · 待人工初筛</span><h1>《历代书法论文选》全书初筛</h1>
      <p>1052 个原 PDF 物理页，四份连续页段。成员选自己的页段，载入已解压的扫描图，在网页逐页记录并导出回收表。</p>
      <p class="static-note">静态站不识别成员身份，也不共享实时进度；审核记录保存在当前浏览器，提交以导出的两张 CSV 为准。</p>
      <div class="static-units">${ranges.map(([start, end], index) => `<article><span class="eyebrow">审核成员 ${index + 1}</span><h2>原 PDF 第 ${start}–${end} 页</h2><p>${end - start + 1} 页 · 尚待人工初筛</p><a href="./screening.html?part=${index + 1}">进入逐页审核 →</a></article>`).join('')}</div></section>`);
  }

  function booksPanel() {
    return `<aside class="books"><div class="panel-head"><div><span class="eyebrow">古籍</span><h2>${state.role === 'admin' ? '已建任务' : '我的任务'}</h2></div><button type="button" data-refresh aria-label="刷新任务">↻</button></div>
      <div class="book-list">${state.books.map((book) => `<button type="button" data-book="${esc(book.id)}" class="${book.id === state.bookId ? 'selected' : ''}">
        <strong>${esc(book.title)}</strong><span>${book.totalPages} 页 · ${label(book.status)}</span></button>`).join('') || '<p class="empty">暂时没有任务</p>'}</div>
      ${state.role === 'admin' ? `<form id="createBookForm" class="stack subtle"><h3>新建古籍任务</h3>
        <label>书名<input name="title" maxlength="200" required placeholder="例如：书谱" /></label>
        <label>总页数<input name="totalPages" type="number" min="1" max="100000" required /></label>
        <label>来源说明<textarea name="sourceNote" maxlength="1000" rows="2" placeholder="底本、版本和材料位置"></textarea></label>
        <button type="submit">创建草稿</button></form>` : ''}</aside>`;
  }

  function unitsPanel(book) {
    if (!book) return `<section class="work-column"><div class="empty big">${state.role === 'admin' ? '创建或选择一本古籍，开始拆分工作。' : '管理员发布并分配后，任务会出现在这里。'}</div></section>`;
    const accepted = state.units.filter((unit) => unit.status === 'accepted').length;
    const coverage = ['proofread', 'screen', 'review'].map((stage) => {
      const units = state.units.filter((unit) => unit.stage === stage);
      const pages = units.reduce((total, unit) => total + unit.endPage - unit.startPage + 1, 0);
      return units.length ? `<span>${label(stage)} ${pages}/${book.totalPages} 页</span>` : '';
    }).join('');
    return `<section class="work-column"><div class="panel-head work-head"><div><span class="eyebrow">${label(book.status)} · ${book.totalPages} 页</span><h1>${esc(book.title)}</h1>
      ${book.sourceNote ? `<p>${esc(book.sourceNote)}</p>` : ''}</div><span class="progress">${state.role === 'admin' ? '已验收' : '我的已验收'} ${accepted}/${state.units.length}</span></div>
      ${coverage ? `<div class="coverage">${coverage}</div>` : ''}
      ${state.role === 'admin' && book.status === 'draft' ? `<form id="addUnitForm" class="unit-form"><h2>拆分工作项</h2><div class="form-grid">
        <label>处理环节<select name="stage"><option value="proofread">原文校对</option><option value="screen">全书初筛</option><option value="review">条目审核</option></select></label>
        <label>起始页<input name="startPage" type="number" min="1" max="${book.totalPages}" required /></label>
        <label>结束页<input name="endPage" type="number" min="1" max="${book.totalPages}" required /></label>
        <label>负责人<select name="assignee">${[2,3,4,5].map((n) => `<option value="test0${n}">test0${n}</option>`).join('')}</select></label></div>
        <label>对应材料原文或工作说明<textarea name="materialText" rows="3" maxlength="200000" placeholder="可粘贴本页段原文；工作人员会在右侧对照"></textarea></label>
        <div class="actions"><button type="submit">添加工作项</button><button type="button" class="secondary" data-publish="${esc(book.id)}" ${state.units.length ? '' : 'disabled'}>发布给成员</button></div></form>` : ''}
      <div class="panel-head list-title"><h2>工作项</h2><span>${state.units.length} 项</span></div>
      <div class="unit-list">${state.units.map((unit) => `<button type="button" data-unit="${esc(unit.id)}" class="${unit.id === state.unitId ? 'selected' : ''}">
        <span class="unit-meta"><b>${label(unit.stage)}</b><small>第 ${unit.startPage}–${unit.endPage} 页</small></span>
        <span class="unit-meta"><small>${esc(unit.assignee)}</small><em class="status ${esc(unit.status)}">${label(unit.status)}</em></span></button>`).join('') || '<p class="empty">还没有工作项</p>'}</div></section>`;
  }

  function detailPanel() {
    const unit = state.unit;
    if (!unit) return `<aside class="detail"><div class="empty big">选择一个工作项，查看材料与处理记录。</div></aside>`;
    const editable = state.role !== 'admin' && ['assigned', 'in_progress', 'returned'].includes(unit.status);
    const canDecide = state.role === 'admin' && unit.status === 'submitted';
    const screeningPart = [[1, 258], [259, 527], [528, 776], [777, 1052]]
      .findIndex(([start, end]) => unit.stage === 'screen' && unit.startPage === start && unit.endPage === end) + 1;
    return `<aside class="detail"><div class="panel-head"><div><span class="eyebrow">${label(unit.stage)} · 第 ${unit.startPage}–${unit.endPage} 页</span><h2>${label(unit.status)}</h2></div><small>修订 ${unit.revision}</small></div>
      <p class="byline">负责人 ${esc(unit.assignee)}${unit.returnReason ? ` · 退回：${esc(unit.returnReason)}` : ''}</p>
      ${screeningPart ? `<p class="screening-entry"><a href="./screening.html?part=${screeningPart}">进入本页段逐页审核 →</a><small>扫描图需在审核页选择本机材料包；导出两张 CSV 后交回负责人。</small></p>` : ''}
      <section class="source"><h3>原始材料／工作说明</h3><pre>${esc(unit.materialText || '管理员尚未附原文，请按来源说明核对相应页段。')}</pre></section>
      <section class="answer"><h3>${editable ? '我的工作稿' : '提交内容'}</h3>
        ${editable ? `<textarea id="workDraft" rows="11" aria-label="工作稿">${esc(state.draft)}</textarea><div class="actions"><button type="button" data-save>保存草稿</button><button type="button" class="secondary" data-submit>提交验收</button></div>`
          : `<pre>${esc(unit.text || '尚无提交内容')}</pre>`}</section>
      ${canDecide ? `<form id="decideForm" class="stack"><h3>管理员验收</h3><label>退回理由<textarea name="reason" rows="2" maxlength="1000" placeholder="退回时必填"></textarea></label>
        <div class="actions"><button type="submit" name="decision" value="accept">验收通过</button><button type="submit" name="decision" value="return" class="secondary">退回修改</button></div></form>` : ''}
      ${state.role === 'admin' && unit.status !== 'accepted' ? `<form id="assignForm" class="assign"><label>改派负责人<select name="assignee">${[2,3,4,5].map((n) => `<option value="test0${n}" ${unit.assignee === `test0${n}` ? 'selected' : ''}>test0${n}</option>`).join('')}</select></label><button type="submit" class="secondary">改派</button></form>` : ''}
      ${state.role === 'admin' && unit.events?.length ? `<details class="events"><summary>操作记录 · ${unit.events.length}</summary>${unit.events.map((event) => `<p><b>${esc(event.actor)}</b> · ${esc(event.action)}${event.note ? ` · ${esc(event.note)}` : ''}</p>`).join('')}</details>` : ''}
    </aside>`;
  }

  function render() {
    if (state.offline) return offline();
    if (!state.user) { location.replace(loginUrl); return; }
    const book = state.books.find((item) => item.id === state.bookId);
    shell(`<div class="page-heading"><div><span class="eyebrow">任务</span><h1>分配与验收</h1></div><p>${state.role === 'admin' ? '按古籍分配页段，验收提交。' : '核对页段与原文，完成后提交。'}</p></div>
      <div class="workspace">${booksPanel()}${unitsPanel(book)}${detailPanel()}</div>`);
  }

  async function refresh() {
    const data = await api('/api/team-tasks');
    state.user = data.user; state.role = data.role; state.books = data.books;
    if (!state.books.some((book) => book.id === state.bookId)) state.bookId = state.books[0]?.id || '';
    state.units = state.bookId ? (await api(`/api/team-tasks/books/${state.bookId}/units`)).units : [];
    if (!state.units.some((unit) => unit.id === state.unitId)) state.unitId = state.units[0]?.id || '';
    state.unit = state.unitId ? await api(`/api/team-tasks/units/${state.unitId}`) : null;
    state.draft = state.unit?.text || ''; state.dirty = false;
    render();
  }

  async function run(work) {
    if (state.loading) return;
    state.loading = true; state.error = ''; state.notice = '';
    try { await work(); }
    catch (error) { state.error = error.message; render(); }
    finally { state.loading = false; }
  }

  async function saveDraft() {
    if (!state.unit) return;
    const value = document.querySelector('#workDraft')?.value ?? state.draft;
    const saved = await api(`/api/team-tasks/units/${state.unitId}/save`, 'POST', { revision: state.unit.revision, text: value });
    state.unit = { ...state.unit, ...saved }; state.draft = value; state.dirty = false;
    state.notice = '草稿已保存'; render();
  }

  app.addEventListener('input', (event) => {
    if (event.target.id === 'workDraft') { state.draft = event.target.value; state.dirty = state.draft !== state.unit?.text; }
  });

  app.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-sidebar-toggle')) {
      const shell = app.querySelector('.team-shell');
      const open = shell?.classList.toggle('nav-open') || false;
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? '关闭工作区导航' : '打开工作区导航');
      return;
    }
    if (button.hasAttribute('data-sidebar-close')) {
      app.querySelector('.team-shell')?.classList.remove('nav-open');
      const toggle = app.querySelector('[data-sidebar-toggle]');
      toggle?.setAttribute('aria-expanded', 'false');
      toggle?.setAttribute('aria-label', '打开工作区导航');
      return;
    }
    if (button.dataset.book) {
      if (state.dirty && !window.confirm('工作稿尚未保存，确定切换任务？')) return;
      state.bookId = button.dataset.book; state.unitId = ''; run(refresh); return;
    }
    if (button.dataset.unit) {
      if (state.dirty && !window.confirm('工作稿尚未保存，确定切换工作项？')) return;
      state.unitId = button.dataset.unit; run(refresh); return;
    }
    if (button.hasAttribute('data-refresh')) { if (state.dirty && !window.confirm('工作稿尚未保存，确定刷新？')) return; run(refresh); }
    if (button.hasAttribute('data-save')) run(saveDraft);
    if (button.hasAttribute('data-submit')) run(async () => {
      if (state.dirty) await saveDraft();
      await api(`/api/team-tasks/units/${state.unitId}/submit`, 'POST', { revision: state.unit.revision });
      await refresh(); state.notice = '已提交管理员验收'; render();
    });
    if (button.dataset.publish) run(async () => {
      await api(`/api/team-tasks/books/${button.dataset.publish}/publish`, 'POST', {});
      await refresh(); state.notice = '任务已发布，成员现在可查看分工'; render();
    });
    if (button.hasAttribute('data-logout')) run(async () => {
      if (state.dirty && !window.confirm('工作稿尚未保存，确定退出？')) return;
      await api('/api/simulation/logout', 'POST', {});
      window.localStorage.setItem('simulation-identity-changed', String(Date.now()));
      location.replace(loginUrl);
    });
  });

  app.addEventListener('submit', (event) => {
    const form = event.target;
    if (!['createBookForm', 'addUnitForm', 'decideForm', 'assignForm'].includes(form.id)) return;
    event.preventDefault();
    const fields = new FormData(form);
    if (form.id === 'createBookForm') run(async () => {
      const book = await api('/api/team-tasks/books', 'POST', { title: fields.get('title'),
        totalPages: Number(fields.get('totalPages')), sourceNote: fields.get('sourceNote') });
      state.bookId = book.id; state.unitId = ''; await refresh(); state.notice = '古籍任务草稿已创建'; render();
    });
    if (form.id === 'addUnitForm') run(async () => {
      await api(`/api/team-tasks/books/${state.bookId}/units`, 'POST', { stage: fields.get('stage'),
        startPage: Number(fields.get('startPage')), endPage: Number(fields.get('endPage')),
        assignee: fields.get('assignee'), materialText: fields.get('materialText') });
      await refresh(); state.notice = '工作项已添加'; render();
    });
    if (form.id === 'decideForm') run(async () => {
      const decision = event.submitter?.value;
      await api(`/api/team-tasks/units/${state.unitId}/decide`, 'POST', {
        revision: state.unit.revision, decision, reason: fields.get('reason') });
      await refresh(); state.notice = decision === 'accept' ? '已验收' : '已退回修改'; render();
    });
    if (form.id === 'assignForm') run(async () => {
      await api(`/api/team-tasks/units/${state.unitId}/assign`, 'POST', {
        revision: state.unit.revision, assignee: fields.get('assignee') });
      await refresh(); state.notice = '负责人已更新'; render();
    });
  });

  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) { event.preventDefault(); event.returnValue = ''; }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const shell = app.querySelector('.team-shell');
    if (!shell?.classList.contains('nav-open')) return;
    shell.classList.remove('nav-open');
    const toggle = app.querySelector('[data-sidebar-toggle]');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', '打开工作区导航');
    toggle?.focus();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== 'simulation-identity-changed') return;
    if (state.dirty) {
      state.error = '登录身份已变化，请先复制本页未保存的工作稿，再刷新页面。';
      render();
    } else location.reload();
  });

  (async () => {
    try {
      const response = await fetch('/api/simulation/me', { cache: 'no-store' });
      if (!response.ok) { state.offline = true; offline(); return; }
      const me = await response.json();
      state.user = me.user; state.role = me.role;
      if (me.user) await refresh(); else location.replace(loginUrl);
    } catch { state.offline = true; offline(); }
  })();
})();

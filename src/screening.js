(() => {
  const app = document.querySelector('#screeningApp');
  const part = Number(new URLSearchParams(location.search).get('part'));
  const state = { data: null, index: 0, reviews: {}, files: new Map(), imageUrl: '', imageReady: false,
    person: '', notice: '', error: '' };
  const esc = (value = '') => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const key = () => `shulun-screening-v1-part-${part}`;
  const page = () => state.data.pages[state.index];
  const current = () => state.reviews[page().page] || {};
  const seen = () => state.data.pages.filter((item) => state.reviews[item.page]?.seen).length;
  const filename = (number) => `page-${String(number).padStart(4, '0')}.jpg`;

  function persist() {
    try {
      localStorage.setItem(key(), JSON.stringify({ version: 1, part, person: state.person, reviews: state.reviews }));
      state.error = '';
    } catch {
      state.error = '浏览器存储空间不足，当前改动未保存。请立即导出“进度备份”，再清理空间。';
      showMessage();
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(key()) || '{}');
      if (saved.version === 1 && saved.part === part && saved.reviews && typeof saved.reviews === 'object') {
        state.reviews = saved.reviews;
        state.person = String(saved.person || '');
      }
    } catch { state.error = '本机旧进度无法读取，可导入先前导出的进度备份。'; }
  }

  function showMessage() {
    const slot = app.querySelector('#messageSlot');
    if (slot) slot.innerHTML = state.error ? `<p class="message error" role="alert">${esc(state.error)}</p>`
      : state.notice ? `<p class="message" role="status">${esc(state.notice)}</p>` : '';
  }

  function setImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = '';
    state.imageReady = false;
    const scan = app.querySelector('#scanWrap');
    const file = state.files.get(filename(page().page));
    if (!file) {
      scan.innerHTML = '<div class="scan-placeholder"><strong>尚未载入这页扫描图</strong>先选自己的解压材料包，再以扫描图逐页核对。OCR 不能代替看图。</div>';
      updateSeenButton();
      return;
    }
    state.imageUrl = URL.createObjectURL(file);
    scan.innerHTML = `<img alt="原 PDF 物理页 ${page().page} 扫描图" />`;
    const image = scan.querySelector('img');
    image.onload = () => { state.imageReady = true; updateSeenButton(); };
    image.onerror = () => { state.error = `扫描图 ${filename(page().page)} 无法打开，请重新选择材料。`; showMessage(); };
    image.src = state.imageUrl;
  }

  function updateSeenButton() {
    const button = app.querySelector('#markSeen');
    if (button) button.disabled = !current().seen && !state.imageReady;
  }

  function render() {
    const p = page();
    const review = current();
    const candidates = Array.isArray(review.candidates) ? review.candidates : [];
    app.innerHTML = `<main class="page">
      <div class="heading"><div><span class="eyebrow">《历代书法论文选》 / 审核成员 ${part}</span><h1>原 PDF 第 ${state.data.start}–${state.data.end} 页</h1><p>逐页看扫描图，记录新候选；已审进度只保存在当前浏览器。</p></div><span class="progress" id="progress">已看 ${seen()} / ${state.data.pages.length} 页</span></div>
      <section class="setup"><p><strong>先载入第 ${part} 份解压材料的“扫描页”文件夹。</strong><br>需要 OCR 对照时，再选包内“定位与操作.html”。这些文件只在本机读取，不上传。</p>
        <div class="tools"><label class="file-button">选择扫描页文件夹<input id="scanFolder" type="file" webkitdirectory multiple /></label>
          <label class="file-button">或选择图片<input id="scanFiles" type="file" accept="image/jpeg" multiple /></label>
          <label class="file-button">载入本地 OCR<input id="locatorFile" type="file" accept="text/html,.html" /></label>
          <label class="file-button">导入进度<input id="backupFile" type="file" accept="application/json,.json" /></label>
          <button type="button" id="backup">导出进度备份</button></div></section>
      <div id="messageSlot"></div>
      <div class="layout"><aside class="panel page-panel"><div class="panel-head"><h2>页码</h2><small>绿色表示已看扫描图</small><label class="jump">跳到原 PDF 页<input id="jump" type="number" min="${state.data.start}" max="${state.data.end}" placeholder="${state.data.start}–${state.data.end}" /></label></div><div class="page-list" id="pageList">${state.data.pages.map((item, index) => `<button type="button" data-index="${index}" class="${index === state.index ? 'selected ' : ''}${state.reviews[item.page]?.seen ? 'done' : ''}" aria-current="${index === state.index}"><span>${item.page} 页</span><small>${state.reviews[item.page]?.seen ? '已看' : item.priority === '通读复核' ? '待看' : esc(item.priority)}</small></button>`).join('')}</div></aside>
      <section class="panel viewer-panel"><div class="panel-head viewer-bar"><div><h2>原 PDF 物理页 ${p.page}</h2><small>分册第 ${p.local} 页 · ${esc(p.priority)}${p.ids.length ? ` · 旧材料 ID：${esc(p.ids.join('、'))}` : ''}</small></div><div class="tools"><button type="button" id="prev" ${state.index === 0 ? 'disabled' : ''}>上一页</button><button type="button" id="next" ${state.index === state.data.pages.length - 1 ? 'disabled' : ''}>下一页</button></div></div><div class="viewer"><div class="scan-wrap" id="scanWrap"></div><details class="ocr"><summary>展开 OCR 对照（未校勘）</summary><pre>${esc(p.ocr || '选择包内“定位与操作.html”可在本页查看 OCR；仍以扫描图为准。')}</pre></details></div></section>
      <section class="panel form-panel"><div class="panel-head"><h2>本页审核记录</h2><small>每次修改自动保存在本机</small></div><div class="form-body">
        <label>审核人<input id="person" maxlength="80" value="${esc(state.person)}" placeholder="请填写真实姓名" /></label>
        <div class="form-actions"><button type="button" id="markSeen" class="primary">${review.seen ? '撤销已看标记' : '已看这页扫描图'}</button>${review.seen ? '<span class="hint">已记录看图；可继续补充候选。</span>' : ''}</div>
        <label class="check"><input id="redoOcr" type="checkbox" ${review.redoOcr ? 'checked' : ''} /> 需重做 OCR</label>
        <label>疑问与处理<textarea id="question" rows="3" placeholder="页码异常、跨页句、无法辨认等">${esc(review.question || '')}</textarea></label>
        <h3>新证据候选 · ${candidates.length}</h3><p class="hint">只记能回到本页扫描图和连续原文的风格线索；不确定处保留待核。</p>
        <div id="candidates">${candidates.map((item, index) => `<div class="candidate"><button type="button" data-remove="${index}" aria-label="删除候选 ${index + 1}">删除</button><strong>${esc(item.author || '书家待核')} · ${esc(item.style || '书体待核')}</strong><br>${esc(item.quote || '')}<br><small>${esc(item.basis || '')}</small></div>`).join('')}</div>
        <form id="candidateForm"><div class="row"><label>书家<input name="author" maxlength="100" placeholder="可写待核" /></label><label>书体<input name="style" maxlength="100" placeholder="可写待核" /></label></div>
          <label>连续原文摘录<textarea name="quote" rows="2" required></textarea></label><label>风格描述依据<textarea name="basis" rows="2" required></textarea></label>
          <label>不确定或待核事项<textarea name="uncertainty" rows="2"></textarea></label><button type="submit">添加本页候选</button></form>
        <h3>交回负责人</h3><p class="hint">两张 CSV 保留未审核页的空行，负责人可据此检查遗漏。请同时留存进度备份。</p><div class="form-actions"><button type="button" id="exportPages" class="primary">导出逐页表</button><button type="button" id="exportCandidates">导出候选表</button></div>
      </div></section></div></main>`;
    showMessage();
    setImage();
    app.querySelector('[data-index][aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function select(index) {
    state.index = Math.max(0, Math.min(state.data.pages.length - 1, index));
    state.notice = ''; state.error = ''; render();
  }

  function record(patch) {
    const number = page().page;
    state.reviews[number] = { ...current(), ...patch };
    persist();
  }

  function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
  function download(name, textValue, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob(['\ufeff', textValue], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCsv(kind) {
    if (!state.person.trim()) { state.error = '请先填写审核人真实姓名，再导出回收表。'; showMessage(); return; }
    let rows;
    if (kind === 'pages') {
      rows = [['原PDF物理页', '分册页', '已看扫描页', '发现候选数', '需重做OCR', '疑问与处理', '审核人'],
        ...state.data.pages.map((item) => {
          const review = state.reviews[item.page] || {};
          return [item.page, item.local, review.seen ? '是' : '', review.seen ? (review.candidates || []).length : '',
            review.redoOcr ? '是' : '', review.question || '', review.seen ? state.person.trim() : ''];
        })];
    } else {
      rows = [['原PDF物理页', '书家', '书体', '连续原文摘录', '风格描述依据', '不确定或待核事项', '审核人']];
      for (const item of state.data.pages) for (const candidate of state.reviews[item.page]?.candidates || [])
        rows.push([item.page, candidate.author, candidate.style, candidate.quote, candidate.basis, candidate.uncertainty, state.person.trim()]);
    }
    download(`第${part}份-${kind === 'pages' ? '逐页初筛回收表' : '新证据候选回收表'}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  }

  function loadFiles(list) {
    const files = new Map();
    for (const file of list) {
      if (!/^page-\d{4}\.jpe?g$/i.test(file.name)) continue;
      files.set(file.name.toLowerCase(), file);
    }
    const matched = state.data.pages.filter((item) => files.has(filename(item.page))).length;
    if (!matched) { state.error = `没有找到第 ${state.data.start}–${state.data.end} 页的扫描图。请选择本份材料的“扫描页”文件夹。`; showMessage(); return; }
    state.files = files;
    state.notice = `已载入本份扫描图 ${matched}/${state.data.pages.length} 页${matched < state.data.pages.length ? '；缺失页不能标记已看。' : '。'}`;
    render();
  }

  app.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !state.data) return;
    if (button.dataset.index !== undefined) return select(Number(button.dataset.index));
    if (button.id === 'prev') return select(state.index - 1);
    if (button.id === 'next') return select(state.index + 1);
    if (button.id === 'markSeen' && (state.imageReady || current().seen)) { record({ seen: !current().seen }); render(); return; }
    if (button.dataset.remove !== undefined) {
      const candidates = [...(current().candidates || [])]; candidates.splice(Number(button.dataset.remove), 1);
      record({ candidates }); render(); return;
    }
    if (button.id === 'exportPages') return exportCsv('pages');
    if (button.id === 'exportCandidates') return exportCsv('candidates');
    if (button.id === 'backup') download(`第${part}份-初筛进度备份.json`, JSON.stringify({ version: 1, part,
      person: state.person, reviews: state.reviews }, null, 2), 'application/json;charset=utf-8');
  });

  app.addEventListener('input', (event) => {
    if (!state.data) return;
    if (event.target.id === 'person') { state.person = event.target.value; persist(); }
    if (event.target.id === 'question') record({ question: event.target.value });
    if (event.target.id === 'redoOcr') record({ redoOcr: event.target.checked });
  });

  app.addEventListener('change', async (event) => {
    if (event.target.id === 'jump') {
      const target = Number(event.target.value);
      if (Number.isInteger(target) && target >= state.data.start && target <= state.data.end) select(target - state.data.start);
      else { state.error = `请输入 ${state.data.start}–${state.data.end} 之间的原 PDF 页码。`; showMessage(); }
    }
    if (event.target.id === 'scanFolder' || event.target.id === 'scanFiles') loadFiles(event.target.files || []);
    if (event.target.id === 'locatorFile') {
      try {
        const source = await event.target.files[0].text();
        const start = source.indexOf('const PAGES=');
        const end = source.indexOf(';let current=0', start);
        if (start < 0 || end < 0) throw new Error('这不是本轮材料包的定位页');
        const pages = JSON.parse(source.slice(start + 'const PAGES='.length, end));
        if (!Array.isArray(pages) || pages.length !== state.data.pages.length ||
            pages.some((item, index) => item.page !== state.data.pages[index].page || typeof item.ocr !== 'string'))
          throw new Error('定位页与本份页段不匹配');
        state.data.pages.forEach((item, index) => { item.ocr = pages[index].ocr; });
        state.notice = '已载入本地 OCR 对照；请以扫描图核对。'; render();
      } catch (error) { state.error = error.message || '本地 OCR 载入失败'; showMessage(); }
    }
    if (event.target.id === 'backupFile') {
      try {
        const saved = JSON.parse(await event.target.files[0].text());
        if (saved.version !== 1 || saved.part !== part || !saved.reviews || typeof saved.reviews !== 'object' || Array.isArray(saved.reviews))
          throw new Error('进度备份与本份页段不匹配');
        if (Object.keys(state.reviews).length && !confirm('导入会覆盖本机当前进度，确定继续？')) return;
        state.reviews = saved.reviews; state.person = String(saved.person || ''); persist();
        state.notice = '进度备份已导入。仍需重新选择本机扫描图。'; render();
      } catch (error) { state.error = error.message || '进度备份读取失败'; showMessage(); }
    }
  });

  app.addEventListener('submit', (event) => {
    if (event.target.id !== 'candidateForm') return;
    event.preventDefault();
    if (!current().seen) { state.error = '请先查看并标记本页扫描图，再添加候选。'; showMessage(); return; }
    const fields = new FormData(event.target);
    const candidate = Object.fromEntries(['author', 'style', 'quote', 'basis', 'uncertainty'].map((field) => [field, String(fields.get(field) || '').trim()]));
    if (!candidate.quote || !candidate.basis) return;
    record({ candidates: [...(current().candidates || []), candidate] }); render();
  });

  async function init() {
    if (![1, 2, 3, 4].includes(part)) { app.innerHTML = '<p class="loading">请选择团队任务中的第 1–4 份初筛工作项。</p>'; return; }
    try {
      const response = await fetch(`./screening-data/part-${part}.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error('页码索引未找到');
      state.data = await response.json();
      if (state.data.part !== part || state.data.pages.length !== state.data.end - state.data.start + 1) throw new Error('页码索引不完整');
      restore(); render();
    } catch (error) { app.innerHTML = `<p class="loading" role="alert">${esc(error.message)}。请刷新页面，或联系负责人检查静态站文件。</p>`; }
  }
  init();
})();

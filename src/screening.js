import { CHECKS, makeDraft, numberLines, moveLine, validateDraft, isVerified, exportText } from './collation-core.js?v=20261003-trim';
import { excludedPages, isTaskPage, taskOcrHref } from './screening-page-policy.js?v=20261003-trim';
import { createProgressStore, initialPageIndex, nextPendingIndex, progressSummary } from './screening-workflow.js?v=20261009-flow';
import { theoryRanges, highlightHtml } from './theory-highlight.js?v=20261003-theory';

(() => {
  const app = document.querySelector('#screeningApp');
  const part = Number(new URLSearchParams(location.search).get('part'));
  const state = { data: null, index: 0, reviews: {}, files: new Map(), imageUrl: '', imageReady: false,
    person: '', notice: '', error: '', saveProblem: '', saveConflict: false, savedAt: '', lastPage: null, zoom: 100, validation: false, resetPending: false, highlight: true, reviewOpen: false };
  let editorObserver;
  const esc = (value = '') => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const key = () => `shulun-screening-v1-part-${part}`;
  const progressStore = createProgressStore(localStorage, key(), part);
  const page = () => state.data.pages[state.index];
  const current = () => state.reviews[page().page] || {};
  const seen = () => state.data.pages.filter((item) => state.reviews[item.page]?.seen).length;
  const filename = (number) => `page-${String(number).padStart(4, '0')}.jpg`;
  const scanHref = (number) => `./screening-data/scans/${filename(number)}`;
  const pdfHref = (local) => `./screening-data/part-${part}.pdf#page=${local}`;
  const draft = () => current().collation || { text: makeDraft(page().layout?.text ?? page().ocr) };
  const layoutNote = () => page().layout?.method === 'aligned-lines' ? '已按逐栏 OCR 对齐分栏；栏界为机器建议，请看图核对。'
    : page().layout?.method === 'ocr-lines' ? '沿用竖排 OCR 栏序；页眉、标点与错字请看图核对。' : '本页缺少可靠栏界，暂保留原段落。请按原页拆栏或合并行。';
  const verifiedCount = () => state.data.pages.filter(item => isVerified(state.reviews[item.page]?.collation, item.ocr)).length;

  function updateDraft(patch, { reset = false } = {}) {
    state.resetPending = false;
    state.notice = ''; state.error = '';
    const changed = Object.hasOwn(patch, 'text') && (reset || patch.text !== draft().text);
    if (Object.hasOwn(patch, 'text') && !changed) return;
    record({ collation: { ...draft(), ...patch, ...(changed ? { checks: {} } : {}), verified: false, verifiedBy: '', verifiedAt: '' } });
    const preview = app.querySelector('#collationText');
    if (preview && preview.value !== draft().text) preview.value = draft().text;
    showMessage();
    updateValidation();
    updateHighlight();
  }

  function syncHighlight() {
    const editor = app.querySelector('#collationText'), layer = app.querySelector('#theoryLayer');
    if (!editor || !layer) return;
    const style = getComputedStyle(editor);
    for (const key of ['font', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'tabSize', 'wordBreak', 'overflowWrap']) layer.style[key] = style[key];
    layer.style.width = `${editor.clientWidth}px`;
    layer.style.height = `${editor.clientHeight}px`;
    layer.scrollTop = editor.scrollTop; layer.scrollLeft = editor.scrollLeft;
  }

  function updateHighlight() {
    const layer = app.querySelector('#theoryLayer'), status = app.querySelector('#theoryStatus');
    if (!layer) return;
    const text = String(draft().text || '');
    const ranges = state.highlight ? theoryRanges(text) : [];
    layer.innerHTML = highlightHtml(text, ranges);
    const count = ranges.filter(range => range.type === 'theory').length;
    status.textContent = !state.highlight ? '高亮已隐藏，原文保持完整。' : count
      ? `深黄：书论线索 · 浅黄：邻近上下文（自动提示，需通读确认）`
      : '本页暂未识别出明显书论线索，仍请通读确认。';
    syncHighlight();
  }

  function updateValidation() {
    const result = validateDraft(draft(), page().ocr);
    const slot = app.querySelector('#validation');
    if (slot) slot.innerHTML = `<span>${result.lines} 栏 · ${result.chars} 汉字 · ${isVerified(draft(), page().ocr) ? '已校验' : '待人工校验'}</span>${state.validation ? `<ul>${[...result.errors, ...result.warnings].map(message => `<li>${esc(message)}</li>`).join('') || '<li>模板格式通过；字序和文字准确性仍须人工核对。</li>'}</ul>` : ''}`;
    for (const checkbox of app.querySelectorAll('[data-check]')) checkbox.checked = Boolean(draft().checks?.[checkbox.dataset.check]);
    const progress = app.querySelector('#progress');
    if (progress) progress.textContent = `已校验 ${verifiedCount()} / ${state.data.pages.length} 页`;
    for (const row of app.querySelectorAll('[data-index]')) {
      const item = state.data.pages[Number(row.dataset.index)], review = state.reviews[item.page] || {};
      const verified = isVerified(review.collation, item.ocr);
      row.querySelector('small').textContent = verified ? '已校验' : review.collation?.text !== undefined ? '草稿' : review.seen ? '已看' : '待校';
      row.classList.toggle('done', verified);
    }
    const complete = app.querySelector('#verifyNext');
    if (complete) complete.textContent = isVerified(draft(), page().ocr) ? '已校验 · 继续待校页' : '校验本页并继续';
  }

  function attachOcr(source) {
    const text = source.replace(/^\uFEFF/, '');
    const headings = [...text.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
    if (headings.length !== state.data.pages.length) throw new Error('线上 OCR 页数与页码索引不匹配');
    headings.forEach((heading, index) => {
      const item = state.data.pages[index];
      if (Number(heading[1]) !== item.page || Number(heading[2]) !== item.local)
        throw new Error(`线上 OCR 第 ${index + 1} 页与页码索引不匹配`);
      item.ocr = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
    });
  }

  function payload() {
    return { version: 1, part, person: state.person, reviews: state.reviews,
      lastPage: page().page, savedAt: state.savedAt };
  }

  function updateSaveStatus() {
    const status = app.querySelector('#saveStatus');
    if (status) {
      status.textContent = state.saveProblem ? '有改动未保存' : state.savedAt ? '已自动保存到本机' : '修改后自动保存在本机';
      status.classList.toggle('unsaved', Boolean(state.saveProblem));
    }
    const recovery = app.querySelector('#saveRecovery');
    if (recovery) recovery.innerHTML = state.saveProblem
      ? `<div class="message error" role="alert">${esc(state.saveProblem)}<div class="tools"><button id="retrySave">重试保存</button><button id="rescueBackup">导出当前进度备份</button>${state.saveConflict ? '<button id="reloadProgress">载入本机最新进度</button>' : ''}</div></div>` : '';
  }

  function persist() {
    const savedAt = new Date().toISOString();
    const result = progressStore.save({ ...payload(), savedAt });
    state.saveConflict = Boolean(result.conflict);
    state.saveProblem = result.ok ? '' : result.conflict
      ? '其他标签页已更新进度，或旧记录无法读取。当前修改仍在本页，尚未保存。请先导出备份，再载入本机最新进度。'
      : '本机保存失败，当前修改仍在本页。请重试保存或导出进度备份，暂勿关闭页面。';
    if (result.ok) { state.savedAt = savedAt; state.lastPage = page().page; }
    updateSaveStatus();
    return result.ok;
  }

  function restore() {
    try {
      const saved = progressStore.read();
      state.reviews = saved?.reviews || {};
      state.person = String(saved?.person || '');
      state.lastPage = saved?.lastPage;
      state.savedAt = String(saved?.savedAt || '');
      state.saveProblem = ''; state.saveConflict = false;
      return true;
    } catch {
      state.saveProblem = '本机旧进度无法读取。为避免覆盖，已暂停自动保存；可先导出当前工作备份，或恢复先前的进度文件。';
      state.saveConflict = true;
      return false;
    }
  }

  function showMessage() {
    const slot = app.querySelector('#messageSlot');
    if (slot) slot.innerHTML = state.error ? `<p class="message error" role="alert">${esc(state.error)}</p>`
      : state.resetPending ? '<div class="message" role="status">重建会替换本页正文并清除校验状态。<button id="confirmDraftReset">确认重建本页草稿</button> <button id="cancelDraftReset">取消</button></div>'
      : state.notice ? `<p class="message" role="status">${esc(state.notice)}</p>` : '';
  }

  function syncReviewDrawer() {
    const drawer = app.querySelector('#reviewDrawer');
    const toggle = app.querySelector('#toggleReviewDrawer');
    if (!drawer || !toggle) return;
    const open = Boolean(state.reviewOpen);
    drawer.hidden = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = `${open ? '收起' : '打开'}校勘操作 <span aria-hidden="true">${open ? '×' : '↗'}</span>`;
  }

  function setImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = '';
    state.imageReady = false;
    const scan = app.querySelector('#scanWrap');
    const file = state.files.get(filename(page().page));
    if (file) state.imageUrl = URL.createObjectURL(file);
    scan.innerHTML = `<img alt="原 PDF 物理页 ${page().page} 扫描图" style="width:${state.zoom}%;max-width:none" />`;
    const image = scan.querySelector('img');
    image.onload = () => { if (app.contains(scan) && scan.contains(image)) { state.imageReady = true; updateSeenButton(); } };
    image.onerror = () => {
      if (!app.contains(scan) || !scan.contains(image)) return;
      scan.innerHTML = '<div class="scan-placeholder"><strong>扫描图未能载入</strong>请检查网络，或在“本地材料备用”里选择本机扫描图。</div>';
      state.error = `扫描图 ${filename(page().page)} 无法打开。`;
      showMessage();
    };
    image.src = state.imageUrl || scanHref(page().page);
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
      <div class="heading"><div><span class="eyebrow">《历代书法论文选》 / 成员 ${part} / 原 PDF ${state.data.start}–${state.data.end} 页</span><h1>原文对照校勘</h1><p>① 对照原页整理栏序　② 逐字校勘　③ 校验并导出 TXT</p></div><span class="progress" id="progress">已校验 ${verifiedCount()} / ${state.data.pages.length} 页</span></div>
      <section class="setup"><label class="person-field">校勘人<input id="person" maxlength="80" value="${esc(state.person)}" placeholder="填写真实姓名" /></label><p><span id="saveStatus" role="status"></span><br>完成后导出交回负责人。</p>
        <div class="tools"><button type="button" id="exportTxt" class="primary">导出校勘 TXT</button><button type="button" id="exportChecks">导出校验表</button><details class="extra-tools"><summary>材料与备份</summary><div class="tools"><a class="download" href="${taskOcrHref(part)}" download>下载任务 OCR</a>
          <a class="download" href="./screening-data/part-${part}.pdf" target="_blank" rel="noopener">打开本份原 PDF</a>
          <button type="button" id="backup">导出进度备份</button><label class="file-button">导入进度<input id="backupFile" type="file" accept="application/json,.json" /></label>
        <details class="local-fallback"><summary>本地材料备用</summary><div class="tools"><label class="file-button">选择扫描页文件夹<input id="scanFolder" type="file" webkitdirectory multiple /></label>
          <label class="file-button">或选择图片<input id="scanFiles" type="file" accept="image/jpeg" multiple /></label>
          <label class="file-button">载入本地 OCR<input id="locatorFile" type="file" accept="text/html,.html" /></label></div></details></div></details></div></section>
      <div id="saveRecovery"></div><div id="messageSlot"></div>
      <div class="layout"><aside class="panel page-panel"><div class="panel-head"><h2>页码</h2><small>以原 PDF 物理页定位</small><label class="jump">跳到原 PDF 页<input id="jump" type="number" min="${state.data.start}" max="${state.data.end}" placeholder="${state.data.start}–${state.data.end}" /></label></div><div class="page-list" id="pageList">${state.data.pages.map((item, index) => { const r = state.reviews[item.page] || {}; return `<button type="button" data-index="${index}" class="${index === state.index ? 'selected ' : ''}${isVerified(r.collation, item.ocr) ? 'done' : ''}" aria-current="${index === state.index}"><span>${item.page} 页</span><small>${isVerified(r.collation, item.ocr) ? '已校验' : r.collation?.text !== undefined ? '草稿' : r.seen ? '已看' : '待校'}</small></button>`; }).join('')}</div></aside>
      <section class="panel viewer-panel"><div class="panel-head viewer-bar"><div><h2>原 PDF · 第 ${p.page} 页</h2><small>分册第 ${p.local} 页 · 竖排正文从右往左读</small></div><div class="tools"><button type="button" id="prev" ${state.index === 0 ? 'disabled' : ''}>上一页</button><button type="button" id="next" ${state.index === state.data.pages.length - 1 ? 'disabled' : ''}>下一页</button></div></div><div class="viewer"><div class="source-controls"><span>原 PDF 高清单页</span><label>缩放 <select id="zoom">${[100, 125, 150, 200].map(value => `<option value="${value}" ${state.zoom === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></label></div><div class="scan-wrap" id="scanWrap"></div><div class="source-links"><a href="${scanHref(p.page)}" target="_blank" rel="noopener">单独打开原页</a><a href="${pdfHref(p.local)}" target="_blank" rel="noopener">打开 PDF 第 ${p.local} 页 ↗</a></div><p class="hint">原页取自原 PDF；翻页保留草稿，不会自动标为已校验。Alt + ← / → 翻页。</p></div></section>
      <section class="panel form-panel"><div class="panel-head txt-head"><div><h2 id="editorHeading" tabindex="-1">TXT · 第 ${p.page} 页</h2><small>一栏一行，编号表示阅读顺序；OCR 草稿须对照左侧核定。</small></div><button type="button" id="openTextEditor">修改本页</button></div><div class="form-body">
        <div class="editor-main">
        <div class="theory-toolbar"><label class="check"><input id="theoryToggle" type="checkbox" ${state.highlight ? 'checked' : ''} />高亮书论相关内容</label><small id="theoryStatus"></small></div>
        <div class="highlight-editor"><div id="theoryLayer" aria-hidden="true"></div><textarea id="collationText" aria-label="第 ${p.page} 页 TXT 预览" readonly spellcheck="false" placeholder="本页尚无 TXT 草稿，请打开右下角校勘操作生成。">${esc(draft().text || '')}</textarea></div>
        </div><aside class="review-controls review-drawer" id="reviewDrawer" ${state.reviewOpen ? '' : 'hidden'} aria-hidden="${state.reviewOpen ? 'false' : 'true'}"><div class="drawer-head"><div><strong>校勘操作 · 第 ${p.page} 页</strong><small>修改正文、核对并保存</small></div><div class="drawer-head-actions"><button type="button" id="exportCurrentPage" class="drawer-save">保存本页 TXT</button><button type="button" id="closeReviewDrawer" class="drawer-close" aria-label="收起校勘操作">收起</button></div></div><div class="drawer-body"><div class="drawer-editor"><label for="editText">修改校勘正文</label><div class="editor-tools"><button id="makeDraft">${draft().text !== undefined ? '重新生成草稿' : '生成分栏草稿'}</button><button id="renumber">重新编号</button><button id="lineUp" title="将光标所在栏向前移动">本栏上移</button><button id="lineDown" title="将光标所在栏向后移动">本栏下移</button></div><textarea id="editText" aria-label="第 ${p.page} 页修改校勘正文" spellcheck="false" placeholder="对照左侧扫描图，在这里修改 TXT。">${esc(draft().text || '')}</textarea><small>${esc(layoutNote())} 无法辨认填 □，待查写【待核：…】。</small></div><details class="ocr"><summary>查看原始 OCR（保留原样）</summary><pre>${esc(p.ocr || '本页没有可用 OCR，请对照原页录入。')}</pre></details>
        <div class="validation" id="validation" aria-live="polite"></div>
        <div class="checklist">${Object.entries(CHECKS).map(([key, label]) => `<label class="check"><input type="checkbox" data-check="${key}" ${draft().checks?.[key] ? 'checked' : ''} />${label}</label>`).join('')}</div>
        <label>疑问与处理<textarea id="question" rows="2" placeholder="例如：第 3 栏有缺字；页眉已移除；跨页接第…页">${esc(review.question || '')}</textarea></label>
        <p class="hint">格式检查不判断古籍文字正误。修改正文会清除本页校验勾选；已看扫描图不等于已校验。</p>
        <details class="secondary-review"><summary>证据候选与旧初筛记录（${candidates.length} 条）</summary>
        <div class="form-actions"><button type="button" id="markSeen" class="primary">${review.seen ? '撤销已看标记' : '已看这页扫描图'}</button>${review.seen ? '<span class="hint">已记录看图；可继续补充候选。</span>' : ''}</div>
        <label class="check"><input id="redoOcr" type="checkbox" ${review.redoOcr ? 'checked' : ''} /> 需重做 OCR</label>
        <h3>新证据候选 · ${candidates.length}</h3><p class="hint">只记能回到本页扫描图和连续原文的风格线索；不确定处保留待核。</p>
        <div id="candidates">${candidates.map((item, index) => `<div class="candidate"><button type="button" data-remove="${index}" aria-label="删除候选 ${index + 1}">删除</button><strong>${esc(item.author || '书家待核')} · ${esc(item.style || '书体待核')}</strong><br>${esc(item.quote || '')}<br><small>${esc(item.basis || '')}</small></div>`).join('')}</div>
        <form id="candidateForm"><div class="row"><label>书家<input name="author" maxlength="100" placeholder="可写待核" /></label><label>书体<input name="style" maxlength="100" placeholder="可写待核" /></label></div>
          <label>连续原文摘录<textarea name="quote" rows="2" required></textarea></label><label>风格描述依据<textarea name="basis" rows="2" required></textarea></label>
          <label>不确定或待核事项<textarea name="uncertainty" rows="2"></textarea></label><button type="submit">添加本页候选</button></form>
        <h3>交回负责人</h3><p class="hint">两张 CSV 保留未审核页的空行，负责人可据此检查遗漏。请同时留存进度备份。</p><div class="form-actions"><button type="button" id="exportPages" class="primary">导出逐页表</button><button type="button" id="exportCandidates">导出候选表</button></div>
      </details><div class="form-actions drawer-actions"><button id="validate">检查 TXT 模板</button><button id="verifyNext" class="primary">本页校验完成，下一页</button></div></div></aside></div></section></div><button type="button" id="toggleReviewDrawer" class="review-drawer-toggle" aria-controls="reviewDrawer" aria-expanded="${state.reviewOpen ? 'true' : 'false'}">${state.reviewOpen ? '收起' : '打开'}校勘操作 <span aria-hidden="true">${state.reviewOpen ? '×' : '↗'}</span></button></main>`;
    showMessage();
    syncReviewDrawer();
    updateSaveStatus();
    setImage();
    updateValidation();
    updateHighlight();
    editorObserver?.disconnect();
    editorObserver = new ResizeObserver(syncHighlight);
    editorObserver.observe(app.querySelector('#collationText'));
    revealCurrentPage();
    for (const input of app.querySelectorAll('#candidateForm [name]')) input.value = current().candidateDraft?.[input.name] || '';
  }

  function revealCurrentPage() {
    const row = app.querySelector('[data-index][aria-current="true"]');
    const list = app.querySelector('#pageList');
    if (row && list) { list.scrollTop = row.offsetTop - 8; list.scrollLeft = row.offsetLeft - 8; }
  }

  function syncUrl() {
    const url = new URL(location.href); url.searchParams.set('page', page().page);
    history.replaceState(null, '', url);
  }

  function select(index, notice = '') {
    if (state.saveProblem && !persist()) { app.querySelector('#saveRecovery')?.scrollIntoView({ block: 'nearest' }); return false; }
    state.index = Math.max(0, Math.min(state.data.pages.length - 1, index));
    state.validation = false;
    state.resetPending = false;
    syncUrl();
    persist();
    state.notice = notice; state.error = ''; render();
    app.querySelector('#editorHeading')?.focus({ preventScroll: true });
    return true;
  }

  function record(patch) {
    const number = page().page;
    state.reviews[number] = { ...current(), ...patch };
    return persist();
  }

  function backup() {
    download(`第${part}份-初筛进度备份.json`, JSON.stringify(payload(), null, 2), 'application/json;charset=utf-8');
  }

  function exportCurrentPage() {
    if (!state.person.trim()) {
      state.error = '请先填写校勘人真实姓名，再导出本页。';
      showMessage();
      app.querySelector('#person')?.focus();
      return;
    }
    const currentPage = page();
    const text = exportText({ part, person: state.person.trim(), pages: [currentPage], reviews: { [currentPage.page]: current() } });
    download(`第${part}份-第${currentPage.page}页校勘.txt`, text, 'text/plain;charset=utf-8');
    state.notice = `已发起第 ${currentPage.page} 页校勘 TXT 下载。`;
    showMessage();
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
    if (button.id === 'toggleReviewDrawer') {
      state.reviewOpen = !state.reviewOpen;
      syncReviewDrawer();
      if (state.reviewOpen) app.querySelector('#reviewDrawer .drawer-body')?.scrollTo({ top: 0 });
      return;
    }
    if (button.id === 'openTextEditor') {
      state.reviewOpen = true;
      syncReviewDrawer();
      app.querySelector('#editText')?.focus({ preventScroll: true });
      return;
    }
    if (button.id === 'closeReviewDrawer') {
      state.reviewOpen = false;
      syncReviewDrawer();
      app.querySelector('#toggleReviewDrawer')?.focus({ preventScroll: true });
      return;
    }
    if (button.id === 'exportCurrentPage') return exportCurrentPage();
    if (button.id === 'retrySave') return persist();
    if (['backup', 'rescueBackup'].includes(button.id)) {
      backup(); state.notice = '已发起进度备份下载，请在浏览器下载列表确认。'; showMessage(); return;
    }
    if (button.id === 'reloadProgress') {
      if (!confirm('载入本机最新进度会替换本页未保存的修改。请确认已下载备份，再继续。')) return;
      if (restore()) { state.notice = '已载入本机最新进度。'; state.error = ''; render(); }
      else updateSaveStatus();
      return;
    }
    if (button.dataset.index !== undefined) return select(Number(button.dataset.index));
    if (button.id === 'prev') return select(state.index - 1);
    if (button.id === 'next') return select(state.index + 1);
    if (button.id === 'cancelDraftReset') { state.resetPending = false; showMessage(); return; }
    if (['makeDraft', 'confirmDraftReset', 'renumber', 'lineUp', 'lineDown'].includes(button.id)) {
      const editor = app.querySelector('#editText');
      let value = editor.value, caret = editor.selectionStart;
      if (button.id === 'makeDraft' || button.id === 'confirmDraftReset') {
        if (button.id === 'makeDraft' && current().collation?.text) { state.resetPending = true; state.error = ''; showMessage(); return; }
        state.resetPending = false;
        value = makeDraft(page().layout?.text ?? page().ocr); caret = 0;
        state.notice = layoutNote(); showMessage();
      } else if (button.id === 'renumber') value = numberLines(value);
      else ({ text: value, caret } = moveLine(value, caret, button.id === 'lineUp' ? -1 : 1));
      updateDraft({ text: value }, { reset: ['makeDraft', 'confirmDraftReset'].includes(button.id) }); editor.value = value; editor.focus(); editor.setSelectionRange(caret, caret);
      app.querySelector('#makeDraft').textContent = '重新生成草稿'; return;
    }
    if (button.id === 'validate') { state.validation = true; updateValidation(); return; }
    if (button.id === 'verifyNext') {
      state.validation = true; updateValidation();
      const validation = validateDraft(draft(), page().ocr);
      const problems = [...validation.errors];
      if (!state.person.trim()) problems.unshift('请填写校勘人真实姓名。');
      if (!state.imageReady) problems.push('原页尚未载入，请载入后核对。');
      if (!Object.keys(CHECKS).every(key => draft().checks?.[key])) problems.push('请逐项完成并勾选三项人工核对。');
      if (validation.warnings.length && !current().question?.trim()) problems.push('字数变化或重复栏提示需要在“疑问与处理”中说明。');
      if (problems.length) { state.error = problems.join(' '); showMessage();
        app.querySelector(!state.person.trim() ? '#person' : validation.errors.length ? '#editText' : !Object.keys(CHECKS).every(key => draft().checks?.[key]) ? '[data-check]:not(:checked)' : '#question')?.focus(); return; }
      const saved = record({ seen: true, collation: { ...draft(), verified: true, verifiedBy: state.person.trim(), verifiedAt: new Date().toISOString() } });
      updateValidation();
      if (!saved) return;
      const completed = page().page;
      const next = nextPendingIndex(state.data.pages, state.reviews, state.index);
      if (next >= 0) select(next, `第 ${completed} 页已校验并保存；已转到第 ${state.data.pages[next].page} 页继续。`);
      else { state.notice = '本份全部校验完成，请导出 TXT 与校验表交回负责人。'; render(); }
      return;
    }
    if (button.id === 'exportTxt' || button.id === 'exportChecks') {
      if (!state.person.trim()) { state.error = '请先填写校勘人真实姓名，再导出。'; showMessage(); app.querySelector('#person').focus(); return; }
      if (button.id === 'exportTxt') download(`第${part}份-逐页校勘.txt`, exportText({ part, person: state.person.trim(), pages: state.data.pages, reviews: state.reviews }), 'text/plain;charset=utf-8');
      else {
        const rows = [['原PDF物理页', '分册页', '校勘状态', '栏序核对', '逐字核对', '跨页核对', '格式问题', '提醒', '疑问与处理', '校验人', '校验时间'],
          ...state.data.pages.map(item => {
            const review = state.reviews[item.page] || {}, d = review.collation || {}, v = validateDraft(d, item.ocr);
            return [item.page, item.local, isVerified(d, item.ocr) ? '已校验' : d.text !== undefined ? '草稿' : '未开始', ...Object.keys(CHECKS).map(key => d.checks?.[key] ? '是' : ''),
              d.text !== undefined ? v.errors.join('；') : '', v.warnings.join('；'), review.question || '', d.verifiedBy || state.person.trim(), d.verifiedAt || ''];
          })];
        download(`第${part}份-TXT校验表.csv`, rows.map(row => row.map(csvCell).join(',')).join('\r\n'));
      }
      const counts = progressSummary(state.data.pages, state.reviews);
      state.notice = `已发起${button.id === 'exportTxt' ? '校勘 TXT' : '校验表'}下载：已校验 ${counts.verified} 页、草稿 ${counts.draft} 页、未开始 ${counts.unstarted} 页。请确认下载后，与另一份文件一起交回负责人。`; showMessage(); return;
    }
    if (button.id === 'markSeen' && (state.imageReady || current().seen)) { record({ seen: !current().seen }); render(); return; }
    if (button.dataset.remove !== undefined) {
      const candidates = [...(current().candidates || [])]; candidates.splice(Number(button.dataset.remove), 1);
      record({ candidates }); render(); return;
    }
    if (button.id === 'exportPages') return exportCsv('pages');
    if (button.id === 'exportCandidates') return exportCsv('candidates');

  });

  app.addEventListener('input', (event) => {
    if (!state.data) return;
    if (event.target.closest('#candidateForm') && event.target.name) { record({ candidateDraft: { ...current().candidateDraft, [event.target.name]: event.target.value } }); return; }
    if (event.target.id === 'theoryToggle') { state.highlight = event.target.checked; updateHighlight(); return; }
    if (event.target.id === 'person') { state.person = event.target.value; persist(); }
    if (event.target.id === 'editText') updateDraft({ text: event.target.value });
    if (event.target.dataset.check) updateDraft({ checks: { ...draft().checks, [event.target.dataset.check]: event.target.checked } });
    if (event.target.id === 'question') record({ question: event.target.value });
    if (event.target.id === 'redoOcr') record({ redoOcr: event.target.checked });
  });

  app.addEventListener('scroll', (event) => {
    if (event.target.id === 'collationText') syncHighlight();
  }, true);

  function jumpTo(value) {
    const target = Number(value);
    if (Number.isInteger(target) && target >= state.data.start && target <= state.data.end) {
      const index = state.data.pages.findIndex(item => item.page === target);
      if (index >= 0) select(index);
      else { state.error = `第 ${target} 页为${excludedPages[target]}，已移出本轮任务。`; showMessage(); }
    }
    else { state.error = `请输入 ${state.data.start}–${state.data.end} 之间的原 PDF 页码。`; showMessage(); }
  }

  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.reviewOpen) {
      state.reviewOpen = false;
      syncReviewDrawer();
      app.querySelector('#toggleReviewDrawer')?.focus({ preventScroll: true });
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); select(state.index + (event.key === 'ArrowLeft' ? -1 : 1)); return;
    }
    if (event.target.id === 'jump' && event.key === 'Enter') {
      event.preventDefault(); jumpTo(event.target.value);
    }
  });

  app.addEventListener('change', async (event) => {
    if (event.target.id === 'zoom') { state.zoom = Number(event.target.value); const image = app.querySelector('#scanWrap img'); if (image) image.style.width = `${state.zoom}%`; }
    if (event.target.id === 'jump') {
      jumpTo(event.target.value);
    }
    if (event.target.id === 'scanFolder' || event.target.id === 'scanFiles') loadFiles(event.target.files || []);
    if (event.target.id === 'locatorFile') {
      try {
        const source = await event.target.files[0].text();
        const start = source.indexOf('const PAGES=');
        const end = source.indexOf(';let current=0', start);
        if (start < 0 || end < 0) throw new Error('这不是本轮材料包的定位页');
        const pages = JSON.parse(source.slice(start + 'const PAGES='.length, end));
        if (!Array.isArray(pages) || pages.length !== state.data.allPages.length ||
            pages.some((item, index) => item.page !== state.data.allPages[index].page || typeof item.ocr !== 'string'))
          throw new Error('定位页与本份页段不匹配');
        state.data.allPages.forEach((item, index) => { item.ocr = pages[index].ocr; delete item.layout; });
        state.notice = '已载入本地 OCR 对照；请以扫描图核对。'; render();
      } catch (error) { state.error = error.message || '本地 OCR 载入失败'; showMessage(); }
    }
    if (event.target.id === 'backupFile') {
      if (!event.target.files?.length) return;
      try {
        const saved = JSON.parse(await event.target.files[0].text());
        if (saved.version !== 1 || saved.part !== part || !saved.reviews || typeof saved.reviews !== 'object' || Array.isArray(saved.reviews))
          throw new Error('进度备份与本份页段不匹配');
        if ((Object.keys(state.reviews).length || state.saveProblem) && !confirm('导入会替换本份在当前浏览器的进度，包括其他标签页的更新。请确认已备份，再继续。')) return;
        progressStore.allowBackupReplacement();
        state.reviews = saved.reviews; state.person = String(saved.person || '');
        state.index = initialPageIndex(state.data.pages, null, saved.lastPage ?? page().page);
        syncUrl(); persist();
        state.notice = state.saveProblem ? '' : '进度备份已导入，可继续逐页校勘。'; render();
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
    record({ candidates: [...(current().candidates || []), candidate], candidateDraft: {} }); render();
  });

  async function init() {
    if (![1, 2, 3, 4].includes(part)) { app.innerHTML = '<p class="loading">请选择团队任务中的第 1–4 份初筛工作项。</p>'; return; }
    try {
      const [response, ocrResponse, layoutResponse] = await Promise.all([
        fetch(`./screening-data/part-${part}.json`, { cache: 'no-store' }),
        fetch(`./screening-data/part-${part}-ocr.txt`, { cache: 'no-store' }),
        fetch(`./screening-data/part-${part}-layout.json`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (!response.ok) throw new Error('页码索引未找到');
      state.data = await response.json();
      if (state.data.part !== part || state.data.pages.length !== state.data.end - state.data.start + 1) throw new Error('页码索引不完整');
      if (ocrResponse.ok) attachOcr(await ocrResponse.text());
      else state.error = '线上 OCR 未能载入；可下载全文或载入本地 OCR，对照时仍以扫描图为准。';
      if (layoutResponse?.ok) {
        try {
          const layout = await layoutResponse.json();
          if (layout.version === 1 && layout.part === part && layout.pages?.length === state.data.pages.length &&
              layout.pages.every((item, index) => item.page === state.data.pages[index].page && typeof item.text === 'string' && item.text.replace(/\s/g, '') === (state.data.pages[index].ocr || '').replace(/\s/g, '')))
            state.data.pages.forEach((item, index) => { item.layout = layout.pages[index]; });
        } catch { /* Missing layout suggestions must never prevent source review. */ }
      }
      state.data.allPages = state.data.pages;
      state.data.pages = state.data.allPages.filter(item => isTaskPage(item.page));
      restore();
      const requested = new URLSearchParams(location.search).get('page');
      const targetPage = Number(requested ?? state.lastPage);
      state.index = initialPageIndex(state.data.pages, requested, state.lastPage);
      if (requested === null && state.lastPage) state.notice = `已回到上次工作位置：第 ${page().page} 页。`;
      if (Number.isInteger(targetPage) && targetPage >= state.data.start && targetPage <= state.data.end) {
        const index = state.data.pages.findIndex(item => item.page >= targetPage);
        state.index = index < 0 ? state.data.pages.length - 1 : index;
        if (!isTaskPage(targetPage)) state.notice = `第 ${targetPage} 页为${excludedPages[targetPage]}，已移出任务，已转到第 ${page().page} 页。`;
      }
      syncUrl();
      render();
    } catch (error) { app.innerHTML = `<p class="loading" role="alert">${esc(error.message)}。请刷新页面，或联系负责人检查静态站文件。</p>`; }
  }
  window.addEventListener('resize', revealCurrentPage);
  window.addEventListener('beforeunload', event => {
    if (!state.saveProblem) return;
    event.preventDefault(); event.returnValue = '';
  });
  window.addEventListener('storage', event => {
    if (!state.data || (event.key !== key() && event.key !== null) || !progressStore.hasChanged()) return;
    state.saveConflict = true;
    state.saveProblem = '其他标签页已更新进度。请先备份本页修改，再载入本机最新进度，避免相互覆盖。';
    updateSaveStatus();
  });
  init();
})();

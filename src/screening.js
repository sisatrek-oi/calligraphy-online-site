import { CHECKS, makeDraft, numberLines, moveLine, validateDraft, isVerified, exportText } from './collation-core.js?v=20261003-trim';
import { excludedPages, isTaskPage, taskOcrHref } from './screening-page-policy.js?v=20261003-trim';
import { createProgressStore, initialPageIndex, nextPendingIndex, progressSummary } from './screening-workflow.js?v=20261009-flow';
import { theoryRanges, highlightHtml } from './theory-highlight.js?v=20261003-theory';

(() => {
  const app = document.querySelector('#screeningApp');
  const part = Number(new URLSearchParams(location.search).get('part'));
  const state = { data: null, index: 0, reviews: {}, files: new Map(), imageUrl: '', imageReady: false,
    person: '', notice: '', error: '', saveProblem: '', saveConflict: false, savedAt: '', lastPage: null, zoom: 100, validation: false, resetPending: false, highlight: true, reviewOpen: false, sourceVersion: 'normalized' };
  state.selectionMenu = { open: false, start: 0, end: 0, text: '', x: 0, y: 0, targetId: '' };
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
  const sourceText = (item) => state.sourceVersion === 'raw' ? item.ocr : item.contextual?.[state.sourceVersion] || item.ocr;
  const sourceLabel = () => ({ raw: '原始 OCR', conservative: '保守校验版', normalized: '语义整理版' }[state.sourceVersion] || '原始 OCR');
  const draft = () => current().collation || { text: makeDraft(state.sourceVersion === 'raw' ? (page().layout?.text ?? page().ocr) : sourceText(page())) };
  const sourceMeta = (item) => {
    const contextual = item.contextual;
    if (!contextual) return '清洗结果未载入，当前显示原始 OCR。';
    const conservative = String(contextual.conservative || '').replace(/\s/g, '');
    const normalized = String(contextual.normalized || '').replace(/\s/g, '');
    const delta = normalized.length - conservative.length;
    const sign = delta > 0 ? '+' : '';
    return `${sourceLabel()} · ${contextual.uncertainties?.length || 0} 条待核 · 两版字数差 ${sign}${delta}`;
  };
  const sourceVersionOptions = () => [
    ['normalized', '语义整理版'], ['conservative', '保守校验版'], ['raw', '原始 OCR'],
  ].map(([value, label]) => `<option value="${value}" ${state.sourceVersion === value ? 'selected' : ''}>${label}</option>`).join('');
  const layoutNote = () => page().layout?.method === 'aligned-lines' ? '已按逐栏 OCR 对齐分栏；栏界为机器建议，请看图核对。'
    : page().layout?.method === 'ocr-lines' ? '沿用竖排 OCR 栏序；页眉、标点与错字请看图核对。' : '本页缺少可靠栏界，暂保留原段落。请按原页拆栏或合并行。';
  const verifiedCount = () => state.data.pages.filter(item => isVerified(state.reviews[item.page]?.collation, sourceText(item))).length;

  function editLocation(text, index) {
    const before = String(text || '').slice(0, index);
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineText = String(text || '').slice(lineStart);
    const lineNumber = lineText.match(/^\[(\d+)\]/)?.[1] || String(before.split('\n').length).padStart(3, '0');
    const prefixLength = lineText.match(/^\[\d+\]\s*/)?.[0].length || 0;
    return { line: lineNumber, char: Math.max(1, index - lineStart - prefixLength + 1) };
  }

  function editLabel(edit) {
    const span = edit.charStart === edit.charEnd ? `第 ${edit.charStart} 字` : `第 ${edit.charStart}–${edit.charEnd} 字`;
    const line = edit.lineEnd && edit.lineEnd !== edit.line ? `第 ${edit.line} 行至第 ${edit.lineEnd} 行` : `第 ${edit.line} 行`;
    return `${line} · ${span}`;
  }

  function editSummary(edit) {
    return `${editLabel(edit)}：${edit.before || '（删除）'} → ${edit.after || '（删除）'}`;
  }

  function shiftEditRanges(edits, start, end, replacementLength) {
    const delta = replacementLength - (end - start);
    return edits.map((edit) => {
      if (!Number.isInteger(edit.currentStart) || !Number.isInteger(edit.currentEnd)) return edit;
      if (edit.currentEnd <= start) return edit;
      if (edit.currentStart >= end) return { ...edit, currentStart: edit.currentStart + delta, currentEnd: edit.currentEnd + delta };
      return { ...edit, stale: true };
    });
  }

  function currentEditRange(text, edit) {
    const value = String(text || '');
    const start = Number.isInteger(edit.currentStart) ? edit.currentStart : -1;
    const end = Number.isInteger(edit.currentEnd) ? edit.currentEnd : -1;
    if (start >= 0 && end >= start && (edit.after ? value.slice(start, end) === edit.after : start <= value.length)) return { start, end };
    if (!edit.after) return { start: Math.max(0, Math.min(value.length, start)), end: Math.max(0, Math.min(value.length, start)) };
    const fallback = value.indexOf(edit.after, Math.max(0, start - 32));
    return fallback < 0 ? null : { start: fallback, end: fallback + edit.after.length };
  }

  function commitTextReplacement(start, end, replacement, targetId = 'editText') {
    const source = String(draft().text || '');
    const before = source.slice(start, end);
    const next = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
    const startLocation = editLocation(source, start);
    const endLocation = editLocation(source, Math.max(start, end - 1));
    const edit = {
      id: `${Date.now()}-${start}`,
      line: startLocation.line,
      lineEnd: endLocation.line,
      charStart: startLocation.char,
      charEnd: before.length > 1 ? endLocation.char : startLocation.char,
      before,
      after: replacement,
      currentStart: start,
      currentEnd: start + replacement.length,
      createdAt: new Date().toISOString(),
    };
    const edits = [...shiftEditRanges(draft().edits || [], start, end, replacement.length), edit];
    updateDraft({ text: next, edits });
    for (const id of ['#collationText', '#editText']) {
      const editor = app.querySelector(id);
      if (!editor) continue;
      editor.value = next;
      if (id === `#${targetId}`) {
        editor.focus({ preventScroll: true });
        const caret = start + replacement.length;
        editor.setSelectionRange(caret, caret);
      }
    }
    return edit;
  }

  function editHistoryMarkup(edits = []) {
    if (!edits.length) return '<div class="change-log-empty">框选替换后，这里会保留原字、改后字和所在行字位。</div>';
    return `<div class="change-log-head"><strong>直接替换记录</strong><span>${edits.length} 条</span></div><ol>${edits.map((edit, index) => `<li><div><span class="change-location">${esc(editLabel(edit))}</span><span class="change-values"><b>${esc(edit.before || '（删除）')}</b><span>→</span><b>${esc(edit.after || '（删除）')}</b></span>${edit.stale ? '<em>位置已被后续修改</em>' : ''}</div><div class="change-actions"><button type="button" data-locate-edit="${index}">定位</button><button type="button" data-restore-edit="${index}" ${edit.stale ? 'disabled' : ''}>恢复原字</button></div></li>`).join('')}</ol>`;
  }

  function updateChangeLog() {
    const slot = app.querySelector('#changeLog');
    if (slot) slot.innerHTML = editHistoryMarkup(draft().edits || []);
  }

  function updateDraft(patch, { reset = false } = {}) {
    state.resetPending = false;
    state.notice = ''; state.error = '';
    const changed = Object.hasOwn(patch, 'text') && (reset || patch.text !== draft().text);
    if (Object.hasOwn(patch, 'text') && !changed) return;
    const clearHistory = changed && !Object.hasOwn(patch, 'edits');
    record({ collation: { ...draft(), ...patch, ...(changed ? { checks: {} } : {}), ...(clearHistory || reset ? { edits: [] } : {}), verified: false, verifiedBy: '', verifiedAt: '' } });
    const preview = app.querySelector('#collationText');
    if (preview && preview.value !== draft().text) preview.value = draft().text;
    showMessage();
    updateValidation();
    updateHighlight();
    updateChangeLog();
  }

  function closeSelectionMenu() {
    state.selectionMenu.open = false;
    const menu = app.querySelector('#selectionMenu');
    if (menu) menu.hidden = true;
  }

  function syncSelectionMenu() {
    const menu = app.querySelector('#selectionMenu');
    if (!menu) return;
    const selection = state.selectionMenu;
    menu.hidden = !selection.open;
    if (!selection.open) return;
    const selected = menu.querySelector('[data-selection-text]');
    const count = menu.querySelector('[data-selection-count]');
    const input = menu.querySelector('#selectionReplacement');
    if (selected) selected.textContent = selection.text.replace(/\n/g, '↵');
    if (count) count.textContent = `${selection.text.length} 字`;
    if (input && input.value !== selection.text) input.value = selection.text;
    const left = Math.max(8, Math.min(selection.x, window.innerWidth - menu.offsetWidth - 8));
    const top = Math.max(8, Math.min(selection.y, window.innerHeight - menu.offsetHeight - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openSelectionMenu(event) {
    const target = event.target.closest('#editText, #collationText');
    if (!target) return;
    const remembered = state.lastTextSelection?.targetId === target.id ? state.lastTextSelection : null;
    const start = target.selectionStart === target.selectionEnd && remembered ? remembered.start : target.selectionStart;
    const end = target.selectionStart === target.selectionEnd && remembered ? remembered.end : target.selectionEnd;
    if (start === end) return;
    event.preventDefault();
    state.selectionMenu = {
      open: true,
      start,
      end,
      text: target.value.slice(start, end),
      x: event.clientX,
      y: event.clientY,
      targetId: target.id,
    };
    syncSelectionMenu();
    requestAnimationFrame(() => {
      const input = app.querySelector('#selectionReplacement');
      input?.focus();
      input?.select();
    });
  }

  function applySelectionReplacement(replacement) {
    const selection = state.selectionMenu;
    if (!selection.open) return;
    replacement = String(replacement ?? '');
    const source = String(draft().text || '');
    const selected = source.slice(selection.start, selection.end);
    if (selected !== selection.text) {
      state.error = '正文刚刚发生变化，已取消这次替换；请重新框选。';
      closeSelectionMenu();
      showMessage();
      return;
    }
    const edit = commitTextReplacement(selection.start, selection.end, replacement, selection.targetId);
    state.notice = `已记录${editSummary(edit)}，原位置已保留。`;
    closeSelectionMenu();
    showMessage();
  }

  function locateEdit(index) {
    const edit = draft().edits?.[index];
    if (!edit) return;
    const range = currentEditRange(draft().text, edit);
    if (!range) {
      state.error = '这条记录对应的正文位置已无法自动定位，请按记录中的行号查找。';
      showMessage();
      return;
    }
    state.reviewOpen = true;
    syncReviewDrawer();
    const editor = app.querySelector('#editText');
    if (editor) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(range.start, range.end);
    }
    state.notice = `已定位到${editLabel(edit)}。`;
    showMessage();
  }

  function restoreEdit(index) {
    const edit = draft().edits?.[index];
    if (!edit || edit.stale) return;
    const range = currentEditRange(draft().text, edit);
    if (!range) {
      state.error = '这条记录对应的改后字已不存在，无法自动恢复。';
      showMessage();
      return;
    }
    state.reviewOpen = true;
    syncReviewDrawer();
    const restored = commitTextReplacement(range.start, range.end, edit.before, 'editText');
    state.notice = `已恢复${editLabel(restored)}：${edit.after || '（删除）'} → ${edit.before || '（删除）'}。`;
    showMessage();
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
    const result = validateDraft(draft(), sourceText(page()));
    const slot = app.querySelector('#validation');
    if (slot) slot.innerHTML = `<span>${result.lines} 栏 · ${result.chars} 汉字 · ${isVerified(draft(), sourceText(page())) ? '已校验' : '待人工校验'}</span>${state.validation ? `<ul>${[...result.errors, ...result.warnings].map(message => `<li>${esc(message)}</li>`).join('') || '<li>模板格式通过；字序和文字准确性仍须人工核对。</li>'}</ul>` : ''}`;
    for (const checkbox of app.querySelectorAll('[data-check]')) checkbox.checked = Boolean(draft().checks?.[checkbox.dataset.check]);
    const progress = app.querySelector('#progress');
    if (progress) progress.textContent = `已校验 ${verifiedCount()} / ${state.data.pages.length} 页`;
    for (const row of app.querySelectorAll('[data-index]')) {
      const item = state.data.pages[Number(row.dataset.index)], review = state.reviews[item.page] || {};
      const verified = isVerified(review.collation, sourceText(item));
      row.querySelector('small').textContent = verified ? '已校验' : review.collation?.text !== undefined ? '草稿' : review.seen ? '已看' : '待校';
      row.classList.toggle('done', verified);
    }
    const complete = app.querySelector('#verifyNext');
    if (complete) complete.textContent = isVerified(draft(), sourceText(page())) ? '已校验 · 继续待校页' : '校验本页并继续';
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

  function attachContextual(payload) {
    if (!payload || payload.version !== 1 || payload.part !== part || !Array.isArray(payload.pages)) return false;
    const byPage = new Map(payload.pages.map(item => [Number(item.page), item]));
    if (state.data.pages.some(item => !byPage.has(item.page))) return false;
    state.data.pages.forEach(item => {
      const contextual = byPage.get(item.page);
      item.contextual = {
        conservative: String(contextual.conservative || ''),
        normalized: String(contextual.normalized || ''),
        uncertainties: Array.isArray(contextual.uncertainties) ? contextual.uncertainties : [],
      };
    });
    return true;
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
      : state.resetPending && !state.reviewOpen ? '<div class="message" role="status">重建会替换本页正文并清除校验状态。<button id="confirmDraftReset">确认重建本页草稿</button> <button id="cancelDraftReset">取消</button></div>'
      : state.notice ? `<p class="message" role="status">${esc(state.notice)}</p>` : '';
    const drawerSlot = app.querySelector('#drawerMessage');
    if (drawerSlot) drawerSlot.innerHTML = state.resetPending
      ? '<div class="message" role="status">重新生成会替换当前正文并清除校验勾选。<div class="tools"><button id="confirmDraftReset">确认重新生成</button><button id="cancelDraftReset">取消</button></div></div>'
      : state.error ? `<p class="message error" role="alert">${esc(state.error)}</p>` : '';
  }

  function syncReviewDrawer() {
    const drawer = app.querySelector('#reviewDrawer');
    if (!drawer) return;
    const open = Boolean(state.reviewOpen);
    drawer.hidden = !open;
    drawer.setAttribute('aria-hidden', String(!open));
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
        <div class="tools"><button type="button" id="exportTxt" class="primary">导出校勘 TXT</button><button type="button" id="exportChecks">导出校验表</button><details class="extra-tools"><summary>材料与备份</summary><div class="tools"><a class="download" href="${taskOcrHref(part)}" download>下载任务 OCR</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-conservative.txt" download>下载全书保守版</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-normalized.txt" download>下载全书语义版</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-comparison.md" target="_blank" rel="noopener">查看两版比对报告</a>
          <a class="download" href="./screening-data/part-${part}.pdf" target="_blank" rel="noopener">打开本份原 PDF</a>
          <button type="button" id="backup">导出进度备份</button><label class="file-button">导入进度<input id="backupFile" type="file" accept="application/json,.json" /></label>
        <details class="local-fallback"><summary>本地材料备用</summary><div class="tools"><label class="file-button">选择扫描页文件夹<input id="scanFolder" type="file" webkitdirectory multiple /></label>
          <label class="file-button">或选择图片<input id="scanFiles" type="file" accept="image/jpeg" multiple /></label>
          <label class="file-button">载入本地 OCR<input id="locatorFile" type="file" accept="text/html,.html" /></label></div></details></div></details></div></section>
      <div id="saveRecovery"></div><div id="messageSlot"></div>
      <div class="layout"><aside class="panel page-panel"><div class="panel-head"><h2>页码</h2><small>以原 PDF 物理页定位</small><label class="jump">跳到原 PDF 页<input id="jump" type="number" min="${state.data.start}" max="${state.data.end}" placeholder="${state.data.start}–${state.data.end}" /></label></div><div class="page-list" id="pageList">${state.data.pages.map((item, index) => { const r = state.reviews[item.page] || {}; return `<button type="button" data-index="${index}" class="${index === state.index ? 'selected ' : ''}${isVerified(r.collation, sourceText(item)) ? 'done' : ''}" aria-current="${index === state.index}"><span>${item.page} 页</span><small>${isVerified(r.collation, sourceText(item)) ? '已校验' : r.collation?.text !== undefined ? '草稿' : r.seen ? '已看' : '待校'}</small></button>`; }).join('')}</div></aside>
      <section class="panel viewer-panel"><div class="panel-head viewer-bar"><div><h2>原 PDF · 第 ${p.page} 页</h2><small>分册第 ${p.local} 页 · 竖排正文从右往左读</small></div><div class="tools"><button type="button" id="prev" ${state.index === 0 ? 'disabled' : ''}>上一页</button><button type="button" id="next" ${state.index === state.data.pages.length - 1 ? 'disabled' : ''}>下一页</button></div></div><div class="viewer"><div class="source-controls"><span>原 PDF 高清单页</span><label>缩放 <select id="zoom">${[100, 125, 150, 200].map(value => `<option value="${value}" ${state.zoom === value ? 'selected' : ''}>${value}%</option>`).join('')}</select></label></div><div class="scan-wrap" id="scanWrap"></div><div class="source-links"><a href="${scanHref(p.page)}" target="_blank" rel="noopener">单独打开原页</a><a href="${pdfHref(p.local)}" target="_blank" rel="noopener">打开 PDF 第 ${p.local} 页 ↗</a></div><p class="hint">原页取自原 PDF；翻页保留草稿，不会自动标为已校验。Alt + ← / → 翻页。</p></div></section>
      <section class="panel form-panel"><div class="panel-head txt-head"><div><h2 id="editorHeading" tabindex="-1">TXT · 第 ${p.page} 页</h2><small>框选文字后右键可直接替换；点击“编辑本页”打开完整编辑器。</small></div><button type="button" id="openTextEditor">编辑本页</button></div><div class="form-body">
        <div class="source-version-bar"><label for="sourceVersion">校勘底稿<select id="sourceVersion">${sourceVersionOptions()}</select></label><button type="button" id="useSourceVersion" ${page().contextual ? '' : 'disabled'}>采用此版本到编辑器</button><span id="sourceVersionMeta">${esc(sourceMeta(p))}${current().collation?.text !== undefined ? ' · 当前页已有本机草稿' : ''}</span></div>
        <div class="editor-main">
        <div class="theory-toolbar"><label class="check"><input id="theoryToggle" type="checkbox" ${state.highlight ? 'checked' : ''} />高亮书论相关内容</label><small id="theoryStatus"></small></div>
        <div class="highlight-editor"><div id="theoryLayer" aria-hidden="true"></div><textarea id="collationText" aria-label="第 ${p.page} 页 TXT 预览" readonly spellcheck="false" placeholder="本页尚无校勘草稿，请点击“编辑本页”开始。">${esc(draft().text || '')}</textarea></div>
        <div class="change-log" id="changeLog" aria-live="polite">${editHistoryMarkup(draft().edits || [])}</div>
        </div><aside class="review-controls review-drawer" id="reviewDrawer" ${state.reviewOpen ? '' : 'hidden'} aria-hidden="${state.reviewOpen ? 'false' : 'true'}"><div class="drawer-head"><div><strong>本页编辑器 · 第 ${p.page} 页</strong><small>修改会自动保存到本机；完成后下载 TXT 文件</small></div><div class="drawer-head-actions"><button type="button" id="exportCurrentPage" class="drawer-save">下载本页 TXT</button><button type="button" id="closeReviewDrawer" class="drawer-close" aria-label="关闭本页编辑器">关闭编辑器</button></div></div><div class="drawer-body"><div id="drawerMessage" aria-live="polite"></div><div class="drawer-editor"><label for="editText">编辑校勘正文</label><div class="editor-tools"><button id="makeDraft">${draft().text !== undefined ? '重新生成草稿' : '生成分栏草稿'}</button><button id="renumber">重新编号</button><button id="lineUp" title="将光标所在栏向前移动">本栏上移</button><button id="lineDown" title="将光标所在栏向后移动">本栏下移</button></div><textarea id="editText" aria-label="第 ${p.page} 页编辑校勘正文" spellcheck="false" placeholder="对照左侧扫描图，在这里修改 TXT。">${esc(draft().text || '')}</textarea><small>${esc(layoutNote())} 对照左侧扫描图修改；无法辨认填 □，待查写【待核：…】。</small></div><details class="ocr"><summary>查看原始 OCR（保留原样）</summary><pre>${esc(p.ocr || '本页没有可用 OCR，请对照原页录入。')}</pre></details>
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
      </details><div class="form-actions drawer-actions"><button id="validate">检查格式</button><button id="verifyNext" class="primary">校验本页并继续待校页</button></div></div></aside></div></section></div>
      <div id="selectionMenu" class="selection-menu" role="dialog" aria-label="替换选中文字" hidden>
        <div class="selection-menu-title"><strong>替换选中文字</strong><span data-selection-count></span></div>
        <div class="selection-preview">“<span data-selection-text></span>”</div>
        <label for="selectionReplacement">改为<input id="selectionReplacement" type="text" autocomplete="off" spellcheck="false" /></label>
        <div class="selection-menu-actions"><button type="button" id="applySelectionReplace" class="primary">替换</button><button type="button" id="selectionDelete">删除选中</button><button type="button" id="closeSelectionMenu">取消</button></div>
        <small>替换会写回当前 TXT 草稿，并保留这段文字在原文中的位置。</small>
      </div></main>`;
    showMessage();
    syncReviewDrawer();
    updateSaveStatus();
    setImage();
    updateValidation();
    updateHighlight();
    syncSelectionMenu();
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
    closeSelectionMenu();
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
    const text = exportText({ part, person: state.person.trim(), pages: [currentPage], reviews: { [currentPage.page]: current() }, sourceForPage: sourceText });
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
    if (state.selectionMenu.open && !event.target.closest('#selectionMenu') && !event.target.closest('#editText, #collationText')) closeSelectionMenu();
    const button = event.target.closest('button');
    if (!button || !state.data) return;
    if (button.dataset.locateEdit !== undefined) {
      locateEdit(Number(button.dataset.locateEdit));
      return;
    }
    if (button.dataset.restoreEdit !== undefined) {
      restoreEdit(Number(button.dataset.restoreEdit));
      return;
    }
    if (button.id === 'applySelectionReplace') {
      applySelectionReplacement(app.querySelector('#selectionReplacement')?.value ?? '');
      return;
    }
    if (button.id === 'selectionDelete') {
      applySelectionReplacement('');
      return;
    }
    if (button.id === 'closeSelectionMenu') {
      closeSelectionMenu();
      return;
    }
    if (button.id === 'openTextEditor') {
      state.reviewOpen = true;
      syncReviewDrawer();
      app.querySelector('#editText')?.focus({ preventScroll: true });
      return;
    }
    if (button.id === 'useSourceVersion') {
      if (!page().contextual) return;
      if (current().collation?.text && !confirm(`用${sourceLabel()}替换当前页编辑草稿？如需保留现有草稿，请先导出进度备份。`)) return;
      updateDraft({ text: makeDraft(sourceText(page())) }, { reset: true });
      state.reviewOpen = true;
      render();
      app.querySelector('#editText')?.focus({ preventScroll: true });
      return;
    }
    if (button.id === 'closeReviewDrawer') {
      state.reviewOpen = false;
      syncReviewDrawer();
      app.querySelector('#openTextEditor')?.focus({ preventScroll: true });
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
      const validation = validateDraft(draft(), sourceText(page()));
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
      if (button.id === 'exportTxt') download(`第${part}份-逐页校勘.txt`, exportText({ part, person: state.person.trim(), pages: state.data.pages, reviews: state.reviews, sourceForPage: sourceText }), 'text/plain;charset=utf-8');
      else {
        const rows = [['原PDF物理页', '分册页', '校勘状态', '栏序核对', '逐字核对', '跨页核对', '格式问题', '提醒', '疑问与处理', '直接替换记录', '校验人', '校验时间'],
          ...state.data.pages.map(item => {
            const review = state.reviews[item.page] || {}, d = review.collation || {}, v = validateDraft(d, sourceText(item));
            return [item.page, item.local, isVerified(d, sourceText(item)) ? '已校验' : d.text !== undefined ? '草稿' : '未开始', ...Object.keys(CHECKS).map(key => d.checks?.[key] ? '是' : ''),
              d.text !== undefined ? v.errors.join('；') : '', v.warnings.join('；'), review.question || '', (d.edits || []).map(editSummary).join('；'), d.verifiedBy || state.person.trim(), d.verifiedAt || ''];
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

  app.addEventListener('contextmenu', openSelectionMenu);

  app.addEventListener('mousedown', (event) => {
    const target = event.target.closest('#editText, #collationText');
    if (!target || event.button !== 2) {
      state.lastTextSelection = null;
      return;
    }
    if (target.selectionStart !== target.selectionEnd) state.lastTextSelection = {
      targetId: target.id,
      start: target.selectionStart,
      end: target.selectionEnd,
    };
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
    if (event.key === 'Escape' && state.selectionMenu.open) {
      closeSelectionMenu();
      return;
    }
    if (event.key === 'Escape' && state.reviewOpen) {
      state.reviewOpen = false;
      syncReviewDrawer();
      app.querySelector('#openTextEditor')?.focus({ preventScroll: true });
      return;
    }
    if (event.target.id === 'selectionReplacement' && event.key === 'Enter') {
      event.preventDefault();
      applySelectionReplacement(event.target.value);
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
    if (event.target.id === 'sourceVersion') {
      state.sourceVersion = event.target.value;
      state.validation = false;
      render();
      return;
    }
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
      const [response, ocrResponse, layoutResponse, contextualResponse] = await Promise.all([
        fetch(`./screening-data/part-${part}.json`, { cache: 'no-store' }),
        fetch(`./screening-data/part-${part}-ocr.txt`, { cache: 'no-store' }),
        fetch(`./screening-data/part-${part}-layout.json`, { cache: 'no-store' }).catch(() => null),
        fetch(`./screening-data/part-${part}-contextual.json`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (!response.ok) throw new Error('页码索引未找到');
      state.data = await response.json();
      if (state.data.part !== part || state.data.pages.length !== state.data.end - state.data.start + 1) throw new Error('页码索引不完整');
      if (ocrResponse.ok) attachOcr(await ocrResponse.text());
      else state.error = '线上 OCR 未能载入；可下载全文或载入本地 OCR，对照时仍以扫描图为准。';
      if (contextualResponse?.ok) {
        try {
          if (!attachContextual(await contextualResponse.json())) state.notice = '清洗版数据与本份页码不匹配，当前显示原始 OCR。';
        } catch { state.notice = '清洗版数据读取失败，当前显示原始 OCR。'; }
      } else state.notice = '清洗版尚未载入，当前显示原始 OCR。';
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

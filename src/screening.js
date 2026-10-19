import { humanMarked, humanMarkLabel, nextUnmarkedIndex } from './human-mark.js?v=human-mark-20261019';
import { draftForPage, defaultDraftText } from './ocr-source-policy.js?v=fulltext-20261019';
import { publicationLabel, teamRelease } from './team-collation.js?v=20261018-part3';
import { targetedLabel, targetedRelease } from './targeted-ocr.js?v=20261018-part3';
import { copyText } from './clipboard.js?v=20261012-copy';
import { buildCollationBundle, createBundleExporter } from './collation-export.js?v=annotations-20261019';
import { assignmentFor, assignmentSegment, assignmentPages, assignmentHref } from './team-assignments.js?v=seven-20261018';
import { readJson, createMaterialLoader } from './screening-loader.js?v=fulltext-20261019';
import { CHECKS, makeDraft, numberLines, moveLine, validateDraft } from './collation-core.js?v=human-mark-20261019';
import { excludedPages, isTaskPage, taskOcrHref } from './screening-page-policy.js?v=20261003-trim';
import { createProgressStore, initialPageIndex } from './screening-workflow.js?v=20261013-typo-only';
import { highlightHtml } from './theory-highlight.js?v=20261003-theory';
import { annotationView, addAnnotation, removeAnnotation, restoreAnnotation, relocateAnnotation, completeAnnotations, rebaseAnnotations } from './theory-annotations.js?v=annotations-20261019';
import { validateProgress } from './delivery-core.js?v=annotations-20261019';
import { pageMetrics } from './task-metrics.js?v=human-mark-20261019';

(() => {
  const app = document.querySelector('#screeningApp');
  const part = Number(new URLSearchParams(location.search).get('part'));
  const member = new URLSearchParams(location.search).get('member');
  let assignment = null, segment = null;
  const state = { data: null, index: 0, reviews: {}, files: new Map(), imageUrl: '', imageReady: false,
    person: '', notice: '', error: '', saveProblem: '', saveConflict: false, savedAt: '', lastPage: null, zoom: 100, validation: false, resetPending: false, annotationOpen: false, reviewOpen: false };
  state.selectionMenu = { open: false, start: 0, end: 0, text: '', x: 0, y: 0, targetId: '' };
  let editorObserver, materialLoader;
  let selectionRequest = 0;
  let exporting = false;
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
  const sourceText = item => item.ocr;
  const sourceLabel = () => page().collated ? '团队校订TXT' : '工作TXT';
  const rowLabel = (item, review) => humanMarkLabel(item,review);
  const draft = () => draftForPage(page(), current());
  const layoutNote = () => page().layout?.method === 'aligned-lines' ? '已按逐栏 OCR 对齐分栏；栏界为机器建议，请看图核对。'
    : page().layout?.method === 'ocr-lines' ? '沿用竖排 OCR 栏序；请逐栏对照原图检查全文。' : '本页保留原段落；本轮无需整理分栏格式。';
  const verifiedCount = () => state.data.pages.filter(item => humanMarked(item,state.reviews[item.page])).length;

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
    for (const id of ['#editText']) {
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
    if (slot) slot.innerHTML = editHistoryMarkup(draft().edits||[]);
  }

  function updateDraft(patch, { reset = false } = {}) {
    state.resetPending = false;
    state.notice = ''; state.error = '';
    const changed = Object.hasOwn(patch, 'text') && (reset || patch.text !== draft().text);
    if (Object.hasOwn(patch, 'text') && !changed) return;
    const clearHistory = changed && !Object.hasOwn(patch, 'edits');
    const existingBaseline = current().collation?.metricBaseline;
    const metricBaseline = reset ? { version: 1, text: String(patch.text || ''), label: sourceLabel() }
      : existingBaseline || (changed && typeof current().collation?.text !== 'string' ? { version: 1, text: String(draft().text || ''), label: sourceLabel() } : undefined);
    record({ ...(changed && current().theoryAnnotations ? { theoryAnnotations: rebaseAnnotations(current().theoryAnnotations, String(draft().text || ''), String(patch.text || ''), state.person) } : {}), collation: { ...draft(), ...patch, ...(metricBaseline ? { metricBaseline } : {}), ...(changed ? { checks: {}, fullTextChecked: false } : {}), ...(clearHistory || reset ? { edits: [] } : {}), verified: false, verifiedBy: '', verifiedAt: '' } });
    const preview = app.querySelector('#editText');
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
    const target = event.target.closest('#editText');
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
    const editor = app.querySelector('#editText'), layer = app.querySelector('#theoryLayer');
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
    const view = annotationView(current().theoryAnnotations, text);
    const ranges = view.ranges;
    layer.innerHTML = highlightHtml(text, ranges);
    status.textContent = `书论 ${ranges.length} 处 · ${view.label}`;
    updateAnnotationList(view);
    syncHighlight();
  }

  function syncAnnotationDrawer() {
    const drawer=app.querySelector('#annotationDrawer'); if(!drawer)return;
    drawer.hidden=!state.annotationOpen; drawer.setAttribute('aria-hidden',String(!state.annotationOpen));
    app.querySelector('#openAnnotations')?.setAttribute('aria-expanded',String(state.annotationOpen));
  }

  function updateAnnotationList(view) {
    const list=app.querySelector('#annotationList');if(!list)return;
    list.innerHTML=`<p class="annotation-summary">${view.label} · ${view.ranges.length} 处书论</p>`+(view.passages.length?view.passages.map((a,i)=>`<article class="annotation-item ${a.status==='needs-review'?'pending':''}"><strong>${i+1}. ${a.status==='needs-review'?'正文已变化 · 待重新定位':'书论'}</strong><blockquote>${esc(a.quote)}</blockquote><small>${esc(a.createdBy)}</small><div class="tools">${a.status==='active'?`<button type="button" data-locate-annotation="${esc(a.id)}">定位原文</button>`:''}<button type="button" data-relocate-annotation="${esc(a.id)}">用当前选区重新定位</button><button type="button" data-remove-annotation="${esc(a.id)}">撤销标注</button></div></article>`).join(''):'<p class="hint">还没有标注。若已通读确认没有书论，可直接点击“确认本页无书论”。</p>');
    const complete=app.querySelector('#completeAnnotations');complete.disabled=Boolean(view.pending.length)||view.completed;
    complete.textContent=view.completed?view.label:view.ranges.length?'确认本页标注完成':'确认本页无书论';
    app.querySelector('#annotationHistory').innerHTML=view.removed.map(a=>`<article class="annotation-item"><blockquote>${esc(a.quote)}</blockquote><button type="button" data-restore-annotation="${esc(a.id)}">恢复标注</button></article>`).join('')||'<p class="hint">没有撤销记录。</p>';
    app.querySelector('#openAnnotations').textContent=`标注列表 · ${view.passages.length}`;
    for(const badge of app.querySelectorAll('[data-annotation-page]')) { const d=state.reviews[badge.dataset.annotationPage]?.theoryAnnotations; badge.textContent=d?(d.passages.some(a=>a.status==='needs-review')?'论 · 待定位':d.completion?(d.completion.kind==='none'?'论 · 无书论':'论 · 已确认'):`论 · ${d.passages.filter(a=>a.status==='active').length}处`):'论 · 未确认'; if(Number(badge.dataset.annotationPage)===page().page)badge.textContent=`论 · ${view.label}`; }
  }

  function changeAnnotations(transform,notice) {
    try {
      const data=transform(current().theoryAnnotations);
      const saved=record({theoryAnnotations:data}); state.error='';state.notice=saved?notice:'标注改动仍在当前页，尚未保存。请重试保存或导出备份。';updateHighlight();showMessage();
    } catch(error) {state.error=error.message;state.notice='';showMessage();}
  }

  function markSelection() {
    const editor=app.querySelector('#editText'),selection=state.selectionMenu;
    const start=selection.open?selection.start:editor.selectionStart,end=selection.open?selection.end:editor.selectionEnd;
    if(selection.open && editor.value.slice(start,end)!==selection.text) {state.error='正文已变化，请重新选择书论范围。';showMessage();closeSelectionMenu();return;}
    changeAnnotations(data=>addAnnotation(data,editor.value,start,end,state.person),'已标为书论，黄色底纹已保存在本机进度中。');
    closeSelectionMenu(); editor.focus({preventScroll:true});editor.setSelectionRange(end,end);
  }

  function scrollToTextRange(editor,start) {
    // Measure a matching prefix in an offscreen copy so wrapped lines locate correctly.
    const layer=app.querySelector('#theoryLayer'),probe=layer.cloneNode(false);
    probe.removeAttribute('id');probe.style.cssText=layer.style.cssText;
    Object.assign(probe.style,{position:'fixed',left:'-10000px',top:'0',height:'auto',overflow:'visible',whiteSpace:'pre-wrap',border:'0'});
    probe.textContent=editor.value.slice(0,start);const caret=document.createElement('span');caret.textContent='|';probe.append(caret);document.body.append(probe);
    editor.scrollTop=Math.max(0,caret.offsetTop-editor.clientHeight/3);probe.remove();syncHighlight();
  }

  function applyPageFilter() {
    for(const button of app.querySelectorAll('[data-index]')){
      const item=state.data.pages[Number(button.dataset.index)];
      const marked=humanMarked(item,state.reviews[item.page]);
      button.hidden=state.pageFilter==='marked'?!marked:state.pageFilter==='unmarked'?marked:false;
    }
    const empty=app.querySelector('#pageFilterEmpty');if(empty)empty.hidden=Boolean(app.querySelector('#pageList [data-index]:not([hidden])'));
    for(const button of app.querySelectorAll('[data-page-filter]'))button.setAttribute('aria-pressed',String(button.dataset.pageFilter===state.pageFilter));
  }

  function updateValidation() {
    const result = validateDraft(draft(), sourceText(page()));
    const humanStatus = app.querySelector('.source-version-bar .publication-status');
    if (humanStatus) humanStatus.textContent = humanMarkLabel(page(),current());
    const slot = app.querySelector('#validation');
    if (slot) slot.innerHTML = `<span>${result.lines} 栏 · ${result.chars} 汉字 · ${humanMarkLabel(page(),current())}</span>${state.validation ? `<ul>${[...result.errors, ...result.warnings].map(message => `<li>${esc(message)}</li>`).join('') || '<li>未发现文本提醒；全文仍需对照原页核对。</li>'}</ul>` : ''}`;
    for (const checkbox of app.querySelectorAll('[data-check]')) checkbox.checked = humanMarked(page(),current()) || Boolean(draft().checks?.wording);
    const progress = app.querySelector('#progress');
    if (progress) progress.textContent = `已标过 ${verifiedCount()} / ${state.data.pages.length} 页`;
    for (const row of app.querySelectorAll('[data-index]')) {
      const item = state.data.pages[Number(row.dataset.index)], review = state.reviews[item.page] || {};
      const verified = humanMarked(item,review);
      row.querySelector('small').textContent = rowLabel(item, review);
      row.classList.toggle('done', verified);
    }
    const complete = app.querySelector('#verifyNext');
    if (complete) complete.textContent = humanMarked(page(),current()) ? '已标过 · 继续下一页' : '标记本页并继续 →';
    applyPageFilter();
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
    app.querySelector('#openTextEditor')?.setAttribute('aria-expanded',String(open));
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

  function publishedMarkup(p) {
    if (p.targeted && !p.collated) {
      const t = p.targeted;
      return `<details class="ocr published-revision" id="publishedRevision"><summary>局部修订版 ${esc(t.reviewedAt)} · ${esc(targetedLabel(p))}</summary>
        <p>仅下列指定区域已重新OCR并对图；整页其他文字仍未校勘。本机人工稿继续保留。</p>
        <div class="tools"><a href="./screening-data/part-${part}-targeted.txt" download>下载本份局部修订TXT</a><a href="./screening-data/part-${part}-targeted-status.csv" download>下载局部处理状态</a><a href="./screening-data/targeted-20261018/region-status.csv" download>62区域完整记录</a></div>
        <ul>${t.regions.map(r => `<li>${esc(r.id)} · ${esc(r.status)}：${esc(r.publicationBefore)} → ${esc(r.after)}；${esc(r.note)} <a href="${esc(r.facsimile)}" target="_blank" rel="noopener">查看裁片</a></li>`).join('')}</ul>
        <pre>${esc(defaultDraftText(p))}</pre></details>`;
    }
    const r = p.collated;
    if (!r) return '';
    return `<details class="ocr published-revision" id="publishedRevision"><summary>团队校订版 ${esc(r.reviewedAt)} · ${esc(publicationLabel(p))}</summary>
      <p>已逐页对照扫描图复核。本机人工稿另行保留；此处为发布正文。</p>
      <div class="tools"><a href="./screening-data/part-${part}-collated.txt" download>下载本份已修订 TXT</a><a href="./screening-data/part-${part}-collated-status.csv" download>下载处理状态表</a></div>
      ${p.targeted ? '<p>此前局部OCR记录已保留，当前正文及待核状态以本次整页复核为准。<a href="./screening-data/targeted-20261018/regions.json" target="_blank" rel="noopener">查看局部OCR历史</a></p>' : ''}
      ${r.pending.length ? `<ul class="pending-notes">${r.pending.map(q => `<li>待核：${esc(q.before)} — ${esc(q.note)}</li>`).join('')}</ul>` : ''}
      <pre>${esc(r.text)}</pre>
      ${(r.facsimiles || []).map(f => `<figure><img src="${esc(f.src)}" alt="${esc(f.caption)}"><figcaption>${esc(f.caption)}</figcaption></figure>`).join('')}
      <ul>${r.corrections.map(c => `<li>${esc(c.before)} → ${esc(c.after)}；${esc(c.note)}</li>`).join('') || '<li>复核未发现需进一步修改的文字。</li>'}${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </details>`;
  }

  function render() {
    const p = page();
    const review = current();
    window.WorkspaceUI.mount('proof');
    app.innerHTML = `<main class="page proof-workspace">
      <div class="heading"><div><h1>《历代书法论文选》</h1><span class="eyebrow">${assignment ? `成员 ${assignment.id} · ${esc(assignment.name)}` : `原第${part}份完整视图`} / ${state.data.pages[0].page}–${state.data.pages.at(-1).page} 页</span></div><span class="progress" id="progress">已标过 ${verifiedCount()} / ${state.data.pages.length} 页</span></div>
      <section class="setup"><label class="person-field">校勘人<input id="person" maxlength="80" value="${esc(state.person)}" placeholder="填写真实姓名" /></label><p><span id="saveStatus" role="status"></span><br>完成后导出交回负责人。</p>
        <div class="tools">${assignment ? assignment.segments.filter(s=>s.part!==part).map(s=>`<a class="assignment-switch download" href="${assignmentHref(assignment.id,s.part)}">另一段 ${s.start}–${s.end} →</a>`).join('') : ''}<button type="button" id="exportBundle" class="primary" ${exporting ? 'disabled' : ''}>${exporting ? '正在打包…' : assignment ? '导出本段ZIP' : '一键导出全部'}</button><details class="extra-tools"><summary>材料与恢复</summary><div class="tools"><p class="hint">${assignment ? '本段正文与表格打包导出；JSON保留原分份全部个人记录。另一段需分别导出。' : '一次下载ZIP，正文、校验表、修改率和进度备份都在里面。整包交回即可。'}</p><a class="download" href="./screening-data/part-${part}-work.txt" download>下载本份工作TXT</a>${teamRelease.parts[part] ? `<a class="download" href="./screening-data/part-${part}-collated.txt" download>原第${part}份已修订 TXT</a><a class="download" href="./screening-data/part-${part}-collated-status.csv" download>原第${part}份修改状态表</a>` : ''}${targetedRelease.parts[part] ? `<a class="download" href="./screening-data/part-${part}-targeted.txt" download>原第${part}份局部修订TXT</a><a class="download" href="./screening-data/part-${part}-targeted-status.csv" download>原第${part}份局部状态表</a>` : ''}<a class="download" href="${taskOcrHref(part)}" download>${assignment ? `下载原第${part}份完整OCR` : '下载原始 OCR（历史）'}</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-conservative.txt" download>下载历史模型保守稿（未核）</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-normalized.txt" download>下载历史模型语义稿（未核）</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-comparison.md" target="_blank" rel="noopener">查看两版比对报告</a>
          <a class="download" href="./screening-data/part-${part}.pdf" target="_blank" rel="noopener">打开本份原 PDF</a>
          <label class="file-button">导入进度 JSON<input id="backupFile" type="file" accept="application/json,.json" /></label><p class="hint">恢复时先解压交付包，再选择其中的进度备份JSON；旧版备份也可使用。</p>
        <details class="local-fallback"><summary>本地材料备用</summary><div class="tools"><label class="file-button">选择扫描页文件夹<input id="scanFolder" type="file" webkitdirectory multiple /></label>
          <label class="file-button">或选择图片<input id="scanFiles" type="file" accept="image/jpeg" multiple /></label>
          <label class="file-button">载入本地 OCR<input id="locatorFile" type="file" accept="text/html,.html" /></label></div></details></div></details></div></section>
      <div id="saveRecovery"></div><div id="messageSlot"></div>
      <div class="layout"><aside class="panel page-panel"><div class="panel-head"><h2>页码</h2><label class="jump">跳到原 PDF 页<input id="jump" type="number" min="${state.data.pages[0].page}" max="${state.data.pages.at(-1).page}" placeholder="页码" /></label><div class="page-filters" role="group" aria-label="人工标记筛选">${[['all','全部'],['unmarked','未标过'],['marked','已标过']].map(([value,label])=>`<button type="button" data-page-filter="${value}" aria-pressed="${state.pageFilter===value}">${label}</button>`).join('')}</div></div><div class="page-list" id="pageList">${state.data.pages.map((item,index)=>`<button type="button" data-index="${index}" class="${index===state.index?'selected ':''}${humanMarked(item,state.reviews[item.page])?'done':''}" aria-current="${index===state.index}"><span>${item.page} 页</span><small>${humanMarkLabel(item,state.reviews[item.page])}</small><small class="annotation-page-status" data-annotation-page="${item.page}"></small></button>`).join('')}<p id="pageFilterEmpty" class="workspace-hint" hidden>此筛选下没有页面</p></div></aside>
      <section class="panel viewer-panel"><div class="panel-head viewer-bar"><h2>原图 · 第 ${p.page} 页</h2><div class="tools"><button type="button" id="prev" ${state.index===0?'disabled':''} aria-label="上一页">←</button><button type="button" id="next" ${state.index===state.data.pages.length-1?'disabled':''} aria-label="下一页">→</button><label class="scan-zoom">缩放<select id="zoom">${[100,125,150,200].map(value=>`<option value="${value}" ${state.zoom===value?'selected':''}>${value}%</option>`).join('')}</select></label></div></div><div class="viewer"><div class="scan-wrap" id="scanWrap"></div><div class="source-links"><a href="${scanHref(p.page)}" target="_blank" rel="noopener">单独打开原图</a><a href="${pdfHref(p.local)}" target="_blank" rel="noopener">原 PDF 第 ${p.local} 页 ↗</a></div></div></section>
      <section class="panel form-panel"><div class="panel-head txt-head"><div><h2 id="editorHeading" tabindex="-1">第 ${p.page} 页全文</h2></div><div class="txt-actions"><button type="button" id="copyCurrentPage" data-copy-current>复制</button><button type="button" id="openTextEditor" aria-controls="reviewDrawer" aria-expanded="${state.reviewOpen}">备注与历史</button></div></div><div class="form-body">
        <div class="source-version-bar"><span>${review.collation?.text!==undefined?'本页人工稿':'当前工作正文'}</span><strong class="publication-status">${humanMarkLabel(p,review)}</strong>${p.collated||p.targeted?'<button type="button" id="openPublished">查看原记录</button>':''}</div>
        <div class="editor-main"><div class="theory-toolbar"><button type="button" id="markTheory" class="primary" title="选中文字后标注（⌘/Ctrl+Shift+M）">标为书论</button><button type="button" id="openAnnotations" aria-controls="annotationDrawer" aria-expanded="${state.annotationOpen}">标注列表</button><small id="theoryStatus" role="status"></small></div><div class="highlight-editor"><div id="theoryLayer" aria-hidden="true"></div><textarea id="editText" aria-label="第 ${p.page} 页校勘全文" aria-describedby="annotationHelp" spellcheck="false">${esc(draft().text||'')}</textarea></div></div>
        <aside class="review-controls review-drawer annotation-drawer" id="annotationDrawer" ${state.annotationOpen?'':'hidden'} aria-hidden="${!state.annotationOpen}" aria-label="书论标注"><div class="drawer-head"><strong>第 ${p.page} 页 · 书论标注</strong><button type="button" id="closeAnnotations">关闭</button></div><div class="drawer-body"><p id="annotationHelp" class="hint">在全文中拖选文字，点“标为书论”；跨页的书论请分页面标注。黄色底纹表示人工选定的书论范围，全文仍可直接改字。</p><p class="hint">调整范围时，请先关闭列表，在全文重新选择文字，再打开列表点击“用当前选区重新定位”。书论标注与全文校对分别记账。</p><div id="annotationList"></div><button type="button" id="completeAnnotations" class="primary">确认本页标注完成</button><details id="removedAnnotations"><summary>已撤销标注</summary><div id="annotationHistory"></div></details></div></aside><aside class="review-controls review-drawer" id="reviewDrawer" ${state.reviewOpen?'':'hidden'} aria-hidden="${!state.reviewOpen}" aria-label="备注与历史"><div class="drawer-head"><strong>第 ${p.page} 页 · 备注与历史</strong><button type="button" id="closeReviewDrawer" class="drawer-close">关闭</button></div><div class="drawer-body"><div id="drawerMessage" aria-live="polite"></div><label>备注（选填）<textarea id="question" rows="3" placeholder="记录看不清的字或后续需要查证的内容">${esc(review.question||'')}</textarea></label>${publishedMarkup(p)}<details class="ocr"><summary>原始 OCR（保留原样）</summary><pre>${esc(p.ocr||'本页没有可用OCR')}</pre></details><details><summary>个人替换历史</summary><div id="changeLog">${editHistoryMarkup(draft().edits||[])}</div></details><details><summary>旧初筛记录与候选</summary><pre>${esc(JSON.stringify({seen:review.seen,candidates:review.candidates||[],redoOcr:review.redoOcr},null,2))}</pre></details><details><summary>正文辅助工具</summary><p class="hint">${esc(layoutNote())}</p><div class="editor-tools"><button id="makeDraft">重新生成草稿</button><button id="renumber">重新编号</button><button id="lineUp">本栏上移</button><button id="lineDown">本栏下移</button></div></details></div></aside>
      </div><div class="validation" id="validation" aria-live="polite"></div><div class="drawer-footer proof-confirmation"><div class="checklist">${Object.entries(CHECKS).map(([key])=>`<label class="check"><input type="checkbox" data-check="${key}" ${humanMarked(p,review)||draft().checks?.wording?'checked':''}/>已对照原图逐栏检查本页全文</label>`).join('')}</div><div class="form-actions drawer-actions"><button id="validate">文本提醒</button><button id="verifyNext" class="primary">标记本页并继续 →</button></div></div></section></div>
      <div id="selectionMenu" class="selection-menu" role="dialog" aria-label="选中文字操作" hidden><div class="selection-menu-title"><strong>选中文字</strong><span data-selection-count></span></div><div class="selection-preview">“<span data-selection-text></span>”</div><label for="selectionReplacement">改为<input id="selectionReplacement" type="text" autocomplete="off" spellcheck="false"/></label><div class="selection-menu-actions"><button type="button" id="selectionMarkTheory">标为书论</button><button type="button" id="applySelectionReplace" class="primary">替换</button><button type="button" id="selectionDelete">删除选中</button><button type="button" id="closeSelectionMenu">取消</button></div></div></main>`;
    showMessage();
    syncReviewDrawer();
    syncAnnotationDrawer();
    updateSaveStatus();
    setImage();
    updateValidation();
    updateHighlight();
    syncSelectionMenu();
    editorObserver?.disconnect();
    editorObserver = new ResizeObserver(syncHighlight);
    editorObserver.observe(app.querySelector('#editText'));
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

  async function select(index, notice = '') {
    const request = ++selectionRequest;
    const target = Math.max(0, Math.min(state.data.pages.length - 1, index));
    state.notice = `正在读取第 ${state.data.pages[target].page} 页材料…`; state.error = ''; showMessage();
    try { await materialLoader.ensurePage(state.data.pages[target].page); }
    catch (error) { if (request === selectionRequest) { state.error = `${error.message}。请再次点击目标页重试。`; showMessage(); } return false; }
    if (request !== selectionRequest) return false;
    if (state.saveProblem && !persist()) { app.querySelector('#saveRecovery')?.scrollIntoView({ block: 'nearest' }); return false; }
    closeSelectionMenu();
    state.lastTextSelection = null;
    state.index = target;
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

  async function copyCurrentPage(button) {
    const number = page().page;
    const text = String(draft().text || '');
    if (!text.trim()) { state.error = '本页正文为空，暂无可复制内容。'; showMessage(); return; }
    button.disabled = true;
    const label = '复制本页';
    try {
      await copyText(text);
      button.textContent = '已复制';
      state.error = '';
      state.notice = `第 ${number} 页校勘正文已复制到剪贴板，可直接粘贴。`;
      setTimeout(() => { if (button.isConnected) button.textContent = label; }, 2000);
    } catch {
      const editor = page().page === number ? app.querySelector(state.reviewOpen ? '#editText' : '#editText') : null;
      if (editor) { editor.focus({ preventScroll: true }); editor.select(); }
      state.error = editor
        ? '浏览器未允许自动复制，已选中本页正文。请使用系统“复制”或按 Ctrl+C（Mac：⌘C）。'
        : `第 ${number} 页自动复制失败，请回到该页重试。`;
    } finally { button.disabled = false; showMessage(); }
  }

  function download(name, textValue, type = 'application/json;charset=utf-8') {
    downloadBlob(name, new Blob(['\ufeff', textValue], { type }));
  }
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const runBundleExport = createBundleExporter({
    capture: () => ({ progress: payload(), unsaved: Boolean(state.saveProblem), saveConflict: state.saveConflict,
      exportedAt: new Date().toISOString(), ...(assignment ? { member: assignment.id } : {}) }),
    loadMaterials: () => materialLoader.ensureAll(),
    build: snapshot => buildCollationBundle({ ...snapshot, pages: state.data.allPages }),
    download: bundle => downloadBlob(bundle.name, new Blob([bundle.bytes], { type: 'application/zip' })),
  });
  async function exportAll() {
    if (exporting) return;
    if (!state.person.trim()) { state.error = '请先填写校勘人姓名，再一键导出。'; showMessage(); app.querySelector('#person')?.focus(); return; }
    exporting = true;
    for (const b of app.querySelectorAll('#exportBundle, [data-export-all]')) b.disabled = true;
    state.notice = '正在打包完整交付材料，请稍候…'; state.error = ''; showMessage();
    try {
      const bundle = await runBundleExport();
      state.notice = `已发起ZIP下载，正文、人工标记和进度备份已打包，请整包交回。包内为点击时的进度，后续改动请再次导出。${bundle.manifest.unsaved ? '本包包含尚未保存的修改，请保留备份。' : ''}`;
    } catch (error) {
      state.error = `${error.message || '打包失败'}。未生成不完整交付包，请再次点击重试；如材料持续无法载入，可先抢救进度。`;
      state.notice = '';
      // A network outage must not prevent saving the current in-memory draft.
      const recovery = app.querySelector('#saveRecovery');
      if (recovery && !state.saveProblem) recovery.innerHTML = '<div class="message"><button id="rescueBackup">紧急导出进度JSON</button>材料无法载入时，可先保存当前修改。</div>';
    } finally {
      exporting = false;
      for (const b of app.querySelectorAll('#exportBundle, [data-export-all]')) b.disabled = false;
      showMessage();
    }
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

  app.addEventListener('click', async (event) => {
    if (state.selectionMenu.open && !event.target.closest('#selectionMenu') && !event.target.closest('#editText') && !event.target.closest('#markTheory')) closeSelectionMenu();
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'markTheory' || button.id === 'selectionMarkTheory') { markSelection(); return; }
    if (button.id === 'openAnnotations') { state.annotationOpen=true; state.reviewOpen=false; syncReviewDrawer(); syncAnnotationDrawer(); app.querySelector('#closeAnnotations')?.focus({preventScroll:true}); return; }
    if (button.id === 'closeAnnotations') { state.annotationOpen=false; syncAnnotationDrawer(); app.querySelector('#openAnnotations')?.focus({preventScroll:true}); return; }
    if (button.id === 'completeAnnotations') { changeAnnotations(data=>completeAnnotations(data,String(draft().text||''),state.person),'本页书论标注已确认。'); return; }
    if (button.dataset.removeAnnotation) { changeAnnotations(data=>removeAnnotation(data,String(draft().text||''),button.dataset.removeAnnotation,state.person),'标注已撤销，可在列表底部恢复。'); return; }
    if (button.dataset.restoreAnnotation) { changeAnnotations(data=>restoreAnnotation(data,String(draft().text||''),button.dataset.restoreAnnotation,state.person),'标注已恢复；如正文已变化，请重新定位。'); return; }
    if (button.dataset.relocateAnnotation) { const e=app.querySelector('#editText'); changeAnnotations(data=>relocateAnnotation(data,e.value,button.dataset.relocateAnnotation,e.selectionStart,e.selectionEnd,state.person),'已按当前选区重新定位。'); return; }
    if (button.dataset.locateAnnotation) { const a=annotationView(current().theoryAnnotations,String(draft().text||'')).ranges.find(a=>a.id===button.dataset.locateAnnotation); if(a) { const e=app.querySelector('#editText'); state.annotationOpen=false; syncAnnotationDrawer(); e.focus({preventScroll:true}); e.setSelectionRange(a.start,a.end); scrollToTextRange(e,a.start); } return; }
    if (button.id === 'openPublished') { state.reviewOpen = true; state.annotationOpen=false; render(); const details = app.querySelector('#publishedRevision'); details.open = true; details.scrollIntoView({ block: 'nearest' }); return; }
    if (button.id === 'retryLoad') { await init(); return; }
    if (!state.data || !app.querySelector('#pageList')) return;
    if (button.id === 'exportBundle' || button.hasAttribute('data-export-all')) return exportAll();
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
      state.reviewOpen = true; state.annotationOpen=false; syncAnnotationDrawer();
      syncReviewDrawer();
      app.querySelector('#question')?.focus({ preventScroll: true });
      return;
    }
    if (button.id === 'closeReviewDrawer') {
      state.reviewOpen = false;
      syncReviewDrawer();
      app.querySelector('#openTextEditor')?.focus({ preventScroll: true });
      return;
    }
    if (button.hasAttribute('data-copy-current')) return copyCurrentPage(button);
    if (button.id === 'retrySave') return persist();
    if (button.id === 'rescueBackup') {
      backup(); state.notice = '已发起进度备份下载，请在浏览器下载列表确认。'; showMessage(); return;
    }
    if (button.id === 'reloadProgress') {
      if (!confirm('载入本机最新进度会替换本页未保存的修改。请确认已下载备份，再继续。')) return;
      if (restore()) { await select(state.index, '已载入本机最新进度。'); }
      else updateSaveStatus();
      return;
    }
    if (button.dataset.pageFilter) {state.pageFilter=button.dataset.pageFilter;applyPageFilter();return;}
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
        value = defaultDraftText(page()); caret = 0;
        state.notice = layoutNote(); showMessage();
      } else if (button.id === 'renumber') value = numberLines(value);
      else ({ text: value, caret } = moveLine(value, caret, button.id === 'lineUp' ? -1 : 1));
      updateDraft({ text: value }, { reset: ['makeDraft', 'confirmDraftReset'].includes(button.id) }); editor.value = value; editor.focus(); editor.setSelectionRange(caret, caret);
      app.querySelector('#makeDraft').textContent = '重新生成草稿'; return;
    }
    if (button.id === 'validate') { state.validation = true; updateValidation(); return; }
    if (button.id === 'verifyNext') {
      if (humanMarked(page(),current())) {
        const next = nextUnmarkedIndex(state.data.pages,state.reviews,state.index);
        if (next >= 0) return select(next);
        state.notice = '当前页段已全部标过，可导出交回。'; showMessage(); return;
      }
      state.validation = true; updateValidation();
      const validation = validateDraft(draft(), sourceText(page()));
      const problems = [...validation.errors];
      if (!state.person.trim()) problems.unshift('请填写校勘人真实姓名。');
      if (!state.imageReady) problems.push('原页尚未载入，请载入后核对。');
      if (!draft().checks?.wording) problems.push('请勾选“已对照原图逐栏检查本页全文”。');
      if (problems.length) { state.error = problems.join(' '); showMessage();
        app.querySelector(!state.person.trim() ? '#person' : validation.errors.length ? '#editText' : !draft().checks?.wording ? '[data-check]:not(:checked)' : '#question')?.focus(); return; }
      const saved = record({ seen: true, collation: { ...draft(), verified: true, fullTextChecked: true, workflow: page().modelReviewed ? 'machine-model-human-fulltext-v1' : 'human-fulltext-v1', ...(page().modelReviewed ? { modelRevision: page().modelReviewed.revision } : {}), verifiedBy: state.person.trim(), verifiedAt: new Date().toISOString() } });
      updateValidation();
      if (!saved) return;
      const completed = page().page;
      const next = nextUnmarkedIndex(state.data.pages, state.reviews, state.index);
      if (next >= 0) select(next, `第 ${completed} 页已标过并保存；已转到第 ${state.data.pages[next].page} 页继续。`);
      else { state.notice = assignment ? '当前分工段已全部标过，请导出本段ZIP；如另有页段，可通过导出按钮旁的链接切换。' : '本份已全部标过，请一键导出全部并将ZIP交回负责人。'; render(); }
      return;
    }
    if (button.id === 'markSeen' && (state.imageReady || current().seen)) { record({ seen: !current().seen }); render(); return; }
    if (button.dataset.remove !== undefined) {
      const candidates = [...(current().candidates || [])]; candidates.splice(Number(button.dataset.remove), 1);
      record({ candidates }); render(); return;
    }

  });

  app.addEventListener('contextmenu', openSelectionMenu);

  app.addEventListener('mousedown', (event) => {
    const target = event.target.closest('#editText');
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
    if (event.target.id === 'person') { state.person = event.target.value; persist(); }
    if (event.target.id === 'editText') updateDraft({ text: event.target.value });
    if (event.target.dataset.check) updateDraft({
      checks: { ...draft().checks, [event.target.dataset.check]: event.target.checked, fulltext: event.target.checked },
      ...(typeof current().collation?.text !== 'string' ? { metricBaseline: { version:1, text:String(draft().text || ''), label:sourceLabel() } } : {}),
    });
    if (event.target.id === 'question') record({ question: event.target.value });
    if (event.target.id === 'redoOcr') record({ redoOcr: event.target.checked });
  });

  app.addEventListener('scroll', (event) => {
    if (event.target.id === 'editText') syncHighlight();
  }, true);

  function jumpTo(value) {
    const target = Number(value);
    if (Number.isInteger(target) && target >= state.data.start && target <= state.data.end) {
      const index = state.data.pages.findIndex(item => item.page === target);
      if (index >= 0) select(index);
      else { state.error = excludedPages[target] ? `第 ${target} 页为${excludedPages[target]}，已移出本轮任务。` : `第 ${target} 页不在当前成员的本段分工中，请从团队任务进入对应页段。`; showMessage(); }
    }
    else { state.error = `请输入 ${state.data.start}–${state.data.end} 之间的原 PDF 页码。`; showMessage(); }
  }

  app.addEventListener('keydown', (event) => {
    if (!state.data || !app.querySelector('#pageList')) return;
    if ((event.metaKey||event.ctrlKey) && event.shiftKey && event.code==='KeyM' && !event.isComposing && event.target.id==='editText') { event.preventDefault(); markSelection(); return; }
    if (event.key === 'Escape' && state.selectionMenu.open) {
      closeSelectionMenu();
      return;
    }
    if (event.key === 'Escape' && state.annotationOpen) { state.annotationOpen=false; syncAnnotationDrawer(); app.querySelector('#openAnnotations')?.focus({preventScroll:true}); return; }
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
        await materialLoader.ensureAll();
        state.data.allPages.forEach((item, index) => { item.ocr = pages[index].ocr; delete item.layout; });
        state.notice = '已载入本地 OCR 对照；请以扫描图核对。'; render();
      } catch (error) { state.error = error.message || '本地 OCR 载入失败'; showMessage(); }
    }
    if (event.target.id === 'backupFile') {
      if (!event.target.files?.length) return;
      try {
        const saved = JSON.parse(await event.target.files[0].text());
        validateProgress(saved);
        if (saved.part !== part)
          throw new Error('进度备份与本份页段不匹配');
        if ((Object.keys(state.reviews).length || state.saveProblem) && !confirm('导入会替换本份在当前浏览器的进度，包括其他标签页的更新。请确认已备份，再继续。')) return;
        const restoredIndex = initialPageIndex(state.data.pages, null, saved.lastPage ?? page().page);
        await materialLoader.ensurePage(state.data.pages[restoredIndex].page);
        ++selectionRequest;
        progressStore.allowBackupReplacement();
        state.reviews = saved.reviews; state.person = String(saved.person || '');
        state.index = restoredIndex;
        syncUrl(); persist();
        state.error = '';
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
    window.WorkspaceUI.mount('proof');
    if (![1, 2, 3, 4].includes(part)) { app.innerHTML = '<p class="loading">请从团队任务选择成员1–7的分工入口；原文材料仍按原四份定位。</p>'; return; }
    try {
      assignment = assignmentFor(member);
      segment = assignmentSegment(member, part);
      app.innerHTML = '<p class="loading" role="status">正在读取页码索引…</p>';
      state.data = await readJson(`./screening-data/part-${part}-index.json?v=remaining-final-20261019`);
      if (state.data.part !== part || state.data.pages.length !== state.data.end - state.data.start + 1 || !state.data.materials) throw new Error('页码索引不完整');
      materialLoader = createMaterialLoader(state.data);
      state.data.allPages = state.data.pages;
      state.data.pages = assignmentPages(state.data.allPages, member, part);
      if (!state.data.pages.length) throw new Error('当前分工段没有可校勘页面');
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
      app.innerHTML = `<p class="loading" role="status">页码索引已就绪，正在读取第 ${page().page} 页材料…</p>`;
      await materialLoader.ensurePage(page().page);
      syncUrl();
      render();
    } catch (error) { app.innerHTML = `<div class="loading" role="alert">${esc(error.message)}。本机校勘进度保留。<p><button id="retryLoad" type="button">重试加载</button></p></div>`; }
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

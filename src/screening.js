import {loadChapterIndex,chapterHref} from './annotation-chapters.js?v=loading-20261028';
import { annotationSource, annotationHref, sourceStamp } from './annotation-source.js?v=index-archive-20261027';
import {loadReviewedPart,loadReviewedIndex,candidateView,deleteDefaultAnnotation,confirmDefaultAnnotations,annotationDisplayRanges} from './reviewed-annotation.js?v=loading-20261028';
import {unifiedAnnotationContext} from './annotation-task-context.js?v=index-archive-20261027';
import { buildAnnotationBundle,buildUnifiedAnnotationBundle } from './theory-annotation-export.js?v=loading-20261028';
import { humanMarked, humanMarkLabel, nextUnmarkedIndex } from './human-mark.js?v=index-archive-20261027';
import { draftForPage, defaultDraftText } from './ocr-source-policy.js?v=index-archive-20261027';
import { publicationLabel, teamRelease } from './team-collation.js?v=member5-mark45-20261023';
import { targetedLabel, targetedRelease } from './targeted-ocr.js?v=20261018-part3';
import { copyText } from './clipboard.js?v=20261012-copy';
import { buildCollationBundle, createBundleExporter } from './collation-export.js?v=index-archive-20261027';
import { captureMemberTask, buildMemberTaskBundle, mergeMemberBackup } from './member-task-export.js?v=index-archive-20261027';
import { assignmentFor, assignmentSegment, assignmentPages, assignmentHref } from './team-assignments.js?v=index-archive-20261027';
import { readJson, createMaterialLoader } from './screening-loader.js?v=loading-20261028';
import { CHECKS, makeDraft, numberLines, moveLine, validateDraft } from './collation-core.js?v=index-archive-20261027';
import { excludedPages, isTaskPage, taskOcrHref } from './screening-page-policy.js?v=index-archive-20261027';
import { createProgressStore, initialPageIndex } from './screening-workflow.js?v=index-archive-20261027';
import { highlightHtml } from './theory-highlight.js?v=20261003-theory';
import { annotationView, addAnnotation, removeAnnotation, restoreAnnotation, relocateAnnotation, rebaseAnnotations } from './theory-annotations.js?v=release-20261022';
import { validateProgress,readProgress } from './delivery-core.js?v=index-archive-20261027';
import { pageMetrics } from './task-metrics.js?v=index-archive-20261027';
import { mountTabletProofInput,textareaSourceOffset } from './tablet-proof-input.js?v=handwriting-buffer-20261019';
import {annotationReading} from './annotation-reading.js?v=release-20261022';

(() => {
  const app = document.querySelector('#screeningApp');
  const annotationMode = location.pathname.endsWith('/annotation.html');
  const unifiedMode = annotationMode&&new URLSearchParams(location.search).get('scope')==='all';
  const chapterId=unifiedMode?new URLSearchParams(location.search).get('chapter'):null;
  const taskName = annotationMode ? '书论标注' : '原文校对';
  const part = Number(new URLSearchParams(location.search).get('part'));
  const member = unifiedMode?null:new URLSearchParams(location.search).get('member');
  let assignment = null, segment = null;
  const state = { data: null, index: 0, reviews: {}, files: new Map(), imageUrl: '', imageReady: false,
    person: '', notice: '', error: '', saveProblem: '', saveConflict: false, savedAt: '', lastPage: null, annotationLastPage: null, annotationSavedAt: '', zoom: 100, validation: false, resetPending: false, annotationOpen: false, reviewOpen: false };
  state.selectionMenu = { open: false, start: 0, end: 0, text: '', x: 0, y: 0, targetId: '' };
  let editorObserver, materialLoader;
  let tabletProofInput;
  let selectionRequest = 0;
  let exporting = false;
  let composingInput = null;
  let editorPointerType = '';
  const esc = (value = '') => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const key = () => `shulun-screening-v1-part-${part}`;
  const progressStore = createProgressStore(localStorage, key(), part);
  const page = () => state.data.pages[state.index];
  const current = () => state.reviews[page().page] || {};
  const unifiedContext = () => {
    const all=unifiedAnnotationContext({getItem:name=>name===key()?JSON.stringify(payload()):localStorage.getItem(name)},state.annotationIndexes);
    if(!state.annotationChapter)return all;
    const numbers=new Set(state.annotationChapter.fragments.map(f=>f.page)),pages=all.pages.filter(p=>numbers.has(p.page));
    return {...all,pages,total:pages.length,completed:pages.filter(p=>p.completed).length,candidates:pages.reduce((n,p)=>n+p.candidates,0)};
  };
  async function openUnifiedPage(target) {
    if(!target)return;
    if(target.part===part)return select(state.data.pages.findIndex(p=>p.page===target.page));
    if(state.saveProblem&&!persist()){showMessage();return;}
    location.assign(annotationHref(null,target.part,target.page)+'&scope=all'+(chapterId?'&chapter='+encodeURIComponent(chapterId):''));
  }
  const seen = () => state.data.pages.filter((item) => state.reviews[item.page]?.seen).length;
  const filename = (number) => `page-${String(number).padStart(4, '0')}.jpg`;
  const scanHref = (number) => `./screening-data/scans/${filename(number)}`;
  const pdfHref = (local) => `./screening-data/part-${part}.pdf#page=${local}`;
  const sourceText = item => item.ocr;
  const visibleOffset = (text, offset) => annotationMode?annotationReading(text).visibleOffset(offset):text.slice(0,offset).replace(/\r\n?/g,'\n').length;
  const readingText=text=>annotationMode?annotationReading(text).text:text;
  const sourceSelection=(text,start,end)=>annotationMode?[annotationReading(text).sourceStart(start),annotationReading(text).sourceEnd(end)]:[textareaSourceOffset(text,start),textareaSourceOffset(text,end)];
  const sourceLabel = () => page().collated ? '团队校订TXT' : '工作TXT';
  const rowLabel = (item, review) => annotationMode ? annotationView(review?.theoryAnnotations,annotationSource(item,review)?.text||'').label : humanMarkLabel(item,review);
  const draft = () => annotationMode ? {text:annotationSource(page(),current())?.text || ''} : draftForPage(page(), current());
  const layoutNote = () => page().layout?.method === 'aligned-lines' ? '已按逐栏 OCR 对齐分栏；栏界为机器建议，请看图核对。'
    : page().layout?.method === 'ocr-lines' ? '沿用竖排 OCR 栏序；请逐栏对照原图检查全文。' : '本页保留原段落；本轮无需整理分栏格式。';
  const verifiedCount = () => state.data.pages.filter(item => annotationMode ? annotationView(state.reviews[item.page]?.theoryAnnotations,annotationSource(item,state.reviews[item.page])?.text||'').completed : humanMarked(item,state.reviews[item.page])).length;

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
        const caret = next.slice(0,start + replacement.length).replace(/\r\n?/g,'\n').length;
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

  function updateDraft(patch, { reset = false, fromEditor = false } = {}) {
    if(annotationMode)return;
    state.resetPending = false;
    state.notice = ''; state.error = '';
    const changed = Object.hasOwn(patch, 'text') && (reset || patch.text !== draft().text);
    if (Object.hasOwn(patch, 'text') && !changed) return;
    if(changed) {
      state.sourceRiskApproval=null;
      const check=app.querySelector('#sourceRiskResolved'),button=app.querySelector('#approveAnnotationSource');
      if(check)check.checked=false;if(button)button.disabled=true;
    }
    const clearHistory = changed && !Object.hasOwn(patch, 'edits');
    const existingBaseline = current().collation?.metricBaseline;
    const metricBaseline = reset ? { version: 1, text: String(patch.text || ''), label: sourceLabel() }
      : existingBaseline || (changed && typeof current().collation?.text !== 'string' ? { version: 1, text: String(draft().text || ''), label: sourceLabel() } : undefined);
    record({ ...(changed && current().theoryAnnotations ? { theoryAnnotations: (current().theoryAnnotations.text===String(draft().text||'')?rebaseAnnotations(current().theoryAnnotations, String(draft().text || ''), String(patch.text || ''), state.person):current().theoryAnnotations) } : {}), collation: { ...draft(), ...patch, ...(metricBaseline ? { metricBaseline } : {}), ...(changed ? { checks: {}, fullTextChecked: false } : {}), ...(clearHistory || reset ? { edits: [] } : {}), verified: false, verifiedBy: '', verifiedAt: '' } });
    // Save provisional handwriting, but leave the native IME's DOM and selection alone.
    if (composingInput?.id === 'editText') return;
    const preview = app.querySelector('#editText');
    if (!fromEditor && preview && preview.value !== draft().text) preview.value = draft().text;
    refreshDraftUI();
  }

  function refreshDraftUI() {
    updateSaveStatus();
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
    // Touch/pen long press belongs to the system selection and handwriting keyboard.
    if (composingInput || ['touch', 'pen'].includes(event.pointerType) || ['touch', 'pen'].includes(editorPointerType) || event.sourceCapabilities?.firesTouchEvents) return;
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
      page:page().page,
      sourceText:String(draft().text||''),
    };
    if(annotationMode) {
      const menu=app.querySelector('#selectionMenu');menu.querySelector('label')?.remove();menu.querySelector('#selectionReplacement')?.remove();menu.querySelector('#applySelectionReplace')?.remove();menu.querySelector('#selectionDelete')?.remove();
    }
    syncSelectionMenu();
    requestAnimationFrame(() => {
      const input = app.querySelector('#selectionReplacement');
      input?.focus();
      input?.select();
    });
  }

  function applySelectionReplacement(replacement) {
    if(annotationMode)return;
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
    const view = annotationMode ? annotationView(current().theoryAnnotations, text) : {ranges:[]};
    const suggestions=annotationMode?candidateView(page(),current(),annotationSource(page(),current())):{pending:[]};
    const ranges = annotationMode?annotationDisplayRanges(view.ranges,suggestions.pending):view.ranges;
    layer.innerHTML = annotationMode?highlightHtml(annotationReading(text).text,annotationReading(text).ranges(ranges)):highlightHtml(text,ranges);
    if(status)status.textContent = annotationMode ? `保留AI标注 ${suggestions.pending.length} 处 · 已保存标注 ${view.ranges.length} 处 · ${view.label}` : '任务一 · 对照原图校验全文，书论在独立任务中标注。';
    if(annotationMode)updateAnnotationList(view);
    syncHighlight();
  }

  function syncAnnotationDrawer() {
    const drawer=app.querySelector('#annotationDrawer'); if(!drawer)return;
    drawer.hidden=!state.annotationOpen; drawer.setAttribute('aria-hidden',String(!state.annotationOpen));
    app.querySelector('#openAnnotations')?.setAttribute('aria-expanded',String(state.annotationOpen));
  }

  function updateAnnotationList(view) {
    const list=app.querySelector('#annotationList');if(!list)return;
    const suggestions=candidateView(page(),current(),annotationSource(page(),current()));
    const ai=`<section class="annotation-suggestions" aria-label="AI书论初标"><h3>默认AI标注</h3><p class="hint">无需逐条判断。标错处选中文字后右键删除标注，通读后一次确认本页。</p>${suggestions.available?`<p class="hint">${esc(suggestions.summary)}</p>${suggestions.contextNotes.map(n=>`<p class="hint">${esc(n)}</p>`).join('')}${suggestions.all.map(c=>`<article class="annotation-item" data-candidate-id="${esc(c.id)}"><strong>${esc(c.category)}${c.contextStatus==='needs-context'?' · 语境提示':''} · ${c.decision==='accepted'?'随本页已确认':c.decision==='rejected'?'已删除':c.remaining.length!==1||c.remaining[0]?.quote!==c.quote?'保留调整后的范围':'默认保留'}</strong><blockquote>${esc(readingText(c.quote))}</blockquote><p class="hint">${esc(c.note)}</p><button type="button" data-locate-candidate="${esc(c.id)}">定位原文</button></article>`).join('')||'<p class="hint">本页没有AI标注；有遗漏可自行补选，通读后确认本页。</p>'}`:'<p class="hint">当前本机正文与初标来源版本不同，初标不套用新稿；旧标注仍保留，可手工圈选。</p>'}</section>`;
    list.innerHTML=ai+`<h3>人工标注</h3><p class="annotation-summary">${view.label} · ${view.ranges.length} 处书论</p>`+(view.passages.length?view.passages.map((a,i)=>`<article class="annotation-item ${a.status==='needs-review'?'pending':''}"><strong>${i+1}. ${a.status==='needs-review'?'正文来源已变化 · 待重新定位':esc(a.category||'书论')}</strong><blockquote>${esc(readingText(a.quote))}</blockquote><small>${esc(a.createdBy)}</small>${a.contextNote?`<p class="hint">${esc(a.contextNote)}</p>`:''}<div class="tools">${a.status==='active'?`<button type="button" data-locate-annotation="${esc(a.id)}">定位原文</button>`:''}<button type="button" data-relocate-annotation="${esc(a.id)}">用当前选区重新定位</button><button type="button" data-remove-annotation="${esc(a.id)}">撤销标注</button></div></article>`).join(''):'<p class="hint">尚无人工标注；请复核上方初标并通读全文。</p>');
    const complete=app.querySelector('#completeAnnotations');complete.disabled=Boolean(view.pending.length)||view.completed;
    complete.textContent=view.completed?view.label:view.ranges.length||suggestions.pending.length?'确认本页标注':'确认本页无书论';
    app.querySelector('#annotationHistory').innerHTML=view.removed.map(a=>`<article class="annotation-item"><blockquote>${esc(readingText(a.quote))}</blockquote><button type="button" data-restore-annotation="${esc(a.id)}">恢复标注</button></article>`).join('')||'<p class="hint">没有撤销记录。</p>';
    app.querySelector('#openAnnotations').textContent=`标注详情 · ${view.passages.length+suggestions.pending.length}`;
    for(const badge of app.querySelectorAll('[data-annotation-page]')) { const d=state.reviews[badge.dataset.annotationPage]?.theoryAnnotations; badge.textContent=d?(d.passages.some(a=>a.status==='needs-review')?'论 · 待定位':d.completion?(d.completion.kind==='none'?'论 · 无书论':'论 · 已确认'):`论 · ${d.passages.filter(a=>a.status==='active').length}处`):'论 · 未确认'; if(Number(badge.dataset.annotationPage)===page().page)badge.textContent=`论 · ${view.label}`; }
  }

  function changeAnnotations(transform,notice) {
    try {
      if(!annotationMode)throw new Error('请进入独立的书论标注任务。');
      if(state.saveConflict || progressStore.hasChanged())throw new Error('人工校验资料已在其他标签页更新，请先载入本机最新进度再标注。');
      const source=annotationSource(page(),current());
      if(!source || readingText(source.text)!==app.querySelector('#editText')?.value)throw new Error('本页没有可用的人工已校验正文，请先完成原文校对。');
      const previousSource=current().theoryAnnotations?.source;
      const data={...transform(current().theoryAnnotations),source:sourceStamp(source,part)};
      if(previousSource && JSON.stringify(previousSource)!==JSON.stringify(data.source))data.events.push({action:'source-change',id:'',by:state.person,at:new Date().toISOString(),previous:previousSource,next:data.source});
      const saved=record({theoryAnnotations:data}); updateValidation(); state.error='';state.notice=saved?notice:'标注改动仍在当前页，尚未保存。请重试保存或导出备份。';updateHighlight();showMessage();
    } catch(error) {state.error=error.message;state.notice='';showMessage();}
  }

  function markSelection() {
    const editor=app.querySelector('#editText'),selection=state.selectionMenu;
    const start=selection.open?selection.start:editor.selectionStart,end=selection.open?selection.end:editor.selectionEnd;
    if(selection.open && editor.value.slice(start,end)!==selection.text) {state.error='正文已变化，请重新选择书论范围。';showMessage();closeSelectionMenu();return;}
    const text=String(draft().text||'');
    changeAnnotations(data=>addAnnotation(data,text,...sourceSelection(text,start,end),state.person),'已标为书论，黄色底纹已保存在本机进度中。');
    closeSelectionMenu(); editor.focus({preventScroll:true});editor.setSelectionRange(end,end);
  }

  function deleteSelectedAnnotation() {
    const editor=app.querySelector('#editText'),selection=state.selectionMenu,text=String(draft().text||'');
    const start=selection.open?selection.start:editor.selectionStart,end=selection.open?selection.end:editor.selectionEnd;
    if(selection.open&&(selection.page!==page().page||selection.sourceText!==text||editor.value.slice(start,end)!==selection.text)) {
      state.error='正文或页面已变化，请重新选择标注范围。';showMessage();closeSelectionMenu();return;
    }
    changeAnnotations(data=>deleteDefaultAnnotation(page(),data,annotationSource(page(),current()),...sourceSelection(text,start,end),state.person),'已删除选中范围的标注，原文保持原样；通读后确认本页即可。');
    closeSelectionMenu();editor.focus({preventScroll:true});editor.setSelectionRange(start,end);
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
      const marked=annotationMode ? annotationView(state.reviews[item.page]?.theoryAnnotations,annotationSource(item,state.reviews[item.page])?.text||'').completed : humanMarked(item,state.reviews[item.page]);
      button.hidden=state.pageFilter==='marked'?!marked:state.pageFilter==='unmarked'?marked:false;
    }
    const empty=app.querySelector('#pageFilterEmpty');if(empty)empty.hidden=Boolean(app.querySelector('#pageList [data-index]:not([hidden])'));
    for(const button of app.querySelectorAll('[data-page-filter]'))button.setAttribute('aria-pressed',String(button.dataset.pageFilter===state.pageFilter));
  }

  function updateValidation() {
    if(annotationMode) {
      const overall=unifiedMode?unifiedContext():null;
      const progress=app.querySelector('#progress');if(progress)progress.textContent=`标注已确认 ${overall?overall.completed:verifiedCount()} / ${overall?overall.total:state.data.pages.length} 页`;
      const view=annotationView(current().theoryAnnotations,String(draft().text||''));
      const complete=app.querySelector('#verifyNext');if(complete)complete.textContent=view.completed?'已确认 · 下一页 →':'确认本页并继续 →';
      for(const row of app.querySelectorAll('[data-index]')) {const item=state.data.pages[Number(row.dataset.index)],done=annotationView(state.reviews[item.page]?.theoryAnnotations,annotationSource(item,state.reviews[item.page])?.text||'').completed;row.querySelector('small').textContent=rowLabel(item,state.reviews[item.page]);row.classList.toggle('done',done);}
      applyPageFilter();return;
    }
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
      lastPage: annotationMode ? state.lastPage : page().page, ...(state.annotationLastPage || annotationMode ? {annotationLastPage:annotationMode?page().page:state.annotationLastPage} : {}), ...(state.annotationSavedAt?{annotationSavedAt:state.annotationSavedAt}:{}), savedAt: state.savedAt };
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
    const result = progressStore.save({ ...payload(), savedAt, ...(annotationMode?{annotationSavedAt:savedAt}:{}) });
    state.saveConflict = Boolean(result.conflict);
    state.saveProblem = result.ok ? '' : result.conflict
      ? '其他标签页已更新进度，或旧记录无法读取。当前修改仍在本页，尚未保存。请先导出备份，再载入本机最新进度。'
      : '本机保存失败，当前修改仍在本页。请重试保存或导出进度备份，暂勿关闭页面。';
    if (result.ok) { state.savedAt = savedAt; if(annotationMode){state.annotationLastPage=page().page;state.annotationSavedAt=savedAt;}else state.lastPage = page().page; }
    if (composingInput?.id !== 'editText') updateSaveStatus();
    return result.ok;
  }

  function restore() {
    try {
      const saved = progressStore.read();
      state.reviews = saved?.reviews || {};
      state.person = String(saved?.person || '');
      state.lastPage = saved?.lastPage;
      state.annotationLastPage = saved?.annotationLastPage;state.annotationSavedAt=String(saved?.annotationSavedAt||'');
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

  function renderNoAnnotationSource() {
    window.WorkspaceUI.mount('annotation');
    app.innerHTML=`<main class="page proof-workspace"><div class="heading"><h1>书论标注</h1></div><section class="panel annotation-empty"><h2>当前页段暂无可标注资料</h2><p>书论标注只使用已完成人工校验、且没有待核项的正文。请先完成原文校对；旧草稿和已有标注继续保留。</p><p><a class="download" href="./screening.html?part=${part}${assignment?`&member=${assignment.id}`:''}">进入原文校对 →</a> <a href="./annotation-tasks.html">返回标注任务</a></p></section></main>`;
  }

  function configureTask() {
    document.title=`${taskName} · 书论工作区`;
    app.querySelector('.heading .eyebrow').prepend(`${taskName} / `);
    if(!annotationMode) {
      app.querySelector('#annotationDrawer')?.remove();
      app.querySelector('#selectionMarkTheory')?.remove();
      app.querySelector('.theory-toolbar').innerHTML='<small id="theoryStatus"></small><a class="annotation-task-link" href="./review-metrics.html">量化检测 →</a><a class="annotation-task-link" href="./annotation-tasks.html">任务二 · 书论标注 →</a>';
      app.querySelectorAll('[data-annotation-page]').forEach(e=>e.remove());
      app.querySelector('#verifyNext').textContent=humanMarked(page(),current())?'已标过 · 继续下一页':'校验本页并继续 →';
      mountSourceRisks();
      return;
    }
    const source=annotationSource(page(),current()),editor=app.querySelector('#editText');
    editor.value=readingText(source.text);editor.readOnly=true;editor.setAttribute('aria-label',`第 ${page().page} 页人工已校验正文（无序号只读标注）`);
    app.querySelector('.source-version-bar').innerHTML=`<span>${esc(source.label)} · ${esc(source.verifiedBy)}${source.verifiedAt?` · ${esc(source.verifiedAt)}`:''}</span><strong>审核版本对应 · 只读</strong>`;
    app.querySelector('.person-field').childNodes[0].textContent='标注人';
    app.querySelector('#openTextEditor')?.remove();app.querySelector('#reviewDrawer')?.remove();app.querySelector('#validation')?.remove();
    app.querySelector('.proof-confirmation .checklist').innerHTML='<span class="hint">默认保留AI标注；标错处选中文字，右键删除标注，通读后确认本页。</span>';
    app.querySelector('#annotationHelp').textContent='AI标注默认保留，无需逐条采纳。标错处选中文字，右键“删除标注”；漏标处选中后“标为书论”。正文只读，最后确认本页即可。';
    if(!app.querySelector('#deleteSelectedAnnotation'))app.querySelector('#markTheory').insertAdjacentHTML('afterend','<button type="button" id="deleteSelectedAnnotation">删除选区标注</button>');
    if(!app.querySelector('#selectionDeleteAnnotation'))app.querySelector('#selectionMarkTheory').insertAdjacentHTML('afterend','<button type="button" id="selectionDeleteAnnotation">删除标注</button>');
    app.querySelector('#validate')?.remove();
    const proofLink=document.createElement('a');proofLink.className='annotation-task-link';proofLink.href=`./screening.html?part=${part}${assignment?`&member=${assignment.id}`:''}&page=${page().page}`;proofLink.textContent='返回原文校对';app.querySelector('.drawer-actions').prepend(proofLink);
    app.querySelector('.page-filters').setAttribute('aria-label','书论标注状态筛选');
    for(const b of app.querySelectorAll('[data-page-filter]'))b.textContent={all:'全部',unmarked:'未确认',marked:'已确认'}[b.dataset.pageFilter];
    for(const row of app.querySelectorAll('[data-index]')){const item=state.data.pages[Number(row.dataset.index)];row.querySelector('small').textContent=rowLabel(item,state.reviews[item.page]);row.querySelector('[data-annotation-page]')?.remove();}
    const exportButton=app.querySelector('#exportBundle');exportButton.textContent='导出标注ZIP';
    const extra=app.querySelector('.extra-tools>.tools');extra.innerHTML='<p class="hint">本任务只读人工已校验正文。完整原分份备份保留两项任务及旧草稿；恢复入口统一放在成果交付。</p><a class="download" href="./delivery.html?task=annotation&mode=restore">恢复进度JSON</a>';
    for(const a of app.querySelectorAll('.assignment-switch')){const url=new URL(a.href);a.href=annotationHref(assignment.id,Number(url.searchParams.get('part')),url.searchParams.get('page'));}
    app.querySelector('#selectionMenu label')?.remove();app.querySelector('#selectionReplacement')?.remove();app.querySelector('#applySelectionReplace')?.remove();app.querySelector('#selectionDelete')?.remove();
    const top=document.querySelector('.topbar');if(top)top.innerHTML='<a href="./annotation-tasks.html">← 书论标注任务</a><span>任务二 · 仅使用人工已校验资料</span>';
    if(unifiedMode) {
      const overall=unifiedContext(),position=overall.pages.findIndex(p=>p.page===page().page);
      const breadcrumb=app.querySelector('.heading .eyebrow');
      breadcrumb.textContent='书论标注 / 全部人工审核合格材料';
      if(state.annotationChapter){const c=state.annotationChapter;breadcrumb.innerHTML=`<a href="${chapterHref(c.id)}">← ${esc(c.workTitle)} · ${esc(c.title)} · 按章阅读</a>`;breadcrumb.title=c.author+' · '+c.workTitle+' · '+c.title;app.querySelector('.proof-confirmation .checklist .hint').textContent='本章来源页；此处显示完整原页，整页确认含该页全部章节。标错处选中文字右键删除标注。';}
      app.querySelector('#prev').disabled=position<=0;app.querySelector('#next').disabled=position>=overall.pages.length-1;
      const options=[1,2,3,4].map(n=>{const pages=overall.pages.filter(p=>p.part===n);return pages.length?`<option value="${n}" ${n===part?'selected':''}>第 ${pages[0].page}–${pages.at(-1).page} 页（${pages.length}页）</option>`:'';}).join('');
      app.querySelector('.setup>.tools').insertAdjacentHTML('afterbegin',`<label class="annotation-material-switch">查看材料 <select id="annotationMaterial">${options}</select></label>`);
      exportButton.textContent='导出全部标注ZIP';
      extra.innerHTML='<p class="hint">一个任务覆盖全部合格材料；导出统一ZIP，原四份完整进度与历史分别保留。</p><button type="button" data-export-all>导出全部标注ZIP</button><a class="download" href="./delivery.html?task=annotation&scope=all&mode=restore">恢复进度JSON</a>';
    }
  }

  function mountSourceRisks() {
    if(annotationMode||!state.data||!app.querySelector('#validation'))return;
    app.querySelector('#sourceRiskPanel')?.remove();
    const human=page().humanReviewed;
    if(!human||human.eligible)return;
    const panel=document.createElement('section');panel.id='sourceRiskPanel';panel.className='published-revision';
    panel.innerHTML=`<strong>本页有来源待核，暂不能进入书论标注</strong><ul>${human.blockedReasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><label class="check"><input id="sourceRiskResolved" type="checkbox">我已对照原图逐项解决以上问题，并确认当前正文</label><button id="approveAnnotationSource" type="button" disabled>重新校验并开放本页标注</button><p class="hint">此操作只记录你对当前版本的明确确认；原备注和旧稿保留。</p>`;
    app.querySelector('#validation').before(panel);
  }

  function render() {
    tabletProofInput?.destroy();
    const p = page();
    const review = current();
    window.WorkspaceUI.mount(annotationMode?'annotation':'proof');
    app.innerHTML = `<main class="page proof-workspace">
      <div class="heading"><div><h1>《历代书法论文选》</h1><span class="eyebrow">${assignment ? `成员 ${assignment.id} · ${esc(assignment.name)}` : `原第${part}份完整视图`} / ${state.data.pages[0].page}–${state.data.pages.at(-1).page} 页</span></div><span class="progress" id="progress">已标过 ${verifiedCount()} / ${state.data.pages.length} 页</span></div>
      <section class="setup"><label class="person-field">校勘人<input id="person" maxlength="80" value="${esc(state.person)}" placeholder="填写真实姓名" /></label><p><span id="saveStatus" role="status"></span><br>完成后导出交回负责人。</p>
        <div class="tools">${assignment ? assignment.segments.filter(s=>s.part!==part).map(s=>`<a class="assignment-switch download" href="${assignmentHref(assignment.id,s.part)}">另一段 ${s.start}–${s.end} →</a>`).join('') : ''}<button type="button" id="exportBundle" class="primary" ${exporting ? 'disabled' : ''}>${exporting ? '正在打包…' : annotationMode ? '导出标注ZIP' : assignment ? '导出我的任务' : '导出本份材料'}</button><details class="extra-tools"><summary>材料与恢复</summary><div class="tools"><p class="hint">${annotationMode ? '标注仅导出当前段合格正文；JSON保留原分份完整记录。' : assignment ? '一次导出本人负责的全部页段；正文、表格和JSON仅含本人任务，跨段也只需一个ZIP。' : '一次下载ZIP，正文、校验表、修改率和进度备份都在里面。整包交回即可。'}</p><a class="download" href="./screening-data/part-${part}-work.txt" download>下载本份工作TXT</a>${teamRelease.parts[part] ? `<a class="download" href="./screening-data/part-${part}-collated.txt" download>原第${part}份已修订 TXT</a><a class="download" href="./screening-data/part-${part}-collated-status.csv" download>原第${part}份修改状态表</a>` : ''}${targetedRelease.parts[part] ? `<a class="download" href="./screening-data/part-${part}-targeted.txt" download>原第${part}份局部修订TXT</a><a class="download" href="./screening-data/part-${part}-targeted-status.csv" download>原第${part}份局部状态表</a>` : ''}<a class="download" href="${taskOcrHref(part)}" download>${assignment ? `下载原第${part}份完整OCR` : '下载原始 OCR（历史）'}</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-conservative.txt" download>下载历史模型保守稿（未核）</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-normalized.txt" download>下载历史模型语义稿（未核）</a><a class="download" href="./tasks/2026-10-11-ocr-cleaning/full-book-comparison.md" target="_blank" rel="noopener">查看两版比对报告</a>
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
        <aside class="review-controls review-drawer annotation-drawer" id="annotationDrawer" ${state.annotationOpen?'':'hidden'} aria-hidden="${!state.annotationOpen}" aria-label="书论标注"><div class="drawer-head"><strong>第 ${p.page} 页 · 书论标注</strong><button type="button" id="closeAnnotations">关闭</button></div><div class="drawer-body"><p id="annotationHelp" class="hint">在全文中拖选文字，点“标为书论”；跨页的书论请分页面标注。黄色底纹表示人工选定的书论范围，本任务正文只读；发现错字请返回原文校对，重新人工确认后再标注。</p><p class="hint">调整范围时，请先关闭列表，在全文重新选择文字，再打开列表点击“用当前选区重新定位”。书论标注与全文校对分别记账。</p><div id="annotationList"></div><button type="button" id="completeAnnotations" class="primary">确认本页标注完成</button><details id="removedAnnotations"><summary>已撤销标注</summary><div id="annotationHistory"></div></details></div></aside><aside class="review-controls review-drawer" id="reviewDrawer" ${state.reviewOpen?'':'hidden'} aria-hidden="${!state.reviewOpen}" aria-label="备注与历史"><div class="drawer-head"><strong>第 ${p.page} 页 · 备注与历史</strong><button type="button" id="closeReviewDrawer" class="drawer-close">关闭</button></div><div class="drawer-body"><div id="drawerMessage" aria-live="polite"></div><label>备注（选填）<textarea id="question" rows="3" placeholder="记录看不清的字或后续需要查证的内容">${esc(review.question||'')}</textarea></label>${publishedMarkup(p)}<details class="ocr"><summary>原始 OCR（保留原样）</summary><pre>${esc(p.ocr||'本页没有可用OCR')}</pre></details><details><summary>个人替换历史</summary><div id="changeLog">${editHistoryMarkup(draft().edits||[])}</div></details><details><summary>旧初筛记录与候选</summary><pre>${esc(JSON.stringify({seen:review.seen,candidates:review.candidates||[],redoOcr:review.redoOcr},null,2))}</pre></details><details><summary>正文辅助工具</summary><p class="hint">${esc(layoutNote())}</p><div class="editor-tools"><button id="makeDraft">重新生成草稿</button><button id="renumber">重新编号</button><button id="lineUp">本栏上移</button><button id="lineDown">本栏下移</button></div></details></div></aside>
      </div><div class="validation" id="validation" aria-live="polite"></div><div class="drawer-footer proof-confirmation"><div class="checklist">${Object.entries(CHECKS).map(([key])=>`<label class="check"><input type="checkbox" data-check="${key}" ${humanMarked(p,review)||draft().checks?.wording?'checked':''}/>已对照原图逐栏检查本页全文</label>`).join('')}</div><div class="form-actions drawer-actions"><button id="validate">文本提醒</button><button id="verifyNext" class="primary">标记本页并继续 →</button></div></div></section></div>
      <div id="selectionMenu" class="selection-menu" role="dialog" aria-label="选中文字操作" hidden><div class="selection-menu-title"><strong>选中文字</strong><span data-selection-count></span></div><div class="selection-preview">“<span data-selection-text></span>”</div><label for="selectionReplacement">改为<input id="selectionReplacement" type="text" autocomplete="off" spellcheck="false"/></label><div class="selection-menu-actions"><button type="button" id="selectionMarkTheory">标为书论</button><button type="button" id="applySelectionReplace" class="primary">替换</button><button type="button" id="selectionDelete">删除选中</button><button type="button" id="closeSelectionMenu">取消</button></div></div></main>`;
    configureTask();
    if (!annotationMode) tabletProofInput=mountTabletProofInput({app,editor:app.querySelector('#editText'),getText:()=>String(draft().text||''),
      replace:(start,end,value)=>{const edit=commitTextReplacement(start,end,value);state.notice=`已记录${editSummary(edit)}，可在“备注与历史”中恢复原字。`;showMessage();},
      notice:message=>{state.notice=message;showMessage();}});
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
    const text = readingText(String(draft().text || ''));
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
  let exportMaterials = {},exportChapterIndex=null;
  const runBundleExport = createBundleExporter({
    capture: () => unifiedMode?{person:state.person,exportedAt:new Date().toISOString(),unsaved:Boolean(state.saveProblem),saveConflict:state.saveConflict,progressByPart:Object.fromEntries([1,2,3,4].map(n=>[n,n===part?payload():readProgress(localStorage,n).value]))}:!annotationMode && assignment ? captureMemberTask({ storage:localStorage, member:assignment.id,
      currentProgress:payload(), unsaved:Boolean(state.saveProblem), saveConflict:state.saveConflict })
      : { progress:payload(), unsaved:Boolean(state.saveProblem), saveConflict:state.saveConflict, exportedAt:new Date().toISOString(), ...(assignment ? {member:assignment.id}: {}) },
    loadMaterials: async snapshot => {
      exportMaterials = {};
      if(unifiedMode)exportChapterIndex=await loadChapterIndex();
      await materialLoader.ensureAll();
      if(annotationMode)await loadReviewedPart(state.data.allPages,part);
      exportMaterials[part] = state.data.allPages;
      if(unifiedMode)for(const n of [1,2,3,4]) {
        if(n===part)continue;
        const data=await readJson(`./screening-data/part-${n}-index.json?v=member5-mark45-20261023`);
        await createMaterialLoader(data).ensureAll();await loadReviewedPart(data.pages,n);exportMaterials[n]=data.pages;
      }
      if (!annotationMode && assignment) for (const entry of snapshot.snapshots) {
        const otherPart = entry.progress.part;
        if (otherPart === part) continue;
        const data = await readJson(`./screening-data/part-${otherPart}-index.json?v=member5-mark45-20261023`);
        if (data.part!==otherPart || !Array.isArray(data.pages) || data.pages.length!==data.end-data.start+1 || !data.materials)
          throw new Error(`原第${otherPart}份索引不完整`);
        await createMaterialLoader(data).ensureAll();
        exportMaterials[otherPart] = data.pages;
      }
    },
    build: snapshot => unifiedMode?buildUnifiedAnnotationBundle({...snapshot,pagesByPart:exportMaterials,chapterIndex:exportChapterIndex}):annotationMode ? buildAnnotationBundle({...snapshot,pages:state.data.allPages}) : assignment ? buildMemberTaskBundle({ ...snapshot, pagesByPart:exportMaterials })
      : buildCollationBundle({ ...snapshot, pages:state.data.allPages }),
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
      state.notice = `已发起${taskName}ZIP下载，${!annotationMode && assignment ? '本人任务成果和范围内进度备份' : '当前任务成果和完整进度备份'}已打包，请整包交回。包内为点击时的进度，后续改动请再次导出。${bundle.manifest.unsaved ? '本包包含尚未保存的修改，请保留备份。' : ''}`;
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
    if (state.selectionMenu.open && !event.target.closest('#selectionMenu') && !event.target.closest('#editText') && !event.target.closest('#markTheory') && !event.target.closest('#deleteSelectedAnnotation')) closeSelectionMenu();
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'markTheory' || button.id === 'selectionMarkTheory') { markSelection(); return; }
    if(annotationMode&&(button.id==='selectionDeleteAnnotation'||button.id==='deleteSelectedAnnotation')){deleteSelectedAnnotation();return;}
    if (button.id === 'openAnnotations') { state.annotationOpen=true; state.reviewOpen=false; syncReviewDrawer(); syncAnnotationDrawer(); app.querySelector('#closeAnnotations')?.focus({preventScroll:true}); return; }
    if (button.id === 'closeAnnotations') { state.annotationOpen=false; syncAnnotationDrawer(); app.querySelector('#openAnnotations')?.focus({preventScroll:true}); return; }
    if (button.id === 'completeAnnotations') { changeAnnotations(data=>confirmDefaultAnnotations(page(),data,annotationSource(page(),current()),state.person),'本页书论标注已确认。'); return; }
    const candidateId=button.dataset.locateCandidate;
    if(annotationMode&&candidateId) {
      const source=annotationSource(page(),current()),candidate=candidateView(page(),current(),source).all.find(c=>c.id===candidateId);
      if(!candidate){state.error='初标来源已变化，请重新载入。';showMessage();return;}
      if(button.dataset.locateCandidate) {
        const e=app.querySelector('#editText'),start=visibleOffset(source.text,candidate.start),end=visibleOffset(source.text,candidate.end);state.annotationOpen=false;syncAnnotationDrawer();e.focus({preventScroll:true});e.setSelectionRange(start,end);scrollToTextRange(e,start);return;
      }
    }
    if (button.dataset.removeAnnotation) { changeAnnotations(data=>removeAnnotation(data,String(draft().text||''),button.dataset.removeAnnotation,state.person),'标注已撤销，可在列表底部恢复。'); return; }
    if (button.dataset.restoreAnnotation) { changeAnnotations(data=>restoreAnnotation(data,String(draft().text||''),button.dataset.restoreAnnotation,state.person),'标注已恢复；如正文已变化，请重新定位。'); return; }
    if (button.dataset.relocateAnnotation) { const e=app.querySelector('#editText'),text=String(draft().text||''); changeAnnotations(data=>relocateAnnotation(data,text,button.dataset.relocateAnnotation,...sourceSelection(text,e.selectionStart,e.selectionEnd),state.person),'已按当前选区重新定位。'); return; }
    if (button.dataset.locateAnnotation) { const text=String(draft().text||''),a=annotationView(current().theoryAnnotations,text).ranges.find(a=>a.id===button.dataset.locateAnnotation); if(a) { const e=app.querySelector('#editText'),start=visibleOffset(text,a.start),end=visibleOffset(text,a.end); state.annotationOpen=false; syncAnnotationDrawer(); e.focus({preventScroll:true}); e.setSelectionRange(start,end); scrollToTextRange(e,start); } return; }
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
      if (restore()) { if(annotationMode)await init();else await select(state.index, '已载入本机最新进度。'); }
      else updateSaveStatus();
      return;
    }
    if (button.dataset.pageFilter) {state.pageFilter=button.dataset.pageFilter;applyPageFilter();return;}
    if (button.dataset.index !== undefined) return select(Number(button.dataset.index));
    if (button.id === 'prev'||button.id==='next') {
      const delta=button.id==='prev'?-1:1;
      if(unifiedMode){const context=unifiedContext(),i=context.pages.findIndex(p=>p.page===page().page);return openUnifiedPage(context.pages[i+delta]);}
      return select(state.index+delta);
    }
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
    if (button.id === 'verifyNext' && annotationMode) {
      if(!annotationView(current().theoryAnnotations,String(draft().text||'')).completed) {
        changeAnnotations(data=>confirmDefaultAnnotations(page(),data,annotationSource(page(),current()),state.person),'本页书论标注已确认。');
        if(state.error||state.saveProblem)return;
      }
      if(unifiedMode) {
        const context=unifiedContext(),i=context.pages.findIndex(p=>p.page===page().page),target=context.pages.find((p,j)=>j>i&&!p.completed)||context.pages.find(p=>!p.completed);
        if(target)return openUnifiedPage(target);
        state.notice='全部合格材料已确认，可导出全部标注成果。';showMessage();updateValidation();return;
      }
      const next=state.data.pages.findIndex((item,i)=>i>state.index&&!annotationView(state.reviews[item.page]?.theoryAnnotations,annotationSource(item,state.reviews[item.page])?.text||'').completed);
      const earlier=state.data.pages.findIndex(item=>!annotationView(state.reviews[item.page]?.theoryAnnotations,annotationSource(item,state.reviews[item.page])?.text||'').completed);
      if(next>=0||earlier>=0)await select(next>=0?next:earlier,'已确认上一页书论标注。');
      else {state.notice='当前人工已校验资料的标注均已确认，可导出标注成果。';showMessage();updateValidation();}
      return;
    }
    if (button.id === 'verifyNext'||button.id==='approveAnnotationSource') {
      if (humanMarked(page(),current())&&button.id!=='approveAnnotationSource') {
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
      const human=page().humanReviewed,clearance=state.sourceRiskApproval;
      if(button.id==='approveAnnotationSource'&&(!human||human.eligible||!clearance||clearance.page!==page().page||clearance.text!==draft().text||!app.querySelector('#sourceRiskResolved')?.checked))problems.push('请逐项解决来源待核并重新勾选；正文变化后需再次核对。');
      if (problems.length) { state.error = problems.join(' '); showMessage();
        app.querySelector(!state.person.trim() ? '#person' : validation.errors.length ? '#editText' : !draft().checks?.wording ? '[data-check]:not(:checked)' : '#question')?.focus(); return; }
      const verifiedAt=new Date().toISOString(),by=state.person.trim();
      const sourceApproval=button.id==='approveAnnotationSource'?{version:1,text:draft().text,by,at:verifiedAt,blockedSourceRevision:human.source.revision,blockedReasons:JSON.stringify(human.blockedReasons)}:null;
      const saved = record({ seen: true, collation: { ...draft(), verified: true, fullTextChecked: true, workflow: page().modelReviewed ? 'machine-model-human-fulltext-v1' : 'human-fulltext-v1', ...(page().modelReviewed ? { modelRevision: page().modelReviewed.revision } : {}), verifiedBy: by, verifiedAt,...(sourceApproval?{annotationSourceApproval:sourceApproval}:{}) } });
      updateValidation();
      if (!saved) return;
      if(sourceApproval){state.notice='当前正文已重新人工校验，可从书论标注任务进入；原稿和备注保留。';showMessage();return;}
      const completed = page().page;
      const next = nextUnmarkedIndex(state.data.pages, state.reviews, state.index);
      if (next >= 0) select(next, `第 ${completed} 页已标过并保存；已转到第 ${state.data.pages[next].page} 页继续。`);
      else { state.notice = assignment ? '当前分工段已全部标过，可导出我的任务；跨段文件会一并打包。' : '本份已全部标过，请一键导出全部并将ZIP交回负责人。'; render(); }
      return;
    }
    if (button.id === 'markSeen' && (state.imageReady || current().seen)) { record({ seen: !current().seen }); render(); return; }
    if (button.dataset.remove !== undefined) {
      const candidates = [...(current().candidates || [])]; candidates.splice(Number(button.dataset.remove), 1);
      record({ candidates }); render(); return;
    }

  });

  app.addEventListener('contextmenu', openSelectionMenu);

  app.addEventListener('pointerdown', (event) => {
    if (event.target.id === 'editText') editorPointerType = event.pointerType;
  });

  app.addEventListener('compositionstart', (event) => {
    composingInput = event.target;
    if (event.target.id === 'editText' && state.selectionMenu.open) closeSelectionMenu();
  });

  app.addEventListener('compositionend', (event) => {
    composingInput = null;
    if (annotationMode || !state.data || event.target.id !== 'editText') return;
    if (event.target.value !== draft().text) updateDraft({ text: event.target.value }, { fromEditor: true });
    else refreshDraftUI();
  });

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
    if (event.target.id === 'person') { state.person = event.target.value;if(unifiedMode)try{localStorage.setItem('shulun-annotation-person-v1',state.person);}catch{} persist(); }
    if (event.target.id === 'editText') {
      if(annotationMode)return;
      if (event.isComposing) composingInput = event.target;
      updateDraft({ text: event.target.value }, { fromEditor: true });
    }
    if (event.target.dataset.check) updateDraft({
      checks: { ...draft().checks, [event.target.dataset.check]: event.target.checked, fulltext: event.target.checked },
      ...(typeof current().collation?.text !== 'string' ? { metricBaseline: { version:1, text:String(draft().text || ''), label:sourceLabel() } } : {}),
    });
    if (!annotationMode && event.target.id === 'question') record({ question: event.target.value });
    if (!annotationMode && event.target.id === 'redoOcr') record({ redoOcr: event.target.checked });
  });

  app.addEventListener('scroll', (event) => {
    if (event.target.id === 'editText') syncHighlight();
  }, true);

  function jumpTo(value) {
    const target = Number(value);
    if(unifiedMode) {
      const destination=unifiedContext().pages.find(p=>p.page===target);
      if(destination)openUnifiedPage(destination);
      else {state.error=`第 ${value} 页暂无可标注的人工审核正文；来源待核页不进入本任务。`;showMessage();}
      return;
    }
    if (Number.isInteger(target) && target >= state.data.start && target <= state.data.end) {
      const index = state.data.pages.findIndex(item => item.page === target);
      if (index >= 0) select(index);
      else { state.error = excludedPages[target] ? `第 ${target} 页为${excludedPages[target]}，已移出本轮任务。` : annotationMode ? `第 ${target} 页无可用的人工已校验正文，或不在当前分工范围。请先在原文校对任务完成校验。` : `第 ${target} 页不在当前成员的本段分工中，请从团队任务进入对应页段。`; showMessage(); }
    }
    else { state.error = `请输入 ${state.data.start}–${state.data.end} 之间的原 PDF 页码。`; showMessage(); }
  }

  app.addEventListener('keydown', (event) => {
    if (!state.data || !app.querySelector('#pageList')) return;
    if (event.isComposing || event.keyCode === 229 || composingInput === event.target) return;
    if (annotationMode && (event.metaKey||event.ctrlKey) && event.shiftKey && event.code==='KeyM' && !event.isComposing && event.target.id==='editText') { event.preventDefault(); markSelection(); return; }
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
    if(event.target.id==='annotationMaterial') {
      const destination=unifiedContext().pages.find(p=>p.part===Number(event.target.value)&&!p.completed)||unifiedContext().pages.find(p=>p.part===Number(event.target.value));
      return openUnifiedPage(destination);
    }
    if(event.target.id==='sourceRiskResolved') {
      state.sourceRiskApproval=event.target.checked?{page:page().page,text:draft().text}:null;
      const button=app.querySelector('#approveAnnotationSource');if(button)button.disabled=!event.target.checked;
      return;
    }
    if (event.target.id === 'zoom') { state.zoom = Number(event.target.value); const image = app.querySelector('#scanWrap img'); if (image) image.style.width = `${state.zoom}%`; }
    if (event.target.id === 'jump') {
      jumpTo(event.target.value);
    }
    if (event.target.id === 'scanFolder' || event.target.id === 'scanFiles') loadFiles(event.target.files || []);
    if (!annotationMode && event.target.id === 'locatorFile') {
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
        let saved = JSON.parse(await event.target.files[0].text());
        validateProgress(saved);
        if (saved.part !== part)
          throw new Error('进度备份与本份页段不匹配');
        const scoped = saved.exportScope !== undefined;
        if (scoped) {
          if (progressStore.hasChanged()) throw new Error('其他标签页已更新进度，请先保留当前备份并载入本机最新进度，再恢复本人任务。');
          saved = mergeMemberBackup(saved,payload(),assignment?.id ?? null);
        }
        if ((Object.keys(state.reviews).length || state.saveProblem) && !confirm(scoped
          ? '导入仅更新本人备份中的页记录，其他页段保留；同页以备份为准。请确认已备份当前修改，再继续。'
          : '导入会替换本份在当前浏览器的进度，包括其他标签页的更新。请确认已备份，再继续。')) return;
        const restoredIndex = initialPageIndex(state.data.pages, null, saved.lastPage ?? page().page);
        await materialLoader.ensurePage(state.data.pages[restoredIndex].page);
        if (scoped && progressStore.hasChanged()) throw new Error('恢复期间其他标签页更新了进度，原记录未改变，请重新核对备份。');
        ++selectionRequest;
        progressStore.allowBackupReplacement();
        state.reviews = saved.reviews; state.person = String(saved.person || '');
        state.lastPage=saved.lastPage;state.annotationLastPage=saved.annotationLastPage;state.annotationSavedAt=String(saved.annotationSavedAt||'');
        if(annotationMode){await init();return;}
        state.index = restoredIndex;
        syncUrl(); persist();
        state.error = '';
        state.notice = state.saveProblem ? '' : '进度备份已导入，可继续逐页校勘。'; render();
      } catch (error) { state.error = error.message || '进度备份读取失败'; showMessage(); }
    }
  });

  app.addEventListener('submit', (event) => {
    if (annotationMode || event.target.id !== 'candidateForm') return;
    event.preventDefault();
    if (!current().seen) { state.error = '请先查看并标记本页扫描图，再添加候选。'; showMessage(); return; }
    const fields = new FormData(event.target);
    const candidate = Object.fromEntries(['author', 'style', 'quote', 'basis', 'uncertainty'].map((field) => [field, String(fields.get(field) || '').trim()]));
    if (!candidate.quote || !candidate.basis) return;
    record({ candidates: [...(current().candidates || []), candidate], candidateDraft: {} }); render();
  });

  async function init() {
    window.WorkspaceUI.mount(annotationMode?'annotation':'proof');
    if (![1, 2, 3, 4].includes(part)) { app.innerHTML = '<p class="loading">请从团队任务选择成员1–7的分工入口；原文材料仍按原四份定位。</p>'; return; }
    try {
      assignment = assignmentFor(member);
      segment = assignmentSegment(member, part);
      app.innerHTML = '<p class="loading" role="status">正在读取页码索引…</p>';
      state.data = await readJson(`./screening-data/part-${part}-index.json?v=member5-mark45-20261023`);
      if (state.data.part !== part || state.data.pages.length !== state.data.end - state.data.start + 1 || !state.data.materials) throw new Error('页码索引不完整');
      materialLoader = createMaterialLoader(state.data);
      state.data.allPages = state.data.pages;
      state.data.pages = assignmentPages(state.data.allPages, member, part);
      if (!state.data.pages.length) throw new Error('当前分工段没有可校勘页面');
      restore();
      if(unifiedMode)try{state.person=localStorage.getItem('shulun-annotation-person-v1')||state.person;}catch{}
      if(annotationMode) {
        app.innerHTML='<p class="loading" role="status">正在核对人工校验资料来源…</p>';
        await materialLoader.ensureAll();
        await loadReviewedPart(state.data.allPages,part);
        if(unifiedMode) {
          state.annotationIndexes=Object.fromEntries(await Promise.all([1,2,3,4].map(async n=>[n,n===part?{pages:state.data.allPages}:await readJson(`./screening-data/part-${n}-index.json?v=member5-mark45-20261023`)])));
          await loadReviewedIndex(state.annotationIndexes,{storage:localStorage});
          state.chapterIndex=await loadChapterIndex();
          if(chapterId){state.annotationChapter=state.chapterIndex.chapters.find(c=>c.id===chapterId);if(!state.annotationChapter)throw new Error('未找到这一章节，请返回统一入口选择');}
        }
        state.data.pages=state.data.pages.filter(item=>annotationSource(item,state.reviews[item.page])&&(!state.annotationChapter||state.annotationChapter.fragments.some(f=>f.page===item.page)));
        if(!state.data.pages.length) {renderNoAnnotationSource();return;}
      }
      const requested = new URLSearchParams(location.search).get('page');
      const rememberedPage=annotationMode?state.annotationLastPage:state.lastPage;
      const targetPage = Number(requested ?? rememberedPage);
      state.index = initialPageIndex(state.data.pages, requested, rememberedPage);
      if (requested === null && rememberedPage) state.notice = `已回到上次工作位置：第 ${page().page} 页。`;
      if (Number.isInteger(targetPage) && targetPage >= state.data.start && targetPage <= state.data.end) {
        const index = state.data.pages.findIndex(item => item.page >= targetPage);
        state.index = index < 0 ? state.data.pages.length - 1 : index;
        if (!isTaskPage(targetPage)) state.notice = `第 ${targetPage} 页为${excludedPages[targetPage]}，已移出任务，已转到第 ${page().page} 页。`;
      }
      app.innerHTML = `<p class="loading" role="status">页码索引已就绪，正在读取第 ${page().page} 页材料…</p>`;
      await materialLoader.ensurePage(page().page);
      if(annotationMode && requested!==null && Number(requested)!==page().page)state.notice=`第 ${requested} 页尚无可用于标注的人工已校验正文，已转到合格的第 ${page().page} 页。`;
      syncUrl();
      render();
      if(unifiedMode&&!state.saveProblem)persist();
      if(!annotationMode)loadReviewedPart(state.data.allPages,part).then(()=>mountSourceRisks()).catch(()=>{});
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

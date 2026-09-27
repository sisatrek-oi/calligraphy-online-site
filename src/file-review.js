/* Standalone, network-free reviewer and coordinator UI. */
(function () {
  'use strict';
  const C = window.ShulunFileReview, Store = window.ShulunReviewStore;
  const app = document.getElementById('review-app');
  let records = [], current = null, setup = null, selected = 0, timer, noticeTimer;
  let dirty = false, saving = null, saveError = '', busy = false, draftCounter = 0, prepared = null;
  let urls = [], exports = [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const filename = s => String(s).replace(/[^\w\u4e00-\u9fff-]/g, '-').slice(0, 70);
  function toast(message) { const n = document.getElementById('notice'); n.textContent = message; n.className = 'show'; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => n.className = '', 6500); }
  function link(name, data, label, type = 'application/json') {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type })); urls.push(url);
    const index = exports.push({ name, content, url }) - 1;
    return `<span class="file-actions"><a class="button" href="${url}" download="${esc(name)}">${esc(label)}</a><button class="copy-file" data-preview="${index}" aria-label="查看文件内容：${esc(name)}">复制内容</button></span>`;
  }
  function releaseUrls() { const old = urls; urls = []; setTimeout(() => old.forEach(u => URL.revokeObjectURL(u)), 30000); }
  function status() {
    document.querySelectorAll('[data-save-state]').forEach(n => { n.textContent = setup ? '材料尚未保存，请创建批次' : saveError || (dirty || saving ? '正在保存草稿…' : '草稿已保存在此浏览器'); n.classList.toggle('error', Boolean(saveError)); });
    if (saveError) document.querySelectorAll('#review-form textarea,#review-form select,#review-form button').forEach(n => n.disabled = true);
    const recovery = document.getElementById('recovery');
    if (recovery) { recovery.replaceChildren(); if (saveError && current) { recovery.innerHTML = link('审核恢复文件.json', { type:'shulun-review-recovery', version:1, record:current }, '下载当前恢复文件'); } }
  }
  async function refreshRecords() { records = await Store.all(); }
  async function persist() {
    clearTimeout(timer);
    if (saving) { await saving; if (dirty) return persist(); return; }
    if (!dirty || !current) return;
    if (saveError) throw new Error(saveError);
    const generation = draftCounter, snap = C.clone(current);
    saving = Store.save(snap, current.revision || 0).then(saved => {
      current.revision = saved.revision; current.savedAt = saved.savedAt;
      if (draftCounter === generation) dirty = false;
    }).catch(e => { saveError = e.message; throw e; }).finally(() => { saving = null; status(); });
    status(); await saving;
    if (dirty) return persist();
  }
  function changed() { dirty = true; draftCounter++; prepared = null; status(); clearTimeout(timer); timer = setTimeout(() => persist().catch(e => toast(e.message)), 350); }
  async function useRecord(record) { await persist(); current = C.clone(record); dirty = false; saveError = ''; selected = 0; setup = null; prepared = null; render(); }
  async function addRecord(record) {
    await persist();
    const saved = await Store.save(record, 0); await refreshRecords(); await useRecord(saved);
  }
  function title() { return current?.batch?.material.title || current?.package?.material.title || ''; }
  function shell(content) {
    return `<div class="toolbar"><button data-home>返回任务列表</button><span data-save-state class="save-state"></span><span id="recovery"></span></div>${content}`;
  }
  function renderHome() {
    return `<div class="intro"><div class="eyebrow">SHULUN / REVIEW</div><h1>把判断留给人，把意见完整收回。</h1><p>负责人分发材料包，成员独立审核，再把结果文件发回汇总。这里不运行 OCR，也不自动上传材料。</p></div>
    <div class="cards"><section class="panel"><h2>发起与汇总</h2><p>从完整工作台导出“审核材料”，在这里建立批次。</p><label><span>导入审核材料 / 工作区 JSON / 协调备份</span><input id="coordinator-file" type="file" accept=".json,application/json"></label><p class="file-hint">已有批次：打开下面的任务，再导入成员结果。每个文件最多 50 MB。</p></section>
    <section class="panel"><h2>我是审核成员</h2><p>选择负责人发来的审核包，核对姓名和材料后开始。</p><label><span>导入审核包 / 草稿恢复文件</span><input id="reviewer-file" type="file" accept=".json,application/json"></label><p class="file-hint">无需注册账号。包内姓名是任务标识，不是经过认证的身份。</p></section></div>
    <section class="panel"><h2>本机保存的任务</h2><div class="saved-list">${records.length ? records.map((r, i) => `<button data-open="${i}">${esc(r.batch ? '汇总 · ' + r.batch.material.title : r.package.reviewer + ' · ' + r.package.material.title)}<br><small>${esc(new Date(r.savedAt).toLocaleString())}</small></button>`).join('') : '<p class="muted">导入材料后，任务会保存在这里。不同设备不会自动同步。</p>'}</div></section>`;
  }
  function renderSetup() {
    return shell(`<section class="panel narrow"><div class="eyebrow">01 / 准备审核</div><h1>${esc(setup.title)}</h1><p>${setup.rows.length} 条材料 · ${setup.fields.length} 个字段</p>
    <p class="muted">每名成员独立审核这批全部条目。需要分工时，请分别准备不同批次。</p>
    <form id="create-batch"><label><span>批次名称</span><input name="title" maxlength="200" value="${esc(setup.title)}" required></label>
    <label><span>成员姓名（每行一个）</span><textarea name="members" required>成员一\n成员二\n成员三\n成员四\n成员五</textarea></label>
    <p class="warning">${setup.rows.filter(r => !r.sourceText).length} 条尚无全文；可对照摘录审核，需要核实原文时请补页图。</p>
    <div class="attachment-line"><label><span>给哪一条附加原图？（同一原文文件的条目会一起附图）</span><select id="image-row">${setup.rows.map((r, i) => `<option value="${i}">${esc(r.id)} · ${esc(r.sourceFile || '无原文文件')}</option>`).join('')}</select></label>
    <label><span>附加页图：PNG / JPEG / WebP，单张不超过 4 MB</span><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p id="image-status" class="muted">已附图 ${setup.rows.filter(r => r.image).length} 条</p></div>
    <p class="file-hint">创建后材料冻结；更改材料需要新建批次。审核包不包含其他人的意见。</p><button class="primary" type="submit">创建批次并生成审核包</button></form></section>`);
  }
  function renderCoordinator() {
    const b = current.batch, summary = C.summarize(b), count = new Set(b.submissions.map(s => s.packageId)).size;
    return shell(`<div class="intro"><div class="eyebrow">发起与汇总</div><h1>${esc(b.material.title)}</h1><p>已收回 ${count} / ${b.assignments.length} 人 · ${summary.filter(s => s.status === '有分歧').length} 条有分歧</p><p class="muted">先保存协调备份，再将各人的审核包单独发给本人。更新意见会保留旧版本。</p></div>
    <section class="panel"><h2>分发材料</h2><div class="download-list">${b.assignments.map(a => link(filename(a.reviewer) + '-审核包.json', C.packageFor(b, a), a.reviewer + ' · 下载审核包')).join('')}</div>
    <div class="toolbar">${link(filename(b.material.title) + '-协调备份.json', b, '下载协调备份')}</div><p class="file-hint">协调备份包含全部材料和已回收意见，请自己保管。</p></section>
    <section class="panel"><h2>收回审核结果</h2><label><span>导入一个或多个成员结果文件</span><input id="results-files" type="file" accept=".json,application/json" multiple></label>
    <p class="muted">${b.assignments.map(a => { const all = b.submissions.filter(s => s.packageId === a.packageId); return esc(a.reviewer) + '：' + (all.length ? '已收回 v' + Math.max(...all.map(s => s.revision)) : '待收回'); }).join('　')}</p>
    <div class="toolbar">${count ? link(filename(b.material.title) + '-审核意见.csv', C.csv(b), '下载汇总 CSV', 'text/csv;charset=utf-8') : ''}</div></section>
    <section class="panel"><h2>逐条对照意见</h2><p class="muted">这里只汇总意见，不自动修改原主表。“一致通过”仍需负责人确认。</p>${summary.map(s => `<article class="summary-row"><div class="status-line"><h3>${esc(s.row.id)}</h3><span class="badge">${esc(s.status)}</span></div><p class="wrap">${esc(s.row.values.quote || s.row.values[b.material.fields[0].id])}</p><div class="opinions">${s.reviews.map(e => `<div class="opinion"><b>${esc(e.reviewer)} · ${C.decisions[e.decision]} · v${e.revision}</b><p>${esc(e.note || '无补充说明')}</p>${b.material.fields.filter(f => e.values[f.id] !== s.row.values[f.id]).map(f => `<p><b>${esc(f.label)}</b><br>原：${esc(s.row.values[f.id])}<br>建议：${esc(e.values[f.id])}</p>`).join('')}</div>`).join('') || '<p class="muted">尚未收到意见</p>'}</div></article>`).join('')}</section>`);
  }
  function renderReviewer() {
    const p = current.package, m = p.material, row = m.rows[selected], draft = current.entries.find(e => e.rowId === row.id);
    const entry = draft || { decision:'', note:'', values:row.values };
    const done = current.entries.filter(e => { try { C.validateEntries([e], m, false); return true; } catch { return false; } }).length;
    const source = row.sourceText || '未附原文全文；证据不足时请选择“无法判断”。';
    const quote = row.values.quote || '', hit = quote ? source.indexOf(quote) : -1;
    const sourceHtml = hit < 0 ? esc(source) : esc(source.slice(0, hit)) + '<mark id="source-hit">' + esc(quote) + '</mark>' + esc(source.slice(hit + quote.length));
    return shell(`<div class="review-heading"><div><span class="eyebrow">独立审核 · ${esc(p.reviewer)}</span><h1 title="${esc(m.title)}">${esc(m.title)}</h1></div><span class="badge">已完成 ${done} / ${m.rows.length}</span></div>
    <div class="review-item-bar"><label><span>审核条目</span><select id="row-picker" aria-label="审核条目">${m.rows.map((r, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${esc(r.id)}${current.entries.some(e => e.rowId === r.id && e.decision) ? ' · 已填写' : ''}</option>`).join('')}</select></label><span class="muted">${selected + 1} / ${m.rows.length}</span><button data-row="${selected - 1}" ${selected === 0 ? 'disabled' : ''}>上一条</button><button data-row="${selected + 1}" ${selected === m.rows.length - 1 ? 'disabled' : ''}>下一条</button></div>
    <div class="review-desk"><section class="source-pane"><div class="pane-heading"><h2>原文对照</h2>${hit >= 0 ? '<button type="button" data-locate>定位摘录</button>' : '<span class="muted">未找到完整摘录</span>'}</div><p class="source-meta">${esc(row.sourceFile || '未提供原文文件名')} · 导入文本，需核对底本</p><div class="source-scroll" tabindex="0" aria-label="原文内容">${row.image ? `<a href="${esc(row.image)}" target="_blank" rel="noopener"><img class="page-image" src="${esc(row.image)}" alt="${esc(row.id)} 原始页图"></a>` : ''}<div class="source">${sourceHtml}</div></div></section>
    <form id="review-form"><div class="pane-heading"><h2>逐项核对</h2><span class="muted">${esc(row.id)}</span></div><div class="review-fields">${m.fields.map((f, i) => `<label><span>${esc(f.label)}</span><div class="original">原：${esc(row.values[f.id] || '空')}</div><textarea data-field="${i}" rows="${f.id === 'quote' ? 3 : 2}" aria-label="${esc(f.label)}建议">${esc(entry.values[f.id])}</textarea></label>`).join('')}</div>
    <div class="review-decision"><label><span>审核判断</span><select name="decision" required><option value="">请选择</option>${Object.entries(C.decisions).map(([k, v]) => `<option value="${k}" ${entry.decision === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="review-note"><span>说明（修改／无法判断必填）</span><textarea name="note" rows="2" maxlength="10000">${esc(entry.note)}</textarea></label><button type="submit" class="primary">保存本条${selected < m.rows.length - 1 ? '并继续' : ''}</button></div></form></div>
    <div class="review-delivery"><button class="primary" data-result>生成结果文件</button><details><summary>草稿备份</summary><div>${link(filename(p.reviewer) + '-审核草稿.json', { type:'shulun-review-recovery', version:1, record:current }, '下载草稿备份')}</div></details><div id="result-download">${prepared ? link(filename(p.reviewer) + '-审核结果-v' + prepared.revision + '.json', prepared, '下载审核结果 v' + prepared.revision) : '<span class="muted">完成后下载结果，发回负责人</span>'}</div></div>`);
  }
  function render() {
    releaseUrls(); exports = [];
    document.body.classList.toggle('reviewing', Boolean(!setup && current?.package));
    app.innerHTML = setup ? renderSetup() : current ? (current.batch ? renderCoordinator() : renderReviewer()) : renderHome(); bind(); status();
    const hit = document.getElementById('source-hit'), scroller = document.querySelector('.source-scroll');
    if (hit && scroller) scroller.scrollTop = Math.max(0, hit.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60);
  }
  function capture() {
    const form = document.getElementById('review-form'); if (!form || !current?.package) return;
    const m = current.package.material, row = m.rows[selected];
    const values = Object.fromEntries(m.fields.map((f, i) => [f.id, form.querySelector(`[data-field="${i}"]`).value]));
    const e = { rowId:row.id, decision:form.elements.decision.value, note:form.elements.note.value, values };
    current.entries = [...current.entries.filter(x => x.rowId !== row.id), e]; changed();
    const result = document.getElementById('result-download'); if (result) result.replaceChildren();
  }
  async function readFile(file) { if (!file) throw new Error('未选择文件'); if (file.size > C.MAX_BYTES) throw new Error('文件超过 50 MB，请拆分批次'); return C.parse(await file.text()); }
  async function importFile(file) {
    const data = await readFile(file); await persist(); await refreshRecords();
    if (data.type === 'calligraphy-workspace') { setup = C.fromWorkspace(data); current = null; render(); return; }
    let record;
    if (data.type === 'shulun-review-package') {
      await C.validatePackage(data); record = { id:'member-' + data.packageId, package:data, entries:[], exportRevision:0 };
    } else if (data.type === 'shulun-review-coordinator') {
      await C.validateBatch(data); record = { id:'coordinator-' + data.batchId, batch:data };
    } else if (data.type === 'shulun-review-recovery') {
      if (data.version !== 1 || !data.record) throw new Error('恢复文件无效');
      const r = data.record;
      if (r.batch) { await C.validateBatch(r.batch); record = { id:'restored-' + C.id(), batch:r.batch }; }
      else {
        await C.validatePackage(r.package);
        if (!Array.isArray(r.entries) || r.entries.length > r.package.material.rows.length || new Set(r.entries.map(e => e.rowId)).size !== r.entries.length) throw new Error('草稿条目无效');
        r.entries.forEach(e => {
          const row = r.package.material.rows.find(x => x.id === e.rowId);
          if (!row || !e.values || typeof e.note !== 'string' || e.note.length > 10000 || !['', ...Object.keys(C.decisions)].includes(e.decision)) throw new Error('草稿字段无效');
          r.package.material.fields.forEach(f => { if (typeof e.values[f.id] !== 'string' || e.values[f.id].length > 200000) throw new Error('草稿字段无效'); });
        });
        if (!Number.isSafeInteger(r.exportRevision) || r.exportRevision < 0) throw new Error('草稿结果版本无效');
        record = { id:'restored-' + C.id(), package:r.package, entries:r.entries, exportRevision:r.exportRevision };
      }
    } else throw new Error('不支持的文件。成员结果请在对应汇总任务中导入。');
    const old = records.find(r => r.id === record.id);
    if (old) {
      if (record.package && C.canonical(old.package) !== C.canonical(record.package)) throw new Error('同编号审核包内容不同，请联系负责人');
      await useRecord(old); toast('已打开本机已有任务，未覆盖本机意见；协调备份请在另一浏览器恢复。');
    } else { await addRecord(record); toast('已导入并保存到本机'); }
  }
  function action(fn) { return async e => { e?.preventDefault(); if (busy) return; busy = true; try { await fn(e); } catch (err) { toast(err.message || '操作失败'); status(); } finally { busy = false; } }; }
  function bind() {
    document.querySelector('[data-home]')?.addEventListener('click', action(async () => { capture(); await persist(); current = null; setup = null; prepared = null; await refreshRecords(); render(); }));
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', action(() => useRecord(records[Number(b.dataset.open)]))));
    ['coordinator-file', 'reviewer-file'].forEach(id => document.getElementById(id)?.addEventListener('change', action(e => importFile(e.target.files[0]))));
    document.getElementById('create-batch')?.addEventListener('submit', action(async e => {
      const f = e.target; setup.title = f.elements.title.value.trim();
      const batch = await C.createBatch(setup, f.elements.members.value.split('\n').map(n => n.trim()).filter(Boolean));
      await addRecord({ id:'coordinator-' + batch.batchId, batch }); toast('批次已冻结，请下载协调备份和各人的审核包');
    }));
    document.getElementById('image-file')?.addEventListener('change', action(async e => {
      const file = e.target.files[0]; if (!file) return;
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error('请选择不超过 4 MB 的 PNG、JPEG 或 WebP');
      const value = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('图片读取失败')); r.readAsDataURL(file); }); C.image(value);
      const row = setup.rows[Number(document.getElementById('image-row').value)];
      setup.rows.forEach(r => { if (r.id === row.id || (row.sourceFile && r.sourceFile === row.sourceFile)) r.image = value; });
      document.getElementById('image-status').textContent = `已附图 ${setup.rows.filter(r => r.image).length} 条`; toast('图片已放入材料包');
    }));
    document.getElementById('results-files')?.addEventListener('change', action(async e => {
      let batch = current.batch; const counts = { added:0, updated:0, duplicate:0 };
      if (e.target.files.length > 100) throw new Error('请每次最多导入 100 个结果');
      for (const file of e.target.files) { const result = C.merge(batch, await readFile(file)); batch = result.batch; counts[result.status]++; }
      current.batch = batch; changed(); await persist(); render(); toast(`新增 ${counts.added} 人，更新 ${counts.updated} 份，跳过重复 ${counts.duplicate} 份；旧版意见保留`);
    }));
    document.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', action(async () => { capture(); await persist(); selected = Number(b.dataset.row); render(); })));
    document.getElementById('row-picker')?.addEventListener('change', action(async e => { const next = Number(e.target.value); capture(); await persist(); selected = next; render(); }));
    document.querySelector('[data-locate]')?.addEventListener('click', () => { const hit = document.getElementById('source-hit'), scroller = document.querySelector('.source-scroll'); if (hit && scroller) scroller.scrollTop += hit.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60; });
    const form = document.getElementById('review-form');
    form?.addEventListener('input', e => { if (busy || saveError) return; if (e.target.dataset.field != null) form.elements.decision.value = 'change'; capture(); });
    form?.addEventListener('change', () => { if (!busy && !saveError) capture(); });
    form?.addEventListener('submit', action(async () => { capture(); const row = current.package.material.rows[selected]; C.validateEntries(current.entries.filter(e => e.rowId === row.id), current.package.material, false); await persist(); selected = Math.min(selected + 1, current.package.material.rows.length - 1); render(); toast('本条已保存'); }));
    document.querySelector('[data-result]')?.addEventListener('click', action(async () => {
      capture(); const result = await C.resultFor(current.package, current.entries, current.exportRevision + 1);
      current.exportRevision = result.revision; changed(); await persist(); prepared = result; render(); toast('结果已生成，请点击“下载审核结果”后发给负责人');
    }));
    document.querySelectorAll('a[download]').forEach(a => a.addEventListener('click', e => {
      if (dirty || saving || saveError) { e.preventDefault(); persist().then(() => { render(); toast('已保存最新草稿，请再次点击下载'); }).catch(err => toast(err.message)); }
      else if (a.download.endsWith('-审核草稿.json')) { const url = URL.createObjectURL(new Blob([JSON.stringify({ type:'shulun-review-recovery', version:1, record:current }, null, 2)], { type:'application/json' })); urls.push(url); a.href = url; }
    }));
    // Recovery download remains available even after a storage failure.
    if (saveError) document.querySelectorAll('#review-form input,#review-form textarea,#review-form select,#review-form button').forEach(n => n.disabled = true);
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('[data-preview]'); if (!button) return;
    const output = exports[Number(button.dataset.preview)]; if (!output) return;
    if (current && output.name.endsWith('-审核草稿.json')) output.content = JSON.stringify({ type:'shulun-review-recovery', version:1, record:current }, null, 2);
    const dialog = document.createElement('dialog'); dialog.className = 'file-dialog';
    dialog.innerHTML = `<h2>保存文件内容</h2><p>文件名：<b>${esc(output.name)}</b></p><p class="muted">若下载没有反应，复制以下全部内容，用文本编辑器保存为上述文件名，再发给对方。</p><textarea readonly aria-label="导出文件内容"></textarea><div class="toolbar"><button data-copy-text class="primary">复制全部内容</button><button data-close-dialog>关闭</button></div><p role="status" data-copy-status></p>`;
    dialog.querySelector('textarea').value = output.content;
    document.body.append(dialog); dialog.showModal();
    dialog.querySelector('[data-close-dialog]').onclick = () => { dialog.close(); dialog.remove(); };
    dialog.addEventListener('cancel', () => dialog.remove());
    dialog.querySelector('[data-copy-text]').onclick = async () => {
      const area = dialog.querySelector('textarea'); area.focus(); area.select();
      try { await navigator.clipboard.writeText(area.value); dialog.querySelector('[data-copy-status]').textContent = '已复制，请保存为指定文件名'; }
      catch { dialog.querySelector('[data-copy-status]').textContent = '文本已选中，请按 Ctrl+C（Mac 为 ⌘C）复制'; }
    };
  });
  window.addEventListener('beforeunload', e => { if (dirty || saving || saveError) { e.preventDefault(); e.returnValue = ''; } });
  refreshRecords().then(render).catch(e => { render(); toast(e.message); });
})();

/* File exchange protocol. Fingerprints detect mismatched material, not reviewer identity. */
(function (root) {
  'use strict';
  const VERSION = 1;
  const MAX_BYTES = 50 * 1024 * 1024;
  const decisions = { pass: '通过', change: '需要修改', uncertain: '无法判断' };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = o => JSON.parse(JSON.stringify(o));
  const fail = message => { throw new Error(message); };
  const object = o => o && typeof o === 'object' && !Array.isArray(o);
  function str(v, label, max = 200000, empty = true) {
    if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) fail(`${label}无效`);
    return v;
  }
  function key(v) {
    str(v, '编号', 160, false);
    if (['__proto__', 'prototype', 'constructor'].includes(v)) fail('不允许的编号');
    return v;
  }
  function list(a, label, max, nonempty = true) {
    if (!Array.isArray(a) || a.length > max || (nonempty && !a.length)) fail(`${label}数量无效`);
    return a;
  }
  function unique(items) { if (new Set(items).size !== items.length) fail('编号重复'); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  async function hash(value) {
    const bytes = new TextEncoder().encode(canonical(value));
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  }
  function id() { return root.crypto.randomUUID(); }
  function parse(text) {
    if (new TextEncoder().encode(text).length > MAX_BYTES) fail('文件超过 50 MB，请拆分批次');
    try { return JSON.parse(text); } catch { fail('不是有效的 JSON 文件'); }
  }
  function image(value) {
    str(value, '图片', 6 * 1024 * 1024);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) fail('图片必须是内嵌 PNG、JPEG 或 WebP');
    return value;
  }
  function validateMaterial(m) {
    if (!object(m)) fail('缺少材料');
    str(m.title, '标题', 200, false);
    list(m.fields, '字段', 80).forEach(f => { if (!object(f)) fail('字段无效'); key(f.id); str(f.label, '字段名', 100, false); });
    unique(m.fields.map(f => f.id));
    let materialBytes = new TextEncoder().encode(JSON.stringify({ title:m.title, fields:m.fields })).length;
    list(m.rows, '条目', 2000).forEach(r => {
      if (!object(r) || !object(r.values)) fail('条目无效');
      key(r.id); str(r.sourceText, '原文', 1000000); str(r.sourceFile, '原文文件', 500);
      if (Object.keys(r.values).length !== m.fields.length) fail('条目字段不完整');
      m.fields.forEach(f => { if (!own(r.values, f.id)) fail('条目缺少字段'); str(r.values[f.id], f.label); });
      if (r.image) image(r.image);
      materialBytes += new TextEncoder().encode(JSON.stringify(r)).length + 1;
      if (materialBytes > MAX_BYTES - 1000000) fail('材料过大，请减少图片或拆分批次');
    });
    unique(m.rows.map(r => r.id));
    return m;
  }
  function fromWorkspace(w) {
    if (!object(w) || w.type !== 'calligraphy-workspace') fail('请导入主工作台导出的审核材料或工作区 JSON');
    list(w.rows, '条目', 2000);
    const defaults = ['author', 'scriptType', 'quote', 'pageNo', 'sourceFile', 'issue', 'note'];
    const labels = ['书家', '书体', '原文摘录', '页码', '原文文件', '待复核问题', '备注'];
    const fields = Array.isArray(w.schema) && w.schema.length ? w.schema.map(f => ({ id: f.id, label: f.label })) : defaults.map((id, n) => ({ id, label: labels[n] }));
    const m = { title: String(w.datasetName || '书论审核'), fields, rows: w.rows.map(r => {
      const values = Object.fromEntries(fields.map(f => [f.id, String((r.fields && own(r.fields, f.id) ? r.fields[f.id] : r[f.id]) ?? '')]));
      const sourceFile = String(values.sourceFile || r.sourceFile || '');
      return { id: String(r.id || ''), values, sourceFile, sourceText: typeof w.uploadedPages?.[sourceFile] === 'string' ? w.uploadedPages[sourceFile] : '' };
    }) };
    return validateMaterial(m);
  }
  async function createBatch(material, names) {
    validateMaterial(material);
    names = names.map(n => n.trim());
    list(names, '成员', 20).forEach(n => str(n, '成员姓名', 80, false)); unique(names);
    const batchId = id(), fingerprint = await hash(material), createdAt = new Date().toISOString();
    return { type: 'shulun-review-coordinator', version: VERSION, batchId, material: clone(material), fingerprint,
      createdAt, assignments: names.map(name => ({ packageId: id(), reviewer: name })), submissions: [] };
  }
  function packageFor(batch, assignment) {
    if (!batch.assignments.some(a => a.packageId === assignment.packageId && a.reviewer === assignment.reviewer)) fail('未知成员');
    return { type: 'shulun-review-package', version: VERSION, batchId: batch.batchId, packageId: assignment.packageId,
      reviewer: assignment.reviewer, createdAt: batch.createdAt, fingerprint: batch.fingerprint, material: clone(batch.material) };
  }
  async function validatePackage(p) {
    if (!object(p) || p.type !== 'shulun-review-package' || p.version !== VERSION) fail('不支持的审核包版本');
    key(p.batchId); key(p.packageId); str(p.reviewer, '成员', 80, false); str(p.createdAt, '创建时间', 80, false);
    validateMaterial(p.material);
    if (await hash(p.material) !== p.fingerprint) fail('材料指纹不一致，请重新取得审核包');
    return p;
  }
  function validateEntries(entries, material, complete = true) {
    list(entries, '审核记录', 2000, complete);
    unique(entries.map(e => e.rowId));
    if (complete && entries.length !== material.rows.length) fail('还有未审核的条目');
    const rows = new Map(material.rows.map(r => [r.id, r]));
    for (const e of entries) {
      if (!object(e) || !rows.has(e.rowId) || !own(decisions, e.decision)) fail('审核条目或判断无效');
      str(e.note, '审核说明', 10000);
      if (e.decision !== 'pass' && !e.note.trim()) fail('需要修改或无法判断时，请填写理由');
      if (!object(e.values) || Object.keys(e.values).length !== material.fields.length) fail('建议字段不完整');
      material.fields.forEach(f => { if (!own(e.values, f.id)) fail('建议缺少字段'); str(e.values[f.id], f.label); });
      if (e.decision !== 'change' && canonical(e.values) !== canonical(rows.get(e.rowId).values)) fail('修改字段后请选择“需要修改”');
    }
    return entries;
  }
  async function resultFor(p, entries, revision) {
    await validatePackage(p); validateEntries(entries, p.material);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('结果版本无效');
    return { type: 'shulun-review-result', version: VERSION, batchId: p.batchId, packageId: p.packageId,
      fingerprint: p.fingerprint, reviewer: p.reviewer, revision, submittedAt: new Date().toISOString(), entries: clone(entries) };
  }
  function validateResult(b, r) {
    if (!object(r) || r.type !== 'shulun-review-result' || r.version !== VERSION) fail('不支持的结果格式');
    if (r.batchId !== b.batchId || r.fingerprint !== b.fingerprint) fail('结果不属于本批材料版本');
    if (!b.assignments.some(a => a.packageId === r.packageId && a.reviewer === r.reviewer)) fail('结果的成员或审核包不匹配');
    if (!Number.isSafeInteger(r.revision) || r.revision < 1) fail('结果版本无效');
    str(r.submittedAt, '提交时间', 80, false);
    validateEntries(r.entries, b.material);
    return r;
  }
  function merge(b, r) {
    validateResult(b, r);
    const old = b.submissions.filter(s => s.packageId === r.packageId);
    const same = old.find(s => s.revision === r.revision);
    if (same) {
      if (canonical(same.entries) !== canonical(r.entries)) fail('同一版本内容冲突，请成员重新导出更高版本');
      return { batch: b, status: 'duplicate' };
    }
    if (old.some(s => s.revision > r.revision)) fail('这是较旧结果，已有更新版本');
    return { batch: { ...b, submissions: [...b.submissions, clone(r)] }, status: old.length ? 'updated' : 'added' };
  }
  async function validateBatch(b) {
    if (!object(b) || b.type !== 'shulun-review-coordinator' || b.version !== VERSION) fail('不是协调备份');
    key(b.batchId); validateMaterial(b.material); str(b.createdAt, '创建时间', 80, false);
    if (await hash(b.material) !== b.fingerprint) fail('协调备份材料已变动');
    list(b.assignments, '成员', 20).forEach(a => { key(a.packageId); str(a.reviewer, '成员', 80, false); });
    unique(b.assignments.map(a => a.packageId)); unique(b.assignments.map(a => a.reviewer));
    list(b.submissions, '结果版本', 2000, false).forEach(s => validateResult(b, s));
    unique(b.submissions.map(s => s.packageId + ':' + s.revision));
    return b;
  }
  function summarize(b) {
    const latest = b.assignments.map(a => b.submissions.filter(s => s.packageId === a.packageId).sort((x, y) => y.revision - x.revision)[0]).filter(Boolean);
    return b.material.rows.map(row => {
      const reviews = latest.map(s => ({ reviewer: s.reviewer, revision: s.revision, ...s.entries.find(e => e.rowId === row.id) }));
      const missing = b.assignments.length - reviews.length;
      const different = new Set(reviews.map(e => canonical({ decision: e.decision, values: e.values, note: e.note.trim() }))).size > 1;
      const status = missing ? '待收齐' : different ? '有分歧' : reviews.every(e => e.decision === 'pass') ? '一致通过（待负责人确认）' : '一致意见（待复核）';
      return { row, reviews, missing, status };
    });
  }
  function csv(b) {
    const escape = v => { let s = String(v ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    const rows = [['材料ID', '汇总状态', '成员', '结果版本', '审核判断', '审核说明', ...b.material.fields.flatMap(f => [f.label + '（原值）', f.label + '（建议）'])]];
    summarize(b).forEach(s => s.reviews.forEach(e => rows.push([s.row.id, s.status, e.reviewer, e.revision, decisions[e.decision], e.note, ...b.material.fields.flatMap(f => [s.row.values[f.id], e.values[f.id]])])));
    return '\uFEFF' + rows.map(r => r.map(escape).join(',')).join('\r\n') + '\r\n';
  }
  root.ShulunFileReview = { VERSION, MAX_BYTES, decisions, clone, canonical, hash, id, parse, image, validateMaterial, fromWorkspace, createBatch, packageFor, validatePackage, validateEntries, resultFor, merge, validateBatch, summarize, csv };
})(globalThis);

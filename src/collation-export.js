import { annotationFiles } from './theory-annotation-export.js?v=annotations-20261019';
import { CHECKS, exportText, isVerified, validateDraft } from './collation-core.js?v=human-mark-20261019';
import { metricsCsv, pageMetrics } from './task-metrics.js?v=human-mark-20261019';
import { progressSummary } from './screening-workflow.js?v=20261013-typo-only';
import { isTaskPage } from './screening-page-policy.js?v=20261003-trim';
import { zipStore } from './zip-store.js?v=20261018-bundle';
import { assignmentFor, assignmentSegment, assignmentPages, assignmentRevision } from './team-assignments.js?v=seven-20261018';
import { humanMarkLabel } from './human-mark.js?v=human-mark-20261019';

const encoder = new TextEncoder();
const clone = value => JSON.parse(JSON.stringify(value));
const cell = value => {
  const text = String(value ?? '');
  return `"${(/^[=+@\-\t\r]/u.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
};
const csv = rows => rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
const digest = async content => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(content))), n => n.toString(16).padStart(2, '0')).join('');

function editSummary(edit) {
  const line = edit.lineEnd && edit.lineEnd !== edit.line ? `第 ${edit.line} 行至第 ${edit.lineEnd} 行` : `第 ${edit.line} 行`;
  const chars = edit.charStart === edit.charEnd ? `第 ${edit.charStart} 字` : `第 ${edit.charStart}–${edit.charEnd} 字`;
  return `${line} · ${chars}：${edit.before || '（删除）'} → ${edit.after || '（删除）'}`;
}

export function checksCsv({ pages, progress }) {
  const person = progress.person.trim();
  return csv([['原PDF物理页', '分册页', '校勘状态', '净修改率(%)', '错字核对', '正文问题', '提醒（不影响本轮完成）', '备注（选填）', '直接替换记录', '校验人', '校验时间'],
    ...pages.map(item => {
      const review = progress.reviews[item.page] || {}, d = review.collation || {};
      const started = typeof d.text === 'string';
      const v = started ? validateDraft(d, item.ocr) : { errors: [], warnings: [] };
      return [item.page, item.local, humanMarkLabel(item,review), pageMetrics(item, review).modificationRate,
        ...Object.keys(CHECKS).map(key => d.checks?.[key] ? '是' : ''), v.errors.join('；'), v.warnings.join('；'), review.question || '',
        (d.edits || []).map(editSummary).join('；'), d.verifiedBy || (item.collated && typeof d.text !== 'string' ? '已回收团队记录' : ''), d.verifiedAt || ''];
    })]);
}

export async function buildCollationBundle({ progress, pages, member = null, exportedAt = new Date().toISOString(), exportId = crypto.randomUUID(), unsaved = false, saveConflict = false }) {
  // Freeze independently of the caller; hashing is asynchronous.
  progress = clone(progress); pages = clone(pages).filter(p => isTaskPage(p.page));
  unsaved = Boolean(unsaved || saveConflict);
  if (progress.version !== 1 || ![1,2,3,4].includes(progress.part) || typeof progress.person !== 'string' || !progress.person.trim() ||
      !progress.reviews || typeof progress.reviews !== 'object' || Array.isArray(progress.reviews)) throw new Error('请填写校勘人姓名，并确认本份进度可读取。');
  if (!pages.length || new Set(pages.map(p=>p.page)).size !== pages.length || pages.some(p => !Number.isInteger(p.page) || !Number.isInteger(p.local) || typeof p.ocr !== 'string')) throw new Error('导出材料不完整，请重试。');
  const [start, end] = [[1,258],[259,527],[528,776],[777,1052]][progress.part-1];
  const expected = Array.from({length:end-start+1}, (_,i)=>start+i).filter(isTaskPage);
  if (pages.length !== expected.length || pages.some((p,i)=>p.page !== expected[i] || p.local !== p.page-start+1)) throw new Error('导出页码与本份完整任务范围不匹配，请重试。');
  const assignment = assignmentFor(member), segment = assignmentSegment(member, progress.part);
  // Validate the full source part first. Scope text/tables without filtering the backup.
  if (assignment) pages = assignmentPages(pages, member, progress.part);
  const at = new Date(exportedAt);
  if (!Number.isFinite(at.getTime()) || typeof exportId !== 'string' || !exportId) throw new Error('导出批次无效。');
  const { part, reviews } = progress, person = progress.person.trim(), counts = progressSummary(pages, reviews);
  const prefix = `第${part}份`, files = [];
  const add = (name, content, type = 'text') => files.push({ name, content: (type === 'text' ? '\ufeff' : '') + content });
  add(`${prefix}-逐页校勘.txt`, exportText({ part, person, pages, reviews }));
  add(`${prefix}-TXT校验表.csv`, checksCsv({ pages, progress }));
  add(`${prefix}-修改率汇总.csv`, metricsCsv({ part, person, pages, reviews, savedAt: progress.savedAt || '', unsaved }));
  // Preserve every original review, including old excluded-page records and baselines.
  add(`${prefix}-初筛进度备份.json`, JSON.stringify(progress, null, 2), 'json');
  add(`${prefix}-逐页初筛回收表.csv`, csv([['原PDF物理页', '分册页', '已看扫描页', '发现候选数', '需重做OCR', '疑问与处理', '审核人'],
    ...pages.map(p => {
      const r = reviews[p.page] || {};
      return [p.page, p.local, r.seen ? '是' : '', r.seen ? (r.candidates || []).length : '', r.redoOcr ? '是' : '', r.question || '', r.seen ? person : ''];
    })]));
  const candidates = [['原PDF物理页', '书家', '书体', '连续原文摘录', '风格描述依据', '不确定或待核事项', '审核人']];
  for (const p of pages) for (const c of reviews[p.page]?.candidates || []) candidates.push([p.page, c.author, c.style, c.quote, c.basis, c.uncertainty, person]);
  add(`${prefix}-新证据候选回收表.csv`, csv(candidates));
  for(const file of annotationFiles(pages,reviews,part,person)) add(file.name,file.content);
  add('交付说明.txt', [
    `《历代书法论文选》${prefix}一键交付包`, `导出人：${person}`, `导出时间：${exportedAt}`, `导出批次：${exportId}`,
    `本机个人标记 ${counts.verified} 页；其余个人页未标。团队已回收页和本机记录按页去重，详见校验表。`,
    ...(assignment ? [`当前分工：成员${assignment.id} ${assignment.name}，原第${part}份第${segment.start}–${segment.end}页。`,
      'TXT与CSV仅列当前成员本段；进度JSON保留此原分份全部个人记录，包括已移交页草稿、比较底稿与编辑历史。跨两个原分份的成员请分别导出两包。'] : []),
    unsaved ? `注意：本包包含当前页面尚未保存的修改${saveConflict ? '，存在其他标签页进度冲突' : ''}；以本次点击时的内存快照导出，不表示已保存到浏览器。` : '本包取自本次点击时的当前浏览器进度。',
    '请将整个ZIP文件交回负责人，不必拆开分次发送。',
    '负责人解压后，校勘TXT含正文，校验表/修改率表用于查漏，进度JSON保留底稿、编辑记录和完整状态。',
    '换浏览器或恢复进度：先解压，在网页“材料与恢复”中导入本包的“初筛进度备份.json”。旧版JSON仍可导入。',
    '书论标注独立保存；本段有标注记录时附原文高亮HTML、书论摘录CSV与逐页标注状态CSV。未确认不等于没有书论；已撤销和待重新定位内容保留记录，不计有效高亮。进度JSON含全部标注、原摘录与操作历史。',
    '人工标过为已标过，未标为未标过；大模型是否处理不改变人工状态。有人工稿时优先保留人工稿，其余使用工作TXT。',
    '旧人工标记继续有效；修改正文后需要重新标记。原疑难字及备注保留在记录中。',
    '净修改率沿用已保存比较底稿计算，不代表OCR准确率；旧草稿缺少比较底稿时留空。',
    '已排除的封面/目录等不计任务表，但原有记录继续保存在JSON备份中。',
    '文件清单.json记录各文件SHA256及页码来源；原PDF和扫描图不打包，可回网页对应物理页查看。',
    `回查入口：https://sisatrek-oi.github.io/calligraphy-online-site/screening.html?part=${part}${assignment ? `&member=${assignment.id}` : ''}`,
  ].join('\n'));
  const manifest = { format: 'shulun-collation-bundle', version: 1, exportId, exportedAt, part, person,
    ...(assignment ? { assignment: { revision:assignmentRevision, member:assignment.id, name:assignment.name, start:segment.start, end:segment.end, backupScope:'entire-original-part' } } : {}),
    scope: '本次点击时本机个人校勘进度；不是全员实时汇总或专家金标准', pageNumbers: pages.map(p=>p.page), counts,
    savedAt: progress.savedAt || '', unsaved: Boolean(unsaved), saveConflict: Boolean(saveConflict),
    files: await Promise.all(files.map(async f => ({ name: f.name, bytes: encoder.encode(f.content).length, sha256: await digest(f.content) }))),
    sources: await Promise.all(pages.map(async p => ({ page: p.page, local: p.local, rawOcrSha256: await digest(p.ocr),
      ...(p.collated ? { teamRevision: p.collated.revision } : {}), ...(p.targeted ? { targetedRevision: p.targeted.revision } : {}),
      ...(p.modelReviewed ? { modelRevision:p.modelReviewed.revision, sourceImageSha256:p.modelReviewed.sourceSha256,
        model:p.modelReviewed.model, humanMark:humanMarkLabel(p,reviews[p.page]),
        machineWorkingTextSha256:await digest(p.modelReviewed.text), requests:p.modelReviewed.requests } : {}) }))),
    note: 'SHA256不自包含文件清单本身；所有校勘数据文件与说明均已列出。' };
  add('文件清单.json', JSON.stringify(manifest, null, 2), 'json');
  const timestamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return { name: `${assignment ? `成员${assignment.id}-` : ''}${prefix}-校勘交付包-${timestamp}.zip`, bytes: zipStore(files, at), manifest };
}

export function createBundleExporter({ capture, loadMaterials, build, download }) {
  let pending = false;
  return async function run() {
    if (pending) return { skipped: true };
    pending = true;
    try {
      const snapshot = clone(capture());
      await loadMaterials();
      const bundle = await build(snapshot);
      await download(bundle);
      return bundle;
    } finally { pending = false; }
  };
}

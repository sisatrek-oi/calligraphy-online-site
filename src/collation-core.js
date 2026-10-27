import { humanMarked, humanMarkLabel } from './human-mark.js?v=index-archive-20261027';
import { isTaskPage } from './screening-page-policy.js?v=index-archive-20261027';
// Raw OCR remains immutable. These helpers format a draft, never certify its reading order.
export const CHECKS = {
  wording: '已对照原页核对本页错字',
};

export function numberLines(text) {
  return String(text || '').split(/\r?\n/).map(line => line.replace(/^\s*\[\d+\]\s*/, '').trim())
    .filter(Boolean).map((line, index) => `[${String(index + 1).padStart(3, '0')}] ${line}`).join('\n');
}

export function makeDraft(raw) {
  // Only discard spacing between Han characters/punctuation, preserving Latin word spacing.
  return numberLines(String(raw || '').replace(/([\p{Script=Han}，。；：！？、])[^\S\r\n]+(?=[\p{Script=Han}，。；：！？、])/gu, '$1'));
}

export function moveLine(text, caret, direction) {
  const lines = text.split('\n');
  const from = text.slice(0, caret).split('\n').length - 1;
  const to = from + direction;
  if (to < 0 || to >= lines.length) return { text, caret };
  [lines[from], lines[to]] = [lines[to], lines[from]];
  const result = numberLines(lines.join('\n'));
  return { text: result, caret: result.split('\n').slice(0, to).reduce((sum, line) => sum + line.length + 1, 0) };
}

export function validateDraft(draft = {}, raw = '') {
  draft = draft || {};
  const text = String(draft.text || '');
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const errors = [], warnings = [];
  if (!text.replace(/^\s*\[\d+\]\s*/gm, '').trim()) errors.push('正文为空，请先录入文字；空白扫描页可填【空白页】。');
  lines.forEach((line, index) => {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (!match || Number(match[1]) !== index + 1) warnings.push(`第 ${index + 1} 行未编号或编号不连续，可按需“重新编号”，不影响本轮完成。`);
    else if (!match[2].trim()) warnings.push(`第 ${index + 1} 栏没有文字，可稍后整理。`);
  });
  if (/[□�]|【待核[^】]*】/.test(text)) warnings.push('保留了 □、替换符或【待核…】标记，可留待后续复核，不影响本轮完成。');
  const count = value => [...value.matchAll(/\p{Script=Han}/gu)].length;
  const before = count(raw), after = count(text);
  if (before && Math.abs(after - before) / before > .2) warnings.push(`汉字数从 ${before} 变为 ${after}，变化超过 20%，请检查漏栏或重复。`);
  if (new Set(lines.map(line => line.replace(/^\[\d+\]\s*/, ''))).size < lines.length) warnings.push('存在相同的栏文本，请检查是否重复粘贴。');
  return { errors: [...new Set(errors)], warnings, lines: lines.length, chars: after };
}

export function isVerified(draft = {}, raw = '') {
  draft = draft || {};
  return Boolean(draft.verified && Object.keys(CHECKS).every(key => draft.checks?.[key]) && !validateDraft(draft, raw).errors.length);
}

export function exportText({ part, person, pages, reviews, sourceForPage = page => page.ocr }) {
  const content = [`《历代书法论文选》｜第 ${part} 份｜逐页 TXT 校勘`, `导出人：${person}`, '说明：人工标过为已标过，人工未标为未标过；旧人工标记继续有效。机器处理情况不改变人工标记，正文直接取当前工作TXT。', ''];
  for (const page of pages) {
    if (!isTaskPage(page.page)) continue;
    const review = reviews[page.page] || {}, draft = review.collation || {};
    content.push(`===== 原 PDF 物理页 ${page.page}｜分册第 ${page.local} 页 =====`,
      `状态：${humanMarkLabel(page,review)}`,
      `校验人：${draft.verifiedBy || (humanMarked(page,review) && page.collated ? '已回收团队记录' : '—')}`, `校验时间：${draft.verifiedAt || '—'}`,
      ...Object.entries(CHECKS).map(([key, label]) => `${draft.checks?.[key] ? '[x]' : '[ ]'} ${label}`),
      `疑问与处理：${review.question || '—'}`,
      ...(draft.edits?.length ? ['【直接替换记录】', ...draft.edits.map((edit) => {
        const line = edit.lineEnd && edit.lineEnd !== edit.line ? `第 ${edit.line} 行至第 ${edit.lineEnd} 行` : `第 ${edit.line} 行`;
        const chars = edit.charStart === edit.charEnd ? `第 ${edit.charStart} 字` : `第 ${edit.charStart}–${edit.charEnd} 字`;
        return `${line}·${chars}：${edit.before || '（删除）'} → ${edit.after || '（删除）'}`;
      })] : []),
      '【正文·一栏一行】', draft.text ?? page.collated?.text ?? page.modelReviewed?.text ?? '（未录入）', '');
  }
  return content.join('\n');
}

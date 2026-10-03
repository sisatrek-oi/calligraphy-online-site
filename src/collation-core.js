// Raw OCR remains immutable. These helpers format a draft, never certify its reading order.
export const CHECKS = {
  order: '已按原页核对栏序（正文通常右→左、栏内上→下）',
  wording: '已逐字核对，检查错字、漏字、标点及页眉页码',
  continuity: '已核对本页首尾与前后页衔接',
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
  if (!lines.length) errors.push('正文为空，请先生成分栏草稿。');
  lines.forEach((line, index) => {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (!match || Number(match[1]) !== index + 1) errors.push(`第 ${index + 1} 行编号不连续，点击“重新编号”修复。`);
    else if (!match[2].trim()) errors.push(`第 ${index + 1} 栏没有文字。`);
  });
  if (/[□�]|【待核[^】]*】/.test(text)) errors.push('仍有 □、替换符或【待核…】标记，请保留草稿并记录疑问。');
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

export function exportText({ part, person, pages, reviews }) {
  const content = [`《历代书法论文选》｜第 ${part} 份｜逐页 TXT 校勘`, `导出人：${person}`, '说明：栏号按阅读顺序排列；未开始、草稿、已校验分别记录。已校验为成员人工确认。', ''];
  for (const page of pages) {
    const review = reviews[page.page] || {}, draft = review.collation || {};
    content.push(`===== 原 PDF 物理页 ${page.page}｜分册第 ${page.local} 页 =====`,
      `状态：${isVerified(draft, page.ocr) ? '已校验' : draft.text !== undefined ? '草稿' : '未开始'}`,
      `校验人：${draft.verifiedBy || person}`, `校验时间：${draft.verifiedAt || '—'}`,
      ...Object.entries(CHECKS).map(([key, label]) => `${draft.checks?.[key] ? '[x]' : '[ ]'} ${label}`),
      `疑问与处理：${review.question || '—'}`, '【正文·一栏一行】', draft.text || '（未录入）', '');
  }
  return content.join('\n');
}

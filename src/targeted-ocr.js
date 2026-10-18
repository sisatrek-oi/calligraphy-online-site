// Offsets count Unicode code points, matching the Python publication audit.
// Reconstructing from approved spans prevents an unreviewed whole-page rewrite.
export function applyTargeted(base, regions) {
  if (typeof base !== 'string' || !Array.isArray(regions) || !regions.length) return null;
  if (regions.some(r => !r || typeof r !== 'object')) return null;
  const chars = Array.from(base), sorted = [...regions].sort((a, b) => a.publicationStart - b.publicationStart);
  let end = 0;
  for (const r of sorted) {
    const a = r.publicationStart, b = r.publicationEnd;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < end || b < a || b > chars.length ||
        typeof r.after !== 'string' || chars.slice(a, b).join('') !== r.publicationBefore) return null;
    end = b;
  }
  let result = chars;
  for (const r of sorted.reverse()) result = [...result.slice(0, r.publicationStart), ...r.after, ...result.slice(r.publicationEnd)];
  return result.join('');
}

export function validTargeted(value, page, raw) {
  if (!value || value.page !== page || value.wholePageReviewed !== false ||
      value.status !== '局部已处理·整页未校' || typeof value.revision !== 'string' ||
      typeof value.reviewedAt !== 'string' || !Array.isArray(value.notes) ||
      typeof value.baseText !== 'string' || (raw !== undefined && raw !== value.baseText) ||
      !Array.isArray(value.regions) || !value.regions.length) return false;
  const ids = new Set();
  for (const r of value.regions) {
    if (!r || typeof r.id !== 'string' || ids.has(r.id) || r.page !== page ||
        typeof r.pending !== 'boolean' || typeof r.note !== 'string' || typeof r.before !== 'string' || typeof r.after !== 'string' ||
        !Array.isArray(r.reviewBox) || r.reviewBox.length !== 4 || !r.reviewBox.every(Number.isFinite) ||
        !Array.isArray(r.ocr) || r.ocr.length !== 2 ||
        (r.pending ? r.status !== '已重OCR·待核' || !r.after.includes('【待核：')
          : !['已修改完毕', '已核对·无需修改'].includes(r.status))) return false;
    ids.add(r.id);
  }
  return typeof value.text === 'string' && value.text === applyTargeted(value.baseText, value.regions);
}

export function targetedSummary(value) {
  return { revision: value.revision, reviewedAt: value.reviewedAt, regions: value.regions.length,
    confirmed: value.regions.filter(r => !r.pending).length, pending: value.regions.filter(r => r.pending).length,
    wholePageReviewed: false };
}

export function targetedLabel(item) {
  const s = item.targetedSummary;
  if (s && item.publication) return `局部OCR历史${s.regions}区域·已纳入团队复核`;
  return s ? `局部已处理${s.confirmed}/${s.regions}${s.pending ? `·待核${s.pending}处` : ''}·整页未校` : '';
}

export const targetedRelease = { date: '2026-10-18', pages: 22, regions: 62, confirmed: 61, pending: 1,
  parts: { 1: { pages: 4, regions: 8, pending: 0 }, 4: { pages: 18, regions: 54, pending: 1, collatedPages: 2 } } };

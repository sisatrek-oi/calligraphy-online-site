import { isVerified } from './collation-core.js?v=fulltext-20261019';
// A machine working text is never a human decision. Keep raw OCR immutable.
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validModelReview(value, page) {
  if (!value || value.page !== page || value.humanConfirmed !== false || value.status !== '待人工全文检查' ||
      typeof value.revision !== 'string' || !value.revision || typeof value.model !== 'string' || !value.model ||
      typeof value.machineModel !== 'string' || !Number.isFinite(Date.parse(value.reviewedAt)) || !hash(value.sourceSha256) ||
      !Number.isInteger(value.columnCount) || value.columnCount < 1 || value.reviewedColumnCount !== value.columnCount ||
      !Array.isArray(value.units) || !value.units.length || !Array.isArray(value.requests) || !value.requests.length) return false;
  const columns = [], ids = new Set(), requests = new Set();
  for (const u of value.units) {
    if (!u || typeof u.id !== 'string' || ids.has(u.id) || !Array.isArray(u.columns) || !u.columns.length ||
        !u.columns.every((c,i) => Number.isInteger(c) && (i === 0 || c === u.columns[i-1]+1)) ||
        !['reviewed','pending'].includes(u.status) || typeof u.text !== 'string' || !u.text.trim() ||
        typeof u.baseline !== 'string' || typeof u.note !== 'string' || !u.note.trim() ||
        (u.status === 'pending' && u.text !== u.baseline) ||
        !Array.isArray(u.box) || u.box.length !== 4 || !u.box.every(Number.isFinite) || u.box[2] <= u.box[0] || u.box[3] <= u.box[1]) return false;
    ids.add(u.id); columns.push(...u.columns);
  }
  if (columns.length !== value.columnCount || columns.some((c,i) => c !== i+1)) return false;
  for (const r of value.requests) {
    if (!r || typeof r.id !== 'string' || requests.has(r.id) || !hash(r.sha256) ||
        !Number.isFinite(r.seconds) || r.seconds < 0 || !Number.isFinite(r.estimatedUSDPeak) || r.estimatedUSDPeak < 0 ||
        !r.usage || !Number.isInteger(r.usage.prompt_tokens) || !Number.isInteger(r.usage.completion_tokens)) return false;
    requests.add(r.id);
  }
  return value.text === value.units.map((u,i) => `[${String(i+1).padStart(3,'0')}] ${u.text}`).join('\n');
}
export function modelReviewSummary(value) {
  return { revision:value.revision, reviewedAt:value.reviewedAt, model:value.model,
    sourceSha256:value.sourceSha256, columns:value.columnCount,
    pending:value.units.filter(u=>u.status==='pending').length, status:value.status, humanConfirmed:false };
}
export function modelReviewLabel(item) {
  return item.modelReviewSummary ? '大模型已复核·待人工全文检查' : '';
}
export function humanReviewStage(review = {}) {
  const d = review.collation;
  return isVerified(d) ? d.fullTextChecked === true && d.checks?.fulltext === true ? '人工全文已确认' : '历史错字核对已确认'
    : typeof d?.text === 'string' ? '人工检查中' : '待人工全文检查';
}

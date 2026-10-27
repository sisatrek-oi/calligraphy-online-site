import { makeDraft } from './collation-core.js?v=index-archive-20261027';
import { validModelReview } from './model-reviewed.js?v=index-archive-20261027';
const compact = text => String(text ?? '').replace(/\s/gu, '');
// Layout may only change whitespace. It must never introduce or omit glyphs.
export function originalDraftText(item) {
  return typeof item.layout?.text === 'string' && compact(item.layout.text) === compact(item.ocr)
    ? item.layout.text : item.ocr;
}
export function draftForPage(item, review = {}) {
  // Preserve the original object including verification, edits and metricBaseline.
  return review.collation || { text: defaultDraftText(item) };
}
export function defaultDraftText(item) {
  return item.collated ? item.collated.text : validModelReview(item.modelReviewed, item.page) ? item.modelReviewed.text
    : makeDraft(item.targeted ? item.targeted.text : originalDraftText(item));
}

import { makeDraft } from './collation-core.js?v=20261003-trim';
const compact = text => String(text ?? '').replace(/\s/gu, '');
// Layout may only change whitespace. It must never introduce or omit glyphs.
export function originalDraftText(item) {
  return typeof item.layout?.text === 'string' && compact(item.layout.text) === compact(item.ocr)
    ? item.layout.text : item.ocr;
}
export function draftForPage(item, review = {}) {
  // Preserve the original object including verification, edits and metricBaseline.
  return review.collation || { text: makeDraft(originalDraftText(item)) };
}

import { isVerified } from './collation-core.js?v=human-mark-20261019';
// Only human records count. Never inspect model, OCR or risk flags here.
export function humanMarked(item, review = {}) {
  return typeof review?.collation?.text === 'string'
    ? isVerified(review.collation,item.ocr) : Boolean(item.publication || item.collated);
}
export const humanMarkLabel = (item,review) => humanMarked(item,review) ? '已标过' : '未标过';
export function nextUnmarkedIndex(pages,reviews,index) {
  for (let offset=1;offset<pages.length;offset++) {
    const candidate=(index+offset)%pages.length;
    if (!humanMarked(pages[candidate],reviews[pages[candidate].page])) return candidate;
  }
  return -1;
}

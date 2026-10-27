import { isVerified } from './collation-core.js?v=index-archive-20261027';

// Annotation has a stricter source gate than the historical two-state page label.
// A returned page with unresolved readings is not finished annotation material.
const unresolved = text => /[□�]|【待核[^】]*】/u.test(text);
export function annotationSource(item, review={}, {summary=false}={}) {
  const d=review?.collation;
  const known=item.humanReviewed||item.humanReviewedSummary;
  const approval=d?.annotationSourceApproval;
  const cleared=!known||known.eligible||Boolean(approval?.version===1&&approval.text===d?.text&&approval.by===d?.verifiedBy&&approval.at===d?.verifiedAt&&approval.blockedSourceRevision===known.source?.revision&&approval.blockedReasons===JSON.stringify(known.blockedReasons));
  if(cleared && typeof d?.text==='string' && isVerified(d,item.ocr) && !unresolved(d.text)) return {
    kind:'personal',text:d.text,label:'本机人工已校验稿',verifiedBy:d.verifiedBy||'原人工记录',
    verifiedAt:d.verifiedAt||'',revision:d.verifiedAt||'legacy-human-verified',page:item.page,
  };
  const human=item.humanReviewed;
  if(human?.integrityChecked && human.page===item.page && human.eligible && !unresolved(human.text))return {...human.source,text:human.text};
  // Published completion labels can refer to later AI revisions. Only the
  // independent human-TXT registry may stand in for the original audit record.
  const p=item.humanReviewedSummary;
  if(summary && p?.page===item.page && p.eligible)return {...p.source};
  return null;
}

export function annotationHref(member,part,page) {
  return `./annotation.html?part=${part}${member!=null?`&member=${member}`:''}${page!=null?`&page=${page}`:''}`;
}

export function sourceStamp(source,part) {
  const {text,...stamp}=source;
  return {...stamp,part};
}

import { isVerified } from './collation-core.js?v=human-mark-20261019';
import { validCollation } from './team-collation.js?v=20261018-part3';

// Annotation has a stricter source gate than the historical two-state page label.
// A returned page with unresolved readings is not finished annotation material.
const unresolved = text => /[□�]|【待核[^】]*】/u.test(text);
export function annotationSource(item, review={}, {summary=false}={}) {
  const d=review?.collation;
  if(typeof d?.text==='string' && isVerified(d,item.ocr) && !unresolved(d.text)) return {
    kind:'personal',text:d.text,label:'本机人工已校验稿',verifiedBy:d.verifiedBy||'原人工记录',
    verifiedAt:d.verifiedAt||'',revision:d.verifiedAt||'legacy-human-verified',page:item.page,
  };
  const c=item.collated;
  if(validCollation(c,item.page) && c.status==='已修改完毕' && c.pending.length===0 && !unresolved(c.text)) return {
    kind:'team',text:c.text,label:'团队已修改完毕稿',verifiedBy:'已回收团队人工记录',verifiedAt:c.reviewedAt,revision:c.revision,page:item.page,
  };
  // Overview counts use the versioned material index; reader/export recheck full text.
  const p=item.publication;
  if(summary && p?.status==='已修改完毕' && p.pending===0) return {
    kind:'team',label:'团队已修改完毕稿',verifiedBy:'已回收团队人工记录',verifiedAt:p.reviewedAt,revision:p.revision,page:item.page,
  };
  return null;
}

export function annotationHref(member,part,page) {
  return `./annotation.html?part=${part}${member!=null?`&member=${member}`:''}${page!=null?`&page=${page}`:''}`;
}

export function sourceStamp(source,part) {
  const {kind,label,verifiedBy,verifiedAt,revision,page}=source;
  return {kind,label,verifiedBy,verifiedAt,revision,page,part};
}

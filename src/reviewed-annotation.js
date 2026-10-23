import {readJson} from './screening-loader.js?v=member5-mark45-20261023';
import {addAnnotation,validateAnnotations,removeAnnotationSelection,completeAnnotations,annotationView} from './theory-annotations.js?v=release-20261022';

export const reviewedBatch = 'human-txt-20261020';
const roles=new Set(['theory','editorial','biography','structure','blank','pending']);
const boundary=(text,n)=>!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));
const validRange=(text,s)=>Number.isInteger(s?.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=text.length&&boundary(text,s.start)&&boundary(text,s.end)&&text.slice(s.start,s.end)===s.quote;
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const fail=()=>{throw new Error('人工TXT初标材料不完整或与审核版本不匹配');};

export async function validateReviewedPart(value,part) {
  if(value?.version!==1||value.batch!==reviewedBatch||value.part!==part||typeof value.revision!=='string'||!value.revision||!Array.isArray(value.pages))fail();
  const pages=new Set();
  for(const p of value.pages) {
    const s=p?.source;
    if(!Number.isInteger(p?.page)||p.part!==part||pages.has(p.page)||typeof p.text!=='string'||!p.text.trim()||typeof p.eligible!=='boolean'||!Array.isArray(p.blockedReasons)||p.eligible===Boolean(p.blockedReasons.length)||
      s?.kind!=='human-txt'||s.page!==p.page||s.part!==part||!s.verifiedBy?.trim()||!s.verifiedAt||!Number.isFinite(Date.parse(s.verifiedAt))||!s.txtPath||!s.reviewCsvPath||!/^\w{64}$/.test(s.fileSha256)||s.revision!==s.textSha256||await sha(p.text)!==s.textSha256||
      !Array.isArray(p.candidates)||!Array.isArray(p.segments)||!Array.isArray(p.contextNotes))fail();
    pages.add(p.page);
    let cursor=0;
    for(const segment of p.segments) {
      if(!validRange(p.text,segment)||segment.start!==cursor||!roles.has(segment.role)||!['complete','needs-context'].includes(segment.contextStatus))fail();
      cursor=segment.end;
    }
    if(cursor!==p.text.length||(!p.eligible&&p.candidates.length))fail();
    const ids=new Set();let end=0;
    for(const c of p.candidates) {
      if(!validRange(p.text,c)||!c.quote.trim()||!c.id||ids.has(c.id)||c.start<end||typeof c.category!=='string'||typeof c.note!=='string'||!['complete','needs-context'].includes(c.contextStatus)||!p.segments.some(s=>s.role==='theory'&&s.start<=c.start&&s.end>=c.end))fail();
      ids.add(c.id);end=c.end;
    }
  }
  return value;
}

export async function attachReviewedPart(pages,value,part) {
  await validateReviewedPart(value,part);
  const byPage=new Map(pages.map(p=>[p.page,p]));
  if(value.pages.some(p=>!byPage.has(p.page)))fail();
  // Publish only after the whole part passes; the original material objects remain untouched.
  for(const item of pages)delete item.humanReviewed;
  for(const p of value.pages)byPage.get(p.page).humanReviewed={...p,revision:p.annotationRevision||value.revision,batch:value.batch,integrityChecked:true};
  return pages;
}

export async function loadReviewedPart(pages,part,options) {
  const value=await readJson(`./annotation-data/part-${part}.json?v=${reviewedBatch}`,options);
  return attachReviewedPart(pages,value,part);
}

export async function loadReviewedIndex(indexes,{storage,...options}={}) {
  const value=await readJson(`./annotation-data/index.json?v=${reviewedBatch}`,options);
  if(value?.version!==1||value.batch!==reviewedBatch||!Array.isArray(value.pages)||value.total!==value.pages.length)fail();
  const seen=new Set();
  for(const p of value.pages) {
    const s=p.source;
    if(seen.has(p.page)||![1,2,3,4].includes(p.part)||typeof p.eligible!=='boolean'||s?.kind!=='human-txt'||!s.verifiedBy||!s.verifiedAt||!/^[a-f0-9]{64}$/.test(s.textSha256)||s.revision!==s.textSha256||!Number.isInteger(p.candidateCount)||p.candidateCount<0||!Array.isArray(p.blockedReasons)||p.eligible===Boolean(p.blockedReasons.length))fail();
    seen.add(p.page);
    if(!indexes[p.part]?.pages.some(item=>item.page===p.page))fail();
  }
  for(const p of value.pages) {
    const summary={...p};
    try {
      const saved=JSON.parse(storage?.getItem(`shulun-screening-v1-part-${p.part}`)||'null'),text=saved?.reviews?.[p.page]?.collation?.text;
      if(typeof text==='string'&&await sha(text)===p.source.textSha256)summary.matchingPersonalText=text;
    }catch{ /* The task context separately reports unreadable personal progress. */ }
    indexes[p.part].pages.find(item=>item.page===p.page).humanReviewedSummary=summary;
  }
  return value;
}

const subtract=(spans,cuts)=>cuts.reduce((remaining,cut)=>remaining.flatMap(s=>cut.end<=s.start||cut.start>=s.end?[s]:[
  ...(s.start<cut.start?[{...s,end:cut.start}]:[]),...(s.end>cut.end?[{...s,start:cut.end}]:[]),
]),spans);

export function candidateView(item,review={},source) {
  const p=item.humanReviewed;
  if(!p?.integrityChecked||!p.eligible||!source||source.text!==p.text)return {available:false,all:[],pending:[],contextNotes:[]};
  const data=review.theoryAnnotations,history=data?.candidateReview;
  const matching=data?.text===source.text&&history?.revision===p.revision&&history.sourceRevision===source.revision;
  const decisions=matching?history.decisions:{};
  const cuts=matching?(history.exclusions||[]):[];
  if(!Array.isArray(cuts)||cuts.some(c=>!validRange(source.text,c)))throw new Error('已删除的标注范围与当前正文不匹配。');
  const all=p.candidates.map(c=>{
    const acceptedPassage=data?.text===source.text&&data.passages?.find(a=>a.status==='active'&&a.candidateId===c.id&&a.start===c.start&&a.end===c.end);
    const remaining=subtract([{start:c.start,end:c.end}],cuts).filter(s=>source.text.slice(s.start,s.end).trim()).map(s=>({...c,...s,quote:source.text.slice(s.start,s.end)}));
    const pageAccepted=matching&&decisions?.[c.id]?.mode==='page-confirmed'&&remaining.every(s=>!subtract([s],annotationView(data,source.text).ranges).length);
    const accepted=pageAccepted||acceptedPassage&&(c.contextStatus==='complete'||(acceptedPassage.contextStatus==='complete'&&acceptedPassage.contextVerifiedBy));
    const decision=!remaining.length?'rejected':accepted?'accepted':decisions?.[c.id]?.decision==='rejected'?'rejected':'pending';
    return {...c,decision,remaining,contextVerifiedBy:acceptedPassage?.contextVerifiedBy||'',contextVerifiedAt:acceptedPassage?.contextVerifiedAt||''};
  });
  return {available:true,all,pending:all.filter(c=>c.decision==='pending').flatMap(c=>c.remaining),contextNotes:p.contextNotes||[],summary:p.summary||''};
}

export function deleteDefaultAnnotation(item,data,source,start,end,by,at=new Date().toISOString()) {
  let next=removeAnnotationSelection(data,source.text,start,end,by,at);
  const p=item.humanReviewed,view=candidateView(item,{theoryAnnotations:data},source);
  if(view.available) {
    const previous=next.candidateReview;
    const matching=previous?.revision===p.revision&&previous.sourceRevision===source.revision&&data?.text===source.text;
    next.candidateReview={revision:p.revision,sourceRevision:source.revision,decisions:matching?{...previous.decisions}:{},exclusions:[...(matching?previous.exclusions||[]:[]),{start,end,quote:source.text.slice(start,end),by:by.trim(),at}]};
  }
  next.events.push({action:'selection-delete',start,end,by:by.trim(),at});return next;
}

export function confirmDefaultAnnotations(item,data,source,by,at=new Date().toISOString()) {
  if(!by.trim())throw new Error('请先填写真实姓名。');
  const view=candidateView(item,{theoryAnnotations:data},source);
  let next=data?structuredClone(validateAnnotations(data)):{version:1,text:source.text,passages:[],events:[],completion:null};
  for(const c of view.pending) {
    const pieces=subtract([{start:c.start,end:c.end}],annotationView(next,source.text).ranges);
    for(const s of pieces) {
      if(!source.text.slice(s.start,s.end).trim())continue;
      next=addAnnotation(next,source.text,s.start,s.end,by,at);
      Object.assign(next.passages.at(-1),{candidateId:c.id,category:c.category,contextNote:c.note,contextStatus:c.contextStatus,originalContextStatus:c.contextStatus,origin:'ai-page-confirmed'});
    }
  }
  if(view.available) {
    const previous=next.candidateReview,p=item.humanReviewed;
    const matching=data?.text===source.text&&previous?.revision===p.revision&&previous.sourceRevision===source.revision;
    next.candidateReview={revision:p.revision,sourceRevision:source.revision,exclusions:matching?previous.exclusions||[]:[],decisions:{...(matching?previous.decisions:{})}};
    for(const c of view.all)next.candidateReview.decisions[c.id]={decision:c.decision==='rejected'?'rejected':'accepted',mode:'page-confirmed',by:by.trim(),at};
  }
  return completeAnnotations(next,source.text,by,at);
}

export function reviewCandidate(data,text,candidate,decision,by,revision,sourceRevision,at=new Date().toISOString(),{contextConfirmed=false}={}) {
  if(!by.trim())throw new Error('请先填写真实姓名，再复核初标。');
  if(!validRange(text,candidate)||!['accepted','rejected','pending'].includes(decision))throw new Error('初标与当前正文版本不匹配，请重新载入。');
  let next;
  if(decision==='accepted') {
    if(candidate.contextStatus==='needs-context'&&!contextConfirmed)throw new Error('请先补核跨页语境与引语归属，再明确采纳。');
    const existing=data?.text===text&&data.passages?.find(a=>a.status==='active'&&a.candidateId===candidate.id&&a.start===candidate.start&&a.end===candidate.end);
    next=existing?structuredClone(validateAnnotations(data)):addAnnotation(data,text,candidate.start,candidate.end,by,at);
    const passage=existing?next.passages.find(a=>a.id===existing.id):next.passages.at(-1);
    Object.assign(passage,{candidateId:candidate.id,category:candidate.category,contextNote:candidate.note,contextStatus:'complete',originalContextStatus:candidate.contextStatus,origin:'ai-reviewed',updatedAt:at,...(contextConfirmed?{contextVerifiedBy:by.trim(),contextVerifiedAt:at}:{})});
    next.completion=null;
  } else {
    next=data?structuredClone(validateAnnotations(data)):{version:1,text,passages:[],events:[],completion:null};
    if(next.text!==text)throw new Error('旧标注对应另一正文版本，请先重新定位或撤销旧标注。');
    next.completion=null;
  }
  const previous=next.candidateReview;
  next.candidateReview={revision,sourceRevision,decisions:previous?.revision===revision&&previous.sourceRevision===sourceRevision?{...previous.decisions}:{}};
  next.candidateReview.decisions[candidate.id]={decision,by:by.trim(),at};
  next.events.push({action:`candidate-${decision}`,id:candidate.id,by:by.trim(),at,revision,sourceRevision});
  return next;
}

export function annotationDisplayRanges(manual,candidates) {
  const result=[...manual];
  for(const c of candidates) {
    let spans=[{start:c.start,end:c.end,type:'suggested'}];
    for(const m of manual)spans=spans.flatMap(s=>m.end<=s.start||m.start>=s.end?[s]:[
      ...(s.start<m.start?[{...s,end:m.start}]:[]),...(s.end>m.end?[{...s,start:m.end}]:[]),
    ]);
    result.push(...spans);
  }
  return result.sort((a,b)=>a.start-b.start);
}

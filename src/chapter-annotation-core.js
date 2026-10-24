import {validateProgress} from './delivery-core.js?v=release-20261022';
import {annotationReading} from './annotation-reading.js?v=release-20261022';
import {addAnnotation,annotationView,validateAnnotations} from './theory-annotations.js?v=release-20261022';
import {deleteDefaultAnnotation} from './reviewed-annotation.js?v=member5-mark45-20261023';
import {chapterFragmentView} from './annotation-chapters.js?v=member5-mark45-20261023';
export const chapterProgressKey='shulun-chapter-annotation-v1';
export const emptyChapterProgress=()=>({format:'shulun-chapter-progress',version:1,person:'',lastChapterId:'',savedAt:'',pages:{},confirmations:{},events:[]});
const sourcePage=item=>item?.humanReviewed||item;
const legacyText=(legacy,part,page)=>JSON.stringify(legacy[part]?.reviews?.[page]?.theoryAnnotations??null);
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const boundary=(text,n)=>!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));
const rangeOK=(p,s)=>Boolean(p)&&Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.start>=0&&s.end>s.start&&s.end<=p.text.length&&boundary(p.text,s.start)&&boundary(p.text,s.end)&&s.quote===p.text.slice(s.start,s.end)&&s.textSha256===p.source.textSha256&&s.part===p.part&&s.page===p.page;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function resolvedChapterLegacy(legacy,state){
 const result={};
 for(const n of [1,2,3,4]){
  const archive=state.legacyArchive?.[n],local=legacy[n]||{version:1,part:n,person:'',reviews:{}};
  if(archive)validateProgress(archive);
  const reviews={...(archive?.reviews||{})};
  for(const [page,review] of Object.entries(local.reviews)){if(reviews[page]?.theoryAnnotations&&review.theoryAnnotations&&JSON.stringify(reviews[page].theoryAnnotations)!==JSON.stringify(review.theoryAnnotations))throw new Error('备份与本机旧标注在同一来源上不同，未覆盖；请保留两个备份后核对。');reviews[page]={...(reviews[page]||{}),...review};}
  result[n]={...(archive||local),...local,reviews,person:local.person||archive?.person||''};
 }
 return result;
}
export function chapterBackupState(state,legacy){return {...structuredClone(state),legacyArchive:structuredClone(resolvedChapterLegacy(legacy,state))};}
export function validateChapterProgress(value,byPage){
 if(value?.format!=='shulun-chapter-progress'||value.version!==1||typeof value.person!=='string'||typeof value.lastChapterId!=='string'||typeof value.savedAt!=='string'||!object(value.pages)||!object(value.confirmations)||!Array.isArray(value.events))throw new Error('请选择整章标注进度JSON，原记录未改变。');
 if(value.legacyChapterArchives){if(!Array.isArray(value.legacyChapterArchives)||value.legacyChapterArchives.some(raw=>typeof raw!=='string'))throw new Error('旧整章记录归档无效。');for(const raw of value.legacyChapterArchives)validateChapterProgress(JSON.parse(raw));}
 if(value.legacyArchive){if(!object(value.legacyArchive))throw new Error('原记录归档无效。');for(const n of [1,2,3,4]){validateProgress(value.legacyArchive[n]);if(value.legacyArchive[n].part!==n)throw new Error('原记录归档分份不匹配。');}}
 for(const [key,s] of Object.entries(value.pages)){
  if(!/^\d+$/.test(key)||String(s?.page)!==key||![1,2,3,4].includes(s.part)||!/^([a-f0-9]{64})$/.test(s.textSha256)||typeof s.legacyAnnotations!=='string')throw new Error('整章标注的来源记录无效。');
  const before=JSON.parse(s.legacyAnnotations);if(before)validateAnnotations(before);validateAnnotations(s.data);
  if(byPage){const p=sourcePage(byPage.get(s.page));if(!p?.eligible||p.part!==s.part||p.source.textSha256!==s.textSha256||s.data.text!==p.text)throw new Error('整章记录与当前人工审核TXT不匹配，原备份保留。');}
 }
 const ids=new Set();for(const e of value.events){if(!e?.id||ids.has(e.id)||!['add','delete','confirm','restore'].includes(e.action)||typeof e.chapterId!=='string'||typeof e.by!=='string'||!e.by.trim()||!Number.isFinite(Date.parse(e.at))||!Array.isArray(e.spans))throw new Error('整章操作历史无效。');ids.add(e.id);for(const s of e.spans){if(!Number.isInteger(s.page)||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.end<=s.start||typeof s.quote!=='string')throw new Error('整章历史范围无效。');if(byPage&&!rangeOK(sourcePage(byPage.get(s.page)),s))throw new Error('整章历史与原审核正文不匹配。');}}
 for(const [key,c] of Object.entries(value.confirmations))if(!key||!c||!/^([a-f0-9]{64})$/.test(c.signature)||!c.by?.trim()||!Number.isFinite(Date.parse(c.at))||c.scope!=='available-chapter')throw new Error('章节确认记录无效。');
 return value;
}
export function readChapterProgress(storage,byPage,key=chapterProgressKey){const raw=storage.getItem(key);return {raw,value:raw===null?emptyChapterProgress():validateChapterProgress(JSON.parse(raw),byPage)};}
export function saveChapterProgress(storage,value,expectedRaw,byPage,key=chapterProgressKey){validateChapterProgress(value,byPage);if(storage.getItem(key)!==expectedRaw)throw new Error('另一标签页已更新整章标注，请重新读取后重选；本次未覆盖。');const raw=JSON.stringify(value);storage.setItem(key,raw);return raw;}
export function effectiveChapterProgress(legacy,chapterState,byPage){
 legacy=resolvedChapterLegacy(legacy,chapterState);
 const effective=Object.fromEntries([1,2,3,4].map(n=>[n,{...(legacy[n]||{version:1,part:n,person:'',reviews:{}}),reviews:{...(legacy[n]?.reviews||{})}}]));
 for(const s of Object.values(chapterState.pages)){
  const p=sourcePage(byPage.get(s.page));if(!p?.eligible||p.source.textSha256!==s.textSha256||p.text!==s.data.text)throw new Error('章内标注与审核正文版本不同，已停止套用。');
  if(legacyText(legacy,s.part,s.page)!==s.legacyAnnotations)throw new Error('原有标注已在其他入口变化，请先保留整章备份并核对，未覆盖旧记录。');
  effective[s.part].reviews[s.page]={...effective[s.part].reviews[s.page],theoryAnnotations:s.data};
 }
 return effective;
}
export function chapterRuns(chapter,byPage,effective){
 const events=[...chapter.fragments.map(f=>({page:f.page,f})),...chapter.gaps.map(g=>({page:g.page,g}))].sort((a,b)=>a.page-b.page),runs=[];
 for(const event of events){if(event.g){runs.push({kind:'gap',gap:event.g});continue;}const f=event.f,p=sourcePage(byPage.get(f.page)),reading=annotationReading(p.text),view=chapterFragmentView(f,byPage,effective);
  for(const b of view.blocks){const visibleStart=reading.visibleOffset(b.start),visibleEnd=reading.visibleOffset(b.end);if(visibleEnd<=visibleStart)continue;runs.push({kind:'text',id:'run-'+f.page+'-'+b.start+'-'+b.end,page:f.page,part:f.part,start:b.start,end:b.end,role:b.role,text:b.text,html:b.html.slice(0,-1),visibleStart,visibleEnd,reading,textSha256:f.textSha256});}
 }
 return runs;
}
export function mapChapterSelection(runs,firstId,firstOffset,lastId,lastOffset,byPage){
 const a=runs.findIndex(r=>r.id===firstId),z=runs.findIndex(r=>r.id===lastId);if(a<0||z<a)throw new Error('请在本章正文内重新选中文字。');
 const selected=runs.slice(a,z+1);if(selected.some(r=>r.kind==='gap'))throw new Error('选区跨过未审核正文缺口，请分段标注。');
 const spans=[];
 for(let i=a;i<=z;i++){const r=runs[i],x=i===a?firstOffset:0,y=i===z?lastOffset:r.text.length;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<x||y>r.text.length)throw new Error('正文选区已失效，请重新选择。');if(x===y)continue;
  const p=sourcePage(byPage.get(r.page)),start=Math.max(r.start,r.reading.sourceStart(r.visibleStart+x)),end=Math.min(r.end,r.reading.sourceEnd(r.visibleStart+y));if(end<=start||!p.text.slice(start,end).trim())continue;const span={page:r.page,part:r.part,start,end,quote:p.text.slice(start,end),textSha256:p.source.textSha256};if(!rangeOK(p,span))throw new Error('选区切断了完整字符，请重新选择。');
  const previous=spans.at(-1);if(previous?.page===span.page&&previous.end===span.start){previous.end=span.end;previous.quote=p.text.slice(previous.start,previous.end);}else spans.push(span);
 }
 if(!spans.length)throw new Error('请先选中属于书论的文字。');return spans;
}
function uncovered(start,end,ranges){let pieces=[{start,end}];for(const r of ranges)pieces=pieces.flatMap(s=>r.end<=s.start||r.start>=s.end?[s]:[{start:s.start,end:Math.min(s.end,r.start)},{start:Math.max(s.start,r.end),end:s.end}].filter(t=>t.end>t.start));return pieces;}
export function applyChapterSelection(state,chapter,spans,type,by,legacy,byPage,at=new Date().toISOString()){
 if(!by.trim())throw new Error('请先填写真实姓名。');if(!['add','delete'].includes(type)||!spans.length)throw new Error('没有可用选区。');
 legacy=resolvedChapterLegacy(legacy,state);
 const effective=effectiveChapterProgress(legacy,state,byPage),next=structuredClone(state);
 for(const s of spans){const p=sourcePage(byPage.get(s.page)),f=chapter.fragments.find(f=>f.page===s.page&&f.start<=s.start&&f.end>=s.end);if(!p||!f||!rangeOK(p,s))throw new Error('选区超出当前章节或正文版本已改变。');
  let data=next.pages[s.page]?.data??effective[s.part]?.reviews?.[s.page]?.theoryAnnotations;
  if(type==='delete'){const item={page:p.page,humanReviewed:{...p,revision:p.annotationRevision,integrityChecked:true}};data=deleteDefaultAnnotation(item,data,{...p.source,text:p.text},s.start,s.end,by,at);}
  else{for(const r of uncovered(s.start,s.end,annotationView(data,p.text).ranges))if(p.text.slice(r.start,r.end).trim())data=addAnnotation(data,p.text,r.start,r.end,by,at);}
  if(data)next.pages[s.page]={page:s.page,part:s.part,textSha256:p.source.textSha256,legacyAnnotations:legacyText(legacy,s.part,s.page),data};
 }
 next.person=by.trim();next.lastChapterId=chapter.id;next.savedAt=at;next.events.push({id:crypto.randomUUID(),action:type,chapterId:chapter.id,by:by.trim(),at,spans:structuredClone(spans)});delete next.confirmations[chapter.id];return next;
}
export async function chapterSignature(chapter,byPage,legacy,state){
 const effective=effectiveChapterProgress(legacy,state,byPage);
 return hash(JSON.stringify({id:chapter.id,fragments:chapter.fragments.map(f=>{const p=sourcePage(byPage.get(f.page));const view=chapterFragmentView(f,byPage,effective);return [f.page,f.start,f.end,f.textSha256,p.candidates.filter(c=>c.start<f.end&&c.end>f.start),view.manualRanges.map(r=>[r.overlapStart,r.overlapEnd,r.overlapQuote]),view.aiCandidates.map(c=>[c.id,c.remaining.map(r=>[Math.max(r.start,f.start),Math.min(r.end,f.end)]).filter(([a,z])=>a<z)]),view.pendingAnnotations];}),gaps:chapter.gaps}));
}
export async function confirmChapter(state,chapter,by,legacy,byPage,at=new Date().toISOString()){
 if(!by.trim())throw new Error('请先填写真实姓名。');if(!chapter.fragments.length)throw new Error('本章尚无合格人工审核正文，不能确认。');
 effectiveChapterProgress(legacy,state,byPage);
 const next=structuredClone(state);next.confirmations[chapter.id]={signature:await chapterSignature(chapter,byPage,legacy,state),by:by.trim(),at,scope:'available-chapter',hasGaps:Boolean(chapter.gaps.length)};next.person=by.trim();next.lastChapterId=chapter.id;next.savedAt=at;next.events.push({id:crypto.randomUUID(),action:'confirm',chapterId:chapter.id,by:by.trim(),at,spans:[]});return next;
}
export async function chapterIsConfirmed(chapter,byPage,legacy,state){const c=state.confirmations[chapter.id];return Boolean(c&&c.signature===await chapterSignature(chapter,byPage,legacy,state));}
export function mergeChapterBackup(current,incoming,byPage){
 validateChapterProgress(incoming,byPage);const next=structuredClone(current);
 if(incoming.legacyChapterArchives)next.legacyChapterArchives=[...new Set([...(next.legacyChapterArchives||[]),...incoming.legacyChapterArchives])];
 if(incoming.legacyArchive)next.legacyArchive=resolvedChapterLegacy(current.legacyArchive||{},incoming);
 for(const [key,value] of Object.entries(incoming.pages)){if(next.pages[key]&&JSON.stringify(next.pages[key])!==JSON.stringify(value))throw new Error('本机与备份在同一来源上有不同章内标注，未自动覆盖；请保留两个备份后核对。');next.pages[key]=value;}
 const events=new Map(next.events.map(e=>[e.id,e]));for(const e of incoming.events){if(events.has(e.id)&&JSON.stringify(events.get(e.id))!==JSON.stringify(e))throw new Error('同编号历史内容不同，未恢复。');events.set(e.id,e);}next.events=[...events.values()];
 for(const [id,c] of Object.entries(incoming.confirmations))if(!next.confirmations[id]||Date.parse(c.at)>Date.parse(next.confirmations[id].at))next.confirmations[id]=c;
 if(!next.person)next.person=incoming.person;if(!next.lastChapterId)next.lastChapterId=incoming.lastChapterId;next.savedAt=new Date().toISOString();return next;
}

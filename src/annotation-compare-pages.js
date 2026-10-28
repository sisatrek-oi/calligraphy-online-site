import {comparisonNeedsReview} from './annotation-compare-core.js?v=page-review-20261028';

export const pageCompareKey=revision=>'shulun-wolai-page-recheck-v1:'+revision;
export const pageTaskId=page=>'P'+String(page).padStart(6,'0');

// Use the complete source page, including unchanged context; difference chunks are only hints.
export function pageComparison(corpus,legacy){
 const groups=new Map(),aliases=new Map(),tasks=[];
 for(const item of corpus.data.items){
  if(item.page!==null){let group=groups.get(item.page);if(!group)groups.set(item.page,group=[]);group.push(item);aliases.set(item.id,pageTaskId(item.page));}
  else if(comparisonNeedsReview(item))tasks.push({...item,kinds:[item.kind],workIds:[item.workId],differences:[item],legacy:legacy.records[item.id]?[{item,record:legacy.records[item.id]}]:[],conflicts:[]});
 }
 for(const [page,all] of groups){
  const differences=all.filter(comparisonNeedsReview);if(!differences.length)continue;
  const p=corpus.pages.get(page),works=[...new Map(all.map(i=>[i.workId,i.work])).entries()],records=all.map(i=>({item:i,record:legacy.records[i.id]})).filter(x=>x.record);
  const edits=records.filter(({record:r})=>r.choice==='custom'||r.choice==='reference'||r.choice==='defer'&&Object.hasOwn(r,'draftText')).map(({item:i,record:r})=>({id:i.id,start:i.localDisplayStart,end:i.localDisplayEnd,text:r.choice==='defer'?r.draftText:r.replacement}));
  const conflicts=edits.filter((a,n)=>edits.some((b,m)=>n!==m&&(a.start===b.start||a.start<b.end&&b.start<a.end)));
  let initial=p.display;
  for(const e of edits.filter(e=>!conflicts.includes(e)).sort((a,b)=>b.start-a.start))initial=initial.slice(0,e.start)+e.text+initial.slice(e.end);
  const first=differences[0];
  tasks.push({...first,id:pageTaskId(page),page,kind:differences.some(i=>i.referenceId)?'han':'unaligned',kinds:[...new Set(differences.map(i=>i.kind))],workId:(works.find(w=>w[0])||works[0])[0],work:works.map(w=>w[1]).join(' / '),works,workIds:works.map(w=>w[0]),sourceStart:0,sourceEnd:p.text.length,original:p.text,local:p.display,localDisplayStart:0,localDisplayEnd:p.display.length,referenceId:null,referenceSha256:null,referenceStart:0,referenceEnd:0,reference:'',boundary:false,initial,differences,legacy:records,conflicts,referenceIds:[...new Set(all.map(i=>i.referenceId).filter(Boolean))]});
 }
 tasks.sort((a,b)=>(a.page??Infinity)-(b.page??Infinity)||a.id.localeCompare(b.id));
 return {...corpus,pageModel:true,legacyCorpus:corpus,aliases,items:new Map(tasks.map(i=>[i.id,i])),data:{...corpus.data,items:tasks}};
}

export function pageEditorText(item,record){
 return record?.choice==='custom'?record.replacement:record?.choice==='defer'&&Object.hasOwn(record,'draftText')?record.draftText:item.page!==null?(record?.choice==='manual'?item.local:item.initial):item.local;
}
export const pageInWork=(item,work)=>item.workIds.includes(work);
export const pageHasKind=(item,kind)=>kind==='all'||item.kinds.includes(kind);

// Unlocated tasks retain their existing decisions; fragment decisions never confirm a physical page.
export function initialPageState(revision,model,legacy){
 const records=Object.fromEntries(Object.entries(legacy.records).filter(([id])=>model.items.get(id)?.page===null));
 return {format:'pdf-page-recheck',version:1,revision,records,events:legacy.events.filter(e=>model.items.get(e.id)?.page===null)};
}

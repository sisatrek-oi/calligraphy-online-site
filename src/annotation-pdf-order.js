import {pdfReadingOrder as order} from './annotation-pdf-order-data.js';
export const pdfOrderRevision=order.revision;
export function pdfChapterIndex(source){
 if(source.structureRevision===order.revision||source.batch!=='wolai-standard-20261022')return source;
 const chapters=source.chapters.map(c=>({...c,title:order.titles[c.id]||c.title,fragments:[],pdfSections:order.sections[c.id]||[],pdfBoundary:order.physicalChapters.find(w=>w.chapter===c.id)||null})),byId=new Map(chapters.map(c=>[c.id,c]));
 for(const c of source.chapters)for(const f of c.fragments){
  const changes=order.transfers.filter(t=>t.source===f.page&&t.start<f.end&&t.end>f.start);if(changes.length&&order.plans[f.page]?.sha256!==f.textSha256)throw Error('篇界映射与审核版本不匹配，原记录保留。');const cuts=[...new Set([f.start,f.end,...changes.flatMap(t=>[Math.max(f.start,t.start),Math.min(f.end,t.end)])])].sort((a,b)=>a-b);
  for(let i=0;i<cuts.length-1;i++){const start=cuts[i],end=cuts[i+1],target=byId.get(changes.find(t=>t.start<=start&&t.end>=end)?.chapter||c.id),blocks=f.blocks.filter(b=>b.start<end&&b.end>start).map(b=>({...b,start:Math.max(start,b.start),end:Math.min(end,b.end)})),previous=target.fragments.at(-1);
   if(previous?.page===f.page&&previous.end===start){previous.end=end;previous.blocks.push(...blocks);}else target.fragments.push({...f,start,end,blocks});
  }
 }
 const pageToChapters={};for(const c of chapters){c.fragments.sort((a,b)=>a.page-b.page||a.start-b.start);c.candidateCount=c.fragments.reduce((n,f)=>n+f.blocks.filter(b=>b.role==='theory').length,0);for(const f of c.fragments)(pageToChapters[f.page]??=[]).push({id:c.id,start:f.start});}
 for(const n of Object.keys(pageToChapters))pageToChapters[n]=pageToChapters[n].sort((a,b)=>a.start-b.start).map(r=>r.id);
 return {...source,chapters,pageToChapters,allocationWeights:Object.fromEntries(source.chapters.map(c=>[c.id,c.fragments.reduce((n,f)=>n+f.end-f.start,0)])),structureRevision:order.revision};
}
export const hasPdfPlan=f=>Boolean(order.plans[f.page]&&order.plans[f.page].sha256===f.textSha256);
export function pdfSourceBlocks(f){
 const plan=order.plans[f.page],pieces=plan&&plan.sha256===f.textSha256?plan.pieces:null,result=[];
 for(const b of [...(f.blocks||[{start:f.start,end:f.end,role:'theory'}])].sort((a,b)=>a.start-b.start)){
  if(!pieces){result.push({...b,pdf:f.page<20001?{page:f.page,start:b.start,end:b.end,status:'exact'}:null});continue;}
  for(const [a,z,page,start,end,status] of pieces)if(a<b.end&&z>b.start)result.push({...b,sourceBlockStart:b.sourceBlockStart??b.start,start:Math.max(a,b.start),end:Math.min(z,b.end),pdf:page===null?null:{page,start,end,status,unit:status==='scan-checked'?'scan-passage-order':'UTF-16-ref'},parallel:status.startsWith('parallel')});
 }
 return result;
}
export function pdfEventOrder(a,b){const x=a.pdf,y=b.pdf;return Number(Boolean(a.parallel))-Number(Boolean(b.parallel))|| (x?0:1)-(y?0:1)||(x&&y?(x.page-y.page||x.start-y.start):0)||(a.f?.page||0)-(b.f?.page||0)||(a.f?.start||0)-(b.f?.start||0);}
export function chapterReadingEvents(chapter){
 const events=chapter.fragments.flatMap(f=>pdfSourceBlocks(f).filter(b=>!b.decoration).map(b=>({f:{...f,start:b.start,end:b.end,blocks:[b]},pdf:b.pdf,parallel:b.parallel})));
 for(const g of chapter.gaps||[])events.push({g,pdf:{page:g.page,start:0,end:0,status:'gap'}});
 events.sort(pdfEventOrder);let previous=null,between=[];
 for(const e of events){if(!e.f){previous=null;between=[];continue;}if(e.f.blocks[0]?.category==='段落分隔'){between.push(e);continue;}
  if(previous&&e.parallel===previous.parallel&&Boolean(e.pdf)===Boolean(previous.pdf)){
   const a=previous.f,b=e.f,withinBlock=a.page===b.page&&a.end===b.start&&a.blocks[0]?.sourceBlockStart===b.blocks[0]?.sourceBlockStart,sourceJoin=order.flowJoins.some(([p,z,q,x])=>a.page===p&&a.end===z&&b.page===q&&b.start===x);
   if(withinBlock||sourceJoin){previous.flowJoined=true;e.flowJoined=true;for(const gap of between)gap.hideGeneratedGap=true;}
  }previous=e;between=[];
 }return events;
}
export function mappedSourcePages(chapter,page){return [...new Set(chapterReadingEvents(chapter).filter(e=>e.f?.page===page&&e.pdf).map(e=>e.pdf.page))].sort((a,b)=>a-b);}

export function chapterReferencePages(chapter){const mapped=chapterReadingEvents(chapter).filter(e=>e.pdf).map(e=>e.pdf.page),boundary=chapter.pdfBoundary;if(boundary){const last=boundary.end[0]-(boundary.end[1]===0?1:0);if(last-boundary.start[0]<1052)for(let n=boundary.start[0];n<=last&&n<=1052;n++)mapped.push(n);}return [...new Set(mapped)].sort((a,b)=>a-b);}

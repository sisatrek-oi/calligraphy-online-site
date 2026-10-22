// Printed volume labels and in-chapter lists are not separate annotation tasks.
export function chapterTaskUnits(source,byPage){
 const result=[],aliases={};
 const merge=(target,child)=>{
  target.sourceChapterIds.push(...child.sourceChapterIds);for(const id of child.sourceChapterIds)aliases[id]=target.id;
  target.end=child.end;target.gaps=[...new Map([...target.gaps,...child.gaps].map(g=>[g.page,g])).values()].sort((a,b)=>a.page-b.page);
  const fs=[];for(const f of [...target.fragments,...child.fragments].sort((a,b)=>a.page-b.page||a.start-b.start)){
   const prev=fs.at(-1);if(prev?.page===f.page&&prev.end===f.start){prev.end=f.end;prev.blocks.push(...f.blocks);}else fs.push(structuredClone(f));
  }
  for(const f of fs){const p=byPage.get(f.page)?.humanReviewed||byPage.get(f.page);f.candidateCount=p.candidates.filter(c=>c.start<f.end&&c.end>f.start).length;}
  target.fragments=fs;target.candidateCount=fs.reduce((n,f)=>n+f.candidateCount,0);
 };
 const raw=source.chapters.map(c=>({...structuredClone(c),sourceChapterIds:[c.id]}));
 for(let i=0;i<raw.length;i++){
  const c=raw[i],previous=result.at(-1),next=raw[i+1];
  if(c.workId==='work-162'&&['吴碑','晋碑','神品'].includes(c.title)&&previous?.workId===c.workId){merge(previous,c);continue;}
  const volumeLabel=c.level==='volume'&&c.fragments.every(f=>f.blocks.every(b=>b.role==='structure'));
  if(volumeLabel&&next?.workId===c.workId){
   const combined={...c,id:next.id,title:next.title,level:next.level,volumeTitle:next.volumeTitle,boundaryStatus:next.boundaryStatus,sourceChapterIds:[...c.sourceChapterIds]};
   merge(combined,next);combined.sourceChapterIds=[...new Set(combined.sourceChapterIds)];raw[i+1]=combined;for(const id of combined.sourceChapterIds)aliases[id]=combined.id;continue;
  }
  result.push(c);for(const id of c.sourceChapterIds)aliases[id]=c.id;
 }
 // Original scans 443 and 460 show these headings; neither page has admitted TXT.
 // No OCR or model body is imported here. Shared missing pages stay gaps in both sections.
 const book=result.findIndex(c=>c.workId==='work-123'&&c.title==='书要篇');
 if(book>=0&&!result.some(c=>c.workId==='work-123'&&c.title==='古学篇')){
  const c=result[book];
  if([443,460].some(n=>(byPage.get(n)?.humanReviewed||byPage.get(n))?.eligible))throw new Error('新准入文本涉及衍极篇界，请先核对443与460来源的精确篇题位置。');
  const point=page=>({page,offset:null,pendingTextAnchor:true});
  const make=(id,title,volume,start,end,lo,hi)=>{
   const fragments=c.fragments.filter(f=>f.page>=lo&&f.page<hi),gaps=c.gaps.filter(g=>g.page>=lo&&g.page<=hi);
   return {...structuredClone(c),id,title,volumeTitle:volume,start,end,fragments,gaps,candidateCount:fragments.reduce((n,f)=>n+f.candidateCount,0),boundaryStatus:'原扫描443／460页篇题已核对；篇题所在页未准入，页内TXT坐标待人工审核。',sourceChapterIds:[...c.sourceChapterIds]};
  };
  const first=make(c.id,c.title,c.volumeTitle,c.start,point(443),0,443),third=make('work-123-original-p443','造书篇','衍极卷三',point(443),point(460),443,460),fourth=make('work-123-original-p460','古学篇','衍极卷四',point(460),c.end,460,Infinity);
  result.splice(book,1,first,third,fourth);aliases[third.id]=third.id;aliases[fourth.id]=fourth.id;
 }
 const works=source.works.map(w=>({...w,chapters:result.filter(c=>c.workId===w.id).map(c=>c.id)})),pageToChapters={};for(const c of result)for(const f of c.fragments)(pageToChapters[f.page]??=[]).push(c.id);
 return {...source,revision:source.revision+':whole-chapter-v1',works,chapters:result,pageToChapters,chapterAliases:aliases,note:'按原章节标注；纯卷题及章内碑目保留在章内，原审核TXT及原始章节索引不改。'};
}

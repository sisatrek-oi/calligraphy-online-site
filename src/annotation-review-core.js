import {annotationReading} from './annotation-reading.js?v=release-20261022';
import {proposeStructure,deriveStructure} from './annotation-structure-core.js?v=loading-20261028';

export const reviewIssueTypes={missing:'漏页／漏文',text:'文字有误',context:'上下文不衔接',source:'原图定位不对应',other:'其他疑点'};
export function reviewPdfPages(chapter,byPage){
 return [...new Set(chapter.fragments.flatMap(f=>f.page<20001?[f.page]:(byPage.get(f.page)?.source.originalPages||[])))].sort((a,b)=>a-b);
}
export function pageRanges(pages){
 const ranges=[];for(const n of [...new Set(pages)].sort((a,b)=>a-b)){const last=ranges.at(-1);if(last&&last[1]+1===n)last[1]=n;else ranges.push([n,n]);}
 return ranges.map(([a,b])=>a===b?String(a):`${a}—${b}`).join('、');
}
export function reviewRuns(chapter,byPage){
 return chapter.fragments.map((f,n)=>{const p=byPage.get(f.page),reading=annotationReading(p.text),visibleStart=reading.visibleOffset(f.start);return {id:'review-'+n,page:f.page,start:f.start,end:f.end,textSha256:p.source.textSha256,visibleStart,text:reading.text.slice(visibleStart,reading.visibleOffset(f.end))};});
}
// These are hints already present in the source/feedback, not new text corrections.
export function reviewIssues(chapter,byPage,feedback={items:[]}){
 const issues=[],seen=new Set();
 const add=i=>{const id=[i.kind,i.page,i.start,i.end,i.detail].join(':');if(!seen.has(id)){seen.add(id);issues.push({...i,id});}};
 for(const gap of chapter.gaps||[])add({kind:'gap',scope:'gap',page:gap.page,label:'缺文待核',detail:(gap.reasons||[]).join('；')||'来源正文尚未开放，可先继续核对其他内容。'});
 for(const f of chapter.fragments){
  const p=byPage.get(f.page),common={page:f.page,textSha256:p.source.textSha256};
  for(const note of p.contextNotes||[])if(/疑|缺[文页口字]|待核|尚未|未准入|未核|未回图|暂未|保留原录/u.test(note))add({...common,scope:'source',kind:'source',start:f.start,end:f.end,label:'来源待核',detail:note});
  if(f.page>=20001&&!p.source.originalPages?.length)add({...common,scope:'source',kind:'location',start:f.start,end:f.end,label:'原图待定位',detail:'此TXT暂无可靠PDF定位，可先阅读正文或手动查看原图。'});
  for(const s of [...(p.segments||[]),...(p.candidates||[])]){
   if(s.role!=='pending'&&(!s.contextStatus||s.contextStatus==='complete'))continue;
   const start=Math.max(f.start,s.start),end=Math.min(f.end,s.end);if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start)continue;
   add({...common,start,end,scope:'range',kind:'context',label:s.role==='pending'?'内容待核':'上下文待核',detail:s.note||'已有待核标记，可先略过，稍后集中核对。'});
  }
  for(const match of p.text.slice(f.start,f.end).matchAll(/[□\uFFFD]+/gu))add({...common,start:f.start+match.index,end:f.start+match.index+match[0].length,scope:'range',kind:'character',label:'缺字待核',detail:'原TXT中的缺字／替代字符占位保留，待回图核对。'});
 }
 for(const item of feedback.items||[]){
  if(item.action!=='note'||item.status!=='pending')continue;
  const spans=item.proposal?.reviewContext?.spans?.length?item.proposal.reviewContext.spans:[item.anchor];
  for(const s of spans){const p=byPage.get(s?.page);if(!p||p.source.textSha256!==s.textSha256||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end<s.start||s.end>p.text.length||p.text.slice(s.start,s.end)!==s.quote)continue;
   for(const f of chapter.fragments){if(s.page!==f.page||s.start<f.start||s.start>=f.end)continue;const end=Math.min(s.end,f.end);add({kind:'feedback',scope:end>s.start?'range':'source',page:s.page,start:s.start,end:end>s.start?end:f.end,textSha256:s.textSha256,label:'已记待核',detail:item.comment,itemId:item.id});}
  }
 }
 return issues;
}
export function reviewDecorations(run,page,issues){
 const boundary=(n,end=false)=>n>0&&n<run.text.length&&/[\uD800-\uDBFF]/u.test(run.text[n-1])&&/[\uDC00-\uDFFF]/u.test(run.text[n])?n+(end?1:-1):n;
 const reading=annotationReading(page.text),ranges=issues.filter(i=>i.scope==='range'&&i.page===run.page&&i.textSha256===run.textSha256&&i.start<run.end&&i.end>run.start).map(i=>({...i,lo:boundary(Math.max(0,reading.visibleOffset(i.start)-run.visibleStart)),hi:boundary(Math.min(run.text.length,reading.visibleOffset(i.end)-run.visibleStart),true)})).filter(i=>i.hi>i.lo);
 const points=[...new Set([0,run.text.length,...ranges.flatMap(i=>[i.lo,i.hi])])].sort((a,b)=>a-b);
 return points.slice(0,-1).map((lo,n)=>{const hi=points[n+1],at=ranges.filter(i=>i.lo<hi&&i.hi>lo);return {text:run.text.slice(lo,hi),issues:at,lo,hi};});
}
export function reviewDomSelection(editor,runs,byPage,selection=window.getSelection()){
 if(!selection||selection.rangeCount!==1||selection.isCollapsed)return null;
 const range=selection.getRangeAt(0);if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer))return null;
 // Feedback may span a missing page; only the actually displayed, approved text
 // receives source coordinates. A gap is never filled or admitted by selection.
 const closest=n=>(n.nodeType===1?n:n.parentElement)?.closest('[data-review-run]'),a=closest(range.startContainer),z=closest(range.endContainer);
 if(!a||!z)throw new Error('请在TXT正文内重新选文。');
 const first=runs.findIndex(r=>r.id===a.dataset.reviewRun),last=runs.findIndex(r=>r.id===z.dataset.reviewRun);if(first<0||last<first)throw new Error('选区已失效，请重新选择。');
 const offset=(el,node,n)=>{const r=document.createRange();r.selectNodeContents(el);r.setEnd(node,n);return r.toString().length;};
 return runs.slice(first,last+1).map((run,n)=>{
  const el=editor.querySelector(`[data-review-run="${run.id}"]`);if(el.textContent!==run.text)throw new Error('TXT显示内容已变化，请重新载入。');
  const p=byPage.get(run.page),reading=annotationReading(p.text),lo=n===0?offset(a,range.startContainer,range.startOffset):0,hi=first+n===last?offset(z,range.endContainer,range.endOffset):run.text.length;
  const start=Math.min(run.end,Math.max(run.start,reading.sourceStart(run.visibleStart+lo))),end=Math.min(run.end,reading.sourceEnd(run.visibleStart+hi));
  return {page:run.page,start,end,quote:p.text.slice(start,end),textSha256:run.textSha256};
 }).filter(s=>s.end>s.start);
}
export function proposeReviewNote(state,corpus,{chapter,spans=[],anchorSource,scanPage,type,comment,by}){
 if(!Object.hasOwn(reviewIssueTypes,type))throw new Error('请选择问题类型。');
 if(scanPage!==null&&(!Number.isInteger(scanPage)||scanPage<1||scanPage>=20001))throw new Error('当前PDF页码无效。');
 if(!String(comment).trim()||comment.length>3500)throw new Error('请填写问题说明（不超过3500字）。');
 for(const s of spans){const p=corpus.byPage.get(s.page);if(!p||p.source.textSha256!==s.textSha256||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start<0||s.end<=s.start||s.end>p.text.length||p.text.slice(s.start,s.end)!==s.quote||!chapter.fragments.some(f=>s.page===f.page&&s.start>=f.start&&s.end<=f.end))throw new Error('所选文字与当前TXT来源不匹配，请重新选文。');}
 const f=anchorSource&&!spans.length?chapter.fragments.find(f=>f.page===anchorSource.page&&anchorSource.start>=f.start&&anchorSource.start<f.end):chapter.fragments[0];
 if(anchorSource&&!spans.length&&(!Number.isInteger(anchorSource.page)||!Number.isInteger(anchorSource.start)||!f||corpus.byPage.get(f.page)?.source.textSha256!==anchorSource.textSha256))throw new Error('当前页TXT定位已失效，请重新选择对照页。');
 if(!f)throw new Error('本篇尚无已开放正文，请先记录在有正文的相邻篇目。');
 const start=anchorSource&&!spans.length?anchorSource.start:f.start;
 const first=spans[0]||{page:f.page,start,end:start,quote:'',textSha256:f.textSha256},index=deriveStructure(state,corpus),target=index.chapters.find(c=>c.fragments.some(f=>f.page===first.page&&first.start>=f.start&&first.start<f.end));
 if(!target)throw new Error('反馈定位已不属于当前结构，请从分段与章节入口核对。');
 const part=target.fragments.find(f=>f.page===first.page&&first.start>=f.start&&first.start<f.end),end=Math.min(first.end,part.end),p=corpus.byPage.get(first.page),anchor={...first,end,quote:p.text.slice(first.start,end)};
 return proposeStructure(state,corpus,{action:'note',chapterId:target.id,anchor,proposal:{reviewContext:{kind:'pdf-txt',type,scanPage,chapterId:chapter.id,spans}},comment:`【PDF与TXT核对 · ${reviewIssueTypes[type]} · ${scanPage===null?'PDF位置待定位':'扫描第'+scanPage+'页'}】\n${comment.trim()}`,by});
}

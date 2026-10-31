import {validateChapterIndex} from './annotation-chapters.js?v=loading-20261028';
import {annotationReading} from './annotation-reading.js?v=release-20261022';
import {validateScanRegion} from './scan-region.js';

export const structureActions={
 'split-paragraph':'拆分这一段','merge-paragraph':'与下一段合并',role:'更正段落角色',
 'rename-chapter':'更正章名','split-chapter':'从这里另分一章','merge-chapter':'与同篇下一章合并',
 'move-next':'从这里起归入下一章','move-previous':'这里之前归入上一章',note:'其他问题／暂不确定','missing-text':'TXT缺文',
};
export const missingTextPositions={'chapter':'整章／章内位置不确定','chapter-start':'章首缺文','chapter-end':'章末缺文',before:'所选文字之前缺文',after:'所选文字之后缺文','pdf-region':'PDF框选区域缺文'};
export const feedbackOnly=action=>['note','missing-text'].includes(action);
export const structureRoles={theory:'书论正文',editorial:'编者题解／注释',biography:'生平背景',structure:'篇题／结构',blank:'空白标记',pending:'待核背景'};
export const structureKey=mode=>'shulun-structure-feedback-v1-'+mode;
export const emptyStructureFeedback=(revision,mode)=>({format:'shulun-structure-feedback',version:1,revision,mode,items:[],checks:[],events:[]});
const stamp=c=>JSON.stringify(c);
const sourceStamp=value=>{const c=typeof value==='string'?JSON.parse(value):structuredClone(value);delete c.pdfSections;delete c.pdfBoundary;return JSON.stringify(c);};
const person=value=>{if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>40)throw new Error('请填写1–40字的真实姓名。');return value.trim();};
const title=value=>{if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>120)throw new Error('请填写1–120字的修订章名。');return value.trim();};
const characterBoundary=(text,n)=>!(n>0&&n<text.length&&(/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n])||text[n-1]==='\r'&&text[n]==='\n'));
const source=entry=>entry?.humanReviewed||entry;
const pointIn=(s,f)=>s.page===f.page&&s.start>=f.start&&s.start<f.end;
const anchorIn=(s,f,action)=>pointIn(s,f)&&s.end<=f.end||action==='note'&&s.page===f.page&&s.start===s.end&&s.start===f.end;
function validateAnchor(a,corpus){
 const p=source(corpus.byPage.get(a?.page));
 if(!p?.eligible||!Number.isInteger(a.start)||!Number.isInteger(a.end)||a.start<0||a.end<a.start||a.end>p.text.length||a.textSha256!==p.source.textSha256||a.quote!==p.text.slice(a.start,a.end))throw new Error('定位与当前审核正文／来源版本不同，请重新选文。');
 if(!characterBoundary(p.text,a.start)||!characterBoundary(p.text,a.end))throw new Error('定位切断了完整字符或换行，请重新选择。');
 return a;
}
function validateMissingText(item,chapter,corpus){
 const p=item.proposal;
 if(!Object.hasOwn(missingTextPositions,p?.position))throw Error('请选择缺文位置。');
 for(const n of [p.scanStart,p.scanEnd])if(n!=null&&(!Number.isInteger(n)||n<1||n>1052))throw Error('PDF物理页码须为1—1052。');
 if(p.scanEnd!=null&&(p.scanStart==null||p.scanEnd<p.scanStart))throw Error('PDF结束页码须不小于起始页码。');
 if(p.position==='pdf-region'){
  validateScanRegion(p.pdfRegion);
  if(p.scanStart!==p.pdfRegion.page||p.scanEnd!==p.pdfRegion.page)throw Error('PDF页码与框选原图不一致。');
 }else if(p.pdfRegion!==undefined)throw Error('原图框选与缺文位置不一致。');
 if(['before','after'].includes(p.position)){
  validateAnchor(item.anchor,corpus);
  if(!chapter.fragments.some(f=>anchorIn(item.anchor,f,'note')))throw Error('缺文定位不属于当前章节。');
 }else if(item.anchor!==null)throw Error('章首、章末或整章缺文使用章节定位，请勿附加文字定位。');
}
function validateNoteSelection(item,corpus){
 const context=item.proposal?.reviewContext;if(context?.kind!=='txt-note')return;
 if(item.action!=='note'||context.chapterId!==item.chapterId||!Array.isArray(context.spans)||!context.spans.length||context.spans.length>4000)throw Error('备注选区格式无效。');
 const chapter=JSON.parse(item.before.find(b=>b.id===item.chapterId)?.stamp||'null');
 for(const s of context.spans){validateAnchor(s,corpus);if(s.end<=s.start||!chapter?.fragments.some(f=>pointIn(s,f)&&s.end<=f.end))throw Error('备注选区不属于当前章节。');}
 if(['page','start','end','quote','textSha256'].some(k=>context.spans[0][k]!==item.anchor[k]))throw Error('备注起点与选区不匹配。');
}
export function structureParagraphs(chapter,byPage){
 const result=[];let prefix=[];
 for(const f of chapter.fragments)for(const b of f.blocks){
  const p=source(byPage.get(f.page)),reading=annotationReading(p.text),text=reading.text.slice(reading.visibleOffset(b.start),reading.visibleOffset(b.end));
  const part={...structuredClone(b),page:f.page,part:f.part,textSha256:f.textSha256,text};
  if(!text.trim()&&!b.paragraphKey){if(result.length){result.at(-1).parts.push(part);result.at(-1).text+=text;}else prefix.push(part);continue;}
  const id=b.paragraphKey||`paragraph-${f.page}-${b.start}`,previous=result.at(-1);
  if(previous?.id===id){previous.parts.push(part);previous.text+=text;}
  else {result.push({id,role:b.role,parts:[...prefix,part],text:prefix.map(v=>v.text).join('')+text});prefix=[];}
 }
 if(prefix.length)result.push({id:'empty-'+chapter.id,role:'blank',parts:prefix,text:prefix.map(p=>p.text).join('')});
 return result;
}
function chapterAt(index,id){const c=index.chapters.find(c=>c.id===id);if(!c)throw new Error('该章节已不存在，请重新选择章节。');return c;}
function affected(index,item){
 const c=chapterAt(index,item.chapterId),n=index.chapters.indexOf(c),direction=item.action==='move-previous'?-1:1;
 if(['merge-chapter','move-next','move-previous'].includes(item.action)){
  const neighbor=index.chapters[n+direction];if(!neighbor||neighbor.workId!==c.workId)throw new Error('只能调整同篇的相邻章节；跨篇疑点请记录为其他问题。');
  return [c,neighbor];
 }
 return [c];
}
function rebuild(index,byPage,changedBoundaries=new Set()){
 index.pageToChapters={};
 for(const c of index.chapters){
  const fragments=[];
  for(const f of [...c.fragments].sort((a,b)=>a.page-b.page||a.start-b.start)){
   const last=fragments.at(-1);if(last?.page===f.page&&last.end===f.start){last.end=f.end;last.blocks.push(...f.blocks);}else fragments.push(f);
  }
  c.fragments=fragments;
  for(const f of fragments){const p=source(byPage.get(f.page));f.candidateCount=p.candidates.filter(a=>a.start<f.end&&a.end>f.start).length;(index.pageToChapters[f.page]??=[]).push({id:c.id,start:f.start});}
  c.candidateCount=fragments.reduce((n,f)=>n+f.candidateCount,0);
  if(fragments.length&&changedBoundaries.has(c.id)){c.start={page:fragments[0].page,offset:fragments[0].start};c.end={page:fragments.at(-1).page,offset:fragments.at(-1).end};}
 }
 for(const page of Object.keys(index.pageToChapters))index.pageToChapters[page]=index.pageToChapters[page].sort((a,b)=>a.start-b.start).map(c=>c.id);
 for(const w of index.works)w.chapters=index.chapters.filter(c=>c.workId===w.id).map(c=>c.id);
 return validateChapterIndex(index,byPage);
}
function splitFragments(c,a,byPage){
 const left=[],right=[];
 for(const f of c.fragments){
  if(f.page<a.page||f.page===a.page&&f.end<=a.start){left.push(structuredClone(f));continue;}
  if(f.page>a.page||f.page===a.page&&f.start>=a.start){right.push(structuredClone(f));continue;}
  for(const [lo,hi,target] of [[f.start,a.start,left],[a.start,f.end,right]]){
   const blocks=f.blocks.filter(b=>b.start<hi&&b.end>lo).map(b=>({...b,start:Math.max(lo,b.start),end:Math.min(hi,b.end)}));
   target.push({...structuredClone(f),start:lo,end:hi,blocks});
  }
 }
 if(![left,right].every(fs=>fs.some(f=>source(byPage.get(f.page)).text.slice(f.start,f.end).trim())))throw new Error('拆分点必须位于章内，不能产生空章节。');
 return [left,right];
}
function transform(index,item,corpus){
 const targets=affected(index,item);
 if(targets.length!==item.before.length||targets.some((c,n)=>c.id!==item.before[n].id||sourceStamp(c)!==sourceStamp(item.before[n].stamp)))throw new Error('相关结构已发生变化，请根据当前版本重新提出反馈；原意见保留。');
 const c=targets[0];
 if(item.action==='missing-text'){validateMissingText(item,c,corpus);return index;}
 const a=validateAnchor(item.anchor,corpus),n=index.chapters.indexOf(c),changedBoundaries=new Set();
 if(!c.fragments.some(f=>anchorIn(a,f,item.action)))throw new Error('定位不属于当前章节，请重新选择。');
 if(item.action==='note')return index;
 if(item.action==='rename-chapter'){c.title=title(item.proposal.title);return rebuild(index,corpus.byPage);}
 if(['split-paragraph','merge-paragraph','role'].includes(item.action)){
  const paragraphs=structureParagraphs(c,corpus.byPage),at=paragraphs.findIndex(p=>p.parts.some(s=>pointIn(a,s))),p=paragraphs[at];
  if(!p)throw new Error('请选择本章内需要调整的段落。');
  if(item.action==='merge-paragraph'){
   const next=paragraphs[at+1];if(!next)throw new Error('已经是本章最后一段，没有下一段可合并。');
   if(c.gaps.some(g=>g.page>=p.parts[0].page&&g.page<=next.parts.at(-1).page))throw new Error('两段之间存在审核缺口，请先记录疑点，不能跨缺口合并。');
   next.parts.forEach(s=>s.paragraphKey=p.id);p.parts.forEach(s=>s.paragraphKey=p.id);
  }else if(item.action==='role'){
   if(!Object.hasOwn(structureRoles,item.proposal.role))throw new Error('请选择有效的段落角色。');
   p.parts.forEach(s=>{s.role=item.proposal.role;s.paragraphKey=p.id;});
  }else{
   const left=[],right=[];
   for(const s of p.parts){if(s.page<a.page||s.page===a.page&&s.end<=a.start)left.push(s);else if(s.page>a.page||s.page===a.page&&s.start>=a.start)right.push(s);else {left.push({...s,end:a.start});right.push({...s,start:a.start});}}
   const hasText=parts=>parts.some(s=>source(corpus.byPage.get(s.page)).text.slice(s.start,s.end).trim());
   if(!hasText(left)||!hasText(right))throw new Error('请选中段内新段落的开头，拆分后两段都应有正文。');
   left.forEach(s=>s.paragraphKey='left-'+item.id);right.forEach(s=>s.paragraphKey='right-'+item.id);p.parts=[...left,...right];
  }
  const parts=paragraphs.flatMap(p=>p.parts);
  for(const f of c.fragments)f.blocks=parts.filter(b=>b.page===f.page&&b.start>=f.start&&b.end<=f.end).map(({page,part,textSha256,text,...b})=>b);
 }else if(item.action==='split-chapter'){
  const [left,right]=splitFragments(c,a,corpus.byPage),id=c.id+'--revision-'+item.id,child={...structuredClone(c),id,title:title(item.proposal.title),fragments:right,gaps:c.gaps.filter(g=>g.page>=a.page),level:'section',boundaryStatus:'本机人工结构修订；待统一更新任务目录'};
  changedBoundaries.add(c.id);changedBoundaries.add(child.id);c.fragments=left;c.gaps=c.gaps.filter(g=>g.page<a.page);index.chapters.splice(n+1,0,child);index.chapterAliases[id]=id;
 }else if(item.action==='merge-chapter'){
  const next=targets[1];changedBoundaries.add(c.id);c.title=title(item.proposal.title||c.title);c.fragments.push(...next.fragments);c.gaps=[...new Map([...c.gaps,...next.gaps].map(g=>[g.page,g])).values()];c.sourceChapterIds=[...new Set([...(c.sourceChapterIds||[c.id]),...(next.sourceChapterIds||[next.id])])];
  index.chapters.splice(n+1,1);for(const [id,to] of Object.entries(index.chapterAliases))if(to===next.id)index.chapterAliases[id]=c.id;index.chapterAliases[next.id]=c.id;
 }else if(['move-next','move-previous'].includes(item.action)){
  const [left,right]=splitFragments(c,a,corpus.byPage),neighbor=targets[1];changedBoundaries.add(c.id);changedBoundaries.add(neighbor.id);
  if(item.action==='move-next'){neighbor.fragments=[...right,...neighbor.fragments];neighbor.gaps=[...c.gaps.filter(g=>g.page>=a.page),...neighbor.gaps];c.fragments=left;c.gaps=c.gaps.filter(g=>g.page<a.page);}
  else {neighbor.fragments.push(...left);neighbor.gaps.push(...c.gaps.filter(g=>g.page<a.page));c.fragments=right;c.gaps=c.gaps.filter(g=>g.page>=a.page);}
 }else throw new Error('不支持的结构修订方式。');
 return rebuild(index,corpus.byPage,changedBoundaries);
}
export function deriveStructure(state,corpus){
 const applied=state.items.filter(i=>i.status==='applied').sort((a,b)=>a.order-b.order);
 // Existing local revisions replay against the source directory they were created from.
 const legacyDraft=corpus.allocationIndex&&applied.some(i=>i.before.some(b=>{try{return !Object.hasOwn(JSON.parse(b.stamp),'pdfBoundary');}catch{return false;}}));
 const index=structuredClone(legacyDraft?corpus.allocationIndex:corpus.index);
 for(const item of applied)transform(index,item,corpus);
 return index;
}
export function proposeStructure(state,corpus,input,at=new Date().toISOString()){
 if(!Object.hasOwn(structureActions,input.action))throw new Error('请选择反馈或调整方式。');
 const index=deriveStructure(state,corpus),targets=affected(index,input),anchor=input.action==='missing-text'?input.anchor??null:validateAnchor(input.anchor,corpus);
 if(input.action!=='missing-text'&&!targets[0].fragments.some(f=>anchorIn(anchor,f,input.action)))throw new Error('定位不属于当前章节。');
 const item={id:crypto.randomUUID(),action:input.action,chapterId:input.chapterId,chapterTitle:targets[0].title,anchor:structuredClone(anchor),proposal:structuredClone(input.proposal||{}),comment:String(input.comment||'').trim(),by:person(input.by),at,status:'pending',before:targets.map(c=>({id:c.id,stamp:stamp(c)}))};
 if(!item.comment||item.comment.length>4000)throw new Error('请填写问题说明或调整依据（不超过4000字）。');
 validateNoteSelection(item,corpus);
 transform(structuredClone(index),item,corpus);
 const next=structuredClone(state);next.items.push(item);next.events.push({id:crypto.randomUUID(),action:'propose',itemId:item.id,by:item.by,at});return next;
}
export function previewStructure(state,corpus,item){return transform(deriveStructure(state,corpus),structuredClone(item),corpus);}
export function decideStructure(state,id,status,by,corpus,resolution='',at=new Date().toISOString()){
 if(!['applied','dismissed'].includes(status))throw new Error('请选择采用或暂不采用。');
 const next=structuredClone(state),item=next.items.find(i=>i.id===id);if(!item||item.status!=='pending')throw new Error('该反馈已处理，请重新读取。');
 if(status==='applied'){if(feedbackOnly(item.action))throw new Error('备注和缺文只能记录处理说明，不能直接生成结构修订。');previewStructure(state,corpus,item);}
 Object.assign(item,{status,decidedBy:person(by),decidedAt:at,resolution:String(resolution).trim(),order:next.events.length+1});next.events.push({id:crypto.randomUUID(),action:status,itemId:id,by:item.decidedBy,at});deriveStructure(next,corpus);return next;
}
export function undoStructure(state,by,corpus,at=new Date().toISOString()){
 const next=structuredClone(state),last=next.items.filter(i=>i.status==='applied').sort((a,b)=>b.order-a.order)[0];if(!last)throw new Error('当前没有已采用的结构修订。');
 last.status='pending';last.resolution='已撤回本次结构修订，原反馈保留。';next.events.push({id:crypto.randomUUID(),action:'undo',itemId:last.id,by:person(by),at});deriveStructure(next,corpus);return next;
}
function checkStamp(index,id,kind){const c=chapterAt(index,id),n=index.chapters.indexOf(c);return kind==='paragraphs'?stamp(c):JSON.stringify(index.chapters.slice(Math.max(0,n-1),n+2));}
export function confirmStructure(state,corpus,chapterId,kind,by,at=new Date().toISOString()){
 if(!['paragraphs','chapters'].includes(kind))throw new Error('核查类型无效。');
 const index=deriveStructure(state,corpus),next=structuredClone(state),check={id:crypto.randomUUID(),chapterId,kind,stamp:checkStamp(index,chapterId,kind),by:person(by),at};next.checks.push(check);next.events.push({id:crypto.randomUUID(),action:'confirm',itemId:check.id,by:check.by,at});return next;
}
export function structureChecks(state,corpus,chapterId){
 const index=deriveStructure(state,corpus);return Object.fromEntries(['paragraphs','chapters'].map(kind=>[kind,state.checks.some(c=>c.chapterId===chapterId&&c.kind===kind&&c.stamp===checkStamp(index,chapterId,kind))]));
}
export function structureAudit(state,corpus,index=deriveStructure(state,corpus)){
 const records=new Map();for(const check of state.checks){const key=check.chapterId+':'+check.kind;if(!records.has(key))records.set(key,[]);records.get(key).push(check);}
 return index.chapters.filter(c=>c.fragments.length).map(c=>{
  const result={chapterId:c.id,author:c.author,work:c.workTitle,title:c.title,hasGaps:Boolean(c.gaps.length)};
  for(const kind of ['paragraphs','chapters']){const candidates=records.get(c.id+':'+kind)||[],signature=candidates.length?checkStamp(index,c.id,kind):'',match=candidates.slice().reverse().find(check=>check.stamp===signature);result[kind]={confirmed:Boolean(match),by:match?.by||'',at:match?.at||''};}
  return result;
 });
}
export function validateStructureFeedback(state,corpus,revision){
 if(state?.format!=='shulun-structure-feedback'||state.version!==1||state.revision!==revision||state.mode!==corpus.mode||!Array.isArray(state.items)||!Array.isArray(state.checks)||!Array.isArray(state.events)||state.items.length>5000||state.checks.length>10000||state.events.length>30000)throw new Error('反馈文件格式或语料版本不匹配，原记录未改变。');
 const ids=new Set(),orders=new Set();
 for(const item of state.items){
  if(typeof item?.id!=='string'||!item.id||ids.has(item.id)||!Object.hasOwn(structureActions,item.action)||!['pending','applied','dismissed'].includes(item.status)||typeof item.chapterId!=='string'||typeof item.chapterTitle!=='string'||typeof item.comment!=='string'||!item.comment.trim()||item.comment.length>4000||!item.proposal||typeof item.proposal!=='object'||Array.isArray(item.proposal)||!Array.isArray(item.before)||!item.before.length||item.before.length>2||item.before.some(v=>typeof v.id!=='string'||typeof v.stamp!=='string')||!Number.isFinite(Date.parse(item.at)))throw new Error('反馈记录或定位无效。');
  ids.add(item.id);person(item.by);
  if(item.action==='missing-text'){
   let chapter;try{chapter=JSON.parse(item.before[0].stamp);}catch{throw Error('缺文章节快照无效。');}
   const baseIds=new Set([...corpus.index.chapters,...(corpus.allocationIndex?.chapters||[])].map(c=>c.id));
   if(chapter?.id!==item.chapterId||item.before[0].id!==item.chapterId||item.before.length!==1||!Array.isArray(chapter.fragments)||!baseIds.has(item.chapterId.split('--revision-')[0])||item.status==='applied')throw Error('缺文章节定位或处理状态无效。');
   validateMissingText(item,chapter,corpus);
  }else validateAnchor(item.anchor,corpus);
  validateNoteSelection(item,corpus);
  if(item.status!=='pending'){person(item.decidedBy);if(!Number.isFinite(Date.parse(item.decidedAt))||!Number.isInteger(item.order)||item.order<1)throw new Error('反馈处理历史无效。');}
  if(item.status==='applied'){if(orders.has(item.order))throw new Error('结构修订顺序冲突。');orders.add(item.order);}
 }
 const checkIds=new Set();for(const c of state.checks){if(!c?.id||checkIds.has(c.id)||typeof c.chapterId!=='string'||!['paragraphs','chapters'].includes(c.kind)||typeof c.stamp!=='string'||!Number.isFinite(Date.parse(c.at)))throw new Error('结构核查记录无效。');checkIds.add(c.id);person(c.by);}
 const eventIds=new Set();for(const e of state.events){if(!e?.id||eventIds.has(e.id)||!['propose','applied','dismissed','undo','confirm'].includes(e.action)||!Number.isFinite(Date.parse(e.at))||!(e.action==='confirm'?checkIds:ids).has(e.itemId))throw new Error('反馈操作历史无效。');eventIds.add(e.id);person(e.by);}
 deriveStructure(state,corpus);return state;
}
export function saveStructureFeedback(storage,key,state,expectedRaw,corpus,revision){
 validateStructureFeedback(state,corpus,revision);if(storage.getItem(key)!==expectedRaw)throw new Error('其他窗口已更新反馈，请先导出本次记录，再重新读取；未覆盖。');const raw=JSON.stringify(state);storage.setItem(key,raw);return raw;
}
export function mergeStructureFeedback(current,incoming,corpus,revision){
 validateStructureFeedback(current,corpus,revision);validateStructureFeedback(incoming,corpus,revision);const next=structuredClone(current);
 for(const key of ['items','checks','events']){const map=new Map(next[key].map(i=>[i.id,i]));for(const i of incoming[key]){if(map.has(i.id)&&JSON.stringify(map.get(i.id))!==JSON.stringify(i))throw new Error('同一条反馈／历史存在不同处理版本，请保留两份文件后核对，未覆盖。');if(!map.has(i.id)){next[key].push(structuredClone(i));map.set(i.id,i);}}}
 return validateStructureFeedback(next,corpus,revision);
}

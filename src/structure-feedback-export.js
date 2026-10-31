import {structureKey,emptyStructureFeedback,validateStructureFeedback,structureActions,missingTextPositions} from './annotation-structure-core.js';

export async function structureFeedbackRevision(corpus){
 const value={mode:corpus.mode,index:corpus.allocationIndex||corpus.index,sources:corpus.pages.filter(p=>p.eligible).map(p=>[p.page,p.source.textSha256])};
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
}
const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/u,"'$&").replaceAll('"','""')+'"';
export function structureFeedbackFiles(state,corpus,revision){
 validateStructureFeedback(state,corpus,revision);
 const header=['反馈ID','章节ID','篇目','章节','类型','缺文位置','PDF起始物理页','PDF结束物理页','定位引文','问题与建议','反馈人','反馈时间','状态','处理说明','框选X比例','框选Y比例','框选宽比例','框选高比例','原图宽像素','原图高像素','原图SHA256'];
 const rows=state.items.map(i=>{
  const c=JSON.parse(i.before.find(b=>b.id===i.chapterId).stamp),p=i.proposal;
  const quote=p.reviewContext?.kind==='txt-note'?p.reviewContext.spans.map(s=>s.quote).join('\n'):i.anchor?.quote||'';
  const region=p.pdfRegion;
  return [i.id,i.chapterId,c.workTitle,i.chapterTitle,structureActions[i.action],missingTextPositions[p.position]||'',p.scanStart,p.scanEnd,quote,i.comment,i.by,i.at,i.status,i.resolution,region?.rect.x,region?.rect.y,region?.rect.width,region?.rect.height,region?.imageWidth,region?.imageHeight,region?.imageSha256];
 });
 return [{name:'分段章节反馈.json',content:JSON.stringify(state,null,2)},{name:'章节反馈与缺文清单.csv',content:'\ufeff'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n')},{name:'章节反馈恢复说明.txt',content:`本包收录 ${state.items.length} 条章节反馈（其中 ${state.items.filter(i=>i.action==='missing-text').length} 条TXT缺文）。\n缺文意见及补录线索仍待核对，不代表正式正文已补齐。\n恢复反馈：进入“分段／章节反馈”→“导入与导出”→“导入反馈”，选择分段章节反馈.json，预览后合并。\n标注进度与章节反馈分别恢复；反馈绑定的来源版本及原始定位完整保留在JSON中。`}];
}
export async function readStructureFeedbackFiles(storage,corpus){
 const key=structureKey(corpus.mode),raw=storage.getItem(key),revision=await structureFeedbackRevision(corpus);
 let state;try{state=raw===null?emptyStructureFeedback(revision,corpus.mode):JSON.parse(raw);}catch{throw Error('章节反馈记录无法读取，请先在反馈入口下载原记录；未导出缺失反馈的成果包。');}
 const files=structureFeedbackFiles(state,corpus,revision);
 if(storage.getItem(key)!==raw)throw Error('其他窗口已更新章节反馈，请重新导出。');
 return {files,key,raw};
}

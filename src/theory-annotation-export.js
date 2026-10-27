import {validateChapterProgress,effectiveChapterProgress,chapterIsConfirmed,chapterBackupState} from './chapter-annotation-core.js?v=index-archive-20261027';
import {chapterAnnotationFiles} from './annotation-chapters.js?v=index-archive-20261027';
import { annotationView } from './theory-annotations.js?v=release-20261022';
import { draftForPage } from './ocr-source-policy.js?v=index-archive-20261027';
import { highlightHtml } from './theory-highlight.js?v=20261003-theory';
import { annotationSource, sourceStamp } from './annotation-source.js?v=index-archive-20261027';
import {candidateView,annotationDisplayRanges,reviewedBatch} from './reviewed-annotation.js?v=index-archive-20261027';
import { assignmentFor, assignmentPages } from './team-assignments.js?v=index-archive-20261027';
import { isTaskPage } from './screening-page-policy.js?v=index-archive-20261027';
import { zipStore } from './zip-store.js?v=20261018-bundle';
import { validateProgress } from './delivery-core.js?v=index-archive-20261027';
const esc = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cell = value => { const s=String(value??'');return `"${(/^[=+@\-\t\r]/u.test(s)?"'"+s:s).replaceAll('"','""')}"`; };
const csv = rows => rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';

export function annotationFiles(pages,reviews,part,person,{sourceForPage,always=false}={}) {
  // Legacy packages remain byte-compatible in structure until annotation is used.
  if(!always && !pages.some(p=>reviews[p.page]?.theoryAnnotations))return [];
  const passages=[['原PDF物理页','标注编号','状态','起点(UTF-16，从0起)','终点(不含)','书论原文','标注人','标注时间','更新时间']];
  const status=[['原PDF物理页','书论标注状态','有效书论数','待重新定位数','确认人','确认时间','正文来源','人工校验人','人工校验时间','正文版本']];
  const sections=[];
  const initial=[['原PDF物理页','初标编号','内容类型','语境状态','复核状态','初标原文','语境与判断说明','起点(UTF-16，从0起)','终点(不含)','初标正文SHA256','复核人','复核时间','当前保留范围(UTF-16 JSON)','删除选区(UTF-16 JSON)']];
  const snapshots=[];
  for(const p of pages) {
    const r=reviews[p.page]||{},source=sourceForPage?.(p,r),text=String(source?source.text:draftForPage(p,r).text||''),data=r.theoryAnnotations,view=annotationView(data,text);
    status.push([p.page,view.label,view.ranges.length,view.pending.length,view.completed?data.completion.by:'',view.completed?data.completion.at:'',source?.label||'',source?.verifiedBy||'',source?.verifiedAt||'',source?.revision||'']);
    for(const a of [...view.passages,...view.removed]) passages.push([p.page,a.id,a.status==='active'?'有效':a.status==='removed'?'已撤销':'待重新定位',a.start,a.end,a.quote,a.createdBy,a.createdAt,a.updatedAt||'']);
    const suggestions=candidateView(p,r,source),ranges=annotationDisplayRanges(view.ranges,suggestions.pending);
    if(p.humanReviewed) {
      const decisions=new Map(suggestions.all.map(c=>[c.id,c]));
      for(const c of p.humanReviewed.candidates) {
        const current=decisions.get(c.id),decision=current?.decision,record=data?.candidateReview?.decisions?.[c.id];
        const exclusions=suggestions.available?data?.candidateReview?.exclusions||[]:[];
        initial.push([p.page,c.id,c.category,c.contextStatus==='needs-context'?'语境待核':'完整候选',!suggestions.available?'正文版本不同，不套用':decision==='accepted'?(record?.mode==='page-confirmed'?'随整页确认保留':'已采纳'):decision==='rejected'?'已删除／不采用':'默认保留，待整页确认',c.quote,c.note,c.start,c.end,p.humanReviewed.source.textSha256,suggestions.available?record?.by||'':'',suggestions.available?record?.at||'':'',JSON.stringify(current?.remaining?.map(({start,end})=>({start,end}))||[]),JSON.stringify(exclusions.filter(s=>s.start<c.end&&s.end>c.start))]);
      }
      snapshots.push({page:p.page,part,source:p.humanReviewed.source,text:p.humanReviewed.text,summary:p.humanReviewed.summary,contextNotes:p.humanReviewed.contextNotes,candidates:p.humanReviewed.candidates,applicable:suggestions.available,personalAdjustments:suggestions.available?data?.candidateReview||null:null});
    }
    sections.push(`<section><h2>原 PDF 第 ${p.page} 页</h2><p class="status">${esc(view.label)} · 人工 ${view.ranges.length} 处 · AI初标待复核 ${suggestions.pending.length} 处${source?` · ${esc(source.label)} · ${esc(source.verifiedBy)} · ${esc(source.verifiedAt)} · ${esc(source.revision)}`:''}</p><pre>${highlightHtml(text,ranges)}</pre>${suggestions.available?`<aside><h3>AI初标与语境</h3>${suggestions.contextNotes.map(n=>`<p>${esc(n)}</p>`).join('')}${suggestions.all.map(c=>`<blockquote><strong>${esc(c.category)} · ${c.contextStatus==='needs-context'?'语境待核 · ':''}${c.decision==='accepted'?'已采纳':c.decision==='rejected'?'不采用':'待复核'}</strong><br>${esc(c.quote)}<br><small>${esc(c.note)}</small></blockquote>`).join('')}</aside>`:''}${view.pending.length?`<aside><h3>待重新定位（未计入高亮）</h3>${view.pending.map(a=>`<blockquote>${esc(a.quote)}</blockquote>`).join('')}</aside>`:''}</section>`);
  }
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第${part}份 · 原文书论标注</title><style>body{max-width:900px;margin:30px auto;padding:0 24px;color:#244843;background:#fffef9;font:16px/1.95 serif}h1,h2,h3,.status{font-family:system-ui,sans-serif}h1{font-size:24px}h2{font-size:18px}section{border-top:1px solid #d9d8ce;margin-top:30px;padding-top:20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}mark{background:#f1d586;color:inherit}aside{border-left:3px solid #a05e28;padding:0 16px}.status{font-size:13px}@media print{section{break-before:page}}</style><h1>原文中的书论标注</h1><p>第${part}份 · 导出人：${esc(person)}。黄色为人工圈选的书论；校对状态另记。未确认页面不表示没有书论；待重新定位内容未计入高亮。网页只作阅读，恢复请用进度JSON。</p>${sections.join('')}</html>`;
  const reading=html.replace('黄色为人工圈选的书论；校对状态另记。','黄色为人工标注，淡绿为AI初标待复核；初标不计人工完成。').replace('mark{background:#f1d586;color:inherit}','mark{background:#f1d586;color:inherit}.theory-suggested{background:#d9e7de}');
  return [{name:`第${part}份-书论标注.csv`,content:csv(passages)},{name:`第${part}份-书论标注页状态.csv`,content:csv(status)},{name:`第${part}份-原文书论标注.html`,content:reading},
    ...(snapshots.length?[{name:`第${part}份-AI初标与复核.csv`,content:csv(initial)},{name:`第${part}份-AI书论初标.json`,content:JSON.stringify({version:1,batch:reviewedBatch,pages:snapshots},null,2)}]:[])];
}

export async function buildAnnotationBundle({progress,pages,member=null,exportedAt=new Date().toISOString(),unsaved=false,saveConflict=false}) {
  progress=JSON.parse(JSON.stringify(validateProgress(progress)));pages=JSON.parse(JSON.stringify(pages));
  const {part,reviews}=progress,person=String(progress.person||'').trim();
  if(!person)throw new Error('请填写标注人姓名。');
  const [start,end]=[[1,258],[259,527],[528,776],[777,1052]][part-1];
  const expected=Array.from({length:end-start+1},(_,i)=>start+i).filter(isTaskPage);
  const taskPages=pages.filter(p=>isTaskPage(p.page));
  if(taskPages.length!==expected.length || taskPages.some((p,i)=>p.page!==expected[i] || p.local!==p.page-start+1 || typeof p.ocr!=='string'))throw new Error('标注导出材料不完整。');
  const scoped=assignmentPages(taskPages,member,part),eligible=scoped.filter(p=>annotationSource(p,reviews[p.page]));
  if(!eligible.length)throw new Error('当前页段暂无已完成人工校验且无待核的正文，请先完成原文校对。');
  const encoder=new TextEncoder(),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  for(const p of eligible) {
    const source=annotationSource(p,reviews[p.page]);
    if(source.kind==='human-txt' && await hash(source.text)!==source.textSha256)throw new Error('人工TXT已偏离审核版本，暂停导出；原记录保留。');
  }
  const files=annotationFiles(eligible,reviews,part,person,{sourceForPage:annotationSource,always:true}).map(f=>({...f,content:'\ufeff'+f.content}));
  files.push({name:`第${part}份-初筛进度备份.json`,content:JSON.stringify(progress,null,2)});
  files.push({name:'交付说明.txt',content:'\ufeff'+[
    '书论标注任务交付包',`标注人：${person}`,`导出时间：${exportedAt}`,
    '正文只取已完成人工校验且无待核的资料；标注界面不改字。',
    'AI标注默认保留，删除选区及整页确认分别留痕；未确认页不计人工完成。黄色为已保存标注，淡绿为待整页确认的默认AI标注。原有语境提示保留，整页确认不会自动填写逐条语境核定。',
    `当前分工段可标注 ${eligible.length} 页，未入选 ${scoped.length-eligible.length} 页。未确认不等于没有书论。`,
    'HTML/CSV仅列合格资料；旧待定位/撤销标注不计入有效高亮。',
    'JSON完整备份保留原分份所有正文、草稿、比较底稿、校对状态和标注历史，包括未入选及移交/排除页。',
    unsaved||saveConflict?'此包含尚未保存的内存修改；请保留完整备份。':'本包取自点击导出时的快照。',
    '恢复时使用进度JSON；回收和发布需另行处理。',
  ].join('\n')});
  const manifest={format:'shulun-annotation-bundle',version:1,task:'annotation',part,person,exportedAt,unsaved:Boolean(unsaved||saveConflict),saveConflict:Boolean(saveConflict),
    ...(assignmentFor(member)?{member:Number(member)}:{}),backupScope:'entire-original-part',pageNumbers:eligible.map(p=>p.page),excludedPageNumbers:scoped.filter(p=>!eligible.includes(p)).map(p=>p.page),
    sources:await Promise.all(eligible.map(async p=>{const source=annotationSource(p,reviews[p.page]);return {...sourceStamp(source,part),textSha256:await hash(source.text)};})),
    files:await Promise.all(files.map(async f=>({name:f.name,bytes:encoder.encode(f.content).length,sha256:await hash(f.content)})))};
  files.push({name:'文件清单.json',content:JSON.stringify(manifest,null,2)});
  const at=new Date(exportedAt);if(!Number.isFinite(at.getTime()))throw new Error('导出时间无效。');
  return {name:`${member?`成员${member}-`:''}第${part}份-书论标注交付包-${at.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}.zip`,bytes:zipStore(files,at),manifest};
}

export async function buildUnifiedAnnotationBundle({progressByPart,pagesByPart,chapterIndex=null,chapterProgress=null,person,exportedAt=new Date().toISOString(),unsaved=false,saveConflict=false}) {
  if(!String(person||'').trim())throw new Error('请填写标注人姓名。');
  const files=[],parts=[];
  for(const part of [1,2,3,4]) {
    if(!progressByPart?.[part]||!pagesByPart?.[part])throw new Error('全部标注材料不完整，暂停导出。');
    const progress={...JSON.parse(JSON.stringify(validateProgress(progressByPart[part]))),person:person.trim()};
    if(progress.part!==part)throw new Error('标注进度分份不匹配。');
    const pages=pagesByPart[part];
    if(!pages.some(p=>annotationSource(p,progress.reviews[p.page]))) {
      files.push({name:`第${part}份-完整进度备份.json`,content:JSON.stringify(progress,null,2)});continue;
    }
    const bundle=await buildAnnotationBundle({progress,pages,exportedAt,unsaved,saveConflict});
    files.push({name:bundle.name,content:bundle.bytes});parts.push(bundle.manifest);
  }
  if(!parts.length)throw new Error('暂无合格人工TXT可供标注导出。');
  if(chapterIndex){
    const byPage=new Map(Object.values(pagesByPart).flat().filter(p=>p.humanReviewed).map(p=>[p.page,p]));
    let effective=progressByPart,statuses=null;
    if(chapterProgress){
      validateChapterProgress(chapterProgress,byPage);effective=effectiveChapterProgress(progressByPart,chapterProgress,byPage);statuses={};
      for(const c of chapterIndex.chapters)statuses[c.id]={...(chapterProgress.confirmations[c.id]||{}),confirmed:await chapterIsConfirmed(c,byPage,progressByPart,chapterProgress)};
      files.push({name:'整章标注进度.json',content:JSON.stringify(chapterBackupState(chapterProgress,progressByPart),null,2)});
      files.push({name:'章节确认状态.csv',content:csv([['作者','篇目','章节','确认状态','确认人','确认时间','审核缺口数'],...chapterIndex.chapters.map(c=>[c.author,c.workTitle,c.title,statuses[c.id].confirmed?(c.gaps.length?'已确认本章开放内容':'本章已确认'):'本章未确认',statuses[c.id].confirmed?statuses[c.id].by:'',statuses[c.id].confirmed?statuses[c.id].at:'',c.gaps.length])])});
      for(const n of [1,2,3,4])files.push({name:`原第${n}份完整原记录.json`,content:JSON.stringify(progressByPart[n],null,2)});
    }
    files.push(...chapterAnnotationFiles(chapterIndex,byPage,effective,statuses));
  }
  files.push({name:'统一标注任务说明.txt',content:'统一收集全部人工审核合格材料，可在任务页按整章安排负责人；分工方案在任务页单独导出与导入。章节整理HTML、JSON、CSV与按篇正文合并新旧合格来源，缺页保留断口；章节阅读文本为派生显示，原审核TXT及UTF16坐标保持。各材料包保留原文来源、AI初标、人工结果及原分份完整历史，恢复时使用各包中的原格式进度JSON。'+(chapterProgress?'整章标注进度JSON同时保留原记录归档、章内调整和章节确认；从整章工作区恢复。原第1–4份完整原记录JSON保持原始记录。整章确认仅针对本章已开放正文，不生成逐页确认或补齐缺失正文。':'')});
  files.push({name:'全部标注来源清单.json',content:JSON.stringify({format:'shulun-unified-annotation',version:1,person:person.trim(),exportedAt,parts},null,2)});
  return {name:'书论统一标注任务-全部成果.zip',bytes:zipStore(files,new Date(exportedAt)),manifest:{task:'annotation',scope:'all',pageNumbers:parts.flatMap(p=>p.pageNumbers),parts}};
}

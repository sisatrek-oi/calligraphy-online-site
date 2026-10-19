import { annotationView } from './theory-annotations.js?v=annotations-20261019';
import { draftForPage } from './ocr-source-policy.js?v=fulltext-20261019';
import { highlightHtml } from './theory-highlight.js?v=20261003-theory';
import { annotationSource, sourceStamp } from './annotation-source.js?v=task-split-20261019';
import { assignmentFor, assignmentPages } from './team-assignments.js?v=entry-20261019';
import { isTaskPage } from './screening-page-policy.js?v=20261003-trim';
import { zipStore } from './zip-store.js?v=20261018-bundle';
import { validateProgress } from './delivery-core.js?v=annotations-20261019';
const esc = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cell = value => { const s=String(value??'');return `"${(/^[=+@\-\t\r]/u.test(s)?"'"+s:s).replaceAll('"','""')}"`; };
const csv = rows => rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';

export function annotationFiles(pages,reviews,part,person,{sourceForPage,always=false}={}) {
  // Legacy packages remain byte-compatible in structure until annotation is used.
  if(!always && !pages.some(p=>reviews[p.page]?.theoryAnnotations))return [];
  const passages=[['原PDF物理页','标注编号','状态','起点(UTF-16，从0起)','终点(不含)','书论原文','标注人','标注时间','更新时间']];
  const status=[['原PDF物理页','书论标注状态','有效书论数','待重新定位数','确认人','确认时间','正文来源','人工校验人','人工校验时间','正文版本']];
  const sections=[];
  for(const p of pages) {
    const r=reviews[p.page]||{},source=sourceForPage?.(p,r),text=String(source?source.text:draftForPage(p,r).text||''),data=r.theoryAnnotations,view=annotationView(data,text);
    status.push([p.page,view.label,view.ranges.length,view.pending.length,view.completed?data.completion.by:'',view.completed?data.completion.at:'',source?.label||'',source?.verifiedBy||'',source?.verifiedAt||'',source?.revision||'']);
    for(const a of [...view.passages,...view.removed]) passages.push([p.page,a.id,a.status==='active'?'有效':a.status==='removed'?'已撤销':'待重新定位',a.start,a.end,a.quote,a.createdBy,a.createdAt,a.updatedAt||'']);
    sections.push(`<section><h2>原 PDF 第 ${p.page} 页</h2><p class="status">${esc(view.label)} · ${view.ranges.length} 处书论${source?` · ${esc(source.label)} · ${esc(source.verifiedBy)} · ${esc(source.verifiedAt)} · ${esc(source.revision)}`:''}</p><pre>${highlightHtml(text,view.ranges)}</pre>${view.pending.length?`<aside><h3>待重新定位（未计入高亮）</h3>${view.pending.map(a=>`<blockquote>${esc(a.quote)}</blockquote>`).join('')}</aside>`:''}</section>`);
  }
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第${part}份 · 原文书论标注</title><style>body{max-width:900px;margin:30px auto;padding:0 24px;color:#244843;background:#fffef9;font:16px/1.95 serif}h1,h2,h3,.status{font-family:system-ui,sans-serif}h1{font-size:24px}h2{font-size:18px}section{border-top:1px solid #d9d8ce;margin-top:30px;padding-top:20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}mark{background:#f1d586;color:inherit}aside{border-left:3px solid #a05e28;padding:0 16px}.status{font-size:13px}@media print{section{break-before:page}}</style><h1>原文中的书论标注</h1><p>第${part}份 · 导出人：${esc(person)}。黄色为人工圈选的书论；校对状态另记。未确认页面不表示没有书论；待重新定位内容未计入高亮。网页只作阅读，恢复请用进度JSON。</p>${sections.join('')}</html>`;
  return [{name:`第${part}份-书论标注.csv`,content:csv(passages)},{name:`第${part}份-书论标注页状态.csv`,content:csv(status)},{name:`第${part}份-原文书论标注.html`,content:html}];
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
  const files=annotationFiles(eligible,reviews,part,person,{sourceForPage:annotationSource,always:true}).map(f=>({...f,content:'\ufeff'+f.content}));
  files.push({name:`第${part}份-初筛进度备份.json`,content:JSON.stringify(progress,null,2)});
  files.push({name:'交付说明.txt',content:'\ufeff'+[
    '书论标注任务交付包',`标注人：${person}`,`导出时间：${exportedAt}`,
    '正文只取已完成人工校验且无待核的资料；标注界面不改字。',
    `当前分工段可标注 ${eligible.length} 页，未入选 ${scoped.length-eligible.length} 页。未确认不等于没有书论。`,
    'HTML/CSV仅列合格资料；旧待定位/撤销标注不计入有效高亮。',
    'JSON完整备份保留原分份所有正文、草稿、比较底稿、校对状态和标注历史，包括未入选及移交/排除页。',
    unsaved||saveConflict?'此包含尚未保存的内存修改；请保留完整备份。':'本包取自点击导出时的快照。',
    '恢复时使用进度JSON；回收和发布需另行处理。',
  ].join('\n')});
  const encoder=new TextEncoder(),hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  const manifest={format:'shulun-annotation-bundle',version:1,task:'annotation',part,person,exportedAt,unsaved:Boolean(unsaved||saveConflict),saveConflict:Boolean(saveConflict),
    ...(assignmentFor(member)?{member:Number(member)}:{}),backupScope:'entire-original-part',pageNumbers:eligible.map(p=>p.page),excludedPageNumbers:scoped.filter(p=>!eligible.includes(p)).map(p=>p.page),
    sources:await Promise.all(eligible.map(async p=>{const source=annotationSource(p,reviews[p.page]);return {...sourceStamp(source,part),textSha256:await hash(source.text)};})),
    files:await Promise.all(files.map(async f=>({name:f.name,bytes:encoder.encode(f.content).length,sha256:await hash(f.content)})))};
  files.push({name:'文件清单.json',content:JSON.stringify(manifest,null,2)});
  const at=new Date(exportedAt);if(!Number.isFinite(at.getTime()))throw new Error('导出时间无效。');
  return {name:`${member?`成员${member}-`:''}第${part}份-书论标注交付包-${at.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}.zip`,bytes:zipStore(files,at),manifest};
}

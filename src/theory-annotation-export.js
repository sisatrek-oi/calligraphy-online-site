import { annotationView } from './theory-annotations.js?v=annotations-20261019';
import { draftForPage } from './ocr-source-policy.js?v=fulltext-20261019';
import { highlightHtml } from './theory-highlight.js?v=20261003-theory';
const esc = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cell = value => { const s=String(value??'');return `"${(/^[=+@\-\t\r]/u.test(s)?"'"+s:s).replaceAll('"','""')}"`; };
const csv = rows => rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';

export function annotationFiles(pages,reviews,part,person) {
  // Legacy packages remain byte-compatible in structure until annotation is used.
  if(!pages.some(p=>reviews[p.page]?.theoryAnnotations))return [];
  const passages=[['原PDF物理页','标注编号','状态','起点(UTF-16，从0起)','终点(不含)','书论原文','标注人','标注时间','更新时间']];
  const status=[['原PDF物理页','书论标注状态','有效书论数','待重新定位数','确认人','确认时间']];
  const sections=[];
  for(const p of pages) {
    const r=reviews[p.page]||{},text=String(draftForPage(p,r).text||''),data=r.theoryAnnotations,view=annotationView(data,text);
    status.push([p.page,view.label,view.ranges.length,view.pending.length,view.completed?data.completion.by:'',view.completed?data.completion.at:'']);
    for(const a of [...view.passages,...view.removed]) passages.push([p.page,a.id,a.status==='active'?'有效':a.status==='removed'?'已撤销':'待重新定位',a.start,a.end,a.quote,a.createdBy,a.createdAt,a.updatedAt||'']);
    sections.push(`<section><h2>原 PDF 第 ${p.page} 页</h2><p class="status">${esc(view.label)} · ${view.ranges.length} 处书论</p><pre>${highlightHtml(text,view.ranges)}</pre>${view.pending.length?`<aside><h3>待重新定位（未计入高亮）</h3>${view.pending.map(a=>`<blockquote>${esc(a.quote)}</blockquote>`).join('')}</aside>`:''}</section>`);
  }
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第${part}份 · 原文书论标注</title><style>body{max-width:900px;margin:30px auto;padding:0 24px;color:#244843;background:#fffef9;font:16px/1.95 serif}h1,h2,h3,.status{font-family:system-ui,sans-serif}h1{font-size:24px}h2{font-size:18px}section{border-top:1px solid #d9d8ce;margin-top:30px;padding-top:20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}mark{background:#f1d586;color:inherit}aside{border-left:3px solid #a05e28;padding:0 16px}.status{font-size:13px}@media print{section{break-before:page}}</style><h1>原文中的书论标注</h1><p>第${part}份 · 导出人：${esc(person)}。黄色为人工圈选的书论；校对状态另记。未确认页面不表示没有书论；待重新定位内容未计入高亮。网页只作阅读，恢复请用进度JSON。</p>${sections.join('')}</html>`;
  return [{name:`第${part}份-书论标注.csv`,content:csv(passages)},{name:`第${part}份-书论标注页状态.csv`,content:csv(status)},{name:`第${part}份-原文书论标注.html`,content:html}];
}

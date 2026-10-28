import {readJson} from './screening-loader.js?v=loading-20261028';
import {annotationReading} from './annotation-reading.js?v=release-20261022';
import {annotationView} from './theory-annotations.js?v=release-20261022';
import {candidateView,annotationDisplayRanges} from './reviewed-annotation.js?v=loading-20261028';
import {highlightHtml} from './theory-highlight.js?v=20261003-theory';
import {readingOrders} from './annotation-reading-orders.js';
export const chapterHref=id=>`./annotation-chapters.html?chapter=${encodeURIComponent(id)}`;
export const chapterPageHref=(id,part,page)=>`./annotation.html?scope=all&part=${part}&page=${page}&chapter=${encodeURIComponent(id)}`;
export const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fail=()=>{throw new Error('章节目录与人工审核TXT不匹配，原标注记录保留。');};
export const orderedChapterFragments=chapter=>[...chapter.fragments].sort((a,b)=>a.page-b.page||a.start-b.start||a.end-b.end);
export const chapterSourceEvents=chapter=>[
  ...orderedChapterFragments(chapter).map(f=>({page:f.page,offset:f.start,f})),
  ...chapter.gaps.map(g=>({page:g.page,offset:0,g}))
].sort((a,b)=>a.page-b.page||a.offset-b.offset||Number(Boolean(b.g))-Number(Boolean(a.g)));
export function validateChapterIndex(value,byPage) {
  if(value?.version!==1||!Array.isArray(value.works)||!Array.isArray(value.chapters)||!value.pageToChapters)fail();
  const ids=new Set(),coverage=new Map();
  for(const c of value.chapters){
    if(!c.id||ids.has(c.id)||!c.title||!c.workId||!Array.isArray(c.fragments)||!Array.isArray(c.gaps))fail();ids.add(c.id);
    let previous=0;
    for(const f of c.fragments){
      if(!Number.isInteger(f.page)||f.page<previous||![1,2,3,4].includes(f.part)||!Number.isInteger(f.start)||!Number.isInteger(f.end)||f.start<0||f.end<=f.start||!Array.isArray(f.blocks))fail();previous=f.page;
      if(!coverage.has(f.page))coverage.set(f.page,[]);coverage.get(f.page).push({...f,chapter:c.id});
      if(byPage){const p=byPage.get(f.page)?.humanReviewed||byPage.get(f.page);if(!p?.eligible||p.part!==f.part||p.source.textSha256!==f.textSha256||f.end>p.text.length)fail();}
      let cursor=f.start;for(const b of f.blocks){if(b.start!==cursor||b.end<=b.start||b.end>f.end)fail();cursor=b.end;}if(cursor!==f.end)fail();
    }
  }
  for(const w of value.works)if(!w.id||!w.title||!w.author||!Array.isArray(w.chapters)||w.chapters.some(id=>!ids.has(id)))fail();
  for(const [page,fs] of coverage){fs.sort((a,b)=>a.start-b.start);let cursor=0;for(const f of fs){if(f.start!==cursor)fail();cursor=f.end;}if(JSON.stringify(fs.map(f=>f.chapter))!==JSON.stringify(value.pageToChapters[page]))fail();if(byPage){const p=byPage.get(page)?.humanReviewed||byPage.get(page);if(cursor!==p.text.length)fail();}}
  if(coverage.size!==value.eligiblePages)fail();
  if(byPage)for(const [n,item] of byPage){const p=item.humanReviewed||item;if(p.eligible&&!coverage.has(n))fail();}
  return value;
}
export async function loadChapterIndex(options){return validateChapterIndex(await readJson('./annotation-data/chapters.json?v=chapters-20261021',options));}
export function chapterDirectoryHtml(index){
  return `<p>${index.works.length} 篇／附录 · ${index.chapters.length} 个篇章单元 · 新旧正文合并阅读；缺页保留断口。</p><label>查找作者、篇名或章节 <input type="search" id="chapterSearch" placeholder="例如：姜夔、续书谱、用笔" /></label><div id="chapterDirectory">${index.works.map(w=>`<details class="chapter-work" data-chapter-search="${esc(w.author+' '+w.title+' '+index.chapters.filter(c=>c.workId===w.id).map(c=>c.title).join(' '))}"><summary>${esc(w.author)} · ${esc(w.title)}${w.contributors.length?' · '+esc(w.contributors.join('、')):''}</summary><ul>${w.chapters.map(id=>index.chapters.find(c=>c.id===id)).map(c=>`<li><a href="${chapterHref(c.id)}">${esc(c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':'')}${esc(c.title)}</a> <small>${c.fragments.length} 个来源片段 · ${c.candidateCount} 处初标${c.gaps.length?' · 有缺页':''}</small></li>`).join('')}</ul></details>`).join('')}</div>`;
}
export function attachChapterSearch(root){root.querySelector('#chapterSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();for(const d of root.querySelectorAll('[data-chapter-search]')){d.hidden=!d.dataset.chapterSearch.toLowerCase().includes(q);if(q&&!d.hidden)d.open=true;}});}
export function chapterFragmentView(fragment,byPage,progressByPart={}) {
  const item=byPage.get(fragment.page),p=item?.humanReviewed||item;
  if(!p?.eligible||p.source.textSha256!==fragment.textSha256)fail();
  const text=p.text,review=progressByPart[fragment.part]?.reviews?.[fragment.page]||{};
  const wrapped=item.humanReviewed?item:{page:p.page,humanReviewed:{...p,revision:p.annotationRevision,batch:'human-txt-20261020',integrityChecked:true}};
  const source={...p.source,text},manual=annotationView(review.theoryAnnotations,text),suggestions=candidateView(wrapped,review,source);
  const ranges=annotationDisplayRanges(manual.ranges,suggestions.pending),reading=annotationReading(text);
  let orderedBlocks=[...fragment.blocks].sort((a,b)=>a.start-b.start||a.end-b.end);
  const order=readingOrders[fragment.page];
  if(order&&order.sha256===fragment.textSha256){
    // Presentation is a permutation of source blocks; annotation ranges never move.
    const ranks=new Map(order.starts.map((start,i)=>[start,i]));
    if(orderedBlocks.some(b=>!ranks.has(b.start)))fail();
    orderedBlocks.sort((a,b)=>ranks.get(a.start)-ranks.get(b.start));
  }
  const blocks=orderedBlocks.filter(b=>!b.decoration).map(b=>{
    const a=reading.visibleOffset(b.start),z=reading.visibleOffset(b.end),body=reading.text.slice(a,z);
    const marks=reading.ranges(ranges).filter(r=>r.start<z&&r.end>a).map(r=>({...r,start:Math.max(a,r.start)-a,end:Math.min(z,r.end)-a}));
    return {...b,text:body,html:highlightHtml(body,marks)};
  });
  return {...fragment,text:text.slice(fragment.start,fragment.end),readingText:blocks.map(b=>b.text).join(''),blocks,
    manualRanges:manual.ranges.filter(r=>r.start<fragment.end&&r.end>fragment.start).map(r=>({...r,overlapStart:Math.max(r.start,fragment.start),overlapEnd:Math.min(r.end,fragment.end),overlapQuote:text.slice(Math.max(r.start,fragment.start),Math.min(r.end,fragment.end))})),
    aiCandidates:suggestions.all.filter(r=>r.start<fragment.end&&r.end>fragment.start).map(r=>({...r,overlapStart:Math.max(r.start,fragment.start),overlapEnd:Math.min(r.end,fragment.end),overlapQuote:text.slice(Math.max(r.start,fragment.start),Math.min(r.end,fragment.end))})),contextNotes:p.contextNotes,
    source:p.source,pendingAnnotations:manual.pending,completed:manual.completed};
}
const displayNote=value=>String(value??'').replace(/\[\d{3,}\][ \t]*/g,'');
const roleNames={theory:'书论',editorial:'编者题解',biography:'生平背景',structure:'原题与结构',blank:'空白标记',pending:'待核背景'};
export function chapterBodyHtml(chapter,byPage,progressByPart={},interactive=false){
  const events=chapterSourceEvents(chapter);
  return events.map(({f,g})=>g?`<p class="chapter-gap" data-gap-page="${g.page}">〔来源缺口：原 PDF 第 ${g.page} 页，${esc(displayNote(g.reasons.join('；')))}。未接入正文。〕</p>`:(()=>{
    const v=chapterFragmentView(f,byPage,progressByPart);
    return `<section class="chapter-fragment" data-source-page="${f.page}"><div class="chapter-reference">原图与来源 · 第 ${f.page} 页${v.completed?' · 本页人工已确认':''}${interactive?` <button type="button" data-show-scan="${f.page}">显示对应原图</button> <a href="${chapterPageHref(chapter.id,f.part,f.page)}">标注这一段所在页 →</a>`:''}</div>${v.blocks.map(b=>`<div class="chapter-block chapter-role-${b.role}" data-role="${b.role}" title="${roleNames[b.role]||b.role}">${b.html}</div>`).join('')}${v.pendingAnnotations.length?`<p class="chapter-context-note">本页有 ${v.pendingAnnotations.length} 处旧标注对应其他正文版本或待重新定位，原记录已保留；请打开来源页查看，未套用到当前审核TXT。</p>`:''}${v.contextNotes.length?`<details class="chapter-context"><summary>本页语境提示</summary>${v.contextNotes.map(n=>`<p>${esc(displayNote(n))}</p>`).join('')}</details>`:''}</section>`;
  })()).join('');
}
const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const csv=rows=>'\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
export function chapterAnnotationFiles(index,byPage,progressByPart={},chapterStatuses=null){
  validateChapterIndex(index,byPage);
  const chapters=index.chapters.map(c=>({...c,...(chapterStatuses?{chapterConfirmation:chapterStatuses[c.id]||null}:{}),fragments:orderedChapterFragments(c).map(f=>{const v=chapterFragmentView(f,byPage,progressByPart);return {...v,blocks:v.blocks.map(({html,...b})=>b)};})}));
  const rows=[['作者','篇目','卷','章节','原PDF页','原TXT起点UTF16','原TXT终点UTF16','正文SHA256','初标编号','类别','语境状态','复核状态','初标原文','本章重叠起点','本章重叠终点','本章重叠原文']];
  const sources=[['作者','篇目','卷','章节','原PDF页','原TXT起点UTF16','原TXT终点UTF16','正文SHA256','审核人','审核时间','原审核TXT','范围状态']];
  for(const c of chapters){for(const f of c.fragments){const prefix=[c.author,c.workTitle,c.volumeTitle,c.title,f.page,f.start,f.end,f.textSha256];sources.push([...prefix,f.source.verifiedBy,f.source.verifiedAt,f.source.txtPath,'合格原文']);for(const a of f.aiCandidates)rows.push([...prefix,a.id,a.category,a.contextStatus,a.decision||'默认保留，待人工确认',a.quote,Math.max(a.start,f.start),Math.min(a.end,f.end),a.overlapQuote]);}for(const g of c.gaps)sources.push([c.author,c.workTitle,c.volumeTitle,c.title,g.page,'','','','','','',g.reasons.join('；')]);}
  const contents=index.works.map(w=>`<li>${esc(w.author)} · ${esc(w.title)}<ul>${w.chapters.map(id=>index.chapters.find(c=>c.id===id)).map(c=>`<li><a href="#${esc(c.id)}">${esc(c.title)}</a></li>`).join('')}</ul></li>`).join('');
  const body=index.chapters.map(c=>`<article id="${esc(c.id)}"><p>${esc(c.author)} · ${esc(c.workTitle)}${c.volumeTitle?' · '+esc(c.volumeTitle):''}</p><h2>${esc(c.title)}</h2>${chapterStatuses?`<p>${chapterStatuses[c.id]?.confirmed?(c.gaps.length?'本章已开放内容已确认':'本章已确认'):'本章未确认'}</p>`:''}<small>${esc(c.boundaryStatus)}</small>${chapterBodyHtml(c,byPage,progressByPart)}</article>`).join('');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>历代书法论文选 · 按篇章整理</title><style>body{max-width:1000px;margin:32px auto;padding:0 24px;font:18px/1.95 serif;color:#26433c;background:#fffef9}h1,h2,small,nav,.chapter-reference{font-family:system-ui,sans-serif}article{border-top:1px solid #cdd5cc;padding-top:28px;margin-top:32px}.chapter-block{white-space:pre-wrap;overflow-wrap:anywhere}.chapter-reference,small{font-size:12px;color:#66776d}.chapter-gap{padding:12px;border:1px dashed #ac7842;background:#fff5e3}.chapter-role-editorial,.chapter-role-biography{color:#617168}.chapter-role-structure{font-weight:bold}.theory-suggested{background:#dceaf8}mark{background:#f1d586;color:inherit}.chapter-context{font:14px/1.7 system-ui}a{color:#28614d}</style><h1>《历代书法论文选》按篇章整理</h1><p>新旧合格人工正文合并，浅蓝为AI初标，黄色为人工标注。AI初标不等于人工确认。编者题解与生平背景保留并区分，缺页明确断开。显示文本接顺机器栏号，原审核TXT及UTF-16定位保留在JSON、来源表与原件中。</p><nav><ul>${contents}</ul></nav>${body}</html>`;
  const files=[{name:'章节整理.html',content:html},{name:'章节整理.json',content:JSON.stringify({format:'shulun-chapter-annotation',version:1,chapterRevision:index.revision,offsetUnit:index.offsetUnit,works:index.works,chapters},null,2)},{name:'章节AI初标.csv',content:csv(rows)},{name:'章节来源与缺口.csv',content:csv(sources)}];
  for(const w of index.works){const text=chapters.filter(c=>c.workId===w.id).map(c=>`${c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':''}${c.title}\n\n`+chapterSourceEvents(c).map(({f,g})=>f?f.readingText:`〔来源缺口：原PDF第${g.page}页，${g.reasons.join('；')}；不补写正文。〕`).join('\n')).join('\n\n');files.push({name:`按篇正文-${w.id}-${(w.author+'-'+w.title).replace(/[\\/:*?"<>|]/g,'_')}.txt`,content:'\ufeff'+text});}
  return files;
}

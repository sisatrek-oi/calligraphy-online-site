import {reviewerName,reviewerMenu,bindReviewerMenu} from './review-entry.js?v=directory-entry-20261026';
import {readJson} from './screening-loader.js?v=index-archive-20261027';
import {loadAnnotationCorpus,corpusMode,corpusQuery,corpusDigest} from './annotation-corpus.js?v=index-archive-20261027';
import {esc} from './annotation-chapters.js?v=index-archive-20261027';
import {readCorpusAssignments,assignmentScope,assignmentsUnchanged} from './annotation-assignments.js?v=annotation-release-20261024';
import {structureKey,emptyStructureFeedback,validateStructureFeedback,saveStructureFeedback,mergeStructureFeedback} from './annotation-structure-core.js?v=index-archive-20261027';
import {reviewIssueTypes,reviewRuns,reviewDomSelection,reviewPdfPages,pageRanges,proposeReviewNote,reviewIssues,reviewDecorations} from './annotation-review-core.js?v=index-archive-20261027';

const app=document.querySelector('#sourceReviewApp'),params=new URLSearchParams(location.search),mode=corpusMode(location.search),memberId=params.get('assignee')||'',key=structureKey(mode),initialHash=location.hash,$=id=>app.querySelector('#'+id);
window.WorkspaceUI.mount('source-review');
let corpus,revision,state,raw=null,current,runs=[],spans=[],chapters=[],assignment=null,parts=[],scanPages=[],scan=null,sourcePage=null,composing=false,stale=false,unsaved=null,selectionError='';
let feedbackScan=undefined;
let knownIssues=[],issueCountsState=null,issueCounts=new Map(),menuContext=null,lastPointer={type:'mouse',at:0};
const drafts=new Map(),suffix=()=>corpusQuery(mode)+(memberId?'&assignee='+encodeURIComponent(memberId):''),notify=text=>{$('reviewNotice').textContent=text;},title=c=>c.author+' · '+(c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':'')+c.title;
function download(name,value,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function draftText(){download('未保存的PDF与TXT核对输入.txt',`核查人：${reviewerName()}\n篇目：${title(current)}\nPDF扫描页：${(feedbackScan===undefined?scan:feedbackScan)??'待定位'}\n问题类型：${reviewIssueTypes[$('reviewIssue').value]}\n定位：${spans.map(s=>s.quote).join('')}\n\n${$('reviewComment').value}`,'text/plain;charset=utf-8');}
function backup(){download('PDF与TXT核对反馈.json',JSON.stringify(unsaved||state,null,2));}
function ready(){if(composing){notify('请先确认输入法候选，再执行操作。');return false;}if(assignment&&!assignmentsUnchanged(localStorage,assignment)){notify('成员分工已变化，请返回任务页重新进入；本次未写入。');return false;}if(stale){notify('其他窗口已更新反馈，请先下载备份，再重新读取。');return false;}if(unsaved){notify('反馈尚未保存，请先重试或下载未保存备份。');return false;}return true;}
function feedbackForChapter(item,c=current){return c.fragments.some(f=>f.page===item.anchor.page&&item.anchor.start>=f.start&&item.anchor.start<f.end);}
function visibleFeedback(item){return chapters.some(c=>feedbackForChapter(item,c));}
function openFeedback(tab='form'){
 if(tab==='form'&&feedbackScan===undefined){feedbackScan=scan;renderAnchor();}
 app.classList.add('review-feedback-open');$('reviewFeedback').hidden=false;$('reviewFormPanel').hidden=tab!=='form';$('reviewRecordsPanel').hidden=tab!=='records';
 $('reviewFeedbackView').value=tab;$('reviewFeedbackToggle').setAttribute('aria-expanded','true');fit();
}
function closeFeedback(){app.classList.remove('review-feedback-open');$('reviewFeedback').hidden=true;$('reviewFeedbackToggle').setAttribute('aria-expanded','false');fit();}
function remember(){if(current)drafts.set(current.id,{comment:$('reviewComment').value,type:$('reviewIssue').value,spans:structuredClone(spans),scan,feedbackScan,scroll:$('reviewTextBody').scrollTop});}
function renderAnchor(){
 $('reviewAnchor').textContent=selectionError|| (spans.length?'定位：“'+spans.map(s=>s.quote).join('').replace(/\s+/g,' ').slice(0,160)+'”':'本篇');
 if(feedbackScan!==undefined)$('reviewAnchor').textContent+=' · '+(feedbackScan===null?'PDF待定位':'关联PDF扫描第 '+feedbackScan+' 页');
 for(const el of app.querySelectorAll('[data-review-run]'))el.classList.toggle('is-selected',spans.some(s=>s.page===Number(el.dataset.page)&&s.start<Number(el.dataset.end)&&s.end>Number(el.dataset.start)));
}
function capture(){
 if(composing||!current||menuContext)return;
 const selection=window.getSelection();
 if(selection?.isCollapsed){if(document.activeElement===$('reviewTextBody')){spans=[];feedbackScan=undefined;selectionError='';renderAnchor();}return;}
 try{const next=reviewDomSelection($('reviewTextBody'),runs,corpus.byPage,selection);if(next){if(JSON.stringify(next)!==JSON.stringify(spans))feedbackScan=undefined;spans=next;selectionError='';renderAnchor();}}
 catch(e){spans=[];selectionError=e.message;renderAnchor();}
}
function renderCatalog(){
 if(issueCountsState!==state){issueCounts=new Map(chapters.map(c=>[c.id,reviewIssues(c,corpus.byPage,state).length]));issueCountsState=state;}
 const q=$('reviewSearch').value.trim().toLocaleLowerCase();
 $('reviewCatalogList').innerHTML=corpus.index.works.map(w=>{const cs=chapters.filter(c=>c.workId===w.id&&(!q||(c.author+' '+c.workTitle+' '+c.title).toLocaleLowerCase().includes(q)));return cs.length?`<details ${w.id===current.workId||q?'open':''}><summary>${esc(w.author)} · ${esc(w.title)}</summary>${cs.map(c=>`<a href="?chapter=${encodeURIComponent(c.id)}${suffix()}" data-review-chapter="${esc(c.id)}" ${c.id===current.id?'aria-current="page"':''}>${esc(c.title)}<small>${state.items.filter(i=>feedbackForChapter(i,c)).length} 条反馈${issueCounts.get(c.id)?' · 待核 '+issueCounts.get(c.id)+' 处':''}${c.fragments.length?'':' · 尚无合格正文'}</small></a>`).join('')}</details>`:'';}).join('')||'<p>没有匹配篇目。</p>';
}
function renderRecords(){
 const items=state.items.filter(visibleFeedback).filter(i=>$('reviewRecordScope').value==='all'||feedbackForChapter(i)).slice().reverse();
 $('reviewRecordList').innerHTML=items.map(i=>`<article class="review-record"><h3>${esc(i.chapterTitle)} · ${i.proposal.reviewContext?.kind==='pdf-txt'?'PDF与TXT核对':'已有结构反馈'}</h3><small>${esc(i.by)} · ${esc(new Date(i.at).toLocaleString('zh-CN'))} · ${i.status==='pending'?'待处理':i.status==='applied'?'已采用到修订版':'已有处理意见'}</small>${i.anchor.quote?`<blockquote>${esc(i.anchor.quote)}</blockquote>`:''}<p>${esc(i.comment)}</p>${i.resolution?`<p>处理说明：${esc(i.resolution)}</p>`:''}</article>`).join('')||'<p>当前范围暂无反馈。发现漏文、错字或上下文疑点时，可记录问题。</p>';
 const count=state.items.filter(visibleFeedback).length;$('reviewShowRecords').textContent='反馈记录 '+count;$('reviewFeedbackView').options[1].textContent='记录 '+count;
}
function decoratedRun(run){
 const page=corpus.byPage.get(run.page),sourceHint=knownIssues.some(i=>i.scope==='source'&&i.page===run.page&&i.start<run.end&&i.end>run.start);
 const text=reviewDecorations(run,page,knownIssues).map(part=>part.issues.length?`<mark class="review-pending" data-review-issue="${esc(part.issues[0].id)}" title="${esc([...new Set(part.issues.map(i=>i.label+'：'+i.detail))].join('；'))}">${esc(part.text)}</mark>`:esc(part.text)).join('');
 return `<p class="review-text-run${sourceHint?' has-source-hint':''}" data-review-run="${run.id}" data-page="${run.page}" data-start="${run.start}" data-end="${run.end}">${text}</p>`;
}
function renderText(){
 const body=$('reviewTextBody'),scroll=body.scrollTop;knownIssues=reviewIssues(current,corpus.byPage,state);runs=reviewRuns(current,corpus.byPage);
 const content=runs.map(r=>({page:r.page,html:decoratedRun(r)}));
 for(const g of current.gaps)content.push({page:g.page,html:`<aside class="review-gap" data-review-gap title="${esc((g.reasons||[]).join('；'))}">缺文待核 · 来源 ${g.page}（可先略过，继续核对）</aside>`});
 body.innerHTML=content.sort((a,b)=>a.page-b.page).map(v=>v.html).join('')||'<p>本篇暂缺合格正文，已保留待核提示，可先进入下一篇。</p>';body.scrollTop=scroll;renderAnchor();renderIssueSummary();
}
function renderIssueSummary(){
 $('reviewKnownIssues').hidden=!knownIssues.length;
 $('reviewIssueCount').textContent=`待核 ${knownIssues.length}`;
 $('reviewIssueList').innerHTML=knownIssues.map(i=>`<li><span>${esc(i.label)}</span> ${esc(i.page>=20001?(corpus.byPage.get(i.page)?.source.displayLabel||'当前TXT'):'来源 '+i.page)}：${esc(i.detail)}</li>`).join('');
}
function renderChapter(){
 closeContextMenu();renderText();
 $('reviewChapterTitle').textContent=title(current);$('reviewPosition').textContent=current.workTitle+' · '+(chapters.indexOf(current)+1)+' / '+chapters.length;
 const refs=reviewPdfPages(current,corpus.byPage),sources=[...new Set(current.fragments.map(f=>f.page))];
 $('reviewSourceDescription').textContent=corpus.label+' · '+(refs.length?'原PDF参考页 '+pageRanges(refs):'尚无可靠原图定位')+(mode==='legacy'?' · 正文只读，已接顺机器编号换行。':' · 标准TXT与旧扫描须按内容对照，不声称逐字对应。');
 $('reviewTxtSources').innerHTML=sources.map(n=>{const p=corpus.byPage.get(n);return `<option value="${n}">${esc(p.source.displayLabel||'TXT来源 '+n)}</option>`;}).join('');$('reviewTxtSources').disabled=!sources.length;
 sourcePage=refs[0]??null;$('reviewOriginalPages').textContent=refs.length?'扫描 '+pageRanges(refs)+' 页':'待定位（扫描页）';$('reviewOriginalPage').innerHTML=refs.map(n=>`<option value="${n}">第 ${n} 页</option>`).join('');$('reviewOriginalPage').disabled=!refs.length;const d=drafts.get(current.id);spans=d?.spans||[];feedbackScan=d?.feedbackScan;selectionError='';$('reviewComment').value=d?.comment||'';$('reviewIssue').value=d?.type||'missing';renderAnchor();
 $('reviewTextBody').scrollTop=d?.scroll||0;showScan(d?.scan??refs[0]??null);renderCatalog();renderRecords();
 $('reviewPreviousChapter').disabled=chapters.indexOf(current)<=0;$('reviewNextChapter').disabled=chapters.indexOf(current)>=chapters.length-1;$('reviewSave').disabled=!current.fragments.length;
 for(const id of ['reviewStructureLink','reviewHeadingLink'])$(id).href='./annotation-structure.html?chapter='+encodeURIComponent(current.id)+corpusQuery(mode)+(memberId?'&assignee='+encodeURIComponent(memberId):'');
 $('reviewBackAnnotation').href='./annotation.html?chapter='+encodeURIComponent(current.id)+corpusQuery(mode)+(memberId?'&assignee='+encodeURIComponent(memberId):'');
 $('reviewTaskList').href='./annotation-compare.html?view=pdf&chapter='+encodeURIComponent(current.id)+suffix();
 const url=new URL(location.href);url.search='?chapter='+encodeURIComponent(current.id)+suffix();url.hash='';history.replaceState(null,'',url);fit();
}
function scanControls(){const at=scanPages.indexOf(scan);$('reviewPage').value=scan??'';$('reviewPage').min=scanPages[0]||1;$('reviewPage').max=scanPages.at(-1)||1;$('reviewPage').disabled=!scanPages.length;$('reviewJump').disabled=!scanPages.length;$('reviewPreviousPage').disabled=at<=0;$('reviewNextPage').disabled=at<0||at>=scanPages.length-1;$('reviewReturn').disabled=!reviewPdfPages(current,corpus.byPage).length;}
function showScan(n){
 scan=n;scanControls();$('reviewReturn').setAttribute('aria-pressed',String(sourcePage!==null&&scan===sourcePage));$('reviewViewingPage').textContent=n===null?'尚未查看':`正在看第 ${n} 页 · ${reviewPdfPages(current,corpus.byPage).includes(n)?'原文参考页':'上下文页'}`;const img=$('reviewScan'),status=$('reviewScanStatus'),refs=reviewPdfPages(current,corpus.byPage);$('reviewPdfLink').hidden=true;$('reviewImageLink').hidden=n===null;
 if(n===null){img.hidden=true;img.onload=null;img.onerror=null;img.removeAttribute('src');$('reviewScanEmpty').hidden=false;$('reviewScanEmpty').textContent='此TXT尚无可靠原图位置。可输入已知PDF扫描页，自行核对上下文。';status.textContent='PDF位置待定位';return;}
 const inChapter=refs.includes(n),note=`扫描第 ${n} 页 · ${inChapter?'本篇参考页':'范围外上下文'}${refs.length?' · 本篇来源 '+pageRanges(refs):''}`;
 status.textContent=note;$('reviewScanEmpty').hidden=true;img.hidden=false;img.alt='PDF扫描第 '+n+' 页';
 const path='./screening-data/scans/page-'+String(n).padStart(4,'0')+'.jpg';$('reviewImageLink').href=path;
 const part=parts.find(p=>n>=p.start&&n<=p.end);if(part){$('reviewPdfLink').href='./screening-data/part-'+part.part+'.pdf#page='+(n-part.start+1);$('reviewPdfLink').hidden=false;}
 if(img.dataset.scan===String(n)&&img.getAttribute('src')===path&&img.complete&&img.naturalWidth)return;
 img.dataset.scan=String(n);img.onload=()=>{if(scan===n){img.hidden=false;status.textContent=note;}};img.onerror=()=>{if(scan===n){img.hidden=true;$('reviewScanEmpty').hidden=false;$('reviewScanEmpty').textContent='扫描图载入失败，请重试此页或打开原PDF。';status.textContent=note+' · 载入失败';}};img.src=path;$('reviewScanScroll').scrollTop=0;
}
function jump(){if(composing)return;const value=$('reviewPage').value.trim(),n=Number(value);if(!value||!Number.isInteger(n)||!scanPages.includes(n)){notify('请输入现有PDF扫描页码，当前原图未切换。');return;}showScan(n);}
async function loadCatalog(){try{parts=await Promise.all([1,2,3,4].map(n=>readJson('./screening-data/part-'+n+'.json')));if(parts.some((p,i)=>p.part!==i+1||!Array.isArray(p.pages)||p.pages.some(s=>!Number.isInteger(s.page)||s.page<p.start||s.page>p.end)))throw Error('页码索引无效');scanPages=[...new Set(parts.flatMap(p=>p.pages.map(s=>s.page)))].sort((a,b)=>a-b);scanControls();showScan(scan);}catch(e){notify('全书PDF页码暂未载入，本篇原图和TXT仍可查看；请稍后重新读取。');}}
function navigate(id){if(!ready())return;closeContextMenu();const next=chapters.find(c=>c.id===id);if(!next)return;remember();current=next;renderChapter();$('reviewCatalog').hidden=true;}
function saveFailure(error,next){if(next)unsaved=next;$('reviewRecovery').hidden=false;$('reviewRecoveryMessage').textContent=error.message;$('reviewRetry').hidden=!unsaved;notify('反馈未保存，输入已保留。');}
function persist(next){try{raw=saveStructureFeedback(localStorage,key,next,raw,corpus,revision);}catch(e){saveFailure(e,next);return false;}state=next;unsaved=null;$('reviewRecovery').hidden=true;renderText();renderRecords();renderCatalog();return true;}
function save(){
 if(!ready())return;capture();if(selectionError){notify(selectionError);return;}const by=reviewerName().trim();if(!by){notify('请填写真实姓名，再保存问题反馈。');app.querySelector('[data-reviewer-switch]').click();return;}
 try{const next=proposeReviewNote(state,corpus,{chapter:current,spans,scanPage:feedbackScan===undefined?scan:feedbackScan,type:$('reviewIssue').value,comment:$('reviewComment').value,by});if(persist(next)){$('reviewComment').value='';feedbackScan=undefined;drafts.delete(current.id);notify('问题反馈已保存到本机；PDF页码、TXT定位与问题说明已保留。');openFeedback('records');}}catch(e){notify(e.message);}
}
function closeContextMenu(){const el=$('reviewContextMenu');if(el)el.hidden=true;menuContext=null;}
function showContextMenu(event){
 if(composing||event.pointerType==='touch'||event.pointerType==='pen'||(event.pointerType!=='mouse'&&lastPointer.type!=='mouse'&&performance.now()-lastPointer.at<1500))return;
 closeContextMenu();capture();if(selectionError){notify(selectionError);return;}
 const selection=window.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
 if(!range||selection.isCollapsed||!$('reviewTextBody').contains(range.startContainer)||!$('reviewTextBody').contains(range.endContainer))spans=[];
 renderAnchor();menuContext={chapterId:current.id,spans:structuredClone(spans),scanPage:scan};
 event.preventDefault();const menu=$('reviewContextMenu');menu.hidden=false;
 $('reviewContextRecord').textContent=spans.length?'记录所选文字的问题':'记录本篇问题';
 const anchor=range&&!selection.isCollapsed?range.getBoundingClientRect():$('reviewTextBody').getBoundingClientRect(),x=event.clientX||anchor.left+12,y=event.clientY||anchor.top+12,v=window.visualViewport,left=v?.offsetLeft||0,top=v?.offsetTop||0,width=v?.width||innerWidth,height=v?.height||innerHeight;
 const rect=menu.getBoundingClientRect();menu.style.left=Math.max(left+6,Math.min(x,left+width-rect.width-6))+'px';menu.style.top=Math.max(top+6,Math.min(y,top+height-rect.height-6))+'px';
 $('reviewContextRecord').focus({preventScroll:true});
}
function useContext(quick=false){
 const context=menuContext;if(!context||context.chapterId!==current.id){closeContextMenu();return;}
 closeContextMenu();spans=context.spans;selectionError='';renderAnchor();
 if(!quick){feedbackScan=context.scanPage;openFeedback();renderAnchor();notify('已带入原选区和PDF位置，填写问题后保存。');return;}
 if(!ready())return;const by=reviewerName().trim();
 if(!by){if(!$('reviewComment').value.trim())$('reviewComment').value='已标为待核，先继续审阅，稍后集中处理。';openFeedback();notify('请填写真实姓名后保存，所选文字已保留。');app.querySelector('[data-reviewer-switch]').click();return;}
 try{const next=proposeReviewNote(state,corpus,{chapter:current,spans:context.spans,scanPage:context.scanPage,type:'other',comment:'已标为待核，先继续审阅，稍后集中处理。',by});if(persist(next))notify('已记待核，可继续核对其他正文。');}catch(e){notify(e.message);}
}
function fit(){if(innerHeight<=560&&app.classList.contains('review-feedback-open')&&$('reviewContext'))$('reviewContext').open=false;const v=window.visualViewport,top=app.getBoundingClientRect().top;app.style.height=Math.max(160,Math.min(innerHeight,v?v.height+v.offsetTop:innerHeight)-Math.max(0,top))+'px';}
function mount(){
 app.innerHTML=`<header class="review-heading"><div><h1>原文对照</h1></div></header><nav class="review-toolbar" aria-label="审核工具"><a id="reviewTaskList">← 目录</a><button id="reviewPreviousChapter" type="button" aria-label="上一篇">←</button><span class="review-position" id="reviewPosition"></span><button id="reviewNextChapter" type="button" aria-label="下一篇">→</button><details class="review-more review-actions"><summary>操作</summary><div>${reviewerMenu()}<button id="reviewCatalogToggle" type="button" aria-expanded="false">篇目目录</button><button id="reviewShowRecords" type="button">反馈记录</button><a href="./annotation-gap-tasks.html">缺文校对</a><a id="reviewBackAnnotation">书论标注</a><a id="reviewStructureLink">结构调整</a><a id="reviewHeadingLink">结构修订</a><button id="reviewExport" type="button">导出 JSON</button><button id="reviewImport" type="button">导入</button><input id="reviewImportFile" type="file" accept=".json,application/json" hidden></div></details></nav>
 <div class="review-workspace"><section class="review-pdf" aria-label="PDF上下文"><header class="review-panel-heading"><h2>PDF原图</h2><a id="reviewPdfLink" target="_blank" rel="noopener" hidden aria-label="打开当前查看页PDF">本页PDF</a><a id="reviewImageLink" target="_blank" rel="noopener" hidden aria-label="放大当前查看页">放大</a></header><div class="page-source-controls" role="group" aria-label="原文位置"><strong>原文位置</strong><span id="reviewOriginalPages"></span><select id="reviewOriginalPage" aria-label="原文扫描页"></select><button id="reviewReturn" type="button">查看原文</button><select id="reviewFit" aria-label="原图显示"><option value="page">整页</option><option value="width">适宽</option></select></div><details class="page-context-controls" id="reviewContext"><summary>上下文查验 <span id="reviewViewingPage"></span></summary><div class="review-pdf-controls"><button id="reviewPreviousPage" type="button" disabled>← 前页</button><button id="reviewNextPage" type="button" disabled>后页 →</button><form id="reviewPageForm"><label>查验页<input id="reviewPage" aria-label="上下文扫描页码" type="number" step="1" inputmode="numeric" disabled></label><button id="reviewJump" type="submit" disabled>跳转</button></form></div></details><p class="review-scan-note" id="reviewScanStatus" role="status"></p><div class="review-scan-scroll" id="reviewScanScroll"><p class="review-scan-empty" id="reviewScanEmpty" hidden></p><img id="reviewScan" alt="PDF扫描原图"></div></section>
 <section class="review-text" aria-label="TXT对照正文"><header class="review-panel-heading"><h2 id="reviewChapterTitle"></h2><label>TXT<select id="reviewTxtSources" aria-label="TXT来源定位"></select></label></header><div class="review-source-meta" id="reviewSourceMeta"><details><summary>来源</summary><div id="reviewSourceDescription"></div></details><details id="reviewKnownIssues" hidden><summary id="reviewIssueCount"></summary><ul id="reviewIssueList"></ul></details></div><div id="reviewTextBody" class="review-text-scroll" tabindex="0" aria-label="连续TXT正文，可选文定位"></div></section>
 <aside class="review-catalog" id="reviewCatalog" hidden aria-label="审核篇目目录"><header>选择篇目<button id="reviewCloseCatalog" type="button">收起</button></header><input type="search" id="reviewSearch" aria-label="查找审核篇目" placeholder="作者、篇名、章节"><div id="reviewCatalogList" class="review-catalog-list"></div></aside>
 <section class="review-feedback" id="reviewFeedback" aria-label="问题反馈" hidden><header class="review-feedback-heading"><select id="reviewFeedbackView" aria-label="反馈视图"><option value="form">问题</option><option value="records">记录</option></select><button id="reviewCloseFeedback" type="button">收起</button></header><div id="reviewFormPanel" class="review-feedback-body"><form id="reviewForm"><div><label>类型<select id="reviewIssue">${Object.entries(reviewIssueTypes).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><div class="review-anchor" id="reviewAnchor"></div></div><label>说明<textarea id="reviewComment" maxlength="3500" placeholder="记录问题"></textarea></label><div><button id="reviewSave" type="submit" class="review-primary">保存</button><span class="review-feedback-hint"></span></div></form></div><div id="reviewRecordsPanel" class="review-feedback-body" hidden><label>范围<select id="reviewRecordScope"><option value="chapter">当前篇目</option><option value="all">全部篇目</option></select></label><div id="reviewRecordList"></div></div></section></div>
 <footer class="review-footer"><span id="reviewNotice" role="status">选文右键记录问题，存疑可先继续。</span><button id="reviewFeedbackToggle" type="button" class="review-primary" aria-expanded="false">记录问题</button></footer><section class="review-recovery" id="reviewRecovery" hidden><p id="reviewRecoveryMessage" role="alert"></p><button id="reviewRescue" type="button">下载反馈备份</button><button id="reviewDraftText" type="button">下载当前输入</button><button id="reviewRetry" type="button">重试保存</button><button id="reviewReload" type="button">备份并重新读取</button></section><dialog id="reviewImportDialog"></dialog><div id="reviewContextMenu" role="menu" aria-label="TXT问题反馈" hidden><button id="reviewContextRecord" type="button" role="menuitem">记录所选文字的问题</button><button id="reviewContextQuick" type="button" role="menuitem">标为待核，继续</button></div>`;
 bindReviewerMenu(app,()=>!composing);
 $('reviewCatalogToggle').onclick=()=>{const open=$('reviewCatalog').hidden;$('reviewCatalog').hidden=!open;$('reviewCatalogToggle').setAttribute('aria-expanded',String(open));};$('reviewCloseCatalog').onclick=()=>{$('reviewCatalog').hidden=true;$('reviewCatalogToggle').setAttribute('aria-expanded','false');};$('reviewSearch').oninput=renderCatalog;
 $('reviewCatalogList').onclick=e=>{const a=e.target.closest('[data-review-chapter]');if(a){e.preventDefault();navigate(a.dataset.reviewChapter);}};
 for(const [id,delta] of [['reviewPreviousChapter',-1],['reviewNextChapter',1]])$(id).onclick=()=>navigate(chapters[chapters.indexOf(current)+delta]?.id);
 for(const [id,delta] of [['reviewPreviousPage',-1],['reviewNextPage',1]])$(id).onclick=()=>{if(composing)return;const n=scanPages[scanPages.indexOf(scan)+delta];if(n)showScan(n);};
 $('reviewPageForm').onsubmit=e=>{e.preventDefault();jump();};$('reviewPage').onkeydown=e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.preventDefault();};$('reviewOriginalPage').onchange=e=>{if(composing){e.target.value=sourcePage??'';return;}sourcePage=Number(e.target.value);showScan(sourcePage);};$('reviewReturn').onclick=()=>{if(!composing)showScan(sourcePage);};$('reviewFit').onchange=e=>{$('reviewScanScroll').classList.toggle('is-width',e.target.value==='width');};
 $('reviewContext').ontoggle=()=>{if($('reviewContext').open&&innerHeight<=560&&app.classList.contains('review-feedback-open'))closeFeedback();};
 $('reviewTxtSources').onchange=e=>{const el=app.querySelector(`[data-review-run][data-page="${Number(e.target.value)}"]`);el?.scrollIntoView({block:'start'});};
 $('reviewContextRecord').onclick=()=>useContext();$('reviewContextQuick').onclick=()=>useContext(true);
 $('reviewTextBody').onpointerdown=e=>{lastPointer={type:e.pointerType||'mouse',at:performance.now()};closeContextMenu();};$('reviewTextBody').oncontextmenu=showContextMenu;
 $('reviewTextBody').onpointerup=capture;$('reviewTextBody').onkeyup=capture;$('reviewForm').onpointerdown=capture;$('reviewForm').onsubmit=e=>{e.preventDefault();if(!composing&&!e.isComposing)save();};
 $('reviewFeedbackToggle').onclick=()=>{capture();if(app.classList.contains('review-feedback-open'))closeFeedback();else openFeedback();};$('reviewShowRecords').onclick=()=>openFeedback('records');$('reviewFeedbackView').onchange=e=>openFeedback(e.target.value);$('reviewCloseFeedback').onclick=closeFeedback;$('reviewRecordScope').onchange=renderRecords;
 app.addEventListener('compositionstart',()=>{composing=true;});app.addEventListener('compositionend',()=>{composing=false;});
 $('reviewDraftText').onclick=draftText;$('reviewExport').onclick=backup;$('reviewRescue').onclick=backup;$('reviewRetry').onclick=()=>{if(!composing&&unsaved&&persist(unsaved)){$('reviewComment').value='';feedbackScan=undefined;drafts.delete(current.id);notify('反馈已成功保存。');openFeedback('records');}};$('reviewReload').onclick=()=>{if($('reviewComment').value.trim())draftText();else backup();location.reload();};
 $('reviewImport').onclick=()=>$('reviewImportFile').click();$('reviewImportFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!ready())return;try{if(file.size>10*1024*1024)throw Error('反馈文件超过10MB。');const incoming=JSON.parse(await file.text()),next=mergeStructureFeedback(state,incoming,corpus,revision),snapshot=raw,d=$('reviewImportDialog');d.innerHTML=`<h2>导入反馈预览</h2><p>文件含 ${incoming.items.length} 条反馈，合并后共 ${next.items.length} 条。原文与标注任务目录保持。</p><p id="reviewImportError" role="alert"></p><button id="reviewCancelImport" type="button">取消</button><button id="reviewApplyImport" type="button">合并这些反馈</button>`;$('reviewCancelImport').onclick=()=>d.close();$('reviewApplyImport').onclick=()=>{if(!ready())return;if(raw!==snapshot){$('reviewImportError').textContent='记录已变化，请重新选择文件。';return;}if(persist(next)){d.close();notify('反馈记录已合并。');openFeedback('records');}};d.showModal();}catch(error){notify(error.message);}};
}
async function init(){
 try{if(!reviewerName()){const directory=new URL('./annotation-compare.html',location.href);directory.search=location.search;directory.searchParams.set('view','pdf');directory.hash=location.hash;location.replace(directory);return;}corpus=await loadAnnotationCorpus(location.search);revision=await corpusDigest({mode,index:corpus.index,sources:corpus.pages.filter(p=>p.eligible).map(p=>[p.page,p.source.textSha256])});raw=localStorage.getItem(key);state=raw===null?emptyStructureFeedback(revision,mode):validateStructureFeedback(JSON.parse(raw),corpus,revision);chapters=corpus.index.chapters;
 if(memberId){assignment=readCorpusAssignments(localStorage,corpus.index,mode);const scope=assignmentScope(assignment.value,corpus.index,memberId);chapters=scope.chapters;if(!chapters.length)throw Error('该成员尚无篇目分工，请返回成员任务页。');}
 const requested=params.get('chapter'),id=corpus.index.chapterAliases[requested]||requested;if(memberId&&id&&!chapters.some(c=>c.id===id))throw Error('此篇目不在本人分工范围内。');current=chapters.find(c=>c.id===id)||chapters.find(c=>c.fragments.length)||chapters[0];if(!current)throw Error('当前没有可对照的合格正文。');mount();renderChapter();void loadCatalog();
 if(initialHash.startsWith('#selection=')){try{const input=JSON.parse(decodeURIComponent(initialHash.slice(11)));spans=input.map(s=>{const p=corpus.byPage.get(s.page);if(!p||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.end<=s.start||s.textSha256!==p.source.textSha256||!current.fragments.some(f=>f.page===s.page&&s.start>=f.start&&s.end<=f.end))throw Error('传入的TXT选区已失效，请重新选择。');return {...s,quote:p.text.slice(s.start,s.end)};});renderAnchor();openFeedback();}catch(e){notify(e.message);}}
 }catch(e){app.innerHTML=`<section class="review-error-page"><h1>PDF与TXT对照暂未载入</h1><p role="alert">${esc(e.message)}</p><button id="reviewRawBackup" type="button">下载现有反馈原记录</button><a href="./annotation-compare.html?from=pdf${corpusQuery(mode)}">返回任务页</a></section>`;$('reviewRawBackup').onclick=()=>download('现有反馈原记录.json',localStorage.getItem(key)||'null');}
}
document.addEventListener('selectionchange',capture);
document.addEventListener('pointerdown',e=>{if(menuContext&&!$('reviewContextMenu').contains(e.target))closeContextMenu();},true);
document.addEventListener('keydown',e=>{if(composing||e.isComposing||e.keyCode===229)return;if(e.key==='Escape'&&menuContext){e.preventDefault();closeContextMenu();$('reviewTextBody').focus({preventScroll:true});}else if(menuContext&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[$('reviewContextRecord'),$('reviewContextQuick')],at=buttons.indexOf(document.activeElement);buttons[(at+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}});
window.addEventListener('blur',closeContextMenu);
window.addEventListener('resize',closeContextMenu);

window.addEventListener('storage',e=>{if(e.key===key||e.key===null){stale=true;if($('reviewRecovery'))saveFailure(Error('其他窗口已更新反馈，原记录未覆盖。请下载本次备份后重新读取。'));}});
window.addEventListener('beforeunload',e=>{if(unsaved||$('reviewComment')?.value.trim()||[...drafts.values()].some(d=>d.comment.trim())){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);window.visualViewport?.addEventListener('scroll',fit);
init();

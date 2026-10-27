import {loadAnnotationCorpus,corpusMode,corpusQuery,bindCorpusProgress} from './annotation-corpus.js?v=index-archive-20261027';
import {esc} from './annotation-chapters.js?v=index-archive-20261027';
import {readProgress} from './delivery-core.js?v=index-archive-20261027';
import {chapterProgressKey,readChapterProgress,effectiveChapterProgress,chapterIsConfirmed} from './chapter-annotation-core.js?v=index-archive-20261027';
import {assignmentKey,standardAssignmentKey,bookFoldKey,readCorpusAssignments,assignmentsUnchanged,saveAssignments,assignedName,changeAssignments,validateAssignments,mergeAssignments,memberTasks} from './annotation-assignments.js?v=annotation-release-20261024';

const app=document.querySelector('#annotationTaskApp');
window.WorkspaceUI.mount('annotation');
document.body.classList.add('annotation-task-overview');
let corpus,progressKey=chapterProgressKey;
const href=id=>'./annotation.html?chapter='+encodeURIComponent(id)+corpusQuery(corpus?.mode);
const title=c=>(c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':'')+c.title;
let index,statuses,available,resume,plan,planRaw,planStore,lastChapterId='',filter='all';
const params=new URLSearchParams(location.search);
// Existing chapter/page bookmarks continue to open the complete chapter editor.
if(params.has('chapter')||params.has('page'))location.replace('./annotation.html'+location.search+location.hash);
else init();
const message=text=>{app.querySelector('#taskUpdateNotice').textContent=text;};
function download(name,content){const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

async function init(){
 try{
  const legacy=Object.fromEntries([1,2,3,4].map(n=>[n,readProgress(localStorage,n).value]));
  corpus=await loadAnnotationCorpus(location.search);progressKey=corpus.key;index=corpus.index;const {pages,byPage}=corpus;
  planStore=readCorpusAssignments(localStorage,index,corpus.mode);({raw:planRaw,value:plan}=planStore);
  const stored=readChapterProgress(localStorage,byPage,progressKey),state=bindCorpusProgress(stored.value,corpus);effectiveChapterProgress(legacy,state,byPage);
  statuses=new Map(await Promise.all(index.chapters.map(async c=>[c.id,await chapterIsConfirmed(c,byPage,legacy,state)])));
  available=index.chapters.filter(c=>c.fragments.length);
  const last=index.chapterAliases[state.lastChapterId]||state.lastChapterId;lastChapterId=last;
  resume=available.find(c=>c.id===last)||available.find(c=>!statuses.get(c.id)&&c.candidateCount)||available.find(c=>!statuses.get(c.id))||available[0];
  const confirmed=available.filter(c=>statuses.get(c.id)).length,pending=available.length-confirmed,blocked=pages.filter(p=>!p.eligible),eligible=pages.filter(p=>p.eligible),ai=eligible.reduce((n,p)=>n+p.candidates.length,0),waiting=index.chapters.filter(c=>!c.fragments.length);
  app.innerHTML=`<header class="task-heading"><div><p>团队任务 / 书论标注 · ${esc(corpus.label)}</p><h1>书论标注</h1></div><p class="task-heading-note">按章通读 · 按章分工 · 整章确认<br><a id="openSourceReview" href="./annotation-compare.html">wolai与人工稿差异复核 →</a><br><a id="openStructureFeedback" href="./annotation-structure.html?chapter=${encodeURIComponent(resume.id)}${corpusQuery(corpus.mode)}">核查分段与章节／提交反馈 →</a></p></header>
   <nav class="task-view-tabs" role="tablist" aria-label="分工与目录"><button type="button" role="tab" id="memberViewTab" data-task-view="assignments" aria-controls="memberTaskPanel" aria-selected="true">成员分工</button><button type="button" role="tab" id="directoryViewTab" data-task-view="directory" aria-controls="directoryTaskPanel" aria-selected="false">书籍目录</button></nav>
   <section id="memberTaskPanel" class="member-task-panel" role="tabpanel" aria-labelledby="memberViewTab"><header class="member-board-heading"><div><h2>《历代书法论文选》书论标注</h2><p id="memberAllocationSummary"></p></div><button type="button" id="openAssignment" class="action-button">安排分工</button></header><div class="member-board-tools"><span>选择自己的成员入口，按负责篇章进行标注。</span><button type="button" id="exportAssignments">导出分工</button><button type="button" id="importAssignments">导入分工</button><input type="file" id="assignmentImportFile" accept=".json,application/json" hidden></div><div id="memberTaskList" class="member-task-list" tabindex="0" aria-label="成员与明确负责范围"></div><footer class="member-board-note"><span>分工方案保存在本机，可导出给成员使用。</span><button type="button" id="assignUnallocated">安排未分工章节</button></footer></section>
   <section id="directoryTaskPanel" class="directory-task-panel" role="tabpanel" aria-labelledby="directoryViewTab" hidden><section class="task-resume" aria-label="继续整章标注"><div class="task-resume-copy"><p class="task-eyebrow">${state.lastChapterId?'上次阅读位置':'从这里开始'}</p><h2>${esc(resume.author)} · ${esc(resume.workTitle)}</h2><p class="task-resume-title">${esc(title(resume))}${resume.gaps.length?' <span class="task-gap-label">含审核缺口</span>':''}</p><a id="resumeChapter" class="action-button" href="${href(resume.id)}">${state.lastChapterId?'继续整章标注':'开始整章标注'} <span aria-hidden="true">→</span></a></div><div class="task-progress"><p><strong>${confirmed}</strong><span> / ${available.length} 章已确认</span></p><progress value="${confirmed}" max="${available.length}" aria-label="整章确认进度"></progress><small>${pending?`还有 ${pending} 章待确认`:'全部开放章节已确认'} · 本机记录</small></div></section>
   <div class="task-body"><details id="taskBook" class="task-book" ${localStorage.getItem(bookFoldKey)==='open'?'open':''}><summary><span class="task-book-title"><span aria-hidden="true" class="task-book-symbol">▤</span><span><strong>《历代书法论文选》</strong><small>${index.works.length} 篇／附录 · ${available.length} 个开放章节</small></span></span><span class="task-book-toggle"><span class="when-closed">展开目录</span><span class="when-open">收起目录</span><span aria-hidden="true">⌄</span></span></summary>
    <section class="task-catalog" aria-labelledby="taskCatalogTitle"><div class="task-catalog-head"><div><h2 id="taskCatalogTitle">章节目录</h2><span>按作者与篇目查阅</span></div><label class="task-search"><span class="sr-only">查找作者、篇名或章节</span><input id="taskChapterSearch" type="search" placeholder="查找作者、篇名或章节" autocomplete="off"></label><div class="task-filter-row"><div class="task-filters" role="group" aria-label="章节状态"><button type="button" data-filter="all" aria-pressed="true">全部</button><button type="button" data-filter="pending" aria-pressed="false">待确认 ${pending}</button><button type="button" data-filter="confirmed" aria-pressed="false">已确认 ${confirmed}</button></div><span id="taskResultCount" role="status"></span></div></div><div id="taskChapterList" class="task-chapter-list" tabindex="0" aria-label="按作者与篇目排列的章节目录"></div></section></details>
   <aside class="task-aside"><section class="task-guide"><h2>标注方法</h2><p><a href="./annotation-compare.html">wolai与人工稿差异复核 →</a></p><p><a href="./annotation-gap-tasks.html">缺文校对书籍目录 →</a></p><p><a href="./annotation-compare.html?view=pdf${corpusQuery(corpus.mode)}">查看PDF与TXT上下文 →</a></p><p><a id="openStructureFeedbackGuide" href="./annotation-structure.html?chapter=${encodeURIComponent(resume.id)}${corpusQuery(corpus.mode)}">核查AI分段与章节／提交反馈 →</a></p><ol><li>展开书籍，按作者、篇目选择章节。</li><li>打开整章，通读正文与对应原图；AI初标默认保留，漏标补标，标错删除。</li><li>完成后，确认本章。</li></ol><p>${corpus.mode==='legacy'?'含审核缺口的章节，只确认已开放内容。':'标准任务只确认已开放正文，不表示全书或来源缺文已补齐。'}</p></section><details class="task-resources"><summary>资料与备份</summary><div><p>${esc(corpus.label)} ${eligible.length} 份来源已接入；${blocked.length} 页来源待核，未接入标注。当前保留 ${ai} 处AI初标。</p><p>分工只记录章节负责人，不改变原文、标注或确认状态。原审核TXT、旧标注与历史记录保留。</p>${corpus.mode==='legacy'?'':'<a href="./annotation-data/wolai-standard.txt" download="wolai标准整合全文.txt">下载标准全文TXT →</a>'}<a href="./annotation-tasks.html?view=directory${corpus.mode==='legacy'?'':'&corpus=legacy'}">${corpus.mode==='legacy'?'返回wolai标准任务':'打开旧审核语料任务'} →</a><a href="${href(resume.id)}&panel=backup">进入工作区备份、导出或恢复 →</a>${waiting.length?`<details class="task-waiting"><summary>${waiting.length} 个章节尚无合格正文</summary>${waiting.map(c=>`<a href="${href(c.id)}">${esc(c.author)} · ${esc(c.workTitle)} · ${esc(title(c))}</a>`).join('')}</details>`:''}</div></details></aside></div></section>
   <footer class="task-footnote"><span>分工与目录独立查看；原审核TXT和标注保留。</span><span id="taskUpdateNotice" role="status"></span></footer><dialog id="taskAssignmentDialog" class="task-assignment-dialog" aria-labelledby="assignmentHeading"></dialog><dialog id="taskAssignmentImportDialog" class="task-assignment-dialog" aria-labelledby="assignmentImportHeading"></dialog>`;
  const update=()=>renderList();
  app.querySelector('#taskChapterSearch').addEventListener('input',update);
  for(const button of app.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;for(const b of app.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===button));update();};
  const book=app.querySelector('#taskBook');
  function rememberBook(open){try{localStorage.setItem(bookFoldKey,open?'open':'closed');}catch{message('目录已切换，浏览器暂不能保存收展偏好。');}}
  // The native toggle event is queued; remember clicks before an immediate refresh.
  book.querySelector(':scope>summary').addEventListener('click',()=>rememberBook(!book.open));
  book.addEventListener('toggle',()=>rememberBook(book.open));
  app.querySelector('#openAssignment').onclick=()=>openAssignment();
  app.querySelector('#exportAssignments').onclick=()=>{try{readCurrentPlan();download('历代书法论文选-章节分工.json',JSON.stringify(plan,null,2));message('分工方案已导出；成员在任务页导入后可从本人任务卡进入。');}catch(e){message(e.message);}};
  app.querySelector('#importAssignments').onclick=()=>app.querySelector('#assignmentImportFile').click();app.querySelector('#assignmentImportFile').onchange=previewAssignments;
  renderMemberBoard();update();setView(params.get('view')==='directory'?'directory':'assignments',false);
  for(const tab of app.querySelectorAll('[data-task-view]')){tab.onclick=()=>setView(tab.dataset.taskView);tab.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=[...app.querySelectorAll('[data-task-view]')],target=e.key==='Home'?tabs[0]:e.key==='End'?tabs.at(-1):tabs[(tabs.indexOf(tab)+1)%tabs.length];setView(target.dataset.taskView);target.focus();}};}
  app.querySelector('#assignUnallocated').onclick=()=>openAssignment('all',{unassigned:true});
  app.setAttribute('aria-busy','false');
 }catch(e){app.setAttribute('aria-busy','false');app.innerHTML=`<section class="task-load-error"><h1>书论标注任务暂未载入</h1><p role="alert">${esc(e.message)}</p><p>原审核TXT、已有标注和分工记录保留。</p><button id="retryTask">重新读取</button><button id="backupRawAssignments">导出原分工记录</button></section>`;app.querySelector('#retryTask').onclick=()=>location.reload();app.querySelector('#backupRawAssignments').onclick=()=>download('分工原记录.json',localStorage.getItem(corpusMode(location.search)==='legacy'?assignmentKey:standardAssignmentKey)||'null');}
}
function setView(view,changeUrl=true){
 const directory=view==='directory';app.querySelector('#directoryTaskPanel').hidden=!directory;app.querySelector('#memberTaskPanel').hidden=directory;
 for(const tab of app.querySelectorAll('[data-task-view]')){const active=tab.dataset.taskView===view;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
 if(changeUrl){const url=new URL(location.href);url.searchParams.set('view',view);history.replaceState(null,'',url);}
}
function renderMemberBoard(){
 const assigned=Object.keys(plan.assignments).length,pending=available.length-assigned;
 app.querySelector('#memberAllocationSummary').textContent=`${plan.members.length} 位成员 · 已分工 ${assigned} / ${available.length} 章 · 尚未分工 ${pending} 章`;
 const list=app.querySelector('#memberTaskList');list.innerHTML=memberTasks(plan,index,statuses).map((task,n)=>{
  const {member,chapters,works,confirmed}=task;
  const next=chapters.find(c=>c.id===lastChapterId)||chapters.find(c=>!statuses.get(c.id))||chapters[0];
  const scope=chapters.length===available.length?`本书全部 ${available.length} 个开放章节`:works.map(g=>`${g.work.author}《${g.work.title}》：${g.chapters.length===available.filter(c=>c.workId===g.work.id).length?'全部开放章节':g.chapters.map(title).join('、')}（${g.chapters.length}章）`).join('；');
  return `<article class="member-task-card" data-member-task="${esc(member.id)}"><div class="member-task-number">${String(n+1).padStart(2,'0')}</div><div class="member-task-copy"><h3>${esc(member.name)}</h3><p class="member-task-count">${chapters.length?`负责 ${works.length} 篇 · 共 ${chapters.length} 章`:'尚未分配章节'}</p>${chapters.length?`<details class="member-task-scope"><summary>负责范围：${esc(scope)}</summary><ol>${chapters.map(c=>`<li>${esc(c.author)} · 《${esc(c.workTitle)}》 · ${esc(title(c))}</li>`).join('')}</ol></details><p class="member-task-progress">本机已确认 ${confirmed} / ${chapters.length} 章 · 待确认 ${chapters.length-confirmed} 章</p>`:'<p class="member-task-pending">请安排整章后再进入标注。</p>'}</div><div class="member-task-actions">${next?`<a class="action-button" data-enter-member="${esc(member.id)}" href="${href(next.id)}&assignee=${encodeURIComponent(member.id)}">进入标注 →</a>`:'<button type="button" class="quiet-button" disabled>暂无任务</button>'}<button type="button" class="member-task-adjust" data-adjust-member="${esc(member.id)}">调整分工</button></div></article>`;
 }).join('')||'<div class="member-board-empty"><h3>当前尚未安排标注分工</h3><p>点击“安排分工”，明确负责人及其负责的篇目、章节。保存后每位成员都有独立任务卡与进入入口。</p></div>';
 for(const b of list.querySelectorAll('[data-adjust-member]'))b.onclick=()=>openAssignment('all',{memberId:b.dataset.adjustMember});
 app.querySelector('#assignUnallocated').disabled=pending===0;app.querySelector('#assignUnallocated').textContent=pending?`安排未分工章节 · ${pending} 章`:'全部章节已分工';
}
function renderList(){
 const q=app.querySelector('#taskChapterSearch').value.trim().toLocaleLowerCase(),list=app.querySelector('#taskChapterList');let count=0;
 list.innerHTML=index.works.map(w=>{
  const chapters=available.filter(c=>c.workId===w.id).filter(c=>(filter==='all'||(filter==='confirmed')===Boolean(statuses.get(c.id)))&&(!q||(w.author+' '+w.title+' '+(w.contributors||[]).join(' ')+' '+title(c)).toLocaleLowerCase().includes(q)));
  if(!chapters.length)return '';count+=chapters.length;
  const done=chapters.filter(c=>statuses.get(c.id)).length;
  return `<details class="task-work" ${q||filter!=='all'||w.id===resume.workId?'open':''}><summary><span><strong>${esc(w.author)}</strong><span class="task-work-title">${esc(w.title)}</span></span><small>${done?`${done} 已确认 · `:''}${chapters.length} 章</small></summary><div class="task-work-chapters">${chapters.map(c=>`<a class="task-chapter-row" href="${href(c.id)}" ${c.id===resume.id?'aria-current="location"':''}><span>${esc(title(c))}${c.gaps.length?'<small class="task-gap-label">含审核缺口</small>':''}</span><span class="task-row-meta"><span class="task-chapter-status ${statuses.get(c.id)?'is-confirmed':''}">${statuses.get(c.id)?'已确认':'待确认'} <span aria-hidden="true">→</span></span></span></a>`).join('')}</div></details>`;
 }).join('')||'<p class="task-no-results">没有符合条件的章节，请调整关键词或切换状态。</p>';
 app.querySelector('#taskResultCount').textContent=count+' 章';list.scrollTop=0;
}
function readCurrentPlan(){if(!assignmentsUnchanged(localStorage,planStore))throw new Error('其他窗口更新了分工，请刷新任务页后再操作。');}
function persistPlan(next){readCurrentPlan();const nextRaw=saveAssignments(localStorage,next,planRaw,index,planStore.key);plan=next;planRaw=nextRaw;planStore={...planStore,raw:nextRaw,inheritedKey:null,inheritedRaw:null};renderMemberBoard();renderList();}
function openAssignment(workId='all',{memberId='',unassigned=false}={}){
 const dialog=app.querySelector('#taskAssignmentDialog'),selected=new Set(available.filter(c=>unassigned?!plan.assignments[c.id]:memberId&&plan.assignments[c.id]===memberId).map(c=>c.id));
 dialog.innerHTML=`<form id="assignmentForm"><header><div><p>《历代书法论文选》</p><h2 id="assignmentHeading">安排章节分工</h2></div><button type="button" id="closeAssignment" aria-label="关闭分工窗口">✕</button></header><p class="assignment-hint">按整章分配；更换负责人只调整分工，正文和标注记录保留。</p><div class="assignment-fields"><label>负责人<input id="assignmentPerson" list="assignmentMembers" maxlength="80" placeholder="填写姓名或选择已有成员" autocomplete="off"><datalist id="assignmentMembers">${plan.members.map(m=>`<option value="${esc(m.name)}"></option>`).join('')}</datalist></label><label>选择篇目<select id="assignmentWork"><option value="all">整本书 · 全部开放章节</option>${index.works.filter(w=>available.some(c=>c.workId===w.id)).map(w=>`<option value="${esc(w.id)}">${esc(w.author)} · ${esc(w.title)}</option>`).join('')}</select></label></div><div class="assignment-select-tools"><button type="button" id="selectAssignmentScope">选中当前范围</button><button type="button" id="clearAssignmentSelection">清空所选</button><span id="assignmentSelectionCount" role="status">已选 0 章</span></div><div id="assignmentChapterChoices" class="assignment-choices"></div><p id="assignmentPreview" class="assignment-hint"></p><p id="assignmentError" role="alert"></p><footer><button type="button" id="unassignChapters">撤销所选分工</button><button type="submit" class="action-button" id="saveAssignment">保存分工</button></footer></form>`;
 const work=dialog.querySelector('#assignmentWork'),person=dialog.querySelector('#assignmentPerson');work.value=workId;person.value=plan.members.find(m=>m.id===memberId)?.name||'';
 const visible=()=>available.filter(c=>work.value==='all'||c.workId===work.value);
 function updateCount(){const assigned=[...selected].filter(id=>plan.assignments[id]).length;dialog.querySelector('#assignmentSelectionCount').textContent=`已选 ${selected.size} 章`;dialog.querySelector('#assignmentPreview').textContent=assigned?`所选中 ${assigned} 章已有负责人；保存后会改为上方指定的人，撤销则恢复为尚未分工。`:'仅分配勾选的章节；尚无合格正文的章节不参与分工。';}
 function choices(){const chapters=visible();dialog.querySelector('#assignmentChapterChoices').innerHTML=index.works.map(w=>{const cs=chapters.filter(c=>c.workId===w.id);return cs.length?`<fieldset><legend>${esc(w.author)} · ${esc(w.title)}</legend>${cs.map(c=>`<label><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?'checked':''}><span>${esc(title(c))}</span><small>${esc(assignedName(plan,c.id)||'尚未分工')}</small></label>`).join('')}</fieldset>`:'';}).join('');for(const box of dialog.querySelectorAll('.assignment-choices input'))box.onchange=()=>{if(box.checked)selected.add(box.value);else selected.delete(box.value);updateCount();};updateCount();}
 work.onchange=()=>{selected.clear();choices();};person.addEventListener('input',updateCount);
 dialog.querySelector('#selectAssignmentScope').onclick=()=>{visible().forEach(c=>selected.add(c.id));choices();};dialog.querySelector('#clearAssignmentSelection').onclick=()=>{selected.clear();choices();};
 dialog.querySelector('#closeAssignment').onclick=()=>dialog.close();
 function save(name){if(person.dataset.composing==='true'){dialog.querySelector('#assignmentError').textContent='请先确认姓名输入候选，再保存分工。';return;}try{persistPlan(changeAssignments(plan,[...selected],name,index));dialog.close();message(name===null?'所选章节分工已撤销，标注记录保留。':'章节分工已保存，成员任务卡已更新。');}catch(e){dialog.querySelector('#assignmentError').textContent=e.message;}}
 dialog.querySelector('#assignmentForm').onsubmit=e=>{e.preventDefault();if(e.isComposing||person.matches(':focus')&&person.dataset.composing==='true')return;save(person.value);};
 person.addEventListener('compositionstart',()=>{person.dataset.composing='true';});person.addEventListener('compositionend',()=>{person.dataset.composing='false';});
 dialog.querySelector('#unassignChapters').onclick=()=>save(null);choices();dialog.showModal();
}
async function previewAssignments(e){
 const file=e.target.files[0];e.target.value='';if(!file)return;
 try{
  if(file.size>5*1024*1024)throw new Error('分工文件超过5MB，请选择导出的章节分工JSON。');
  const incoming=validateAssignments(JSON.parse(await file.text()),index),next=mergeAssignments(plan,incoming,index),dialog=app.querySelector('#taskAssignmentImportDialog');
  const added=Object.keys(next.assignments).length-Object.keys(plan.assignments).length;
  dialog.innerHTML=`<header><h2 id="assignmentImportHeading">导入分工预览</h2><button type="button" id="cancelAssignmentImport" aria-label="取消导入">✕</button></header><p>文件含 ${incoming.members.length} 位成员、${Object.keys(incoming.assignments).length} 章分工；将新增 ${added} 章分工。</p><p class="assignment-hint">合并新增分工及历史，不撤销本机已有分工，不修改正文或标注。</p><div class="assignment-choices">${incoming.members.map(m=>`<p>${esc(m.name)}：${Object.values(incoming.assignments).filter(id=>id===m.id).length} 章</p>`).join('')}</div><p id="assignmentImportError" role="alert"></p><footer><button type="button" id="applyAssignmentImport" class="action-button">合并分工</button></footer>`;
  dialog.querySelector('#cancelAssignmentImport').onclick=()=>dialog.close();dialog.querySelector('#applyAssignmentImport').onclick=()=>{try{persistPlan(next);dialog.close();message('分工已合并，成员任务卡已更新。');}catch(error){dialog.querySelector('#assignmentImportError').textContent=error.message;}};dialog.showModal();
 }catch(error){message(error.message);}
}
window.addEventListener('storage',e=>{if(e.key===null||(e.key===planStore?.key||e.key===planStore?.inheritedKey)||e.key===progressKey||e.key?.startsWith('shulun-screening-v1-part-')){const notice=app.querySelector('#taskUpdateNotice');if(notice){notice.innerHTML='其他窗口有新记录，<button type="button" id="refreshTaskProgress">更新任务</button>';notice.querySelector('button').onclick=()=>location.reload();}}});

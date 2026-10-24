import {readJson} from './screening-loader.js?v=member5-mark45-20261023';
import {loadAnnotationCorpus,corpusMode,corpusQuery,corpusDigest,corpusSourceView} from './annotation-corpus.js?v=annotation-release-20261024';
import {esc} from './annotation-chapters.js?v=member5-mark45-20261023';
import {annotationReading} from './annotation-reading.js?v=release-20261022';
import {readCorpusAssignments,assignmentScope,assignmentsUnchanged} from './annotation-assignments.js?v=annotation-release-20261024';
import {zipStore} from './zip-store.js?v=release-20261022';
import {structureActions,structureRoles,structureKey,emptyStructureFeedback,structureParagraphs,deriveStructure,proposeStructure,previewStructure,decideStructure,undoStructure,confirmStructure,structureChecks,structureAudit,validateStructureFeedback,saveStructureFeedback,mergeStructureFeedback} from './annotation-structure-core.js?v=annotation-release-20261024';

const app=document.querySelector('#structureApp'),params=new URLSearchParams(location.search),mode=corpusMode(location.search),key=structureKey(mode);
window.WorkspaceUI.mount('annotation');
let audit=new Map();
let scanPages=[],scanPage=null,scanSource=null,scanCatalogError='';
let corpus,revision,state,raw=null,index,current,anchor=null,view='base',unsaved=null,stale=false,composing=false,draftPreview=null,preview=null;
const drafts=new Map(),memberId=params.get('assignee')||'';let assignmentSnapshot=null,memberChapters=null,scopedReviewerName='';
const notice=text=>{const el=app.querySelector('#structureNotice');if(el)el.textContent=text;};
const timestamp=()=>new Date().toISOString();
const hasEdits=()=>state.items.some(i=>i.status==='applied');
const currentIndex=()=>view==='base'?corpus.index:index;
const label=c=>(c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':'')+c.title;
function download(name,content,type='application/json'){
 const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function inScope(c){if(!c)return false;if(!memberChapters)return true;if(!c.fragments.length)return memberChapters.some(base=>base.id===c.id);return c.fragments.every(f=>{let cursor=f.start;for(const span of memberChapters.flatMap(base=>base.fragments).filter(s=>s.page===f.page).sort((a,b)=>a.start-b.start)){if(span.start>cursor)break;if(span.end>cursor)cursor=span.end;if(cursor>=f.end)return true;}return false;});}
const visibleChapters=(idx=currentIndex())=>idx.chapters.filter(inScope);
const memberQuery=()=>memberId?'&assignee='+encodeURIComponent(memberId):'';
function feedbackBackup(value=unsaved||state){download('分段章节反馈-'+timestamp().replace(/[:.]/g,'-')+'.json',JSON.stringify(value,null,2));}
function recovery(error,next=null){app.querySelector('#structurePreviewDialog')?.close();app.querySelector('#structureImportDialog')?.close();if(next)unsaved=next;const panel=app.querySelector('#structureRecovery');panel.hidden=false;panel.querySelector('p').textContent=error.message;app.querySelector('#structureRetry').hidden=!unsaved;notice(error.message);}
function ready(){
 if(memberId&&assignmentSnapshot&&!assignmentsUnchanged(localStorage,assignmentSnapshot)){stale=true;notice('成员分工已变更，请返回任务页重新进入；本次未写入。');return false;}
 if(composing){notice('请先确认输入法候选，再执行操作。');return false;}
 if(unsaved){notice('本次记录尚未保存，请重试或下载未保存备份。');return false;}
 if(stale){notice('其他窗口已更新反馈，请先下载本次备份，再重新读取。');return false;}
 return true;
}
function editing(){if(!ready())return false;if(view==='base'&&hasEdits()){notice('当前在对照原AI结构。请切换“本机修订版”后继续反馈或核查。');return false;}return true;}
function author(){const value=app.querySelector('#structurePerson').value.trim();if(!value){notice('请先填写真实姓名。');app.querySelector('#structurePerson').focus();return null;}return value;}
function persist(next,message){
 try{raw=saveStructureFeedback(localStorage,key,next,raw,corpus,revision);}catch(e){recovery(e,next);return false;}
 state=next;unsaved=null;stale=false;if(hasEdits())view='revision';index=deriveStructure(state,corpus);app.querySelector('#structureRecovery').hidden=true;
 renderDocument();renderRecords();notice(message);return true;
}
function formValues(){return {action:app.querySelector('#structureAction').value,title:app.querySelector('#structureTitle').value,role:app.querySelector('#structureRole').value,comment:app.querySelector('#structureComment').value};}
function invalidatePreview(){draftPreview=null;app.querySelector('#structureSaveFeedback').disabled=true;}
function rememberDraft(){if(current)drafts.set(current.id,{...formValues(),anchor:structuredClone(anchor)});}
function restoreDraft(){
 const d=drafts.get(current.id)||{action:'note',title:'',role:'theory',comment:'',anchor:null};
 for(const [id,field] of [['structureAction','action'],['structureTitle','title'],['structureRole','role'],['structureComment','comment']])app.querySelector('#'+id).value=d[field];
 anchor=d.anchor;invalidatePreview();updateForm();updateAnchor();
}
function updateForm(){
 const action=app.querySelector('#structureAction').value;
 app.querySelector('#structureTitleField').hidden=!['rename-chapter','split-chapter','merge-chapter'].includes(action);
 app.querySelector('#structureRoleField').hidden=action!=='role';
 app.querySelector('#structureActionHint').textContent={
  'split-paragraph':'选中新段落的开头，在所选文字之前拆分；原文不改字。',
  'merge-paragraph':'合并定位段落与紧邻的下一段；正文顺序保持。',
  'split-chapter':'选中新章节正文的开头，在它之前拆章，并填写新章名。',
  'merge-chapter':'仅合并同篇相邻的下一章，保留原有正文顺序。',
  'move-next':'从定位文字开始至本章结尾，调整为同篇下一章的开头。',
  'move-previous':'将本章开头至定位文字之前，调整为同篇上一章的结尾。',
  'rename-chapter':'只调整修订版目录名称；原文里的篇题仍保留。',
  role:'更正定位段落的角色，不改变AI书论标注范围。',note:'记录疑点、遗漏或跨篇归属问题；可写明应如何处理。',
 }[action];
}
function defaultAnchor(c=current){
 const p=structureParagraphs(c,corpus.byPage).find(p=>p.text.trim()),s=p?.parts.find(p=>p.text.trim());if(!s)return null;
 return {page:s.page,start:s.start,end:Math.min(s.end,s.start),quote:'',textSha256:s.textSha256};
}
function updateAnchor(){
 const target=app.querySelector('#structureAnchor'),p=anchor&&structureParagraphs(current,corpus.byPage).find(p=>p.parts.some(s=>s.page===anchor.page&&s.start<=anchor.start&&s.end>anchor.start));
 target.textContent=anchor?(anchor.quote?`定位：“${anchor.quote.replace(/\s+/g,' ').slice(0,120)}”`:`定位：${p?.text.trim().slice(0,80)||'本章开头'}（在此之前调整）`):'在正文选中需要调整的开头，或点击段落的“定位此段”。未选文时，章名／其他反馈可针对整章。';
 for(const el of app.querySelectorAll('[data-paragraph]'))el.classList.toggle('is-target',el.dataset.paragraph===p?.id);
 if(anchor)showScan(anchor.page);
}
function capture(){
 if(!current||composing)return;
 const sel=window.getSelection();if(!sel?.rangeCount)return;const r=sel.getRangeAt(0),node=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement,el=node?.closest?.('.structure-source-run');
 if(!el||!app.querySelector('#structureBody').contains(el))return;
 const probe=document.createRange();probe.selectNodeContents(el);probe.setEnd(r.startContainer,r.startOffset);
 const page=Number(el.dataset.page),p=corpus.byPage.get(page),reading=annotationReading(p.text),lo=Number(el.dataset.start),hi=Number(el.dataset.end),visible=reading.visibleOffset(lo)+probe.toString().length,start=Math.min(hi,reading.sourceStart(visible));
 let end=start;
 if(!r.collapsed){const endNode=r.endContainer.nodeType===1?r.endContainer:r.endContainer.parentElement,endElement=endNode?.closest?.('.structure-source-run');if(endElement===el){probe.setEnd(r.endContainer,r.endOffset);end=Math.min(hi,reading.sourceEnd(reading.visibleOffset(lo)+probe.toString().length));}else end=hi;}
 if(anchor?.page===page&&anchor.start===start&&anchor.end===end)return;
 anchor={page,start,end,quote:p.text.slice(start,end),textSha256:p.source.textSha256};invalidatePreview();updateAnchor();
}
function visibleSourceSpan(s){const reading=annotationReading(corpus.byPage.get(s.page).text),text=s.text.replace(/\s+$/u,''),end=reading.sourceEnd(reading.visibleOffset(s.start)+text.length);return `<span class="structure-source-run" data-page="${s.page}" data-start="${s.start}" data-end="${end}">${esc(text)}</span>`;}
function paragraphHtml(p,interactive=true){return `<article class="structure-paragraph" data-paragraph="${esc(p.id)}" data-role="${esc(p.role)}"><header><span>${esc(structureRoles[p.role]||p.role)}</span>${interactive?`<button type="button" data-locate-paragraph="${esc(p.id)}">定位此段</button>`:''}</header><div class="structure-paragraph-text">${p.parts.filter(s=>s.text.trim()).map(visibleSourceSpan).join('')}</div></article>`;}
function feedbackInScope(item){return !memberChapters||memberChapters.some(c=>c.fragments.some(f=>f.page===item.anchor.page&&f.start<=item.anchor.start&&f.end>item.anchor.start));}
function directoryStatus(c){if(!c.fragments.length)return '尚无合格正文';const status=view==='base'&&hasEdits()?'原结构对照':audit.has(c.id)?'分段'+(audit.get(c.id).paragraphs.confirmed?'已核':'待核')+' · 章节'+(audit.get(c.id).chapters.confirmed?'已核':'待核'):'';return status+(state.items.some(i=>i.chapterId===c.id&&i.status==='pending')?' · 有待处理反馈':'');}
function renderDirectory(){
 const q=app.querySelector('#structureSearch').value.trim().toLocaleLowerCase(),idx=currentIndex();
 app.querySelector('#structureDirectoryList').innerHTML=idx.works.map(w=>{
  const cs=visibleChapters(idx).filter(c=>c.workId===w.id&&(!q||(c.author+' '+c.workTitle+' '+label(c)).toLocaleLowerCase().includes(q)));
  if(!cs.length)return '';return `<details ${w.id===current.workId||q?'open':''}><summary>${esc(w.author)} · ${esc(w.title)}</summary>${cs.map(c=>`<a href="?chapter=${encodeURIComponent(c.id)}${corpusQuery(mode)}${memberQuery()}" data-structure-chapter="${esc(c.id)}" ${c.id===current.id?'aria-current="page"':''}>${esc(label(c))}<small>${directoryStatus(c)}</small></a>`).join('')}</details>`;
 }).join('')||'<p>没有匹配章节。</p>';
}
function renderDocument(){
 audit=new Map(structureAudit(state,corpus,index).filter(c=>inScope(index.chapters.find(chapter=>chapter.id===c.chapterId))).map(c=>[c.chapterId,c]));
 const idx=currentIndex(),oldId=current?.id,id=idx.chapterAliases[oldId]||oldId;
 current=visibleChapters(idx).find(c=>c.id===id)||visibleChapters(idx).find(c=>c.id===oldId?.split('--revision-')[0])||visibleChapters(idx).find(c=>c.fragments.length);if(!current)throw new Error('当前修订版没有完全处于本人分工内的章节，请从全书结构入口核对。');
 const original=corpus.index.chapters.find(c=>c.fragments.some(f=>current.fragments.some(s=>s.page===f.page&&s.start<f.end&&s.end>f.start)))||corpus.index.chapters.find(c=>c.id===current.id);app.querySelector('#backToAnnotation').href='./annotation.html?chapter='+encodeURIComponent(original?.id||current.id)+corpusQuery(mode)+memberQuery();
 const reviewLink=app.querySelector('#openPdfTxtReview');if(reviewLink)reviewLink.href='./annotation-review.html?chapter='+encodeURIComponent(original?.id||current.id)+corpusQuery(mode)+memberQuery();
 app.querySelector('#structureChapterTitle').textContent=current.author+' · '+(current.workTitle===current.title?label(current):current.workTitle+' · '+label(current));
 app.querySelector('#structureReadingMode').textContent=view==='base'?'原AI分段与章节 · 对照原图核查':'本机修订版 · 待核对后统一更新任务目录';
 app.querySelector('#structureBody').innerHTML=[...structureParagraphs(current,corpus.byPage).map(p=>({page:p.parts[0].page,html:paragraphHtml(p)})),...current.gaps.map(g=>({page:g.page,html:`<aside class="structure-gap">审核缺口 · 来源 ${g.page}：${esc((g.reasons||[]).join('；'))}。缺失正文未接入；结构核查只针对已开放内容。</aside>`}))].sort((a,b)=>a.page-b.page).map(e=>e.html).join('')||'<p>本章尚无合格正文，可在记录中查看本篇其他反馈。</p>';
 const checks=index.chapters.some(c=>c.id===current.id)?structureChecks(state,corpus,current.id):{paragraphs:false,chapters:false};
 app.querySelector('#structureCheckStatus').innerHTML=view==='base'&&hasEdits()?'原结构仅用于对照；当前核查状态请查看修订版。':`<span>分段：${checks.paragraphs?'已核查正确':'待核查'}</span><span>章节：${checks.chapters?'已核查正确':'待核查'}</span>`;
 for(const b of app.querySelectorAll('[data-structure-view]'))b.setAttribute('aria-pressed',String(b.dataset.structureView===view));
 const pages=[...new Set(current.fragments.map(f=>f.page))];app.querySelector('#structureScanSelect').innerHTML=pages.map(n=>{const v=corpusSourceView(n,corpus.byPage);return `<option value="${n}">${esc(v.label)}</option>`;}).join('');
 renderDirectory();if(anchor&&!current.fragments.some(f=>f.page===anchor.page&&f.start<=anchor.start&&f.end>anchor.start))anchor=null;updateAnchor();if(!anchor&&pages.length)showScan(pages[0]);
 app.querySelector('#structureUndo').disabled=!hasEdits();app.querySelector('#structureSummary').textContent=`${state.items.filter(i=>feedbackInScope(i)&&i.status==='pending').length} 条待处理 · ${state.items.filter(i=>feedbackInScope(i)&&i.status==='applied').length} 项已采用 · 分段 ${[...audit.values()].filter(c=>c.paragraphs.confirmed).length}/${audit.size} 章已核 · 章节 ${[...audit.values()].filter(c=>c.chapters.confirmed).length}/${audit.size} 章已核`;
 app.querySelector('#structureRecordsTab').textContent=`反馈记录 ${state.items.filter(feedbackInScope).length}`;
 const at=visibleChapters(idx).indexOf(current);app.querySelector('#structurePrevious').disabled=at<=0;app.querySelector('#structureNext').disabled=at>=visibleChapters(idx).length-1;
 const url=new URL(location.href);url.search='?chapter='+encodeURIComponent(current.id)+corpusQuery(mode)+memberQuery();history.replaceState(null,'',url);fitViewport();
}
function chapterScanPages(){return [...new Set(current.fragments.flatMap(f=>{const v=corpusSourceView(f.page,corpus.byPage);return f.page<20001?[f.page]:v.originalPages;}))].sort((a,b)=>a-b);}
function scanControls(){
 const at=scanPages.indexOf(scanPage),input=app.querySelector('#structureScanPage');
 input.value=scanPage??'';input.min=scanPages[0]||1;input.max=scanPages.at(-1)||1;
 input.disabled=!scanPages.length;app.querySelector('#structureScanGo').disabled=!scanPages.length;
 app.querySelector('#structureScanPrevious').disabled=at<=0;app.querySelector('#structureScanNext').disabled=at<0||at>=scanPages.length-1;
 app.querySelector('#structureScanReturn').disabled=!current.fragments.length;
}
function showPhysicalScan(page){
 const img=app.querySelector('#structureScanImage'),status=app.querySelector('#structureScanStatus'),link=app.querySelector('#structureScanLink');
 scanPage=page;scanControls();
 const sources=chapterScanPages(),inChapter=sources.includes(page),range=sources.length?(sources.length===1?String(sources[0]):sources[0]+'—'+sources.at(-1)):'未定位';
 const message=`扫描第 ${page} 页 · ${inChapter?'本章来源参考':'本章范围外参考'}。本章来源页：${range}。`+(mode==='legacy'?'':'标准正文与扫描页须按内容核对。');
 status.textContent=message+(scanCatalogError?' '+scanCatalogError:'');
 const path='./screening-data/scans/page-'+String(page).padStart(4,'0')+'.jpg';
 img.hidden=false;link.hidden=false;link.href=path;link.textContent='放大原图';img.alt=`扫描第 ${page} 页`;
 if(img.dataset.scan===String(page)&&img.getAttribute('src')===path&&img.naturalWidth)return;
 img.dataset.scan=String(page);img.dataset.source=String(scanSource??'');
 img.onerror=()=>{if(scanPage===page){img.hidden=true;status.textContent=message+' 原图载入失败，可重新跳转此页重试或放大查看。';}};
 img.onload=()=>{if(scanPage===page){img.hidden=false;status.textContent=message+(scanCatalogError?' '+scanCatalogError:'');}};
 app.querySelector('.structure-scan-scroll').scrollTop=0;img.src=path;
}
function showScan(page){
 scanSource=page;const v=corpusSourceView(page,corpus.byPage);app.querySelector('#structureScanSelect').value=String(page);
 if(v.scan){showPhysicalScan(v.scan);return;}
 scanPage=null;scanControls();const img=app.querySelector('#structureScanImage'),link=app.querySelector('#structureScanLink');img.onload=null;img.onerror=null;img.removeAttribute('src');delete img.dataset.scan;img.hidden=true;
 app.querySelector('#structureScanStatus').textContent='此来源无可靠原图位置，可打开正文来源，或输入扫描页码自行查验。'+scanCatalogError;
 link.hidden=!v.url;if(v.url)link.href=v.url;link.textContent='查看正文来源';
}
function jumpScan(){
 if(composing)return;const input=app.querySelector('#structureScanPage'),value=input.value.trim(),page=Number(value);
 if(!value||!Number.isInteger(page)||!scanPages.includes(page)){app.querySelector('#structureScanStatus').textContent=`请输入已有扫描页码（${scanPages[0]}—${scanPages.at(-1)}）；当前原图未切换。`;return;}
 showPhysicalScan(page);
}
async function loadScanCatalog(){
 try{const parts=await Promise.all([1,2,3,4].map(n=>readJson('./screening-data/part-'+n+'.json')));
  if(parts.some((p,i)=>p.part!==i+1||!Array.isArray(p.pages)||p.pages.some(s=>!Number.isInteger(s.page)||s.page<p.start||s.page>p.end)))throw new Error('扫描页码索引不完整');
  scanPages=[...new Set(parts.flatMap(p=>p.pages.map(s=>s.page)))].sort((a,b)=>a-b);if(!scanPages.length)throw new Error('扫描页码索引为空');scanCatalogError='';
 }catch(e){scanCatalogError='全书页码暂未载入，请刷新重试；本章来源仍可查看。';}
 scanControls();if(scanPage!==null)showPhysicalScan(scanPage);else app.querySelector('#structureScanStatus').textContent+=scanCatalogError;
}

function navigate(id){
 if(!ready()||!id)return;rememberDraft();const next=visibleChapters().find(c=>c.id===id);if(!next)return;current=next;restoreDraft();renderDocument();app.classList.remove('structure-catalog-open');
}
function switchView(next){if(!ready()||next===view)return;rememberDraft();view=next;renderDocument();restoreDraft();renderRecords();notice(view==='base'?'正在对照原AI结构。原任务目录保持原样。':'正在查看本机修订版，可继续反馈或核查。');}
function recordsTab(tab){
 const records=tab==='records';app.querySelector('#structureFormPanel').hidden=records;app.querySelector('#structureRecords').hidden=!records;
 app.querySelector('#structureFormTab').setAttribute('aria-selected',String(!records));app.querySelector('#structureRecordsTab').setAttribute('aria-selected',String(records));
}
function renderRecords(){
 const all=app.querySelector('#structureRecordScope')?.value==='all';
 const records=state.items.filter(feedbackInScope).filter(i=>all||i.chapterId===current.id||(index.chapterAliases[i.chapterId]||i.chapterId)===current.id).slice().reverse();
 app.querySelector('#structureRecordList').innerHTML=records.map(i=>`<article class="structure-record" data-feedback-id="${esc(i.id)}"><h3>${esc(structureActions[i.action])} · ${esc(i.chapterTitle)}</h3><small>${esc(i.by)} · ${esc(new Date(i.at).toLocaleString('zh-CN'))} · ${i.status==='applied'?'已采用到本机修订版':i.status==='dismissed'?'暂不采用':'待处理'}</small><blockquote>${esc(i.anchor.quote||'章节／段落起点')}</blockquote><p>${esc(i.comment)}</p>${i.resolution?`<p>处理说明：${esc(i.resolution)}</p>`:''}${i.decidedBy?`<small>处理人：${esc(i.decidedBy)}</small>`:''}${i.status==='pending'?`<div><button type="button" data-preview-feedback="${esc(i.id)}">${i.action==='note'?'查看定位':'预览调整'}</button>${i.action!=='note'?`<button type="button" data-adopt-feedback="${esc(i.id)}">采用到修订版</button>`:''}<label><span>处理说明</span><textarea maxlength="4000" aria-label="处理说明" placeholder="暂不采用时，请写明原因"></textarea></label><button type="button" data-dismiss-feedback="${esc(i.id)}">暂不采用／记录处理</button></div>`:''}</article>`).join('')||'<p>当前范围没有反馈。可切换“全部章节”，或回到“提出反馈”记录问题。</p>';
}
function previewHtml(idx,ids){
 const targets=idx.chapters.filter(c=>ids.has(c.id)||ids.has(c.id.split('--revision-')[0]));
 return targets.map(c=>`<h4>${esc(label(c))}</h4>${structureParagraphs(c,corpus.byPage).map(p=>`<div class="structure-preview-paragraph">${esc(p.text.trim())}</div>`).join('')}`).join('');
}
function openPreview(item,{draft=false}={}){
 const before=deriveStructure(state,corpus),after=item.action==='note'?before:previewStructure(state,corpus,item),ids=new Set(item.before.map(v=>v.id));
 const dialog=app.querySelector('#structurePreviewDialog');preview={item,draft};
 dialog.innerHTML=`<header><h2>${esc(structureActions[item.action])}</h2><button type="button" id="closeStructurePreview" aria-label="关闭预览">✕</button></header><p>${esc(item.comment)}</p><div class="structure-preview-columns"><section><h3>调整前 · 当前结构</h3>${previewHtml(before,ids)}</section><section><h3>${item.action==='note'?'待核问题 · 不直接调整结构':'调整后 · 仅本机修订版'}</h3>${previewHtml(after,ids)}</section></div><p>原文字符、原图及已有标注保持；采用后也不会自动调整当前标注任务目录。</p><p class="structure-error" id="structurePreviewError" role="alert"></p><footer><button type="button" id="cancelStructurePreview">返回核对</button>${draft?'<button type="button" class="structure-primary" id="savePreviewFeedback">保存这条反馈</button>':item.action==='note'?'':`<button type="button" class="structure-primary" id="applyPreviewFeedback">采用到本机修订版</button>`}</footer>`;
 dialog.querySelector('#closeStructurePreview').onclick=()=>dialog.close();dialog.querySelector('#cancelStructurePreview').onclick=()=>dialog.close();
 if(draft)dialog.querySelector('#savePreviewFeedback').onclick=saveDraft;
 else dialog.querySelector('#applyPreviewFeedback')?.addEventListener('click',()=>adopt(item.id));
 dialog.showModal();
}
function previewDraft(){
 if(!editing())return;const by=author();if(!by)return;const values=formValues();
 try{const needsPoint=['split-paragraph','merge-paragraph','role','split-chapter','move-next','move-previous'].includes(values.action);if(needsPoint&&!anchor)throw new Error('请先在正文中选中调整位置，或定位需要调整的段落。');
  const next=proposeStructure(state,corpus,{action:values.action,chapterId:current.id,anchor:anchor||defaultAnchor(),proposal:{title:values.title,role:values.role},comment:values.comment,by});if(next.items.at(-1).before.some(t=>!inScope(index.chapters.find(c=>c.id===t.id))))throw new Error('这项调整涉及本人分工之外的章节，请记录为其他问题，待统一核对。');draftPreview={next,values:JSON.stringify(values),raw};app.querySelector('#structureSaveFeedback').disabled=false;openPreview(next.items.at(-1),{draft:true});
 }catch(e){notice(e.message);}
}
function saveDraft(){
 if(!editing()||!draftPreview)return;
 if(JSON.stringify(formValues())!==draftPreview.values||raw!==draftPreview.raw){notice('表单或反馈记录已变化，请重新预览。');return;}
 const next=draftPreview.next;if(persist(next,'反馈已保存到本机；尚未采用。可在记录中核对并采用到修订版。')){app.querySelector('#structurePreviewDialog').close();app.querySelector('#structureComment').value='';drafts.delete(current.id);invalidatePreview();recordsTab('records');}
}
function adopt(id){
 if(!ready())return;const by=author();if(!by)return;
 try{const item=state.items.find(i=>i.id===id);if(item.before.some(t=>!index.chapters.some(c=>c.id===t.id&&inScope(c))))throw new Error('相关章节已变化或超出本人分工，请重新核对。');const next=decideStructure(state,id,'applied',by,corpus),beforeView=view;view='revision';if(persist(next,'已采用到本机修订版。原标注任务目录保持，核对后再统一更新。')){app.querySelector('#structurePreviewDialog').close();invalidatePreview();}else view=beforeView;}catch(e){const el=app.querySelector('#structurePreviewError');if(el)el.textContent=e.message;notice(e.message);}
}
async function exportBundle(){
 if(!ready())return;
 const derived=deriveStructure(state,corpus),csvCell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/u,"'$&").replaceAll('"','""')+'"',csv=[['反馈ID','章节','类型','反馈人','反馈时间','定位引文','问题与建议','状态','处理人','处理说明'],...state.items.map(i=>[i.id,i.chapterTitle,structureActions[i.action],i.by,i.at,i.anchor.quote,i.comment,i.status,i.decidedBy,i.resolution])].map(row=>row.map(csvCell).join(',')).join('\r\n');
 const auditRows=[['章节ID','作者','篇目','章节','分段核查','分段核查人','分段核查时间','章节核查','章节核查人','章节核查时间','审核缺口'],...structureAudit(state,corpus,derived).map(c=>[c.chapterId,c.author,c.work,c.title,c.paragraphs.confirmed?'当前结构已核查正确':'待核查',c.paragraphs.by,c.paragraphs.at,c.chapters.confirmed?'当前结构已核查正确':'待核查',c.chapters.by,c.chapters.at,c.hasGaps?'仅开放正文':''])].map(row=>row.map(csvCell).join(',')).join('\r\n');
 const text='\ufeff'+derived.chapters.map(c=>`${c.author} · ${c.workTitle} · ${label(c)}\n\n`+structureParagraphs(c,corpus.byPage).map(p=>p.text.trim()).join('\n\n')).join('\n\n');
 const files=[{name:'结构核查结果.csv',content:'\ufeff'+auditRows},{name:'分段章节反馈.json',content:JSON.stringify(state,null,2)},{name:'反馈处理清单.csv',content:'\ufeff'+csv},{name:'原AI章节结构.json',content:JSON.stringify(corpus.index,null,2)},{name:'本机修订章节结构.json',content:JSON.stringify(derived,null,2)},{name:'本机修订正文阅读稿.txt',content:text},{name:'来源版本.json',content:JSON.stringify({mode,revision,sources:corpus.pages.filter(p=>p.eligible).map(p=>({page:p.page,...p.source}))},null,2)},{name:'使用说明.txt',content:'此包是分段与章节核查及本机修订版，尚未统一更新正式标注任务目录。\n导入反馈请使用分段章节反馈.json，核对预览后显式合并。\n正文阅读稿仅为派生排版；源TXT、原标注坐标、分工和标注确认未改。\n分段／章节正确是独立的结构核查，不等于书论标注已完成。\n'}];
 download('分段章节反馈与修订版.zip',zipStore(files),'application/zip');notice('反馈与修订包已生成；包含原结构、修订结构、阅读稿、来源版本和处理清单。');
}
async function importFeedback(event){
 const file=event.target.files[0];event.target.value='';if(!file||!ready())return;
 try{if(file.size>10*1024*1024)throw new Error('反馈文件超过10MB，请选择本工作区导出的反馈JSON。');const incoming=JSON.parse(await file.text()),next=mergeStructureFeedback(state,incoming,corpus,revision),snapshot=raw,dialog=app.querySelector('#structureImportDialog');
  dialog.innerHTML=`<header><h2>导入反馈预览</h2><button id="cancelStructureImport" type="button">取消</button></header><p>文件含 ${incoming.items.length} 条反馈、${incoming.checks.length} 条结构核查。合并后共 ${next.items.length} 条反馈，其中 ${next.items.filter(i=>i.status==='applied').length} 项已采用到修订版。</p><p>正文版本已匹配；不会修改原任务目录、分工或标注记录。同一反馈有不同处理结论时会停止。</p><p id="structureImportError" role="alert"></p><footer><button id="applyStructureImport" type="button" class="structure-primary">合并这些记录</button></footer>`;
  dialog.querySelector('#cancelStructureImport').onclick=()=>dialog.close();dialog.querySelector('#applyStructureImport').onclick=()=>{if(!ready())return;if(raw!==snapshot){dialog.querySelector('#structureImportError').textContent='本机记录已有变化，请重新选择文件预览。';return;}if(next.items.some(i=>i.status==='applied'))view='revision';if(persist(next,'反馈已合并；修订版与原任务目录仍独立。'))dialog.close();};dialog.showModal();
 }catch(e){notice(e.message);}
}
function fitViewport(){const vv=window.visualViewport,top=app.getBoundingClientRect().top;app.style.height=Math.floor(Math.max(160,Math.min(innerHeight,vv?vv.height+vv.offsetTop:innerHeight)-Math.max(0,top)))+'px';}
function mount(){
 const by=scopedReviewerName||state.events.at(-1)?.by||'';
 app.innerHTML=`<header class="structure-heading"><div><p>书论标注 / 结构核查 · ${esc(corpus.label)}</p><h1>分段与章节反馈</h1></div><span><a id="openPdfTxtReview" href="./annotation-review.html?chapter=${encodeURIComponent(current.id)}${corpusQuery(mode)}${memberQuery()}">以原图与TXT对照审核 →</a></span></header>
 <section class="structure-toolbar" aria-label="结构核查工具"><a id="backToAnnotation" href="./annotation.html?chapter=${encodeURIComponent(current.id)}${corpusQuery(mode)}">← 返回标注</a><button class="structure-compact-toggle" id="structureCatalogToggle" type="button">目录</button><label>核查人<input id="structurePerson" value="${esc(by)}" autocomplete="name" maxlength="40" placeholder="填写真实姓名"></label><div class="structure-mode" aria-label="结构版本"><button type="button" data-structure-view="base" aria-pressed="true">原AI结构</button><button type="button" data-structure-view="revision" aria-pressed="false">本机修订版</button></div><button type="button" id="structurePrevious">← 上一章</button><button type="button" id="structureNext">下一章 →</button><button class="structure-compact-toggle" type="button" id="structureFeedbackToggle">反馈</button><button type="button" id="structureUndo">撤回最新修订</button><details class="structure-more"><summary>导入与导出</summary><div><button type="button" id="structureExport">导出反馈JSON</button><button type="button" id="structureImport">导入反馈</button><input type="file" id="structureImportFile" accept=".json,application/json" hidden><button type="button" id="structureExportBundle">导出修订包</button></div></details></section>
 <div class="structure-grid"><nav class="structure-directory" aria-label="核查章节目录"><label>查找章节<input type="search" id="structureSearch" placeholder="作者、篇名、章节"></label><div class="structure-directory-list" id="structureDirectoryList"></div></nav><section class="structure-document" aria-label="分段正文"><header class="structure-document-heading"><h2 id="structureChapterTitle"></h2><div id="structureReadingMode"></div><div class="structure-check-status" id="structureCheckStatus"></div></header><div id="structureBody" class="structure-body" tabindex="0" aria-label="按段落显示的本章正文，可选文字定位"></div></section><aside class="structure-aside"><section class="structure-scan" aria-label="对应原图"><div class="structure-scan-toolbar"><label>对应原图<select id="structureScanSelect" aria-label="对应原图来源"></select></label><a id="structureScanLink" target="_blank" rel="noopener">放大原图</a></div><div class="structure-scan-navigation" aria-label="查看范围外扫描页"><button id="structureScanToggle" type="button" aria-expanded="false">翻页／跳页</button><div><button id="structureScanPrevious" type="button" aria-label="上一扫描页" disabled>← 前页</button><button id="structureScanNext" type="button" aria-label="下一扫描页" disabled>后页 →</button><button id="structureScanReturn" type="button">回到本章</button></div><form id="structureScanJump"><label>扫描页<input id="structureScanPage" type="number" inputmode="numeric" step="1" aria-label="扫描页码" disabled></label><button id="structureScanGo" type="submit" disabled>跳转</button></form></div><div class="structure-scan-scroll"><p id="structureScanStatus" role="status"></p><img id="structureScanImage" alt="对应原图"></div></section><section class="structure-feedback-panel" aria-label="反馈表单与记录"><nav class="structure-tabs" role="tablist"><button id="structureFormTab" type="button" role="tab" aria-selected="true" aria-controls="structureFormPanel">提出反馈</button><button id="structureRecordsTab" type="button" role="tab" aria-selected="false" aria-controls="structureRecords">反馈记录</button><button id="structureCloseFeedback" class="structure-compact-toggle" type="button" aria-label="收起反馈面板">收起</button></nav><div id="structureFormPanel" class="structure-form-scroll" role="tabpanel" aria-labelledby="structureFormTab"><form id="structureForm"><div id="structureAnchor" class="structure-anchor" role="status"></div><label>问题与调整方式<select id="structureAction">${Object.entries(structureActions).map(([k,v])=>`<option value="${k}" ${k==='note'?'selected':''}>${esc(v)}</option>`).join('')}</select></label><p id="structureActionHint" class="structure-form-hint"></p><label id="structureTitleField" hidden>修订章名<input id="structureTitle" maxlength="120" placeholder="填写章名"></label><label id="structureRoleField" hidden>修订角色<select id="structureRole">${Object.entries(structureRoles).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>问题说明／调整依据<textarea id="structureComment" maxlength="4000" placeholder="例如：这一段后半已经转入另一层意思，应从……另起一段。"></textarea></label><div class="structure-form-actions"><button id="structurePreview" type="button">预览这条反馈</button><button id="structureSaveFeedback" type="button" class="structure-primary" disabled>保存反馈</button></div></form><div class="structure-confirm-tools"><p>若已通读核对，可分别记录当前划分正确；结构改变后需重新核查。这不替代书论标注确认。</p><button id="structureConfirmParagraphs" type="button">分段核查正确</button><button id="structureConfirmChapters" type="button">章节核查正确</button></div></div><div id="structureRecords" class="structure-records" role="tabpanel" aria-labelledby="structureRecordsTab" hidden><label class="structure-record-tools">查看范围<select id="structureRecordScope"><option value="chapter">当前章节</option><option value="all">全部章节</option></select></label><div id="structureRecordList"></div></div></section></aside></div>
 <footer class="structure-footer"><span id="structureNotice" role="status">选择需要核查的章，对照原图检查分段与章节；原文只读。</span><span id="structureSummary"></span></footer><section id="structureRecovery" class="structure-recovery" hidden><p role="alert"></p><button type="button" id="structureRescue">下载本次反馈备份</button><button type="button" id="structureRetry">重试保存</button><button type="button" id="structureReload">下载备份并重新读取</button></section><dialog id="structurePreviewDialog" class="structure-dialog" aria-label="结构调整前后预览"></dialog><dialog id="structureImportDialog" class="structure-dialog" aria-label="反馈导入预览"></dialog>`;
 app.querySelector('#structureSearch').oninput=renderDirectory;
 app.querySelector('#structureDirectoryList').onclick=e=>{const a=e.target.closest('[data-structure-chapter]');if(a){e.preventDefault();navigate(a.dataset.structureChapter);}};
 app.querySelector('#structureBody').onclick=e=>{const button=e.target.closest('[data-locate-paragraph]');if(!button)return;const p=structureParagraphs(current,corpus.byPage).find(p=>p.id===button.dataset.locateParagraph),part=p.parts.find(s=>s.text.trim())||p.parts[0];anchor={page:part.page,start:part.start,end:part.end,quote:corpus.byPage.get(part.page).text.slice(part.start,part.end),textSha256:part.textSha256};invalidatePreview();updateAnchor();app.classList.add('structure-feedback-open');};
 app.querySelector('#structureBody').onpointerup=capture;app.querySelector('#structureBody').onkeyup=capture;
 for(const b of app.querySelectorAll('[data-structure-view]'))b.onclick=()=>switchView(b.dataset.structureView);
 app.querySelector('#structureCatalogToggle').onclick=()=>app.classList.toggle('structure-catalog-open');app.querySelector('#structureFeedbackToggle').onclick=()=>{capture();app.classList.toggle('structure-feedback-open');};app.querySelector('#structureCloseFeedback').onclick=()=>app.classList.remove('structure-feedback-open');
 for(const [id,delta] of [['structurePrevious',-1],['structureNext',1]])app.querySelector('#'+id).onclick=()=>{const chapters=visibleChapters();navigate(chapters[chapters.indexOf(current)+delta]?.id);};
 app.querySelector('#structureScanToggle').onclick=e=>{const open=e.target.parentElement.classList.toggle('is-open');e.target.setAttribute('aria-expanded',String(open));};
 app.querySelector('#structureScanJump').onsubmit=e=>{e.preventDefault();jumpScan();};
 app.querySelector('#structureScanPage').onkeydown=e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.preventDefault();};
 for(const [id,delta] of [['structureScanPrevious',-1],['structureScanNext',1]])app.querySelector('#'+id).onclick=()=>{if(composing)return;const next=scanPages[scanPages.indexOf(scanPage)+delta];if(next)showPhysicalScan(next);};
 app.querySelector('#structureScanReturn').onclick=()=>{if(!composing)showScan(anchor?.page||current.fragments[0]?.page);};
 app.querySelector('#structureScanSelect').onchange=e=>showScan(Number(e.target.value));app.querySelector('#structureFormTab').onclick=()=>recordsTab('form');app.querySelector('#structureRecordsTab').onclick=()=>recordsTab('records');app.querySelector('#structureRecordScope').onchange=renderRecords;
 app.querySelector('#structureForm').addEventListener('pointerdown',capture);
 app.querySelector('#structureForm').onsubmit=e=>{e.preventDefault();if(!composing&&!e.isComposing)previewDraft();};
 app.querySelector('#structureAction').onchange=()=>{invalidatePreview();updateForm();};
 for(const id of ['structureTitle','structureRole','structureComment','structurePerson'])app.querySelector('#'+id).addEventListener('input',invalidatePreview);
 app.querySelector('#structurePreview').onpointerdown=e=>{capture();if(e.pointerType==='mouse')e.preventDefault();};app.querySelector('#structurePreview').onclick=previewDraft;app.querySelector('#structureSaveFeedback').onclick=saveDraft;
 app.addEventListener('compositionstart',()=>{composing=true;});app.addEventListener('compositionend',()=>{composing=false;});
 for(const [id,kind] of [['structureConfirmParagraphs','paragraphs'],['structureConfirmChapters','chapters']])app.querySelector('#'+id).onclick=()=>{if(!editing())return;const by=author();if(!by)return;try{persist(confirmStructure(state,corpus,current.id,kind,by),kind==='paragraphs'?'已记录当前分段核查正确；未确认书论标注。':'已记录当前章节核查正确；原任务目录保持。');}catch(e){notice(e.message);}};
 app.querySelector('#structureRecordList').onclick=e=>{const id=e.target.dataset.previewFeedback||e.target.dataset.adoptFeedback||e.target.dataset.dismissFeedback;if(!id||!ready())return;const item=state.items.find(i=>i.id===id);try{
  if(e.target.dataset.dismissFeedback){const by=author(),resolution=e.target.closest('.structure-record').querySelector('textarea').value.trim();if(!by)return;if(!resolution)throw new Error('请填写处理说明，再记录暂不采用。');persist(decideStructure(state,id,'dismissed',by,corpus,resolution),'已记录处理意见，原反馈和结构保留。');}
  else openPreview(item);
 }catch(error){notice(error.message);}};
 app.querySelector('#structureUndo').onclick=()=>{if(!ready())return;const by=author();if(!by)return;try{view='revision';persist(undoStructure(state,by,corpus),'已撤回最新结构修订，原反馈和处理历史保留。');}catch(e){notice(e.message);}};
 app.querySelector('#structureExport').onclick=()=>feedbackBackup();app.querySelector('#structureExportBundle').onclick=exportBundle;app.querySelector('#structureImport').onclick=()=>app.querySelector('#structureImportFile').click();app.querySelector('#structureImportFile').onchange=importFeedback;
 app.querySelector('#structureRescue').onclick=()=>feedbackBackup();app.querySelector('#structureRetry').onclick=()=>{if(unsaved)persist(unsaved,'已成功保存本次反馈／修订。');};app.querySelector('#structureReload').onclick=()=>{feedbackBackup();location.reload();};
 updateForm();renderDocument();renderRecords();
}
async function init(){
 try{
  corpus=await loadAnnotationCorpus(location.search);revision=await corpusDigest({mode,index:corpus.index,sources:corpus.pages.filter(p=>p.eligible).map(p=>[p.page,p.source.textSha256])});raw=localStorage.getItem(key);state=raw===null?emptyStructureFeedback(revision,mode):validateStructureFeedback(JSON.parse(raw),corpus,revision);index=deriveStructure(state,corpus);view=hasEdits()?'revision':'base';
  if(memberId){assignmentSnapshot=readCorpusAssignments(localStorage,corpus.index,mode);const scope=assignmentScope(assignmentSnapshot.value,corpus.index,memberId);memberChapters=scope.chapters;scopedReviewerName=scope.member.name;if(!memberChapters.length)throw new Error('该成员尚无章节分工，请返回任务页重新进入。');}
  const id=currentIndex().chapterAliases[params.get('chapter')]||params.get('chapter');if(memberId&&id&&!visibleChapters().some(c=>c.id===id))throw new Error('该章节不在本人分工范围内，请返回成员入口。');current=visibleChapters().find(c=>c.id===id)||visibleChapters().find(c=>c.fragments.length);if(!current)throw new Error('当前没有可核查的合格正文。');mount();
  void loadScanCatalog();
  if(location.hash.startsWith('#selection=')){try{const value=JSON.parse(decodeURIComponent(location.hash.slice(11))),first=value[0],p=corpus.byPage.get(first?.page);if(!p||!Number.isInteger(first.start)||!Number.isInteger(first.end)||first.end<first.start||first.end>p.text.length||p.source.textSha256!==first.textSha256||!current.fragments.some(f=>f.page===first.page&&first.start>=f.start&&first.start<f.end))throw Error('从标注页传入的位置已不属于当前结构，请重新选文。');anchor={page:first.page,start:first.start,end:first.end,quote:p.text.slice(first.start,first.end),textSha256:p.source.textSha256};updateAnchor();app.classList.add('structure-feedback-open');}catch(e){notice(e.message);}}
 }catch(e){app.innerHTML=`<section class="structure-loading"><h1>分段与章节反馈暂未载入</h1><p role="alert">${esc(e.message)}</p><p>原文、分工和标注记录保留。</p><button id="downloadRawStructure" type="button">下载现有反馈原记录</button><button type="button" id="reloadStructure">重新读取</button></section>`;app.querySelector('#downloadRawStructure').onclick=()=>download('反馈原记录.json',localStorage.getItem(key)||'null');app.querySelector('#reloadStructure').onclick=()=>location.reload();}
}
document.addEventListener('selectionchange',capture);
window.addEventListener('storage',e=>{if(e.key===key||e.key===null){stale=true;if(app.querySelector('#structureRecovery'))recovery(new Error('其他窗口已更新反馈，请先下载备份再重新读取；原记录未覆盖。'));}});
window.addEventListener('beforeunload',e=>{if(unsaved){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('resize',fitViewport);window.visualViewport?.addEventListener('scroll',fitViewport);
init();

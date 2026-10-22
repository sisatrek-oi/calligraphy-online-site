import {captureMemberTask,buildMemberTaskBundle} from './member-task-export.js?v=release-20261022';
import {annotationSource} from './annotation-source.js?v=release-20261022';
import {loadReviewedPart} from './reviewed-annotation.js?v=release-20261022';
import {buildAnnotationBundle} from './theory-annotation-export.js?v=release-20261022';
import {assignments,assignmentFor,assignmentHref,assignmentPages} from './team-assignments.js?v=release-20261022';
import {readJson,createMaterialLoader} from './screening-loader.js?v=release-20261022';
import {buildCollationBundle} from './collation-export.js?v=release-20261022';
import {zipStore} from './zip-store.js?v=20261018-bundle';
import {readProgress,validateProgress,restoreProgress,compareProgress} from './delivery-core.js?v=release-20261022';
const ui=window.WorkspaceUI,host=document.querySelector('#workspacePage');ui.mount('delivery');
let remembered;try{remembered=localStorage.getItem('shulun-active-member-v1');}catch{}
const params=new URLSearchParams(location.search);
let member=/^[1-7]$/.test(params.get('member')||remembered||'')?Number(params.get('member')||remembered):1;
let previewRequest=0;
let task=params.get('task')==='annotation'?'annotation':'proofread';
let mode=['export','restore','receive'].includes(params.get('mode'))?params.get('mode'):'export',pending=null,busy=false;
const cache=new Map();
function notify(message,error=false){const slot=document.querySelector('#deliveryNotice');slot.textContent=message;slot.classList.toggle('error',error);}
function download(name,bytes,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function materials(part){if(!cache.has(part))cache.set(part,readJson(`./screening-data/part-${part}-index.json?v=release-20261022`).then(async data=>{await createMaterialLoader(data).ensureAll();return data.pages;}).catch(error=>{cache.delete(part);throw error;}));return cache.get(part);}
function render(){
 previewRequest++;pending=null;const a=assignmentFor(member);
 let name='';try{name=readProgress(localStorage,a.segments[0].part).value.person;}catch{}
 host.innerHTML=`<header class="workspace-page-header"><div><h1>成果交付</h1><p>导出、恢复与回收检查各自独立，原记录继续保留。</p></div><a class="quiet-button" href="./team-tasks.html">返回校勘</a></header><nav class="delivery-tabs" aria-label="交付操作">${[['export','导出我的成果'],['restore','恢复我的进度'],['receive','负责人回收']].map(([value,label])=>`<button type="button" data-mode="${value}" aria-pressed="${mode===value}">${label}</button>`).join('')}</nav><div class="workspace-page-content"><div id="deliveryNotice" class="workspace-notice" role="status"></div>${mode==='export'?`<section class="workspace-panel delivery-export"><h2>导出我的成果</h2><div class="workspace-fields"><label>选择任务<select id="deliveryTask"><option value="proofread" ${task==='proofread'?'selected':''}>任务一 · 原文校对</option><option value="annotation" ${task==='annotation'?'selected':''}>任务二 · 书论标注</option></select></label><label>选择成员<select id="deliveryMember">${assignments.map(x=>`<option value="${x.id}" ${x.id===member?'selected':''}>成员 ${x.id} · ${ui.esc(x.name)}</option>`).join('')}</select></label><label>导出范围<select id="deliveryScope">${task==='proofread'?'<option value="all">本人的全部责任页段（一个ZIP）</option>':`${a.segments.length>1?'<option value="all">本人的全部页段（一个总ZIP）</option>':''}${a.segments.map(s=>`<option value="${s.part}" ${Number(params.get('part'))===s.part?'selected':''}>${s.start===1?'5、6、13':s.start}–${s.end} 页 · 原第${s.part}份</option>`).join('')}`}</select></label><label>导出人姓名<input id="deliveryPerson" value="${ui.esc(name)}" placeholder="填写真实姓名" maxlength="80"/></label></div><div class="delivery-package"><strong>ZIP 将包含</strong><ul><li>${task==='annotation'?'人工已校验正文中的书论高亮、摘录与标注状态':'当前分工校对正文与人工校验表'}</li><li>${task==='proofread'?'本人责任页段进度备份；本机其他页段仍保留':'完整原分份进度备份'}</li><li>${task==='annotation'?'人工校验来源、正文哈希及文件清单':'修改记录、比较底稿及文件清单'}</li></ul><p>跨分份时总ZIP内保留各段独立交付包，旧备份格式不变。</p></div><button type="button" id="downloadDelivery" class="action-button">↓ 下载成果ZIP</button></section>`:`<section class="workspace-panel"><h2>${mode==='restore'?'恢复我的进度':'检查回收文件'}</h2><p>${mode==='restore'?'先解压成果ZIP，选择其中的“初筛进度备份.json”。核对范围后再恢复。':'选择解压后的校勘进度JSON，检查分份、范围与本机差异。此处不自动改稿、更新团队标记或发布。'}</p><label class="quiet-button">选择进度备份JSON<input id="deliveryFile" type="file" accept="application/json,.json"/></label><div id="backupPreview"></div>${mode==='receive'?'<p>独立条目审核结果，请在<a href="./review.html">条目独立审核</a>的对应汇总批次中导入。</p>':''}</section>`}<p class="workspace-hint">已保存到本机、已导出文件、负责人已回收是不同动作。网站不会自动传送文件。</p></div>`;
 host.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{if(busy)return;mode=button.dataset.mode;render();});
 document.querySelector('#deliveryMember')?.addEventListener('change',event=>{if(busy){event.target.value=String(member);return;}member=Number(event.target.value);try{localStorage.setItem('shulun-active-member-v1',String(member));}catch{}render();});
 document.querySelector('#deliveryTask')?.addEventListener('change',event=>{if(busy)return;task=event.target.value;render();});
 document.querySelector('#downloadDelivery')?.addEventListener('click',exportBundle);
 document.querySelector('#deliveryFile')?.addEventListener('change',previewBackup);
}
async function exportBundle(){
 if(busy)return;
 const person=document.querySelector('#deliveryPerson').value.trim(),scope=document.querySelector('#deliveryScope').value,a=assignmentFor(member);
 if(!person){notify('请填写导出人姓名。',true);document.querySelector('#deliveryPerson').focus();return;}
 const exportingMember=member,exportingTask=task;
 const segments=a.segments.filter(s=>scope==='all'||s.part===Number(scope));
 let snapshots;
 try{snapshots=segments.map(s=>({...s,progress:JSON.parse(JSON.stringify({...readProgress(localStorage,s.part).value,person}))}));}catch(error){notify('原记录无法读取，请先备份并恢复旧进度：'+error.message,true);return;}
 busy=true;host.querySelectorAll('button,select,input').forEach(e=>e.disabled=true);notify('正在读取材料并打包，期间不会改动人工记录…');
 try{
  if(exportingTask==='proofread'){
    const captured=captureMemberTask({storage:localStorage,member:exportingMember,currentProgress:snapshots[0].progress});
    const pagesByPart={};for(const entry of captured.snapshots)pagesByPart[entry.progress.part]=await materials(entry.progress.part);
    const out=await buildMemberTaskBundle({...captured,pagesByPart});
    download(out.name,out.bytes,'application/zip');notify('已发起本人全部责任页段ZIP下载，本机其他记录保持。');return;
  }
  const bundles=[],backups=[];
  for(const s of snapshots) {
    const pages=await materials(s.part);
    if(exportingTask==='annotation')await loadReviewedPart(pages,s.part);
    if(exportingTask==='annotation' && scope==='all' && snapshots.length>1 && !assignmentPages(pages,exportingMember,s.part).some(p=>annotationSource(p,s.progress.reviews[p.page]))) {
      backups.push({name:`第${s.part}份-暂无标注资料-完整进度备份.json`,content:JSON.stringify(s.progress,null,2)});continue;
    }
    bundles.push(await (exportingTask==='annotation'?buildAnnotationBundle:buildCollationBundle)({progress:s.progress,pages,member:exportingMember}));
  }
  if(!bundles.length)throw new Error('当前所有页段暂无可标注的人工已校验正文；请先完成原文校对。');
  const out=bundles.length===1&&!backups.length?bundles[0]:{name:`成员${exportingMember}-全部页段-${exportingTask==='annotation'?'书论标注':'校勘'}成果.zip`,bytes:zipStore([...bundles.map(b=>({name:b.name,content:b.bytes})),...backups])};
  download(out.name,out.bytes,'application/zip');notify('已发起成果ZIP下载，请在下载列表确认后将文件交回负责人。');
 }catch(error){notify(error.message||'导出失败，原记录未改变。',true);}finally{busy=false;host.querySelectorAll('button,select,input').forEach(e=>e.disabled=false);}
}
async function previewBackup(event){
 const request=++previewRequest,file=event.target.files?.[0];pending=null;document.querySelector('#backupPreview').replaceChildren();if(!file)return;
 try{
  if(file.size>50*1024*1024)throw new Error('文件超过50MB，请选择进度备份JSON。');
  const value=validateProgress(JSON.parse((await file.text()).replace(/^\uFEFF/,'')));
  const raw=localStorage.getItem(`shulun-screening-v1-part-${value.part}`);
  let current;
  try{current=readProgress(localStorage,value.part);}catch(error){current={raw,value:null,error:error.message};}
  const comparison=compareProgress(current.value,value);
  if(request!==previewRequest)return;
  pending={value,current,comparison,file};
  const existing=current.error?'本机原记录无法解析，将先保留原始副本':current.raw?'已存在本机记录':'本机暂无此分份记录';
  document.querySelector('#backupPreview').innerHTML=`<div class="backup-preview"><h3>原第 ${value.part} 份 · ${ui.esc(value.person||'未署名')}</h3><dl><dt>备份时间</dt><dd>${ui.esc(value.savedAt||'原文件未记录')}</dd><dt>${value.exportScope?`成员${value.exportScope.member}责任范围备份`:'完整原分份记录'}</dt><dd>${comparison.incoming} 页${value.exportScope?'（仅更新包内页记录）':'（包含历史移交或排除页）'}</dd><dt>本机对比</dt><dd>${current.error?existing+'；原页数和差异暂无法核定。':`${existing}，${comparison.current} 页；${comparison.changed} 页内容不同，${comparison.omitted} 页不在此备份中。`}</dd></dl>${mode==='restore'?`<p>${value.exportScope?'恢复仅更新本人备份中的页，其他页段和草稿保留；同页以备份为准。':'恢复将替换整个原分份，包含当前未展示的旧页记录。'}确认时先下载本机现有进度副本，再恢复所选版本。</p><label class="restore-confirm"><input type="checkbox" id="approveRestore"/>已核对分份与覆盖范围，确认恢复这个版本</label><button id="restoreDelivery" class="action-button">恢复此份进度</button>`:'<p>这里只检查回收文件，不将其写入人工稿或发布稿。</p><button id="recordReceipt" class="quiet-button">保存本机回收检查记录</button>'}</div>`;
  document.querySelector('#restoreDelivery')?.addEventListener('click',restoreBackup);
  document.querySelector('#recordReceipt')?.addEventListener('click',recordReceipt);
  notify('备份已读取，尚未修改任何原记录。');
 }catch(error){if(request!==previewRequest)return;notify(error.message||'备份无法读取；原记录未改变。',true);}
}
function restoreBackup(){
 if(!pending||!document.querySelector('#approveRestore').checked){notify('请先核对并勾选恢复范围。',true);return;}
 try{
  const {value,current}=pending;
  if(localStorage.getItem(`shulun-screening-v1-part-${value.part}`)!==current.raw)throw new Error('其他标签页已更新进度，请重新选择并核对备份。');
  if(current.raw!==null)download(`恢复前-第${value.part}份-原进度.json`,current.raw);
  restoreProgress(localStorage,value,current.raw);pending=null;document.querySelector('#backupPreview').innerHTML='<p>进度已恢复。<a href="./team-tasks.html">继续校勘 →</a></p>';notify(value.exportScope?'已恢复本人备份页；其他页段和草稿保持。':'已恢复整个原分份；其他分份的记录保持。');
 }catch(error){notify(error.message||'恢复失败，原进度仍保留。',true);}
}
async function recordReceipt(){
 if(!pending)return;
 const receipt=pending;
 try{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await receipt.file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  const key='shulun-delivery-receipts-v1',rows=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(rows))throw new Error('本机回收台账无法读取，未覆盖。');
  const value=receipt.value;rows.push({file:receipt.file.name,sha256:hash,part:value.part,person:value.person,records:Object.keys(value.reviews).length,receivedAt:new Date().toISOString(),status:'checked-locally'});localStorage.setItem(key,JSON.stringify(rows));notify('已登记本机回收检查记录；人工稿、团队标记和网站发布稿均未改动。');
 }catch(error){notify(error.message||'本机登记失败。',true);}
}
render();

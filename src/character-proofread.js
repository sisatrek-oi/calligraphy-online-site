import{loadChapter}from'../proofread/transport.mjs?v=chapter-loading-zstd-20261109';
import{taskScope}from'../proofread/site-context.mjs';
import{validateCrops}from'../proofread/crop-state.mjs';
const $=id=>document.getElementById(id),frame=$('character-task-frame'),params=new URLSearchParams(location.search),prefix='shulun-chapter-character-draft-v1:';let scope,index,imagePages,imageCatalogue;
window.WorkspaceUI.mount('proof');
function notice(message){$('character-task-notice').hidden=false;$('character-task-notice').textContent=message;}
function download(value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`原文校对-${scope.label}-逐字草稿.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('逐字任务材料读取失败。');return r.json();}
async function checkedRecord(key,value){
 if(!value||value.format!=='chapter-character-draft-v1'||typeof value.chapter!=='string'||!scope.catalogue.chapters.some(c=>c.id===value.chapter))return null;
 if(value.pendingEdit||value.pendingCrop)throw Error('文件含未保存调整，请先在原界面保存当前修改后再导出恢复。');
 const e=index.chapters.find(c=>c.id===value.chapter),d=await loadChapter(e),reference=key===`${prefix}${d.id}:${d.binding}-unreviewed-reference`,base=reference?d.reference:d,binding=d.binding+(reference?'-unreviewed-reference':'');
 if(!base||key!==`${prefix}${d.id}:${binding}`||value.binding!==binding||value.baseTextSha256!==base.textSha256||!Array.isArray(value.partTexts)||value.partTexts.length!==base.parts.length||value.partTexts.some(t=>typeof t!=='string'||t.length>100000)||!Array.isArray(value.history))throw Error('草稿与当前章节版本不一致，未恢复。');
 const available={...d.images,...Object.fromEntries((imagePages[d.id]||[]).filter(n=>imageCatalogue[String(n)]).map(n=>[String(n),imageCatalogue[String(n)]]))};validateCrops(value.manualCrops||{},base.parts.map((p,i)=>({...p,text:value.partTexts[i]})),available);return{...value,humanConfirmed:false};
}
$('character-backup').onclick=()=>{
 try{const records=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;const raw=localStorage.getItem(key);let value;try{value=JSON.parse(raw);}catch{throw Error('有损坏的逐字草稿，请从对应章节下载原记录后处理。');}if(scope.catalogue.chapters.some(c=>c.id===value?.chapter))records.push({key,value});}if(!records.length){notice('当前分工还没有已保存的逐字草稿。');return;}download({format:'shulun-character-task-backup-v1',createdAt:new Date().toISOString(),taskContext:scope.assignment,records,humanConfirmed:false});notice(`已备份${records.length}份本机已保存逐字草稿，历史校对记录保持。`);}catch(e){notice(e.message);}
};
$('character-restore').onclick=()=>$('character-file').click();
$('character-file').onchange=async()=>{
 const file=$('character-file').files[0];if(!file)return;const created=[];let skipped=0;
 try{if(file.size>50*1024*1024)throw Error('草稿文件超过50MB，请分章恢复。');const value=JSON.parse(await file.text()),records=value.format==='shulun-character-task-backup-v1'?value.records:value.format==='chapter-character-draft-v1'?[{key:`${prefix}${value.chapter}:${value.binding}`,value}]:null;if(!Array.isArray(records)||records.length>1000)throw Error('请选择逐字审核下载的JSON草稿或任务备份。');
  const prepared=[],seen=new Set();for(const r of records){if(typeof r?.key!=='string'||!r.key.startsWith(prefix)||seen.has(r.key))throw Error('草稿键重复或格式无效。');seen.add(r.key);const checked=await checkedRecord(r.key,r.value);if(checked)prepared.push({key:r.key,raw:JSON.stringify(checked)});else skipped++;}
  for(const r of prepared){if(localStorage.getItem(r.key)!==null){skipped++;continue;}localStorage.setItem(r.key,r.raw);created.push(r);}
  notice(`已恢复${created.length}份逐字草稿；${skipped}份已有记录或不在当前范围，保持原样。请先保存当前修改，再重新打开对应章节。`);
 }catch(e){for(const r of created)try{if(localStorage.getItem(r.key)===r.raw)localStorage.removeItem(r.key);}catch{}notice('恢复未完成，原记录保持：'+e.message);}finally{$('character-file').value='';}
};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow||e.data?.type!=='shulun-character-chapter'||!scope?.catalogue.chapters.some(c=>c.id===e.data.chapter))return;const u=new URL(location.href);u.searchParams.set('chapter',e.data.chapter);u.searchParams.delete('page');history.replaceState(null,'',u);});
function viewport(){const v=window.visualViewport;document.body.style.height=`${v&&v.scale===1?v.height:innerHeight}px`;document.body.style.position='fixed';document.body.style.top=`${v&&v.scale===1?v.offsetTop:0}px`;document.body.style.width='100%';}
window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);viewport();
try{const values=await Promise.all(['./proofread/index.json?v=chapter-loading-zstd-20261109','./proofread/chapter-pages.json','./proofread/chapter-image-pages.json','./proofread/image-catalogue.json'].map(json));index=values[0];imagePages=values[2];imageCatalogue=values[3];scope=taskScope(params,index,values[1]);$('character-task-scope').textContent=`${scope.label} · ${scope.catalogue.chapters.length}个相关篇目／章节 · 按原分工定位，整章阅读`;const legacy=new URL('./screening-history.html',location.href);for(const k of['part','member','page'])if(params.has(k))legacy.searchParams.set(k,params.get(k));if(!legacy.searchParams.has('part'))legacy.searchParams.set('part','1');$('character-history').href=legacy.href;$('character-history').target='_blank';$('character-history').rel='noopener';
 const child=new URL('./proofread/index.html',location.href);for(const k of['part','member','page'])if(params.has(k))child.searchParams.set(k,params.get(k));child.searchParams.set('chapter',scope.entry);frame.src=child.href;frame.hidden=false;$('character-startup').hidden=true;
}catch(e){$('character-startup').textContent=e.message;for(const id of['character-backup','character-restore'])$(id).disabled=true;}

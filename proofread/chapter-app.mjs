import {loadChapter} from './transport.mjs';
import {digest,mapText,replaceText} from './alignment.mjs';
import {reviewRows} from './human-review.mjs';
import {cropKey,validateCrops,shiftCrops,withCrops} from './crop-state.mjs';
import {createCropEditor} from './crop-editor.mjs';
import {loadTaskScope} from './site-context.mjs';
const taskParams=new URLSearchParams(location.search);let siteScope;
const $=id=>document.getElementById(id),input=$('edit-text');
let reliableData,referenceMode=false,crops={};
let catalogue,data,parts=[],selected=null,history=[],composing=false,busy=false,ticket=0,renderTicket=0,observer=null,draftProblem='',rawDraft=null;
const photos=new Map();
const text=()=>parts.map(p=>p.text).join('');
const dirty=()=>selected&&input.value!==selected.before;
const key=()=>`shulun-chapter-character-draft-v1:${data.id}:${data.binding}`;
function notice(s){$('notice').textContent=s;}
function guard(){if(cropEditor.isOpen())return false;if(composing){notice('请先完成当前输入。');return false;}if(dirty()){notice('请先应用或取消当前校改，再切换章节。');return false;}return !busy;}
function controls(){const i=catalogue.chapters.findIndex(c=>c.id===data?.id);$('previous').disabled=busy||i<=0;$('next').disabled=busy||i>=catalogue.chapters.length-1;$('chapters').disabled=busy;input.disabled=referenceMode||busy||!selected;for(const id of ['apply','delete','cancel'])$(id).disabled=referenceMode||busy||!selected;$('undo').disabled=busy||!history.length;$('adjust-crop').disabled=busy||!selected;$('draft-state').textContent=history.length?`本机整章草稿 · ${history.length}次校改`:'未修改';}
function payload(next=parts,events=history,manual=crops){return {format:'chapter-character-draft-v1',chapter:data.id,binding:data.binding,baseTextSha256:data.textSha256,reviewMode:'human',taskContext:siteScope?.assignment||null,manualCrops:manual,partTexts:next.map(p=>p.text),history:events,humanConfirmed:false,sourceMode:referenceMode?'unreviewed-machine-reference':'reliable-source'};}
function persist(next,events,manual=crops){if(draftProblem){notice(draftProblem+' 请先下载JSON保留原记录。');return false;}try{if(localStorage.getItem(key())!==rawDraft){notice('另一个窗口已更新本章草稿，当前修改已保留。请先下载JSON，再重新载入。');return false;}const encoded=JSON.stringify(payload(next,events,manual));localStorage.setItem(key(),encoded);rawDraft=encoded;return true;}catch{notice('保存失败，当前修改已保留，可下载JSON后重试。');return false;}}
function imageURL(page){const image=data.images[String(page)];return image?.display?.url||image?.url;}
async function photo(page){
 const source=data.images[String(page)],item=source?.display||source;if(!item)throw Error('该字的原图来源未能确认。');
 if(photos.has(page)){const found=photos.get(page);photos.delete(page);photos.set(page,found);return found.promise;}
 const owner=data.id,record={url:null,promise:null};record.promise=(async()=>{
  const r=await fetch(item.url);if(!r.ok)throw Error('原图读取失败。');const bytes=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==item.sha256)throw Error('原图与字框版本不符，已停止绘制。');
  const image=new Image();record.url=URL.createObjectURL(new Blob([bytes]));image.src=record.url;await image.decode();if(image.naturalWidth!==item.size[0]||image.naturalHeight!==item.size[1])throw Error('原图尺寸不匹配。');if(data.id!==owner)throw Error('章节已切换。');return image;
 })();photos.set(page,record);
 while(photos.size>7){const[first,old]=photos.entries().next().value;photos.delete(first);if(old.url)URL.revokeObjectURL(old.url);}
 return record.promise;
}
function paint(canvas,image,box,text,size=104){
 canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,size,size);
 // Match the TXT ink extent, including small punctuation, without stretching the scan.
 ctx.font=`${size}px ${getComputedStyle(canvas.parentElement.querySelector('.txt')).fontFamily}`;const m=ctx.measureText(text),extent=Math.min(size-8,Math.max(m.actualBoundingBoxLeft+m.actualBoundingBoxRight,m.actualBoundingBoxAscent+m.actualBoundingBoxDescent)||size*.9);
 const[l,t,r,b]=box,w=r-l,h=b-t,s=extent/Math.max(w,h);ctx.drawImage(image,l,t,w,h,(size-w*s)/2,(size-h*s)/2,w*s,h*s);
}
function remap(part){
 const source=new Map(part.base.sourceGlyphs.map(g=>[g.id,g]));
 const rows=part.text===part.base.text?part.base.characters:mapText(part.base.sourceGlyphs,part.text).map(r=>({...r,sourcePage:source.get(r.glyphId)?.sourcePage}));
 return withCrops(reviewRows(rows,part.base.sourceGlyphs,data.images),part.id,crops);
}
function render(){
 const generation=++renderTicket;observer?.disconnect();selected=null;input.value='';$('selected-char').textContent='—';$('context').hidden=true;
 const wrapper=document.createElement('div');wrapper.className='pairs';
 if(reliableData.reference){const banner=document.createElement('div');banner.className='source-gap';banner.textContent=referenceMode?'未审核机器参照 · 只读 · 不计入可靠TXT正文。':'缺文处另备只读机器参照，默认正文不混入。';const toggle=document.createElement('button');toggle.id='toggle-reference';toggle.type='button';toggle.textContent=referenceMode?'返回可靠TXT正文':'查看缺文机器参照（未审核）';toggle.onclick=()=>{if(!guard())return;if(referenceMode){load(reliableData.id);return;}referenceMode=true;data=referenceMode?{...reliableData,...reliableData.reference,gaps:[],binding:reliableData.binding+'-unreviewed-reference'}:reliableData;parts=data.parts.map(p=>({id:p.id,text:p.text,base:p}));restoreDraft();selected=null;input.value='';$('source-label').textContent=referenceMode?'未审核机器参照 · 只读':data.sourceLabel;render();$('reading').scrollTop=0;notice(referenceMode?'当前为未审核机器参照，仅供看图核对；不继承人工审核状态。':'已返回可靠TXT正文。');};banner.append(document.createElement('br'),toggle);wrapper.append(banner);}
 let total=0,offset=0;
 if(data.gaps.length){const banner=document.createElement('div');banner.className='source-gap';banner.textContent='本章先展示已有可靠TXT，以下来源缺口保留，不用AI稿补写。';const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`查看${data.gaps.length}处来源缺口及原图`;detail.append(summary);
  for(const gap of data.gaps){const p=document.createElement('p');p.textContent=(gap.reason||'来源缺口').replaceAll('待核','需人工核对');detail.append(p);const a=gap.startPage||gap.page,b=gap.endPage||a;if(a&&b)for(let n=a;n<=b;n++){const link=document.createElement('a');link.href=imageURL(n)||'#';link.target='_blank';link.rel='noopener';link.textContent=`原扫描${n} `;detail.append(link);}}
  banner.append(detail);wrapper.append(banner);
 }
 const refs=[];
 for(const part of parts){part.start=offset;part.rows=remap(part);offset+=part.text.length;
  for(const row of part.rows){
   if(row.status==='spacing'){if(!/[\r\n]/.test(row.text)){const space=document.createElement('span');space.className='space';wrapper.append(space);}continue;}
   total++;const button=document.createElement('button');button.type='button';button.className='pair';button.dataset.part=part.id;button.dataset.start=row.start;button.dataset.globalStart=part.start+row.start;button.dataset.status=row.status;button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',`${row.text}，点击查看原图邻文`);
   if(row.box&&row.sourcePage){const c=document.createElement('canvas');c.width=c.height=1;c.setAttribute('aria-hidden','true');button.append(c);refs.push({button,canvas:c,row});}
   else{const mark=document.createElement('span');mark.className='unlocated';mark.setAttribute('aria-hidden','true');button.append(mark);}
   const caption=document.createElement('span');caption.className='txt';caption.textContent=row.text;button.append(caption);button.onclick=()=>{if(guard())select(part,row,button);};wrapper.append(button);
  }
 }
 if(!total){const empty=document.createElement('p');empty.className='empty';empty.textContent='本章尚无可采用的可靠TXT，原扫描保留供核对。';const a=document.createElement('a');a.href=imageURL(data.references[0])||'#';a.target='_blank';a.rel='noopener';a.textContent='查看原图 ↗';empty.append(document.createElement('br'),a);wrapper.append(empty);}
 $('reading').replaceChildren(wrapper);$('mapping-state').textContent=`整章 ${total} 字 · 人工审核`;
 const refsByButton=new Map(refs.map(r=>[r.button,r]));
 observer=new IntersectionObserver(entries=>{for(const e of entries){const ref=refsByButton.get(e.target);if(!ref)continue;if(e.isIntersecting){const nonce=Symbol();ref.nonce=nonce;photo(ref.row.sourcePage).then(img=>{if(generation===renderTicket&&ref.nonce===nonce)paint(ref.canvas,img,ref.row.box,ref.row.text);}).catch(err=>{if(generation===renderTicket){ref.button.dataset.imageError='true';ref.canvas.width=ref.canvas.height=1;notice(err.message);}});}else{ref.nonce=null;ref.canvas.width=ref.canvas.height=1;}}},{root:$('reading'),rootMargin:'180px'});
 for(const ref of refs)observer.observe(ref.button);controls();
}
async function select(part,row,button){
 for(const b of $('reading').querySelectorAll('[aria-pressed=true]'))b.setAttribute('aria-pressed','false');button.setAttribute('aria-pressed','true');
 selected={partId:part.id,start:row.start,end:row.end,before:row.text,snapshot:part.text};input.value=row.text;$('selected-char').textContent=row.text;controls();
 const snapshot=selected,box=row.box,page=row.sourcePage;
 $('context').hidden=false;$('context-title').textContent=page?`原图邻文 · 扫描第 ${page} 页`:'原图邻文';$('context-image').hidden=!box||!page;$('original').hidden=!page;
 $('context-note').textContent=`${part.base.source.kind==='machine-reference'?'未审核机器参照（只读）':part.base.source.kind==='wolai-standard'?'wolai优先标准稿':part.base.source.kind==='human-return'?'人工初校回收原稿（保留历史疑点）':'人工初校补充'} · 「${row.text}」${box?'请结合原图邻文自行审核。':'此处没有定位范围，保留原文和字图空位。'}`;
 if(page)$('original').href=imageURL(page)||'#';
 if(box&&page)try{const image=await photo(page);if(selected!==snapshot)return;const[l,t,r,b]=box,margin=Math.max(70,(r-l)*1.3),x=Math.max(0,l-margin),y=Math.max(0,t-margin),right=Math.min(image.naturalWidth,r+margin),bottom=Math.min(image.naturalHeight,b+margin),c=$('context-image');c.width=450;c.height=250;const ctx=c.getContext('2d'),s=Math.min(450/(right-x),250/(bottom-y)),dx=(450-(right-x)*s)/2,dy=(250-(bottom-y)*s)/2;ctx.fillStyle='white';ctx.fillRect(0,0,450,250);ctx.drawImage(image,x,y,right-x,bottom-y,dx,dy,(right-x)*s,(bottom-y)*s);ctx.strokeStyle='#528762';ctx.lineWidth=2;ctx.strokeRect(dx+(l-x)*s,dy+(t-y)*s,(r-l)*s,(b-t)*s);}catch(e){notice(e.message);}
}
function apply(value,explicitDelete=false){
 if(referenceMode||composing||busy||!selected)return;if(!value&&!explicitDelete){notice('若要删除此字，请使用“删除此字”。');return;}
 const i=parts.findIndex(p=>p.id===selected.partId),part=parts[i];if(!part)return;
 try{const changed=replaceText(part.text,selected,value);if(changed===part.text)return;const next=parts.map((p,j)=>j===i?{...p,text:changed}:p),nextCrops=shiftCrops(crops,part.id,selected.start,selected.end,value),replacedCrops=Object.values(crops).filter(c=>c.partId===part.id&&c.start<selected.end&&c.end>selected.start),events=[...history,{partId:part.id,start:selected.start,end:selected.end,before:selected.before,after:value,replacedCrops}];if(!persist(next,events,nextCrops))return;crops=nextCrops;const scroll=$('reading').scrollTop;parts=next;history=events;render();$('reading').scrollTop=scroll;notice('已存为本机整章草稿，原审核TXT与标注保持。');}catch(e){notice(e.message);}
}
function cancel(){if(composing)return;if(selected)input.value=selected.before;notice('已取消当前输入。');}
function undo(){
 if(!guard()||!history.length)return;const event=history.at(-1),events=history.slice(0,-1);let next=parts,nextCrops;
 try{
  if(event.kind==='crop'){nextCrops={...crops};if(event.beforeCrop)nextCrops[event.key]=event.beforeCrop;else delete nextCrops[event.key];}
  else{const i=parts.findIndex(p=>p.id===event.partId),part=parts[i];if(!part||part.text.slice(event.start,event.start+event.after.length)!==event.after)throw Error('撤回位置已变化，保留草稿，请下载后核对。');const changed=part.text.slice(0,event.start)+event.before+part.text.slice(event.start+event.after.length);next=parts.map((p,j)=>j===i?{...p,text:changed}:p);nextCrops=shiftCrops(crops,part.id,event.start,event.start+event.after.length,event.before);for(const c of event.replacedCrops||[])nextCrops[cropKey(c.partId,c.start)]=c;}
  validateCrops(nextCrops,next,data.images);if(persist(next,events,nextCrops)){const scroll=$('reading').scrollTop;parts=next;crops=nextCrops;history=events;render();$('reading').scrollTop=scroll;notice('已撤回上一次文字或字图修改。');}
 }catch(e){notice(e.message);}
}
function restoreDraft(){
 history=[];crops={};draftProblem='';rawDraft=null;
 try{rawDraft=localStorage.getItem(key());const saved=JSON.parse(rawDraft||'null');if(saved){if(saved.chapter!==data.id||saved.binding!==data.binding||saved.baseTextSha256!==data.textSha256||!Array.isArray(saved.partTexts)||saved.partTexts.length!==parts.length||saved.partTexts.some(t=>typeof t!=='string'||t.length>100000)||!Array.isArray(saved.history))throw Error('草稿来源版本不匹配，原记录已保留。');parts=parts.map((p,i)=>({...p,text:saved.partTexts[i]}));crops=validateCrops(saved.manualCrops||{},parts,data.images);history=saved.history;}}catch(e){draftProblem=e instanceof SyntaxError?'草稿格式损坏，原记录已保留。':e.message;}
}

async function load(id){
 const sequence=++ticket;busy=true;controls();
 try{const entry=catalogue.chapters.find(c=>c.id===id);if(!entry)throw Error('章节不存在。');const next=await loadChapter(entry);next.references=siteScope.imagePages[next.id]||next.references;next.images={...next.images,...Object.fromEntries([...new Set([...Object.keys(next.images),...next.references])].filter(n=>siteScope.imageCatalogue[String(n)]).map(n=>[String(n),siteScope.imageCatalogue[String(n)]]))};if(await digest(next.text)!==next.textSha256)throw Error('本章TXT校验失败。');if(sequence!==ticket)return;
  observer?.disconnect();for(const record of photos.values())if(record.url)URL.revokeObjectURL(record.url);photos.clear();reliableData=next;referenceMode=false;data=next;parts=data.parts.map(p=>({id:p.id,text:p.text,base:p}));restoreDraft();
  $('chapter-title').textContent=data.title===data.workTitle?`${data.author} · ${data.title}`:`${data.workTitle} · ${data.title}`;$('source-label').textContent=data.sourceLabel;$('chapters').value=id;render();$('reading').scrollTop=0;const u=new URL(location.href);u.searchParams.delete('page');u.searchParams.set('chapter',id);window.history.replaceState(null,'',u);if(parent!==window)parent.postMessage({type:'shulun-character-chapter',chapter:id},location.origin);notice(draftProblem||(data.gaps.length?`本章有${data.gaps.length}处来源缺口；可查看原扫描。`:'整章连续阅读 · wolai优先 · 点击字图查看邻文，由人工审核。'));
 }catch(e){notice(e.message);if(data)$('chapters').value=data.id;else $('reading').textContent=e.message;}finally{busy=false;controls();}
}
function download(name,value,type='text/plain;charset=utf-8'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([value],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);$('download-menu').open=false;}
function exportParts(){if(!dirty())return parts;const i=parts.findIndex(p=>p.id===selected.partId);return parts.map((p,j)=>j===i?{...p,text:replaceText(p.text,selected,input.value)}:p);}
input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
$('edit-form').onkeydown=e=>{if((e.key==='Enter'||e.key==='Escape')&&(composing||e.isComposing||e.keyCode===229)){e.preventDefault();return;}if(e.key==='Escape'){e.preventDefault();cancel();}};
$('edit-form').onsubmit=e=>{e.preventDefault();if(!e.isComposing&&!composing)apply(input.value);};$('delete').onclick=()=>apply('',true);$('cancel').onclick=cancel;$('undo').onclick=undo;$('close-context').onclick=()=>{$('context').hidden=true;};
$('chapters').onchange=e=>{if(guard())load(e.target.value);else e.target.value=data.id;};
for(const[id,delta]of [['previous',-1],['next',1]])$(id).onclick=()=>{if(guard()){const i=catalogue.chapters.findIndex(c=>c.id===data.id);if(catalogue.chapters[i+delta])load(catalogue.chapters[i+delta].id);}};
const scaleKey='shulun-character-view-scale-v1';let viewScale=100;
function setViewScale(value,remember=true){
 if(composing){$('size').value=String(viewScale);return;}
 const number=Number(value);viewScale=Number.isFinite(number)?Math.max(40,Math.min(200,Math.round(number/5)*5)):100;
 document.documentElement.style.setProperty('--cell',`${52*viewScale/100}px`);$('size').value=String(viewScale);$('size').setAttribute('aria-valuetext',`${viewScale}%`);$('size-value').value=`${viewScale}%`;
 if(remember)try{localStorage.setItem(scaleKey,String(viewScale));if($('notice').textContent==='缩放已应用，本次比例未能记住。')notice('缩放比例已记住。');}catch{notice('缩放已应用，本次比例未能记住。');}
}
$('size').oninput=e=>setViewScale(e.target.value);$('size-reset').onclick=()=>setViewScale(100);
try{const saved=Number(localStorage.getItem(scaleKey));setViewScale(saved>=40&&saved<=200?saved:100,false);}catch{setViewScale(100,false);}
$('download-txt').onclick=()=>{if(!composing)download(`${data.workTitle}-${data.title}-${referenceMode?'未审核机器参照':'逐字对照稿'}.txt`,'\ufeff'+exportParts().map(p=>p.text).join(''));};
$('download-json').onclick=()=>{if(composing)return;download(`${data.id}-整章定位草稿.json`,JSON.stringify({...payload(),text:text(),coordinateUnit:'original-image-pixels',textOffsetUnit:'UTF-16',images:data.images,characters:parts.flatMap(p=>p.rows.map(r=>({...r,start:p.start+r.start,end:p.start+r.end,partId:p.id}))),sources:data.parts.map(p=>({partId:p.id,source:p.source})),pendingCrop:cropEditor.isOpen()?{...selected,...cropEditor.pending()}:null,pendingEdit:dirty()?{...selected,value:input.value}:null,unreadableDraft:draftProblem?rawDraft:null},null,2),'application/json');};
window.addEventListener('beforeunload',e=>{if(dirty()||composing||cropEditor.dirty()){e.preventDefault();e.returnValue='';}});
const cropEditor=createCropEditor({photo,onNotice:notice});
$('adjust-crop').onclick=()=>{
 if(!guard()||!selected)return;const target={...selected},part=parts.find(p=>p.id===target.partId),row=part.rows.find(r=>r.start===target.start&&r.end===target.end),page=row.sourcePage||part.base.alignment?.bestPage||data.references[0];
 if(!page){notice('本章没有可用原图。');return;}
 cropEditor.open({page,box:row.box,title:target.before,images:Object.fromEntries([...new Set([...data.references,page])].filter(n=>data.images[String(n)]).map(n=>[String(n),data.images[String(n)]])),save:({page,box})=>{
  if(selected?.partId!==target.partId||selected?.start!==target.start||part.text!==target.snapshot){notice('正文位置已变化，请取消后重新选择此字。');return false;}
  const k=cropKey(part.id,target.start),crop={partId:part.id,start:target.start,end:target.end,text:target.before,page,box,imageSha256:data.images[String(page)].sha256},nextCrops={...crops,[k]:crop},events=[...history,{kind:'crop',key:k,beforeCrop:crops[k]||null,afterCrop:crop}];
  try{validateCrops(nextCrops,parts,data.images);if(!persist(parts,events,nextCrops))return false;const scroll=$('reading').scrollTop;crops=nextCrops;history=events;render();$('reading').scrollTop=scroll;const button=[...$('reading').querySelectorAll('.pair')].find(b=>b.dataset.part===part.id&&Number(b.dataset.start)===target.start),nextRow=part.rows.find(r=>r.start===target.start);if(button)select(part,nextRow,button);notice('字图已保存到本机整章草稿，可撤回并随JSON下载。');return true;}catch(e){notice(e.message);return false;}
 }});
};
$('crop-download').onclick=()=>{$('download-json').onclick();};
function viewport(){const v=window.visualViewport,h=v&&v.scale===1?v.height:innerHeight;document.body.style.height=`${h}px`;document.body.style.top=`${v&&v.scale===1?v.offsetTop:0}px`;document.body.classList.toggle('compact',h<480);}
window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);viewport();
try{siteScope=await loadTaskScope(taskParams);catalogue=siteScope.catalogue;let group;
 for(const c of catalogue.chapters){if(!group||group.label!==c.workTitle){group=document.createElement('optgroup');group.label=c.workTitle;$('chapters').append(group);}group.append(new Option(c.title,c.id));}
 const requested=new URLSearchParams(location.search).get('chapter');await load(catalogue.chapters.some(c=>c.id===requested)?requested:catalogue.defaultChapter);
}catch(e){notice(e.message);$('reading').textContent=e.message;}

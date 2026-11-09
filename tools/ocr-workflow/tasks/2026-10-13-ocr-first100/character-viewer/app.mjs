import {digest,mapText,replaceText} from './alignment.mjs';

const $=id=>document.getElementById(id),input=$('edit-text');
let catalogue,data,version,image,text='',rows=[],selected=null,history=[],composing=false,busy=false,serial=0,versionSerial=0,blobUrl=null,draftProblem='',rawDraft=null;
const labels={equal:'OCR位置对应',substituted:'文字有变化，位置待核',inserted:'新增文字，待定位',ambiguous:'多种对应，待定位',no_geometry:'没有可靠字框',alignment_limit:'文本过长，待定位'};
function notice(message){$('notice').textContent=message;}
function dirtyBuffer(){return selected&&input.value!==selected.before;}
function guard(){if(composing){notice('请先完成当前输入。');return false;}if(dirtyBuffer()){notice('校改尚未应用，请先应用到草稿或取消。');return false;}return !busy;}
function key(){return `shulun-character-draft-v1:${data.page}:${version.binding}`;}
function sourceGlyphs(){return version.mapping.sourceGlyphs||data.sourceGlyphs;}
function payload(nextText=text,nextHistory=history){return {format:'shulun-character-draft-v1',page:data.page,version:version.id,mappingBinding:version.binding,sourceSha256:data.sourceSha256,baseTextSha256:version.mapping.textSha256,text:nextText,history:nextHistory,humanConfirmed:false};}
function persist(nextText,nextHistory){
 if(draftProblem){notice(draftProblem+' 请先下载JSON保留原草稿。');return false;}
 try{localStorage.setItem(key(),JSON.stringify(payload(nextText,nextHistory)));return true;}
 catch{notice('本机草稿保存失败。校改仍在输入框，请下载后再切换。');return false;}
}
function controls(){
 const index=catalogue.pages.findIndex(p=>p.page===data?.page);
 $('previous').disabled=busy||index<=0;$('next').disabled=busy||index>=catalogue.pages.length-1;
 $('pages').disabled=busy;$('versions').disabled=busy;
 for(const id of ['apply','delete','cancel'])$(id).disabled=!selected||busy;
 if(selected?.sourceOnly)$('delete').disabled=true;
 input.disabled=!selected||busy;$('undo').disabled=!history.length||busy;
 $('draft-state').textContent=text===version?.mapping.text?'未修改':`本机草稿 · ${history.length} 次校改`;
}
function drawGlyph(canvas,box,size=104){
 canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);
 const[l,t,r,b]=box,w=r-l,h=b-t,scale=Math.min((size-8)/w,(size-8)/h);
 ctx.drawImage(image,l,t,w,h,(size-w*scale)/2,(size-h*scale)/2,w*scale,h*scale);
}
function render(){
 rows=mapText(sourceGlyphs(),text,version.mapping.ignoredLineLabels);
 const wrapper=document.createElement('div');wrapper.className='pairs';
 const glyphs=sourceGlyphs(),used=new Set(rows.map(r=>r.glyphId).filter(Boolean)),glyphOrder=new Map(glyphs.map((g,i)=>[g.id,i])),display=[...rows];
 for(let i=0;i<glyphs.length;i++){
  const g=glyphs[i];if(!g.box||used.has(g.id)||/^\s+$/u.test(g.text))continue;
  const next=rows.find(r=>r.glyphId&&glyphOrder.get(r.glyphId)>i),previous=rows.findLast(r=>r.glyphId&&glyphOrder.get(r.glyphId)<i);
  const at=previous&&previous.column===g.column&&(!next||next.column!==g.column)?previous.end:next?next.start:text.length;
  const row={...g,start:at,end:at,text:'',ocrText:g.text,glyphId:g.id,status:'source_only',sourceOnly:true};
  const position=next?display.indexOf(next):display.length;display.splice(position,0,row);
 }
 let located=0,total=0;
 for(const row of display){
  if(row.status==='line_label')continue;
  if(row.status==='spacing'){
   if(!/[\r\n]/.test(row.text)){const space=document.createElement('span');space.className='space';space.setAttribute('aria-hidden','true');wrapper.append(space);}
   continue;
  }
  if(!row.sourceOnly){total++;if(row.box)located++;}
  const button=document.createElement('button');button.type='button';button.className='pair';button.dataset.start=row.start;button.dataset.status=row.status;
  button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',`${row.text}，${labels[row.status]||'待定位'}`);
  if(row.sourceOnly){button.dataset.sourceOnly='true';button.setAttribute('aria-label',`原图字形「${row.ocrText}」在TXT中无唯一对应，可核对补字`);}
  button.title=`${row.text} · ${labels[row.status]||'待定位'}`;
  if(row.box){const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');drawGlyph(canvas,row.box);button.append(canvas);}
  else{const pending=document.createElement('span');pending.className='unlocated';pending.textContent='待定位';button.append(pending);}
  const txt=document.createElement('span');txt.className='txt';txt.textContent=row.sourceOnly?'+':row.text;button.append(txt);
  if(row.status==='substituted'){const mark=document.createElement('small');mark.textContent='待核';button.append(mark);}
  button.onclick=()=>{if(guard())select(row,button);};
  button.onkeydown=e=>{
   if(e.isComposing||e.keyCode===229)return;
   if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
    e.preventDefault();const siblings=[...wrapper.querySelectorAll('.pair')],i=siblings.indexOf(button),next=siblings[i+(e.key==='ArrowRight'?1:-1)];next?.focus();
   }
  };
  wrapper.append(button);
 }
 $('reading').replaceChildren(wrapper);
 $('mapping-state').textContent=`上图下文 · ${located} 字有位置 · ${total-located} 字待定位`;
 selected=null;input.value='';$('selected-char').textContent='—';$('context').hidden=true;controls();
}
function select(row,button){
 for(const el of $('reading').querySelectorAll('[aria-pressed=true]'))el.setAttribute('aria-pressed','false');
 button.setAttribute('aria-pressed','true');
 selected={start:row.start,end:row.end,before:row.text,snapshot:text,sourceOnly:!!row.sourceOnly};
 input.value=row.text;$('selected-char').textContent=row.sourceOnly?'补字':row.text;controls();$('delete').disabled=!!row.sourceOnly;
 $('context').hidden=false;$('context-title').textContent=`扫描第 ${data.page} 页 · 原图邻文`;
 const fallback=sourceGlyphs().find(g=>g.id===row.glyphId)?.box;
 const box=row.box||fallback;
 $('context-image').hidden=!box;
 const note=$('context-note');note.replaceChildren();
 const detail=document.createElement('strong');detail.textContent=row.sourceOnly?'此OCR字形在TXT中无唯一对应；可能是缺文或多识别，请核图后补录。':`「${row.text}」 · ${labels[row.status]||'待定位'}`;note.append(detail,document.createElement('br'));
 note.append(document.createTextNode(box?'字框来自识别位置估计，请结合邻文核对。修改只进入本机草稿。':'此处没有唯一可靠位置，保留待定位。可查看原页，不自动借用相邻字图。'));
 if(box){
  const[l,t,r,b]=box,margin=Math.max(70,(r-l)*1.3),x=Math.max(0,Math.floor(l-margin)),y=Math.max(0,Math.floor(t-margin)),right=Math.min(image.naturalWidth,Math.ceil(r+margin)),bottom=Math.min(image.naturalHeight,Math.ceil(b+margin));
  const c=$('context-image');c.width=450;c.height=250;const ctx=c.getContext('2d'),scale=Math.min(450/(right-x),250/(bottom-y)),dx=(450-(right-x)*scale)/2,dy=(250-(bottom-y)*scale)/2;
  ctx.fillStyle='white';ctx.fillRect(0,0,450,250);ctx.drawImage(image,x,y,right-x,bottom-y,dx,dy,(right-x)*scale,(bottom-y)*scale);
  ctx.strokeStyle='#528762';ctx.lineWidth=2;ctx.strokeRect(dx+(l-x)*scale,dy+(t-y)*scale,(r-l)*scale,(b-t)*scale);
 }
 notice(row.sourceOnly?'此处可补字；原图字形是否属于正文，仍需核对。':`已选「${row.text}」，可在下方校改；长按文字输入框可使用系统输入法。`);
}
function apply(value,explicitDelete=false){
 if(composing||busy||!selected)return;
 if(!value&&!explicitDelete){notice('若要删除此字，请使用“删除此字”。');return;}
 try{
  const nextText=replaceText(text,selected,value);if(nextText===text){notice('文字未变化。');return;}
  const nextHistory=[...history,{text,start:selected.start,end:selected.end,before:selected.before,after:value}];
  if(!persist(nextText,nextHistory))return;
  const position=selected.start,scroll=$('reading').scrollTop;text=nextText;history=nextHistory;
  render();$('reading').scrollTop=scroll;
  const target=$('reading').querySelector(`.pair[data-start="${position}"]:not([data-source-only])`),row=rows.find(r=>r.start===position);if(target&&row)select(row,target);
  notice('已保存到本机草稿。原TXT与审核状态保持。');
 }catch(e){notice(e.message);}
}
async function setVersion(id){
 const expected=data,ticket=++versionSerial,candidate=data.versions.find(v=>v.id===id);if(!candidate)throw Error('文本版本不存在。');
 if(await digest(candidate.mapping.text)!==candidate.mapping.textSha256)throw Error('TXT版本校验失败。');
 if(expected!==data||ticket!==versionSerial)return;
 version=candidate;text=version.mapping.text;history=[];draftProblem='';rawDraft=null;
 try{
  rawDraft=localStorage.getItem(key());const saved=JSON.parse(rawDraft||'null');
  if(saved){
   if(saved.mappingBinding!==version.binding||saved.sourceSha256!==data.sourceSha256||saved.baseTextSha256!==version.mapping.textSha256||typeof saved.text!=='string'||saved.text.length>100000||!Array.isArray(saved.history)||saved.history.some(h=>typeof h.text!=='string'))throw Error('草稿来源版本不匹配，原记录已保留。');
   text=saved.text;history=saved.history;
  }
 }catch(e){draftProblem=e instanceof SyntaxError?'本机草稿格式损坏，原记录已保留。':e.message;notice(draftProblem);}
 $('versions').value=id;render();
}
async function openPage(number){
 const request=++serial;busy=true;controls();
 try{
  const entry=catalogue.pages.find(p=>p.page===number);if(!entry)throw Error('此页不在当前样例中。');
  const response=await fetch(entry.file);if(!response.ok)throw Error('逐字数据读取失败。');const raw=await response.text();
  if(await digest(raw)!==entry.sha256)throw Error('逐字数据版本校验失败。');
  const next=JSON.parse(raw),photo=await fetch(next.image);if(!photo.ok)throw Error('原图读取失败。');
  const bytes=await photo.arrayBuffer(),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(sha!==next.sourceSha256)throw Error('原图与字框版本不匹配，已停止显示。');
  const url=URL.createObjectURL(new Blob([bytes])),img=new Image();img.src=url;await img.decode();
  if(request!==serial){URL.revokeObjectURL(url);return;}
  if(img.naturalWidth!==next.imageSize[0]||img.naturalHeight!==next.imageSize[1]){URL.revokeObjectURL(url);throw Error('原图尺寸不匹配。');}
  if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=url;data=next;image=img;
  $('page-title').textContent=data.title;$('pages').value=number;
  $('original').href=data.image;
  $('versions').replaceChildren(...data.versions.map(v=>new Option(v.label,v.id)));
  await setVersion(data.versions.some(v=>v.id==='reviewed')?'reviewed':data.versions[0].id);
  $('reading').scrollTop=0;
  const u=new URL(location.href);u.searchParams.set('page',number);historyUrl(u);
  notice(draftProblem||'四页本地样例 · 机器定位待核 · 校改仅存本机草稿');
 }catch(e){notice(e.message);if(data)$('pages').value=data.page;else $('reading').replaceChildren(Object.assign(document.createElement('p'),{className:'empty',textContent:e.message}));}
 finally{busy=false;controls();}
}
function historyUrl(url){window.history.replaceState(null,'',url);}
function download(name,value,type='text/plain;charset=utf-8'){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([value],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);$('download-menu').open=false;
}
input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
$('edit-form').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key==='Escape')&&(composing||e.isComposing||e.keyCode===229)){e.preventDefault();return;}if(e.key==='Escape'){e.preventDefault();cancel();}});
$('edit-form').onsubmit=e=>{e.preventDefault();if(!e.isComposing&&!composing)apply(input.value);};
$('delete').onclick=()=>apply('',true);
function cancel(){if(composing)return;if(selected)input.value=selected.before;notice('已取消当前输入，草稿未变。');}
$('cancel').onclick=cancel;
$('undo').onclick=()=>{if(!guard()||!history.length)return;const previous=history.at(-1).text,nextHistory=history.slice(0,-1);if(persist(previous,nextHistory)){text=previous;history=nextHistory;const scroll=$('reading').scrollTop;render();$('reading').scrollTop=scroll;notice('已撤回上一次校改。');}};
$('close-context').onclick=()=>{$('context').hidden=true;};
$('pages').onchange=e=>{const page=Number(e.target.value);if(guard())openPage(page);else e.target.value=data.page;};
for(const[id,delta]of [['previous',-1],['next',1]])$(id).onclick=()=>{if(guard()){const i=catalogue.pages.findIndex(p=>p.page===data.page);if(catalogue.pages[i+delta])openPage(catalogue.pages[i+delta].page);}};
$('versions').onchange=async e=>{const id=e.target.value;if(guard()){busy=true;controls();try{await setVersion(id);notice(draftProblem||'已切换文本来源；各版本草稿分别保存。');}catch(error){notice(error.message);}finally{busy=false;controls();}}else e.target.value=version.id;};
$('size').onchange=e=>{if(composing){e.target.value=String(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell')));return;}document.documentElement.style.setProperty('--cell',`${e.target.value}px`);};
$('download-txt').onclick=()=>{if(composing)return;const candidate=dirtyBuffer()?replaceText(text,selected,input.value):text;download(`扫描${data.page}-${version.id}-校订草稿.txt`,'\ufeff'+candidate);};
$('download-json').onclick=async()=>{if(composing)return;download(`扫描${data.page}-${version.id}-校订草稿.json`,JSON.stringify({...payload(),textSha256:await digest(text),characters:rows,pendingEdit:dirtyBuffer()?{...selected,value:input.value}:null,unreadableDraft:draftProblem?rawDraft:null},null,2),'application/json');};
window.addEventListener('beforeunload',e=>{if(dirtyBuffer()||composing){e.preventDefault();e.returnValue='';}});
function viewport(){const v=window.visualViewport,height=v&&v.scale===1?v.height:innerHeight;document.body.style.height=`${height}px`;document.body.style.top=`${v&&v.scale===1?v.offsetTop:0}px`;document.body.classList.toggle('compact',height<480);}
window.addEventListener('resize',viewport);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);viewport();
try{
 const r=await fetch('index.json');if(!r.ok)throw Error('样例目录读取失败。');catalogue=await r.json();
 $('pages').replaceChildren(...catalogue.pages.map(p=>new Option(`扫描 ${p.page} 页`,p.page)));
 const initial=Number(new URLSearchParams(location.search).get('page'));
 await openPage(catalogue.pages.some(p=>p.page===initial)?initial:catalogue.pages[0].page);
}catch(e){notice(e.message);$('reading').textContent=e.message;}

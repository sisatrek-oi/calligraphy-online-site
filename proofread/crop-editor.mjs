import{validBox}from'./crop-state.mjs';
const $=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
export function createCropEditor({photo,onNotice}){
 const dialog=$('crop-editor'),svg=$('crop-canvas'),viewport=$('crop-viewport'),rect=$('crop-rect'),preview=$('crop-preview');
 let session=null,image=null,box=null,initial=null,scale=1,drawing=false,drag=null,loadTicket=0;
 const fields=['crop-x','crop-y','crop-w','crop-h'];
 const handles=['nw','ne','se','sw'].map(corner=>{const r=document.createElementNS(ns,'rect');r.dataset.corner=corner;r.classList.add('crop-handle');svg.append(r);return r;});
 const current=()=>({page:Number($('crop-page').value),box:box&&[...box]});
 const dirty=()=>session&&JSON.stringify(current())!==initial;
 function controls(){const ready=!!image;$('crop-save').disabled=!ready||!validBox(box,image?[image.naturalWidth,image.naturalHeight]:null);for(const id of ['crop-redraw','crop-zoom-in','crop-zoom-out','crop-fit',...fields])$(id).disabled=!ready;}
 function zoom(value,centre){
  if(!image)return;const old=scale,cx=centre?.[0]??(viewport.scrollLeft+viewport.clientWidth/2)/old,cy=centre?.[1]??(viewport.scrollTop+viewport.clientHeight/2)/old;
  scale=Math.max(.12,Math.min(4,value));svg.style.width=`${image.naturalWidth*scale}px`;svg.style.height=`${image.naturalHeight*scale}px`;$('crop-zoom').textContent=`${Math.round(scale*100)}%`;draw();viewport.scrollLeft=cx*scale-viewport.clientWidth/2;viewport.scrollTop=cy*scale-viewport.clientHeight/2;
 }
 function draw(){
  if(!image)return;
  rect.hidden=!box;rect.style.display=box?'':'none';
  if(box){const[l,t,r,b]=box;rect.setAttribute('x',l);rect.setAttribute('y',t);rect.setAttribute('width',r-l);rect.setAttribute('height',b-t);const points=[[l,t],[r,t],[r,b],[l,b]],s=12/scale;handles.forEach((h,i)=>{h.setAttribute('x',points[i][0]-s/2);h.setAttribute('y',points[i][1]-s/2);h.setAttribute('width',s);h.setAttribute('height',s);h.style.display='';});
   [l,t,r-l,b-t].forEach((v,i)=>{if(document.activeElement!==$(fields[i]))$(fields[i]).value=v;});
   const ctx=preview.getContext('2d'),w=r-l,h=b-t,k=Math.min(140/w,140/h);ctx.fillStyle='white';ctx.fillRect(0,0,160,160);if(w>0&&h>0)ctx.drawImage(image,l,t,w,h,(160-w*k)/2,(160-h*k)/2,w*k,h*k);
  }else{for(const h of handles)h.style.display='none';for(const id of fields)$(id).value='';const ctx=preview.getContext('2d');ctx.clearRect(0,0,160,160);}
  $('crop-redraw').setAttribute('aria-pressed',String(drawing));svg.classList.toggle('drawing',drawing);controls();
 }
 function point(e){const r=svg.getBoundingClientRect();return[Math.max(0,Math.min(image.naturalWidth,Math.round((e.clientX-r.left)*image.naturalWidth/r.width))),Math.max(0,Math.min(image.naturalHeight,Math.round((e.clientY-r.top)*image.naturalHeight/r.height)))];}
 async function loadPage(page,startingBox=null){
  const seq=++loadTicket;image=null;box=null;controls();$('crop-status').textContent='正在读取原图…';$('crop-image').removeAttribute('href');rect.style.display='none';handles.forEach(h=>h.style.display='none');
  try{const img=await photo(page);if(!session||seq!==loadTicket)return;image=img;svg.setAttribute('viewBox',`0 0 ${img.naturalWidth} ${img.naturalHeight}`);$('crop-image').setAttribute('href',img.src);$('crop-image').setAttribute('width',img.naturalWidth);$('crop-image').setAttribute('height',img.naturalHeight);
   box=startingBox&&validBox(startingBox,[img.naturalWidth,img.naturalHeight])?[...startingBox]:null;drawing=!box;zoom(Math.min(1,Math.max(.12,(viewport.clientWidth-20)/img.naturalWidth)),box?[(box[0]+box[2])/2,(box[1]+box[3])/2]:undefined);$('crop-status').textContent=box?'拖动框内移动，拖动角点缩放；空白处拖动可移动原图。':'请在原图上拖出该字的裁剪框。';draw();
  }catch(e){if(seq===loadTicket){$('crop-status').textContent=e.message;onNotice(e.message);}}
 }
 svg.addEventListener('pointerdown',e=>{
  if(!image||e.button!==0||drag)return;e.preventDefault();svg.focus({preventScroll:true});const p=point(e),corner=e.target.dataset.corner;
  drag={id:e.pointerId,start:p,box:box&&[...box],client:[e.clientX,e.clientY],scroll:[viewport.scrollLeft,viewport.scrollTop],mode:drawing?'draw':corner||e.target===rect?'box':'pan',corner};
  if(corner)drag.mode='resize';if(drawing){box=[p[0],p[1],p[0],p[1]];draw();}svg.setPointerCapture(e.pointerId);
 });
 svg.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id||!image)return;e.preventDefault();const p=point(e),dx=p[0]-drag.start[0],dy=p[1]-drag.start[1],w=image.naturalWidth,h=image.naturalHeight;
  if(drag.mode==='pan'){viewport.scrollLeft=drag.scroll[0]-(e.clientX-drag.client[0]);viewport.scrollTop=drag.scroll[1]-(e.clientY-drag.client[1]);return;}
  if(drag.mode==='draw')box=[Math.min(p[0],drag.start[0]),Math.min(p[1],drag.start[1]),Math.max(p[0],drag.start[0]),Math.max(p[1],drag.start[1])];
  else if(drag.mode==='box'){const b=drag.box,x=Math.max(-b[0],Math.min(w-b[2],dx)),y=Math.max(-b[1],Math.min(h-b[3],dy));box=[b[0]+x,b[1]+y,b[2]+x,b[3]+y];}
  else{const b=[...drag.box];if(drag.corner.includes('w'))b[0]=Math.min(p[0],b[2]-1);if(drag.corner.includes('e'))b[2]=Math.max(p[0],b[0]+1);if(drag.corner.includes('n'))b[1]=Math.min(p[1],b[3]-1);if(drag.corner.includes('s'))b[3]=Math.max(p[1],b[1]+1);box=b;}
  draw();
 });
 function end(e){if(!drag||e.pointerId!==drag.id)return;if(e.type==='pointercancel')box=drag.box;else if(drag.mode==='draw'&&!validBox(box,[image.naturalWidth,image.naturalHeight]))box=drag.box;else if(drag.mode==='draw')drawing=false;drag=null;draw();}
 svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
 svg.addEventListener('keydown',e=>{if(!box||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const d=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,dy=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0,b=[box[0]+dx,box[1]+dy,box[2]+dx,box[3]+dy];if(validBox(b,[image.naturalWidth,image.naturalHeight])){box=b;draw();}});
 for(const id of fields)$(id).addEventListener('change',()=>{if(!image)return;const[x,y,w,h]=fields.map(f=>Number($(f).value)),b=[x,y,x+w,y+h];if(validBox(b,[image.naturalWidth,image.naturalHeight])){box=b;drawing=false;$('crop-status').textContent='裁剪框已调整，点击保存字图。';draw();}else{$('crop-status').textContent='坐标须在原图内，宽和高须大于零。';if(box){const[l,t,r,b]=box;[l,t,r-l,b-t].forEach((v,i)=>$(fields[i]).value=v);}draw();}});
 $('crop-redraw').onclick=()=>{drawing=true;draw();$('crop-status').textContent='在原图上拖出新框；原框在保存前保持为草稿。';};
 $('crop-zoom-in').onclick=()=>zoom(scale*1.3);$('crop-zoom-out').onclick=()=>zoom(scale/1.3);$('crop-fit').onclick=()=>zoom(Math.min(1,(viewport.clientWidth-20)/image.naturalWidth));
 $('crop-page').onchange=()=>loadPage(Number($('crop-page').value));
 function close(){loadTicket++;drag=null;session=null;image=null;dialog.close();}
 $('crop-cancel').onclick=close;$('crop-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 $('crop-save').onclick=()=>{if(!session||!image||!validBox(box,[image.naturalWidth,image.naturalHeight]))return;if(session.save(current()))close();else $('crop-status').textContent=$('notice').textContent||'保存未成功，当前框已保留，请重试或先下载JSON。';};
 return {open({page,box:initialBox,title,images,save}){session={save};$('crop-title').textContent=`调整字图 · ${title}`;$('crop-page').replaceChildren(...Object.keys(images).map(n=>new Option(`原扫描 ${n}`,n)));$('crop-page').value=String(page);box=initialBox;initial=JSON.stringify({page,box:initialBox||null});dialog.showModal();loadPage(page,initialBox);},isOpen:()=>dialog.open,dirty,pending:()=>session?current():null};
}

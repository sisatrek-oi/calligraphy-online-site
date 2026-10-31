export function scanImagePath(page){
 if(!Number.isInteger(page)||page<1||page>1052)throw Error('原图页码无效。');
 return './screening-data/scans/page-'+String(page).padStart(4,'0')+'.jpg';
}
export function normalizedScanRect(box,from,to){
 if(!(box.width>0&&box.height>0))throw Error('原图尚未显示，请等待载入。');
 const clamp=(n,size)=>Math.max(0,Math.min(size,n)),x1=clamp(from.x-box.left,box.width),x2=clamp(to.x-box.left,box.width),y1=clamp(from.y-box.top,box.height),y2=clamp(to.y-box.top,box.height),round=n=>Number(n.toFixed(12));
 return {x:round(Math.min(x1,x2)/box.width),y:round(Math.min(y1,y2)/box.height),width:round(Math.abs(x2-x1)/box.width),height:round(Math.abs(y2-y1)/box.height)};
}
export function validateScanRegion(region){
 if(!region||typeof region!=='object')throw Error('原图框选记录无效。');
 scanImagePath(region.page);
 if(!Number.isInteger(region.imageWidth)||region.imageWidth<1||!Number.isInteger(region.imageHeight)||region.imageHeight<1||!/^([a-f0-9]{64})$/.test(region.imageSha256))throw Error('原图尺寸或版本无效。');
 const r=region.rect;
 if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1+1e-10||r.y+r.height>1+1e-10)throw Error('框选范围超出原图或为空。');
 return region;
}
function imageIdentity(image,page){
 const src=new URL(scanImagePath(page),image.ownerDocument.baseURI).href;
 if(image.hidden||!image.complete||!image.naturalWidth||image.dataset.scan!==String(page)||image.currentSrc!==src)throw Error('原图未载入或已切换，请重新框选。');
 return {src,page,imageWidth:image.naturalWidth,imageHeight:image.naturalHeight};
}
async function imageHash(src){
 const response=await fetch(src,{cache:'force-cache',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('无法核验原图版本，请稍后重试。');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function captureScanRegion(image,candidate){
 const before=imageIdentity(image,candidate.page);
 if(before.src!==candidate.src||before.imageWidth!==candidate.imageWidth||before.imageHeight!==candidate.imageHeight)throw Error('原图已变化，请重新框选。');
 const imageSha256=await imageHash(before.src),after=imageIdentity(image,candidate.page);
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('原图已切换，请重新框选。');
 return validateScanRegion({page:candidate.page,rect:structuredClone(candidate.rect),imageWidth:before.imageWidth,imageHeight:before.imageHeight,imageSha256});
}
export async function verifyScanRegion(image,region){
 validateScanRegion(region);
 const identity=imageIdentity(image,region.page);
 if(identity.imageWidth!==region.imageWidth||identity.imageHeight!==region.imageHeight||await imageHash(identity.src)!==region.imageSha256)throw Error('原图版本与反馈不一致，已保留记录，请核对原图。');
 const after=imageIdentity(image,region.page);
 if(after.imageWidth!==region.imageWidth||after.imageHeight!==region.imageHeight)throw Error('原图尺寸已变化，请核对原记录。');
}

export function bindScanRegion({image,layer,box,toggle,declare,clear,status,getContext,canSelect,beforeSelect=()=>{},onDeclare,onClear}){
 let active=false,drag=null,candidate=null,busy=false;
 const context=()=>JSON.stringify(getContext());
 function paint(rect){
  box.hidden=!rect;if(!rect)return;
  for(const [key,value]of Object.entries({left:rect.x,top:rect.y,width:rect.width,height:rect.height}))box.style[key]=value*100+'%';
 }
 function endDrag(){
  const id=drag?.id;drag=null;if(id!=null&&layer.hasPointerCapture(id))layer.releasePointerCapture(id);
 }
 function setActive(next){
  active=next;layer.classList.toggle('is-selecting',active);layer.tabIndex=active?0:-1;toggle.setAttribute('aria-pressed',String(active));toggle.textContent=active?'退出框选':'框选缺文';
 }
 function reset(){endDrag();candidate=null;setActive(false);paint(null);declare.disabled=true;clear.disabled=true;status.textContent='';}
 function cancel(){endDrag();candidate=null;paint(null);declare.disabled=true;clear.disabled=true;status.textContent='框选已取消，可重新拖动。';}
 toggle.onclick=()=>{
  if(!canSelect())return;
  if(active){reset();return;}
  try{imageIdentity(image,getContext().page);beforeSelect();setActive(true);layer.focus({preventScroll:true});status.textContent='在原图上拖动框选缺失区域；普通滚动请先退出框选。';}catch(e){status.textContent=e.message;}
 };
 clear.onclick=()=>{if(!canSelect())return;reset();onClear();};
 layer.addEventListener('pointerdown',event=>{
  if(!active||!event.isPrimary||event.button!==0||busy||!canSelect())return;
  try{
   const identity=imageIdentity(image,getContext().page);event.preventDefault();endDrag();candidate=null;declare.disabled=true;
   drag={...identity,id:event.pointerId,context:context(),from:{x:event.clientX,y:event.clientY},box:image.getBoundingClientRect()};
   layer.setPointerCapture(event.pointerId);paint(null);clear.disabled=false;
  }catch(e){status.textContent=e.message;}
 });
 function unchanged(){
  if(!drag||drag.context!==context()||!active||image.currentSrc!==drag.src||!image.complete||image.naturalWidth!==drag.imageWidth||image.naturalHeight!==drag.imageHeight)return false;
  const b=image.getBoundingClientRect();return ['left','top','width','height'].every(k=>Math.abs(b[k]-drag.box[k])<.5);
 }
 layer.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(!unchanged()){cancel();return;}event.preventDefault();paint(normalizedScanRect(drag.box,drag.from,{x:event.clientX,y:event.clientY}));
 });
 layer.addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(!unchanged()){cancel();return;}
  event.preventDefault();const rect=normalizedScanRect(drag.box,drag.from,{x:event.clientX,y:event.clientY}),saved=drag;
  endDrag();if(rect.width*saved.box.width<4||rect.height*saved.box.height<4){cancel();status.textContent='请拖出一个区域，单击不会创建缺文反馈。';return;}
  candidate={page:saved.page,src:saved.src,imageWidth:saved.imageWidth,imageHeight:saved.imageHeight,rect,context:saved.context};paint(rect);declare.disabled=false;clear.disabled=false;setActive(false);status.textContent='已框选PDF第'+saved.page+'页，点击“声明此处缺文”。';
 });
 for(const type of ['pointercancel','lostpointercapture'])layer.addEventListener(type,()=>{if(drag)cancel();});
 layer.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();reset();}});
 declare.onclick=async()=>{
  if(!candidate||busy||!canSelect())return;
  const snapshot=candidate;busy=true;declare.disabled=true;status.textContent='正在核验原图位置…';
  try{
   const region=await captureScanRegion(image,snapshot);
   if(candidate!==snapshot||snapshot.context!==context()||!canSelect())throw Error('图页或选区已变化，请重新框选。');
   onDeclare(region);status.textContent='框选位置已带入缺文反馈，请确认保存。';
  }catch(e){status.textContent=e.message;}finally{busy=false;declare.disabled=!candidate;}
 };
 return {reset,geometryChanged(){if(drag)cancel();},show(region){reset();paint(region.rect);clear.disabled=false;status.textContent='正在查看已记录的PDF第'+region.page+'页框选区域。';const scroll=image.closest('.structure-scan-scroll'),b=image.getBoundingClientRect(),v=scroll.getBoundingClientRect();scroll.scrollLeft+=b.left+(region.rect.x+region.rect.width/2)*b.width-v.left-scroll.clientWidth/2;scroll.scrollTop+=b.top+region.rect.y*b.height-v.top-20;}};
}

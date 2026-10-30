export function feedbackWindowRect(viewport, position=null){
 const margin=8,x=viewport.offsetLeft||0,y=viewport.offsetTop||0;
 const width=Math.min(viewport.width<600?340:430,Math.max(0,viewport.width-margin*2));
 const height=Math.min(viewport.width<600?380:500,Math.max(180,viewport.height*.66),Math.max(0,viewport.height-margin*2));
 const clamp=(n,a,z)=>Math.min(Math.max(a,n),Math.max(a,z));
 return {width,height,left:clamp(position?.left??x+viewport.width-width-16,x+margin,x+viewport.width-width-margin),top:clamp(position?.top??y+viewport.height-height-16,y+margin,y+viewport.height-height-margin)};
}

export function bindFeedbackWindow(panel,handle,isOpen){
 let position=null,drag=null;
 const view=()=>{const vv=window.visualViewport;return vv?{width:vv.width,height:vv.height,offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop}:{width:innerWidth,height:innerHeight};};
 function layout(){
  if(!isOpen())return;
  const rect=feedbackWindowRect(view(),position);
  for(const [key,value]of Object.entries(rect))panel.style[key]=value+'px';
  position={left:rect.left,top:rect.top};
  // Resize only the window; keep the active native input and its selection intact.
  const active=panel.ownerDocument.activeElement,scroll=panel.contains(active)&&active.closest('[role="tabpanel"]');
  if(scroll&&active!==scroll){const a=active.getBoundingClientRect(),b=scroll.getBoundingClientRect();if(a.bottom>b.bottom)scroll.scrollTop+=a.bottom-b.bottom+4;else if(a.top<b.top)scroll.scrollTop-=b.top-a.top+4;}
 }
 function stop(event){
  if(!drag||event&&event.pointerId!==drag.id)return;
  const id=drag.id;drag=null;panel.classList.remove('is-dragging');
  if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
 }
 handle.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0||drag)return;
  event.preventDefault();const rect=panel.getBoundingClientRect();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  handle.setPointerCapture(event.pointerId);panel.classList.add('is-dragging');
 });
 handle.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  position={left:drag.left+event.clientX-drag.x,top:drag.top+event.clientY-drag.y};layout();
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(type,stop);
 handle.addEventListener('keydown',event=>{
  if(event.isComposing||event.keyCode===229)return;
  const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(!direction)return;event.preventDefault();layout();const step=event.shiftKey?40:10;
  position={left:position.left+direction[0]*step,top:position.top+direction[1]*step};layout();
 });
 return {layout,stop};
}

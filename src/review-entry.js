const key='shulun-reviewer-session-v1';
let person='',pending=null,memoryOnly=false,handoffChecked=false;

export function validateReviewerName(value){
 const name=typeof value==='string'?value.trim():'';
 if(!name||name.length>40||/[\u0000-\u001f\u007f]/.test(name))throw Error('请输入姓名（1—40字）。');
 return name;
}
export function reviewerName(){
 if(!handoffChecked){
  handoffChecked=true;const url=new URL(location.href),token=url.searchParams.get('reviewEntry');
  if(token){url.searchParams.delete('reviewEntry');history.replaceState(null,'',url);try{const handoffKey='shulun-review-entry:'+token,raw=localStorage.getItem(handoffKey);localStorage.removeItem(handoffKey);const value=JSON.parse(raw);if(value?.target===url.href&&Date.now()-value.at>=0&&Date.now()-value.at<120000){person=validateReviewerName(value.name);memoryOnly=true;}}catch{}}
 }
 if(!memoryOnly)try{person=validateReviewerName(sessionStorage.getItem(key));}catch{}
 return person;
}
export function ensureReviewer({force=false}={}){
 if(pending)return pending;
 if(reviewerName()&&!force)return Promise.resolve(person);
 pending=new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='review-entry-dialog';dialog.setAttribute('aria-labelledby','reviewEntryTitle');
  dialog.innerHTML='<form novalidate><h2 id="reviewEntryTitle">进入任务</h2><label for="reviewEntryName">校勘人</label><input id="reviewEntryName" name="reviewer" autocomplete="name" maxlength="40" placeholder="姓名" required><p id="reviewEntryError" role="status"></p><div><button type="button" data-cancel>取消</button><button type="submit" class="review-entry-primary">进入</button></div></form>';
  if(force&&reviewerName()){dialog.querySelector('h2').textContent='校勘人';dialog.querySelector('label').textContent='姓名';dialog.querySelector('[type=submit]').textContent='确认';}
  const input=dialog.querySelector('input'),form=dialog.querySelector('form');input.value=reviewerName();let composing=false;
  const finish=value=>{dialog.close();dialog.remove();pending=null;resolve(value);};
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  form.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key==='Escape')&&(composing||e.isComposing||e.keyCode===229))e.preventDefault();});
  form.onsubmit=e=>{e.preventDefault();if(composing||e.isComposing)return;try{const name=validateReviewerName(input.value);person=name;
   // Session storage is optional; saved records always carry the entered name.
   try{sessionStorage.setItem(key,name);memoryOnly=false;}catch{memoryOnly=true;}finish(name);
  }catch(error){dialog.querySelector('#reviewEntryError').textContent=error.message;input.focus();}};
  dialog.querySelector('[data-cancel]').onclick=()=>{if(!composing)finish(null);};dialog.oncancel=e=>{e.preventDefault();if(!composing)finish(null);};
  document.body.append(dialog);dialog.showModal();input.focus();
 });
 return pending;
}
export function reviewerMenu(){return '<button type="button" data-reviewer-switch>校勘人 <span data-reviewer-name></span></button>';}
export function bindReviewerMenu(root,canChange=()=>true){
 const refresh=()=>root.querySelectorAll('[data-reviewer-name]').forEach(el=>{el.textContent=reviewerName()||'未填写';});refresh();
 window.addEventListener('pageshow',refresh);
 for(const button of root.querySelectorAll('[data-reviewer-switch]'))button.onclick=async()=>{if(canChange()&&await ensureReviewer({force:true}))refresh();};
 root.addEventListener('click',e=>{if(e.target.closest('button,a'))e.target.closest('details.review-actions')?.removeAttribute('open');});
 root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229){const menu=e.target.closest('details.review-actions');if(menu){menu.open=false;menu.querySelector('summary').focus();}}});
 document.addEventListener('pointerdown',e=>{for(const menu of root.querySelectorAll('details.review-actions[open]'))if(!menu.contains(e.target))menu.open=false;});
}
export function gateReviewLinks(root){
 root.addEventListener('click',async e=>{
  const link=e.target.closest('a[href]');if(!link||e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||link.target==='_blank')return;
  const url=new URL(link.href,location.href);if(url.origin!==location.origin||!/^annotation-(gaps|compare|review)\.html$/.test(url.pathname.split('/').at(-1)))return;
  if(['directory','pdf'].includes(url.searchParams.get('view')))return;
  if(!link.hasAttribute('data-review-task')&&!['item','work','chapter','page'].some(key=>url.searchParams.has(key)))return;
  e.preventDefault();const name=await ensureReviewer({force:true});if(!name)return;
  // If session storage is blocked, carry the explicitly entered name once to this task only.
  if(memoryOnly){try{const token=crypto.randomUUID();localStorage.setItem('shulun-review-entry:'+token,JSON.stringify({name,target:url.href,at:Date.now()}));url.searchParams.set('reviewEntry',token);}catch{const notice=root.querySelector('[role=status]');if(notice)notice.textContent='暂不能保留本次姓名，请重试。';return;}}
  location.assign(url.href);
 });
}

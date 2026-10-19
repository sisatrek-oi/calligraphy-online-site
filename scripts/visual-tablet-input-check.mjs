// Direct full-page IME regression; protected tablet input is covered by visual-handwriting-buffer-check.mjs.
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium,webkit} = createRequire(import.meta.url)('playwright');
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const out=path.resolve(process.env.OUTPUT_DIR||'test-artifacts/tablet-input');await fs.mkdir(out,{recursive:true});
const results=[],base=process.env.BASE_URL||'http://127.0.0.1:8810',tag=process.env.CHECK_TAG||'after';
const original='[001] 甲乙丙丁\n[002] 第二行文字\n[003] 最后一行文字';
for(const engine of [chromium,webkit]) {
 const b=await engine.launch(),c=await b.newContext({viewport:{width:1024,height:768},hasTouch:false}),p=await c.newPage(),checks=[],errors=[];
 const check=(label,ok)=>{assert.ok(ok,label);checks.push(label);console.log(engine.name()+' PASS '+label);};p.on('pageerror',e=>errors.push(e.message));
 try {
  await p.goto(base+'/screening.html?part=3&member=3&page=603',{waitUntil:'networkidle'});await p.locator('#editText').waitFor();await p.locator('#editText').fill(original);
  const saved=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('shulun-screening-v1-part-3')));
  const other={collation:{text:'其他页旧稿',edits:[{before:'甲',after:'乙'}],metricBaseline:{text:'旧比较底稿'}}};
  await p.evaluate(other=>{const key='shulun-screening-v1-part-3',data=JSON.parse(localStorage.getItem(key));data.reviews[604]=other;data.reviews[603].collation.metricBaseline={version:1,text:'原比较底稿',label:'历史'};localStorage.setItem(key,JSON.stringify(data));},other);
  await p.reload({waitUntil:'networkidle'});await p.locator('#editText').waitFor();
  for(const pointerType of ['touch','pen']) {
   const r=await p.locator('#editText').evaluate(async(e,t)=>{e.focus();e.setSelectionRange(7,8);e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:t}));const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:700,clientY:350});e.dispatchEvent(ev);await new Promise(requestAnimationFrame);return{prevented:ev.defaultPrevented,active:document.activeElement.id,start:e.selectionStart,end:e.selectionEnd,menu:!document.querySelector('#selectionMenu').hidden};},pointerType);
   check(pointerType+' context menu leaves native selection and editor focus intact',!r.prevented&&r.active==='editText'&&r.start===7&&r.end===8&&!r.menu);
  }
  await p.locator('#editText').evaluate(e=>{e.focus();e.setSelectionRange(7,8);e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',button:2}));e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:700,clientY:350}));});await p.locator('#selectionReplacement').waitFor();
  await p.waitForFunction(()=>document.activeElement?.id==='selectionReplacement');
  check('desktop right click still opens replacement tool',await p.locator('#selectionReplacement').isVisible());
  const r=await p.locator('#selectionReplacement').evaluate(e=>{e.value='手';e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const ev=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',isComposing:true,keyCode:229});e.dispatchEvent(ev);return {prevented:ev.defaultPrevented,active:document.activeElement.id,menu:!document.querySelector('#selectionMenu').hidden,text:document.querySelector('#editText').value};});
  check('candidate confirmation cannot prematurely apply replacement',!r.prevented&&r.active==='selectionReplacement'&&r.menu&&r.text===original);
  const legacy=await p.locator('#selectionReplacement').evaluate(e=>{const ev=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',keyCode:229});e.dispatchEvent(ev);return!ev.defaultPrevented&&!document.querySelector('#selectionMenu').hidden;});check('legacy IME keycode 229 also stays in input method',legacy);
  await p.locator('#selectionReplacement').evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'手'})));await p.locator('#selectionReplacement').press('Enter');
  check('explicit Enter after composition replaces selected character',await p.locator('#editText').inputValue()===original.replace('乙','手'));
  const history=(await saved()).reviews[603].collation.edits;check('replacement retains traceable edit history',history.length===1&&history[0].before==='乙'&&history[0].after==='手');
  await p.locator('#editText').fill(original);
  await p.locator('#editText').evaluate(e=>{window.inputMutations=[];window.inputObserver=new MutationObserver(ms=>window.inputMutations.push(...ms.map(m=>m.target.id)));window.inputObserver.observe(document.querySelector('#screeningApp'),{subtree:true,childList:true,attributes:true,characterData:true});e.focus();e.setSelectionRange(7,8);e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.setRangeText('首',7,8,'end');e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'首',isComposing:true}));});
  check('composition draft is recoverable in local storage',(await saved()).reviews[603].collation.text===original.replace('乙','首'));
  const middle=await p.evaluate(()=>({mutations:window.inputMutations,active:document.activeElement.id,start:document.querySelector('#editText').selectionStart}));
  check('composition does not rebuild validation highlight or page-list UI',!middle.mutations.some(id=>['validation','theoryLayer','progress','verifyNext','theoryStatus','changeLog'].includes(id))&&middle.active==='editText'&&middle.start===8);
  await p.locator('#editText').evaluate(e=>{e.setRangeText('手写',7,8,'end');e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'手写',isComposing:true}));e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'手写'}));e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'手写',isComposing:false}));window.inputObserver.disconnect();});
  const final=original.replace('乙','手写');check('multi-event handwriting stays at original selection',await p.locator('#editText').inputValue()===final&&(await saved()).reviews[603].collation.text===final&&await p.locator('#editText').evaluate(e=>e.selectionStart===9&&e.selectionEnd===9));
  check('confirmed composition refreshes draft status',(await p.locator('.publication-status').innerText()).includes('未标过'));
  await p.reload({waitUntil:'networkidle'});await p.locator('#editText').waitFor();check('reload restores exact handwritten text',await p.locator('#editText').inputValue()===final);
  check('other-page draft history and baseline preserved',JSON.stringify((await saved()).reviews[604])===JSON.stringify(other)&&(await saved()).reviews[603].collation.metricBaseline.text==='原比较底稿');
  if(engine===chromium){
   const cd=await c.newCDPSession(p);await p.locator('#editText').evaluate(e=>{e.focus();e.setSelectionRange(6,7);});
   await cd.send('Input.imeSetComposition',{text:'中',selectionStart:1,selectionEnd:1});await cd.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});await cd.send('Input.insertText',{text:'中文'});
   const expected=final.slice(0,6)+'中文'+final.slice(7);check('browser-native IME replaces selected character without jumping',await p.locator('#editText').inputValue()===expected&&(await saved()).reviews[603].collation.text===expected);
   const long=Array.from({length:80},(_,i)=>`[${String(i+1).padStart(3,'0')}] 第${i+1}栏原文甲乙丙丁。`).join('\n');await p.locator('#editText').fill(long);
   for(const line of [1,40,80]) {
    const source=await p.locator('#editText').inputValue(),at=source.indexOf('甲',source.indexOf(`[${String(line).padStart(3,'0')}]`));
    await p.locator('#editText').evaluate((e,at)=>{e.focus();e.setSelectionRange(at,at+1);e.scrollTop=e.scrollHeight*(at/e.value.length);},at);
    await cd.send('Input.imeSetComposition',{text:'手',selectionStart:1,selectionEnd:1});await cd.send('Input.imeSetComposition',{text:'手写',selectionStart:2,selectionEnd:2});await cd.send('Input.insertText',{text:'手写'});
    const expected=source.slice(0,at)+'手写'+source.slice(at+1);
    check(`native IME stays in selected line ${line} of scrolled 80-line draft`,await p.locator('#editText').inputValue()===expected&&(await saved()).reviews[603].collation.text===expected&&await p.locator('#editText').evaluate((e,at)=>e.selectionStart===at+2&&e.selectionEnd===at+2,at));
   }
   await cd.detach();
  }
  for(const size of [{width:768,height:1024},{width:1024,height:600},{width:390,height:844}]){await p.setViewportSize(size);check('editing surface stays inside viewport '+size.width,await p.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth));}
  check('no browser runtime errors',errors.length===0);await p.screenshot({path:path.join(out,tag+'-'+engine.name()+'.png')});
  results.push({engine:engine.name(),checks,errors});
 }catch(e){results.push({engine:engine.name(),checks,errors,failure:e.stack});throw e;}finally{await fs.writeFile(path.join(out,tag+'.json'),JSON.stringify(results,null,2));await b.close();}
}

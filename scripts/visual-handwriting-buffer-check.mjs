import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import path from 'node:path';
const {chromium,webkit}=createRequire(import.meta.url)('playwright');
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const out=path.resolve(process.env.OUTPUT_DIR||'test-artifacts/handwriting-buffer');await fs.mkdir(out,{recursive:true});
const base=process.env.BASE_URL||'http://127.0.0.1:8810',tag=process.env.CHECK_TAG||'local',results=[];
const original=Array.from({length:80},(_,i)=>`[${String(i+1).padStart(3,'0')}] 第${i+1}行甲乙丙丁，其他文字保留。`).join('\n');
for(const engine of [chromium,webkit]){
 const b=await engine.launch(),c=await b.newContext({hasTouch:true,viewport:{width:1280,height:800}}),p=await c.newPage(),checks=[],errors=[];
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(engine.name()+' PASS '+name);};p.on('pageerror',e=>errors.push(e.message));
 const seed={version:1,part:2,person:'隔离手写测试',lastPage:389,reviews:{389:{collation:{text:original,metricBaseline:{version:1,text:'原底稿',label:'历史'},edits:[]}},390:{question:'旧疑字与备注',collation:{text:'他页草稿',metricBaseline:{text:'旧底稿'},edits:[{before:'甲',after:'乙'}]}}}};
 await c.addInitScript(seed=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('shulun-screening-v1-part-2',JSON.stringify(seed));sessionStorage.setItem('seeded','yes');}},seed);
 const saved=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('shulun-screening-v1-part-2')));
 const select=async(at,end=at+1)=>{await p.locator('#editText').evaluate((e,[a,z])=>{e.focus();e.setSelectionRange(a,z);e.scrollTop=e.scrollHeight*(a/e.value.length);},[at,end]);await p.locator('[data-tablet-replace]').click();await p.locator('[data-tablet-value]').waitFor();};
 try{
  await p.goto(base+'/screening.html?part=2&member=2&page=389',{waitUntil:'networkidle'});await p.locator('#editText').waitFor();
  check('touch tablet defaults to protected full-page selection',await p.locator('#editText').evaluate(e=>e.readOnly&&e.inputMode==='none'));
  check('opening tablet does not change old draft',await p.locator('#editText').inputValue()===original&&(await saved()).reviews[389].collation.text===original);
  await p.locator('[data-tablet-replace]').click();check('missing selection cannot insert at an arbitrary caret',!(await p.locator('.tablet-proof-correction').isVisible())&&(await p.locator('#messageSlot').innerText()).includes('先'));
  let expected=original;
  for(const line of [1,40,80]){
   const at=expected.indexOf('甲',expected.indexOf(`[${String(line).padStart(3,'0')}]`));await select(at);
   check('small editor locks line '+line,(await p.locator('[data-tablet-location]').innerText()).includes(`第 ${line} 行`));
   if(engine===chromium){const cd=await c.newCDPSession(p);await cd.send('Input.imeSetComposition',{text:'手',selectionStart:1,selectionEnd:1});await cd.send('Input.imeSetComposition',{text:'手写',selectionStart:2,selectionEnd:2});check('provisional handwriting never changes full page '+line,await p.locator('#editText').inputValue()===expected&&(await saved()).reviews[389].collation.text===expected);await cd.send('Input.insertText',{text:'手写'});await cd.detach();}
   else {await p.locator('[data-tablet-value]').fill('手写');check('buffered text never changes full page '+line,await p.locator('#editText').inputValue()===expected);}
   await p.locator('[data-tablet-apply]').click();expected=expected.slice(0,at)+'手写'+expected.slice(at+1);
   check('confirmed handwriting changes only selected range '+line,await p.locator('#editText').inputValue()===expected&&(await saved()).reviews[389].collation.text===expected);
  }
  const at=expected.indexOf('乙');await select(at);await p.locator('[data-tablet-value]').fill('h网阿田田田乱码');await p.locator('[data-tablet-cancel]').click();
  check('cancelled recognition garbage never enters saved body',await p.locator('#editText').inputValue()===expected&&(await saved()).reviews[389].collation.text===expected);
  await select(at);await p.locator('[data-tablet-value]').fill('\uFFFD');await p.locator('[data-tablet-apply]').click();check('replacement characters rejected before saving',await p.locator('.tablet-proof-correction').isVisible()&&await p.locator('#editText').inputValue()===expected);
  await p.locator('[data-tablet-value]').fill('𠮷');await p.locator('[data-tablet-apply]').click();expected=expected.slice(0,at)+'𠮷'+expected.slice(at+1);check('valid supplementary ancient character remains intact',await p.locator('#editText').inputValue()===expected);
  check('traceable replacement history and original baseline retained',(await saved()).reviews[389].collation.edits.length===4&&(await saved()).reviews[389].collation.metricBaseline.text==='原底稿');
  check('other-page draft baseline and old notes unchanged',JSON.stringify((await saved()).reviews[390])===JSON.stringify(seed.reviews[390]));
  await p.reload({waitUntil:'networkidle'});await p.locator('#editText').waitFor();check('confirmed body survives reload exactly',await p.locator('#editText').inputValue()===expected);
  await select(expected.indexOf('丙'));
  for(const [width,height]of [[1280,350],[1024,320],[390,360]]){
   await p.setViewportSize({width,height});await p.waitForFunction(()=>document.body.classList.contains('proof-keyboard-open'));
   const geometry=await p.evaluate(()=>{const field=document.querySelector('[data-tablet-value]').getBoundingClientRect(),panel=document.querySelector('.tablet-proof-correction').getBoundingClientRect(),scan=document.querySelector('#scanWrap').getBoundingClientRect(),text=document.querySelector('#editText').getBoundingClientRect();return{field:{top:field.top,bottom:field.bottom},panel:{top:panel.top,bottom:panel.bottom},scanHeight:scan.height,textHeight:text.height,height:innerHeight,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};});
   check(`keyboard ${width}x${height} keeps input visible`,geometry.field.top>=0&&geometry.field.bottom<=height&&geometry.panel.bottom<=height+1);
   check(`keyboard ${width}x${height} preserves original scan and text area`,geometry.scanHeight>100&&geometry.textHeight>150&&!geometry.overflow);
   await p.screenshot({path:path.join(out,`${tag}-${engine.name()}-${width}.png`)});
  }
  await p.locator('[data-tablet-cancel]').click();await p.setViewportSize({width:1280,height:800});
  await p.locator('[data-tablet-toggle]').click();check('explicit full-page editing remains available',!(await p.locator('#editText').evaluate(e=>e.readOnly)));await p.locator('[data-tablet-toggle]').click();check('protected mode can be restored',await p.locator('#editText').evaluate(e=>e.readOnly));
  await p.addInitScript(()=>{const v=new EventTarget();Object.assign(v,{height:800,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{configurable:true,value:v});window.testViewport=v;});
  await p.reload({waitUntil:'networkidle'});await p.locator('#editText').waitFor();await select(expected.indexOf('丁'));
  await p.evaluate(()=>{testViewport.height=350;testViewport.dispatchEvent(new Event('resize'));});await p.waitForFunction(()=>document.body.classList.contains('proof-keyboard-open'));
  check('visual viewport alone can resize workspace above keyboard',await p.evaluate(()=>innerHeight===800&&document.body.getBoundingClientRect().height===350&&document.querySelector('[data-tablet-value]').getBoundingClientRect().bottom<=350));
  await p.evaluate(()=>{testViewport.offsetTop=80;testViewport.dispatchEvent(new Event('scroll'));});await p.waitForFunction(()=>document.querySelector('.tablet-proof-correction').getBoundingClientRect().top>=80);
  check('panned visual viewport keeps correction input on screen',await p.evaluate(()=>{const r=document.querySelector('[data-tablet-value]').getBoundingClientRect();return r.top>=80&&r.bottom<=430;}));
  await p.locator('[data-tablet-value]').fill('丙');await p.locator('#editText').evaluate(e=>e.value+='external');await p.locator('[data-tablet-apply]').click();
  check('changed source cannot redirect pending replacement',(await p.locator('[data-tablet-error]').innerText()).includes('正文已发生变化')&&(await saved()).reviews[389].collation.text===expected);
  await p.locator('[data-tablet-cancel]').click();
  const desktop=await b.newContext({viewport:{width:1440,height:900}}),dp=await desktop.newPage();await dp.goto(base+'/screening.html?part=2&member=2&page=389',{waitUntil:'networkidle'});await dp.locator('#editText').waitFor();
  check('desktop keeps ordinary full-page editing',!(await dp.locator('#editText').evaluate(e=>e.readOnly)));await dp.locator('#editText').fill('[001] 普通键盘正文');check('desktop ordinary typing still saves',await dp.evaluate(()=>JSON.parse(localStorage.getItem('shulun-screening-v1-part-2')).reviews[389].collation.text==='[001] 普通键盘正文'));await desktop.close();
  const cc=await b.newContext({hasTouch:true,viewport:{width:1280,height:800}}),cp=await cc.newPage(),raw='[001] 第一行\r\n[002] 第二行𠮷乙\r\n[003] 末行';
  await cc.addInitScript(raw=>localStorage.setItem('shulun-screening-v1-part-2',JSON.stringify({version:1,part:2,person:'CRLF测试',reviews:{389:{collation:{text:raw}}}})),raw);
  await cp.goto(base+'/screening.html?part=2&member=2&page=389',{waitUntil:'networkidle'});await cp.locator('#editText').waitFor();await cp.locator('#editText').evaluate(e=>{e.focus();const at=e.value.indexOf('乙');e.setSelectionRange(at,at+1);});await cp.locator('[data-tablet-replace]').click();await cp.locator('[data-tablet-value]').fill('手写');await cp.locator('[data-tablet-apply]').click();
  check('CRLF backup replaces correct character and preserves original line endings',await cp.evaluate(()=>JSON.parse(localStorage.getItem('shulun-screening-v1-part-2')).reviews[389].collation.text)===raw.replace('乙','手写'));await cc.close();
  check('no browser runtime errors',errors.length===0);results.push({engine:engine.name(),checks,errors});
 }catch(e){results.push({engine:engine.name(),checks,errors,failure:e.stack});throw e;}finally{await fs.writeFile(path.join(out,`${tag}.json`),JSON.stringify(results,null,2));await b.close();}
}

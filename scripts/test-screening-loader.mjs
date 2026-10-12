import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialLoader, readJson } from '../src/screening-loader.js';
const data = () => ({part:1,start:1,end:2,materials:{1:'one.json',2:'two.json'},pages:[{page:1,local:1},{page:2,local:2}]});
const response = page => ({ok:true,json:async()=>({version:1,part:1,pages:[{page,ocr:'原文',contextual:{conservative:'校文',normalized:'正文',uncertainties:[]},layout:{text:'原文'}}]})});
test('first page does not wait for other materials; export loads every page',async()=>{
 const calls=[]; const d=data();
 const loader=createMaterialLoader(d,{fetcher:async url=>{calls.push(url);return response(url.includes('one')?1:2);}});
 await loader.ensurePage(1);
 assert.equal(calls.length,1); assert.equal(d.pages[0].contextual.normalized,'正文'); assert.equal(d.pages[1].ocr,undefined);
 await loader.ensureAll(); assert.equal(calls.length,2); assert.equal(d.pages[1].ocr,'原文');
});
test('simultaneous page requests deduplicate and cache success',async()=>{
 let calls=0; const loader=createMaterialLoader(data(),{fetcher:async()=>{calls++;return response(1);}});
 await Promise.all([loader.ensurePage(1),loader.ensurePage(1)]);await loader.ensurePage(1);assert.equal(calls,1);
});
test('stalled response body times out and can be retried',async()=>{
 let stalled=true;let signal;
 const loader=createMaterialLoader(data(),{timeoutMs:15,fetcher:async(_url,options)=>{signal=options.signal;return stalled?{ok:true,json:()=>new Promise(()=>{})}:response(1);}});
 await assert.rejects(loader.ensurePage(1),/超时/);assert.equal(signal.aborted,true);
 stalled=false;await loader.ensurePage(1);
});
test('incomplete or wrong-part chunks never partially attach',async()=>{
 const d=data();d.materials[2]='one.json';
 const loader=createMaterialLoader(d,{fetcher:async()=>response(1)});
 await assert.rejects(loader.ensurePage(1),/不完整/);assert.equal(d.pages[0].ocr,undefined);
});
test('HTTP failure is explicit, static requests permit browser caching',async()=>{
 await assert.rejects(readJson('missing',{fetcher:async(_url,options)=>{assert.notEqual(options.cache,'no-store');return {ok:false,status:404};}}),/404/);
});

import fs from 'node:fs/promises';
import { isTaskPage } from '../src/screening-page-policy.js';
test('all published chunks preserve all original OCR, layout and cleaned versions even when task pages are filtered',async()=>{
 for(let part=1;part<=4;part++) {
  const read=async name=>await fs.readFile(new URL(`../screening-data/${name}`,import.meta.url),'utf8');
  const d=JSON.parse(await read(`part-${part}-index.json`));
  const originals=d.pages; const layouts=JSON.parse(await read(`part-${part}-layout.json`));
  const clean=JSON.parse(await read(`part-${part}-contextual.json`));
  const raw=await read(`part-${part}-ocr.txt`);
  const headings=[...raw.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
  const loader=createMaterialLoader(d,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await read(url.replace('./screening-data/','')))})});
  d.pages=d.pages.filter(item=>isTaskPage(item.page));
  await loader.ensurePage(d.pages[0].page);await loader.ensureAll();
  originals.forEach((item,i)=>{
   assert.equal(item.ocr,raw.slice(headings[i].index+headings[i][0].length,headings[i+1]?.index??raw.length).trim());
   assert.deepEqual(item.layout,layouts.pages[i]);
   const {conservative,normalized,uncertainties}=clean.pages[i];
   assert.deepEqual(item.contextual,{conservative,normalized,uncertainties});
  });
 }
});

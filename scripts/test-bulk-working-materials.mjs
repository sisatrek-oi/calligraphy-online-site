import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import { validModelReview } from '../src/model-reviewed.js';
import { humanMarked } from '../src/human-mark.js';
import { createMaterialLoader } from '../src/screening-loader.js';
import { isTaskPage } from '../src/screening-page-policy.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../screening-data/'+name,import.meta.url),'utf8'));
test('all four parts contain 851 complete image-reviewed working pages and no synthetic human approvals',()=>{
 let total=0;for(let part=1;part<=4;part++){
  const source=read(`part-${part}-model-reviewed.json`);assert.equal(source.pages.length,[218,199,174,260][part-1]);
  assert.equal(new Set(source.pages.map(p=>p.page)).size,source.pages.length);
  for(const p of source.pages){assert.equal(validModelReview(p,p.page),true);assert.equal(p.humanConfirmed,false);assert.ok(isTaskPage(p.page));}
  total+=source.pages.length;
 }assert.equal(total,851);
});
test('all 1041 task pages have a working source; only the 949 explicitly confirmed human pages count as marked',async()=>{
 let total=0,marked=0;
 for(let part=1;part<=4;part++){
  const index=read(`part-${part}-index.json`),loader=createMaterialLoader(index,{fetcher:async url=>({ok:true,json:async()=>read(url.replace('./screening-data/',''))})});
  await loader.ensureAll();
  for(const p of index.pages.filter(p=>isTaskPage(p.page))){
   assert.ok(p.collated || p.modelReviewed);assert.equal(humanMarked(p),Boolean(p.collated));total++;marked+=Number(humanMarked(p));
  }
 }assert.equal(total,1041);assert.equal(marked,949);
});
test('known numerical, geometry and historical-uncertainty evidence survives publication without marking the page',()=>{
 const sources=[1,3,4].flatMap(part=>read(`part-${part}-model-reviewed.json`).pages);
 const p62=sources.find(p=>p.page===62);assert.deepEqual(p62.units.at(-1).columns,[16,17]);assert.equal(p62.units.at(-1).text,'法。');
 const p204=sources.find(p=>p.page===204);assert.match(p204.units[0].text,/一九二$/);assert.doesNotMatch(p204.units[0].text,/一九二一/);
 assert.match(sources.find(p=>p.page===633).text,/又益二三十种/);
 const p828=sources.find(p=>p.page===828);assert.match(p828.text,/【待核：原OCR嶔曦窅】/);assert.ok(p828.units.some(u=>u.inheritedUncertainty));
 for(const p of [p62,p204,p828])assert.equal(humanMarked({page:p.page,modelReviewed:p}),false);
 const diagram=read('part-4-model-reviewed.json').pages.find(p=>p.page===888);assert.equal(diagram.units.find(u=>u.columns.includes(6)).status,'pending');
 assert.equal(diagram.units.find(u=>u.columns.includes(6)).text,diagram.units.find(u=>u.columns.includes(6)).baseline);
});

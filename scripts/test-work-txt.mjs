import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import { isTaskPage } from '../src/screening-page-policy.js';
const read=name=>fs.readFileSync(new URL('../screening-data/'+name,import.meta.url),'utf8');
test('four public working TXT files cover all 991 task pages exactly once and only contain human statuses',()=>{
 let total=0,marked=0;
 for(let part=1;part<=4;part++){
  const index=JSON.parse(read(`part-${part}-index.json`)),text=read(`part-${part}-work.txt`);
  const ids=[...text.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====$/gm)];
  assert.deepEqual(ids.map(m=>+m[1]),index.pages.filter(p=>isTaskPage(p.page)).map(p=>p.page));
  assert.ok(ids.every(m=>+m[2]===+m[1]-index.start+1));
  const states=[...text.matchAll(/^状态：(.+)$/gm)].map(m=>m[1]);
  assert.equal(states.length,ids.length);assert.ok(states.every(s=>s==='已标过'||s==='未标过'));
  assert.doesNotMatch(text,/待人工全文检查|大模型已复核/);
  total+=ids.length;marked+=states.filter(s=>s==='已标过').length;
 }
 assert.equal(total,991);assert.equal(marked,949);
});
test('working TXT retains human team text and the known split-glyph repair without inventing marks',()=>{
 const text=read('part-1-work.txt'),human=JSON.parse(read('part-1-collated.json')).pages.find(p=>p.page===5);
 assert.ok(text.includes(human.text));
 const model=JSON.parse(read('part-1-model-reviewed.json')).pages.find(p=>p.page===62);
 assert.equal(model.units.at(-1).text,'法。');assert.deepEqual(model.units.at(-1).columns,[16,17]);
 assert.equal(model.humanConfirmed,false);assert.doesNotMatch(model.text,/\[016\] 去。/);
 assert.ok(text.includes(JSON.parse(read('part-1-collated.json')).pages.find(p=>p.page===62).text));
});

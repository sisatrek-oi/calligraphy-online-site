import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { draftForPage, originalDraftText } from '../src/ocr-source-policy.js';
import {pageMetrics} from '../src/task-metrics.js';
const page={page:259,local:1,ocr:'羊 欣 字 敬 元',layout:{text:'羊 欣\n字 敬 元'},contextual:{normalized:'卞壶字望之'}};
test('unstarted pages never inherit unverified model rewrites',()=>{
 assert.equal(draftForPage(page,{}).text,'[001] 羊欣\n[002] 字敬元');
 assert.equal(originalDraftText({...page,layout:{text:'从略'}}),page.ocr);
});
test('verified and draft text, metadata, metrics and unknown legacy baselines survive material replacement',()=>{
 for(const verified of [true,false]) for(const known of [true,false]) {
  const saved={text:'[001] 羊欣字敬元',verified,checks:{order:true,wording:true,continuity:true},verifiedBy:'成员',verifiedAt:'2026-10-13',edits:[{before:'半及',after:'羊欣'}],...(known?{metricBaseline:{version:1,label:'语义整理版',text:'[001] 卞壶字望之'}}:{})};
  const review={collation:saved};const before=JSON.stringify(review);const metrics=pageMetrics(page,review);
  const updated={...page,ocr:'新机器底稿',contextual:{normalized:'另一份模型稿'}};
  assert.equal(draftForPage(updated,review),saved);
  assert.equal(JSON.stringify(review),before);
  assert.equal(pageMetrics(updated,review).changes,metrics.changes);
  assert.equal(pageMetrics(updated,review).modificationRate,metrics.modificationRate);
 }
});
test('known omitted/model-invented pages have complete original OCR in both repaired references',()=>{
 const payload=JSON.parse(fs.readFileSync(new URL('../screening-data/part-2-contextual.json',import.meta.url),'utf8'));
 for(const page of [259,...Array.from({length:15},(_,i)=>463+i),512,516]){
  const r=payload.pages.find(x=>x.page===page);
  assert.ok(r.conservative.length>150,`page ${page} conservative missing`);
  assert.ok(r.normalized.length>150,`page ${page} normalized missing`);
  assert.doesNotMatch(r.normalized,/语义版从略|以下书家传授姓名|卞壶字望之/);
 }
});

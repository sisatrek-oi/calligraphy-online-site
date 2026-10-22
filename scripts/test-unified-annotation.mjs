import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadReviewedIndex,attachReviewedPart} from '../src/reviewed-annotation.js';
import {unifiedAnnotationContext} from '../src/annotation-task-context.js';
import {buildUnifiedAnnotationBundle} from '../src/theory-annotation-export.js';
const json=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url)));
test('one annotation context spans every reviewed source and resumes across original material parts without assigning a member',async()=>{
 const indexes=Object.fromEntries([1,2,3,4].map(n=>[n,json(`../screening-data/part-${n}-index.json`)]));
 const saved={3:{version:1,part:3,annotationLastPage:530,annotationSavedAt:'2026-10-20T10:00:00Z',reviews:{700:{question:'旧记录保留'}}}};
 const before=JSON.stringify(saved),storage={getItem:key=>saved[Number(key.at(-1))]?JSON.stringify(saved[Number(key.at(-1))]):null};
 await loadReviewedIndex(indexes,{storage,fetcher:async()=>({ok:true,json:async()=>json('../annotation-data/index.json')})});
 const context=unifiedAnnotationContext(storage,indexes);
 assert.equal(context.total,472);assert.equal(context.candidates,1468);assert.equal(context.pages.length,472);
 assert.deepEqual([...new Set(context.pages.map(p=>p.part))],[1,2,3,4]);assert.equal(context.page,530);
 assert.match(context.href,/scope=all/);assert.doesNotMatch(context.href,/member=/);assert.equal(JSON.stringify(saved),before);
});
test('unified export captures all qualified pages and preserves each original backup without changing source progress',async()=>{
 const progressByPart=Object.fromEntries([1,2,3,4].map(part=>[part,{version:1,part,person:'原姓名',reviews:{}}]));
 progressByPart[3].reviews[700]={question:'旧稿及底稿保持',collation:{text:'个人旧草稿',metricBaseline:{text:'历史底稿'}}};
 const pagesByPart={};
 for(const part of [1,2,3,4]) {
  pagesByPart[part]=json(`../screening-data/part-${part}-index.json`).pages.map(p=>({...p,ocr:'隔离原OCR'}));
  await attachReviewedPart(pagesByPart[part],json(`../annotation-data/part-${part}.json`),part);
 }
 const before=JSON.stringify(progressByPart),bundle=await buildUnifiedAnnotationBundle({progressByPart,pagesByPart,person:'统一标注者',exportedAt:'2026-10-20T12:00:00Z'});
 assert.equal(bundle.manifest.scope,'all');assert.equal(bundle.manifest.parts.length,4);assert.equal(bundle.manifest.pageNumbers.length,472);
 assert.equal(JSON.stringify(progressByPart),before);assert.ok(bundle.bytes.length>10000);
 await assert.rejects(buildUnifiedAnnotationBundle({progressByPart,pagesByPart:{1:pagesByPart[1]},person:'甲'}),/不完整/);
});

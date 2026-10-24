import test from 'node:test';
import assert from 'node:assert/strict';
import {taskBatches,taskBatchScope,batchQuery,transferBatch} from '../src/annotation-batches.js';
const index={chapters:Array.from({length:12},(_,i)=>({id:'c'+i,fragments:i===5?[]:[{start:0,end:(i+1)*10}]}))};
test('3 annotation and 4 review scopes cover each relevant complete chapter exactly once in order',()=>{
 for(const kind of ['annotation','review']){const batches=taskBatches(index,kind);assert.equal(batches.length,kind==='annotation'?3:4);assert.deepEqual(batches.flatMap(b=>b.chapters),index.chapters.filter(c=>kind==='review'||c.fragments.length));assert.equal(new Set(batches.flatMap(b=>b.chapters.map(c=>c.id))).size,kind==='annotation'?11:12);assert.ok(batches.every(b=>b.chapters.length));}
});
test('partition minimizes maximum weight without mutating chapter data',()=>{
 const input={chapters:[2,3,4,2,5].map((w,i)=>({id:''+i,fragments:[{start:9,end:9+w}]}))},before=JSON.stringify(input);
 const batches=taskBatches(input,'annotation');assert.equal(Math.max(...batches.map(b=>b.weight)),6);assert.equal(JSON.stringify(input),before);assert.deepEqual(taskBatches(input,'annotation'),batches);
});
test('batch parsing rejects wrong task, empty and out of range identifiers',()=>{
 assert.equal(taskBatchScope(index,'','review'),null);assert.equal(taskBatchScope(index,'?batch=review-4','review').number,4);
 for(const id of ['','review-0','review-5','annotation-1','review-01'])assert.throws(()=>taskBatchScope(index,'?batch='+id,'review'));
});
test('cross-task links map the chapter to the target partition and keep legacy unscoped links',()=>{
 const chapter=index.chapters[9];const target=taskBatches(index,'review').find(b=>b.chapters.includes(chapter));assert.equal(transferBatch(index,'?batch=annotation-3','review',chapter.id),batchQuery(target));assert.equal(transferBatch(index,'','review',chapter.id),'');assert.equal(transferBatch(index,'?batch=review-1','annotation','c5'),'');
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {annotationSource} from '../src/annotation-source.js';
import {annotationTaskContext} from '../src/annotation-task-context.js';
import {buildAnnotationBundle} from '../src/theory-annotation-export.js';
import {buildCollationBundle} from '../src/collation-export.js';
import {completeAnnotations} from '../src/theory-annotations.js';
import {assignments} from '../src/team-assignments.js';
const team=(page=528,pending=[])=>({page,text:'[001] 团队人工校验完毕正文。',revision:'team-v1',reviewedAt:'2026-10-18',status:pending.length?'已修订·待核':'已修改完毕',pending,corrections:[],notes:[]});
const personal=(text='[001] 个人已校验正文。')=>({text,verified:true,checks:{wording:true},verifiedBy:'旧校验人',verifiedAt:'2026-10-19'});
test('OCR, model, partial OCR and pending team pages do not supply annotation text',()=>{
 for(const item of [{page:528,ocr:'识别稿'},{page:528,modelReviewed:{text:'模型稿'}},{page:528,targeted:{text:'局部修订'}},{page:528,collated:team(528,[{note:'待核'}])},{page:528,publication:{status:'已修订·待核',pending:1}}]) {
  assert.equal(annotationSource(item),null);assert.equal(annotationSource(item,{}, {summary:true}),null);
 }
});
test('unfinished local drafts cannot displace finished team sources',()=>{
 const page={page:528,collated:team()},draft={collation:{text:'[001] 不可进入标注的草稿。',verified:false,metricBaseline:{text:'旧底稿'}}};
 const before=JSON.stringify(draft);assert.equal(annotationSource(page,draft).text,page.collated.text);assert.equal(JSON.stringify(draft),before);
 assert.equal(annotationSource(page,{collation:personal()}).kind,'personal');
});
test('old human confirmations remain valid; pending markers or unchecked text fail the source gate',()=>{
 assert.equal(annotationSource({page:528},{collation:personal()}).kind,'personal');
 for(const d of [{...personal(),verified:false},{...personal(),checks:{}},personal('[001] □'),personal('[001] 【待核：某字】'),personal('[001] �')])assert.equal(annotationSource({page:528},{collation:d}),null);
});
test('source index summaries are only valid for overview counts, never for reader/export text',()=>{
 const page={page:528,publication:{status:'已修改完毕',pending:0,revision:'team-v1',reviewedAt:'2026-10-18'}};
 assert.equal(annotationSource(page),null);assert.equal(annotationSource(page,{}, {summary:true}).kind,'team');
});
test('public annotation queue has 173 finished team pages, plus deduplicated verified personal pages',()=>{
 const indexes=Object.fromEntries([1,2,3,4].map(n=>[n,JSON.parse(fs.readFileSync(new URL(`../screening-data/part-${n}-index.json`,import.meta.url)))]));
 const values=new Map(),storage={getItem:k=>values.get(k)||null};
 assert.deepEqual(assignments.map(a=>annotationTaskContext(storage,a,indexes).total),[26,67,71,9,0,0,0]);
 const r={528:{collation:personal()},603:{collation:personal()},604:{collation:{...personal(),verified:false}}};
 values.set('shulun-screening-v1-part-3',JSON.stringify({version:1,part:3,reviews:r,lastPage:604,annotationLastPage:603}));
 const context=annotationTaskContext(storage,assignments[2],indexes);assert.equal(context.total,72);assert.equal(context.page,603);assert.match(context.href,/annotation.html/);
});
test('annotation package only exports approved full text but JSON retains every old draft/annotation',async()=>{
 const pages=Array.from({length:249},(_,i)=>({page:528+i,local:i+1,ocr:'原OCR'}));pages[0].collated=team();pages[1].collated=team(529,[{note:'尚待核'}]);
 const progress={version:1,part:3,person:'标注人',lastPage:604,annotationLastPage:528,reviews:{528:{collation:{text:'不合格私稿',verified:false,metricBaseline:{text:'旧底稿'}},theoryAnnotations:completeAnnotations(undefined,pages[0].collated.text,'标注人')},603:{collation:personal()},604:{collation:{text:'未核对草稿',verified:false},theoryAnnotations:completeAnnotations(undefined,'未核对草稿','旧标注人')},700:{question:'移交页历史'}}};
 const before=JSON.stringify(progress),bundle=await buildAnnotationBundle({progress,pages,member:3});
 assert.deepEqual(bundle.manifest.pageNumbers,[528,603]);assert.equal(bundle.manifest.sources[0].kind,'team');assert.equal(bundle.manifest.sources[1].kind,'personal');
 assert.ok(bundle.manifest.excludedPageNumbers.includes(529));assert.ok(bundle.manifest.excludedPageNumbers.includes(604));assert.equal(JSON.stringify(progress),before);
 const proof=await buildCollationBundle({progress,pages,member:3});assert.equal(proof.manifest.files.length,7);assert.equal(proof.manifest.files.some(f=>f.name.endsWith('html')),false);
});
test('annotation export rejects incomplete sources and zero-eligible assignments',async()=>{
 const pages=Array.from({length:249},(_,i)=>({page:528+i,local:i+1,ocr:'原OCR'})),progress={version:1,part:3,person:'甲',reviews:{}};
 await assert.rejects(buildAnnotationBundle({progress,pages,member:3}),/暂无/);
 await assert.rejects(buildAnnotationBundle({progress,pages:pages.slice(0,30),member:3}),/不完整/);
});
test('cross-part annotation resume uses its own time, independently of newer proofreading saves',()=>{
 const values={1:{version:1,part:1,lastPage:200,annotationLastPage:159,annotationSavedAt:'2026-10-19T01:00:00Z',savedAt:'2026-10-19T10:00:00Z',reviews:{159:{collation:personal()}}},2:{version:1,part:2,annotationLastPage:430,annotationSavedAt:'2026-10-19T02:00:00Z',reviews:{430:{collation:personal()}}}};
 const storage={getItem:k=>JSON.stringify(values[Number(k.at(-1))])},indexes={1:{pages:[{page:159}]},2:{pages:[{page:430}]}};
 const context=annotationTaskContext(storage,assignments[4],indexes);assert.equal(context.page,430);assert.equal(context.part,2);
});

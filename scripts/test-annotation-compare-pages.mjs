import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateComparison,emptyRecheck,recordDecision,validateRecheck,saveRecheck,mergeRecheck,comparisonEditDecision,decisionResolved} from '../src/annotation-compare-core.js';
import {pageComparison,pageTaskId,pageEditorText,pageCompareKey,pageInWork,pageHasKind,initialPageState} from '../src/annotation-compare-pages.js';
import {groupReviewTasks} from '../src/annotation-compare-tasks.js';
const source=await validateComparison(JSON.parse(await fs.readFile(new URL('../comparison-data/wolai-human.json',import.meta.url),'utf8')));
const legacy=emptyRecheck('test'),pages=pageComparison(source,legacy),p5=pages.items.get(pageTaskId(5));
const by='隔离测试',draft=(i,text=i.local)=>({id:i.id,manualSha256:i.manualSha256,sourceStart:i.sourceStart,sourceEnd:i.sourceEnd,text,deleteText:false});
test('one task per physical PDF page, ordered, complete TXT including unchanged context',()=>{
 const list=pages.data.items.filter(i=>i.page!==null);assert.equal(list.length,591);assert.equal(new Set(list.map(i=>i.page)).size,591);assert.deepEqual(list.map(i=>i.page),[...list.map(i=>i.page)].sort((a,b)=>a-b));
 for(const i of list){const p=source.pages.get(i.page);assert.equal(i.local,p.display);assert.equal(i.original,p.text);assert.equal(i.sourceStart,0);assert.equal(i.sourceEnd,p.text.length);}
 assert.equal(p5.differences.length,3);assert.equal(pages.aliases.get('R000003'),p5.id);assert.equal(p5.local.length,436);
});
test('all old item links resolve to a page; missing-PDF records retain no invented source',()=>{
 for(const i of source.data.items.filter(i=>i.page!==null))assert.equal(pages.items.get(pages.aliases.get(i.id)).page,i.page);
 const unmatched=pages.data.items.filter(i=>i.page===null);assert.equal(unmatched.length,1062);assert.ok(unmatched.every(i=>i.kind==='reference-only'&&i.referenceId));
});
test('work and kind filters select whole pages across work boundaries',()=>{
 const cross=pages.data.items.find(i=>i.workIds.length>1);assert.ok(cross);for(const w of cross.workIds)assert.ok(pageInWork(cross,w));assert.equal(cross.local,source.pages.get(cross.page).display);assert.equal(pageHasKind(cross,'all'),true);
 for(const i of pages.data.items.filter(i=>i.page!==null))for(const d of i.differences)assert.ok(pageHasKind(i,d.kind));
});
test('real wolai references including empty deletion strings remain deduplicated page context',()=>{
 for(const i of pages.data.items.filter(i=>i.page!==null)){const refs=[...new Set(source.data.items.filter(d=>d.page===i.page&&d.referenceId).map(d=>d.referenceId))];assert.deepEqual(i.referenceIds,refs);}
 assert.equal(p5.referenceIds.length,0);assert.ok(pages.data.items.some(i=>i.referenceIds?.length>1));
});
test('whole page correction binds full frozen range and survives export/import without changing sources',()=>{
 const before=source.pages.get(5).text,text=p5.local+'\n𠮷𠀀同词同词',edited=comparisonEditDecision(p5,draft(p5,text)),s=recordDecision(emptyRecheck('test',pages),pages,{id:p5.id,by,...edited});
 assert.equal(s.format,'pdf-page-recheck');assert.equal(s.records[p5.id].binding.sourceEnd,before.length);assert.equal(s.records[p5.id].binding.sourceStart,0);assert.equal(s.records[p5.id].replacement,text);assert.equal(pageEditorText(p5,s.records[p5.id]),text);assert.equal(source.pages.get(5).text,before);
 const restored=validateRecheck(JSON.parse(JSON.stringify(s)),'test',pages);assert.equal(mergeRecheck(emptyRecheck('test',pages),restored,'test',pages).value.records[p5.id].replacement,text);assert.ok(decisionResolved(restored.records[p5.id]));
});
test('page records and fragment confirmations cannot be imported as one another or inherit confirmation',()=>{
 const old=recordDecision(legacy,source,{id:'R000003',by,choice:'manual'}),model=pageComparison(source,old);assert.deepEqual(emptyRecheck('test',model).records,{});assert.equal(pageEditorText(model.items.get(p5.id)),p5.local);
 assert.throws(()=>validateRecheck(old,'test',model));assert.notEqual(pageCompareKey('test'),'shulun-wolai-human-recheck-v1:test');
 const s=recordDecision(emptyRecheck('test',pages),pages,{id:p5.id,by,choice:'manual'});assert.throws(()=>validateRecheck(s,'test',source));assert.equal(s.records[p5.id].replacement,p5.original);
});
test('nonoverlapping legacy edits and deferred drafts combine in exact display order',()=>{
 let old=recordDecision(legacy,source,{id:'R000001',by,choice:'custom',replacement:'开头𠀀'});old=recordDecision(old,source,{id:'R000003',by,choice:'defer',draftText:'结尾𠮷'});
 const p=pageComparison(source,old).items.get(p5.id);assert.equal(p.initial,'开头𠀀'+p5.local.slice(180,360)+'结尾𠮷');assert.equal(p.conflicts.length,0);assert.equal(p.legacy.length,2);assert.equal(old.records.R000003.choice,'defer');
});
test('overlapping legacy edits are exposed instead of silently applied',()=>{
 const c={...source,data:{...source.data,items:[...source.data.items,{...source.items.get('R000001'),id:'overlap',localDisplayStart:1,localDisplayEnd:3}]}},old={...legacy,records:{R000001:{choice:'custom',replacement:'A'},overlap:{choice:'custom',replacement:'B'}}};
 const p=pageComparison(c,old).items.get(p5.id);assert.equal(p.conflicts.length,2);assert.equal(p.initial,p5.local);
});
test('page source/range mismatch, ambiguous deletion, quota and concurrent writes reject safely',()=>{
 for(const patch of [{id:'R000003'},{sourceEnd:p5.sourceEnd-1},{manualSha256:'0'.repeat(64)},{text:''}])assert.throws(()=>comparisonEditDecision(p5,{...draft(p5),...patch}));
 const s=recordDecision(emptyRecheck('test',pages),pages,{id:p5.id,by,choice:'custom',replacement:'𠀀新稿'});let written=false;
 assert.throws(()=>saveRecheck({getItem:()=>'{other}',setItem:()=>{written=true;}},pageCompareKey('test'),s,null,'test',pages));assert.equal(written,false);
 assert.throws(()=>saveRecheck({getItem:()=>null,setItem:()=>{throw Error('quota');}},pageCompareKey('test'),s,null,'test',pages));assert.equal(s.records[p5.id].replacement,'𠀀新稿');
});
test('deferred empty page remains unconfirmed and restores deliberately empty draft',()=>{
 const s=recordDecision(emptyRecheck('test',pages),pages,{id:p5.id,by,choice:'defer',draftText:''});assert.equal(pageEditorText(p5,s.records[p5.id]),'');assert.equal(decisionResolved(s.records[p5.id]),false);
});
test('cross-work pages appear under both work directories with one shared task identity',()=>{
 const task=pages.data.items.find(i=>i.workIds.filter(Boolean).length>1),groups=groupReviewTasks([{...task,title:'整页',status:'pending'}]);assert.equal(groups.length,task.workIds.filter(Boolean).length);
 assert.ok(groups.every(g=>g.items.length===1&&g.items[0].id===task.id&&g.items[0].workId===g.id));
});
test('unlocated historical decisions remain valid without transferring fragment approvals to page progress',()=>{
 const id=source.data.items.find(i=>i.page===null).id;let old=recordDecision(legacy,source,{id,by,choice:'reference'});old=recordDecision(old,source,{id:'R000003',by,choice:'manual'});const model=pageComparison(source,old),s=initialPageState('test',model,old);
 validateRecheck(s,'test',model);assert.equal(s.records[id].choice,'reference');assert.equal(s.records[p5.id],undefined);assert.equal(s.records.R000003,undefined);
});

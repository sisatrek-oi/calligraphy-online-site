import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateReviewedPart,attachReviewedPart,loadReviewedIndex,candidateView,reviewCandidate,annotationDisplayRanges,deleteDefaultAnnotation,confirmDefaultAnnotations} from '../src/reviewed-annotation.js';
import {annotationTaskContext} from '../src/annotation-task-context.js';
import {assignments} from '../src/team-assignments.js';
import fs from 'node:fs';
import {annotationSource} from '../src/annotation-source.js';
import {addAnnotation,annotationView,removeAnnotation,completeAnnotations} from '../src/theory-annotations.js';
const hash=text=>createHash('sha256').update(text).digest('hex');
const text='[001] 书之法则，点画攸同。\n[002] 原序。𠮷';
const candidate={id:'p530-s1',start:6,end:16,quote:text.slice(6,16),category:'用笔技法',note:'一般技法',contextStatus:'complete'};
function fixture(){return {version:1,batch:'human-txt-20261020',part:3,revision:'fixture-v1',pages:[{page:530,part:3,text,eligible:true,blockedReasons:[],source:{kind:'human-txt',page:530,part:3,label:'人工审核原TXT',verifiedBy:'原校验人',verifiedAt:'2026-10-13T01:00:00Z',revision:hash(text),textSha256:hash(text),fileSha256:'a'.repeat(64),txtPath:'original.txt',reviewCsvPath:'checks.csv'},candidates:[structuredClone(candidate)],segments:[{start:0,end:text.length,quote:text,role:'theory',category:'用笔技法',note:'',contextStatus:'complete'}],contextNotes:[]}]};}
test('reviewed TXT validates content hash, coverage, exact ranges and full source identity',async()=>{
 const value=fixture();await validateReviewedPart(value,3);
 for(const mutate of [v=>v.pages[0].text+='字',v=>v.pages[0].source.verifiedBy='',v=>v.pages[0].candidates[0].quote='换字',v=>v.pages[0].segments[0].start=1,v=>v.pages.push(structuredClone(v.pages[0]))]){
  const bad=fixture();mutate(bad);await assert.rejects(validateReviewedPart(bad,3));
 }
});
test('only attached original human TXT supplies team annotation source; website status cannot substitute',async()=>{
 const item={page:530,ocr:'机器稿',collated:{page:530,text:'后来AI改稿',status:'已修改完毕',pending:[],corrections:[],notes:[],revision:'AI',reviewedAt:'2026-10-18'}};
 assert.equal(annotationSource(item),null);assert.equal(annotationSource({page:530,publication:{status:'已修改完毕',pending:0}}, {},{summary:true}),null);
 await attachReviewedPart([item],fixture(),3);assert.equal(annotationSource(item).text,text);assert.equal(item.collated.text,'后来AI改稿');
 const blocked=fixture();blocked.pages[0].eligible=false;blocked.pages[0].blockedReasons=['原字待核'];blocked.pages[0].candidates=[];
 await attachReviewedPart([item],blocked,3);assert.equal(annotationSource(item),null);
});
test('AI suggestions do not create personal marks; explicit acceptance or rejection is reversible and preserves old data',async()=>{
 const item={page:530};await attachReviewedPart([item],fixture(),3);const source=annotationSource(item);
 assert.equal(candidateView(item,{},source).pending.length,1);assert.equal(annotationView(undefined,text).completed,false);
 const data=reviewCandidate(undefined,text,candidate,'accepted','复核人',item.humanReviewed.revision,source.revision,'2026-10-20T01:00:00Z');
 assert.equal(data.passages[0].createdBy,'复核人');assert.equal(data.passages[0].candidateId,candidate.id);assert.equal(data.completion,null);
 assert.equal(candidateView(item,{theoryAnnotations:data},source).pending.length,0);
 const removed=removeAnnotation(data,text,data.passages[0].id,'复核人');assert.equal(candidateView(item,{theoryAnnotations:removed},source).pending.length,1);
 const rejected=reviewCandidate(undefined,text,candidate,'rejected','复核人',item.humanReviewed.revision,source.revision);
 assert.equal(rejected.passages.length,0);assert.equal(candidateView(item,{theoryAnnotations:rejected},source).pending.length,0);
 const reset=reviewCandidate(rejected,text,candidate,'pending','复核人',item.humanReviewed.revision,source.revision);
 assert.equal(candidateView(item,{theoryAnnotations:reset},source).pending.length,1);assert.equal(rejected.candidateReview.decisions[candidate.id].decision,'rejected');
});
test('candidate layer is hidden for newer personal source and splits around existing manual ranges',async()=>{
 const item={page:530};await attachReviewedPart([item],fixture(),3);const source=annotationSource(item);
 assert.equal(candidateView(item,{}, {...source,text:'新稿'}).available,false);
 const data=addAnnotation(undefined,text,8,11,'旧标注人');const before=JSON.stringify(data);
 const ranges=annotationDisplayRanges(annotationView(data,text).ranges,candidateView(item,{theoryAnnotations:data},source).pending);
 assert.deepEqual(ranges.map(r=>[r.start,r.end,r.type]),[[6,8,'suggested'],[8,11,'manual'],[11,16,'suggested']]);assert.equal(JSON.stringify(data),before);
 assert.throws(()=>reviewCandidate(data,text,candidate,'accepted','甲',item.humanReviewed.revision,source.revision),/重叠/);
});
test('old personal verification cannot bypass known source blockers; clearance binds exact text, issues and confirmation',async()=>{
 const value=fixture();value.pages[0].eligible=false;value.pages[0].blockedReasons=['原字待核'];value.pages[0].candidates=[];
 const item={page:530,ocr:'识别稿'};await attachReviewedPart([item],value,3);
 const collation={text,verified:true,checks:{wording:true},verifiedBy:'甲',verifiedAt:'2026-10-20T01:00:00Z'};
 assert.equal(annotationSource(item,{collation}),null);
 const approval={version:1,text,by:'甲',at:collation.verifiedAt,blockedSourceRevision:item.humanReviewed.source.revision,blockedReasons:JSON.stringify(item.humanReviewed.blockedReasons)};
 assert.equal(annotationSource(item,{collation:{...collation,annotationSourceApproval:approval}}).kind,'personal');
 assert.equal(annotationSource(item,{collation:{...collation,text:text+'改',annotationSourceApproval:approval}}),null);
 assert.equal(annotationSource(item,{collation:{...collation,annotationSourceApproval:{...approval,blockedReasons:'[]'}}}),null);
});
test('all 552 registry sources match original reviewed TXT, cover full Unicode text and quarantine every blocked page',async()=>{
 const input=JSON.parse(fs.readFileSync(new URL('../../../2026-10-20-reviewed-annotation-local/input-batch.json',import.meta.url)));
 const summary=JSON.parse(fs.readFileSync(new URL('../../../2026-10-21-chapter-annotation-expansion/annotation-summary.json',import.meta.url)));
 const manifest=JSON.parse(fs.readFileSync(new URL('../../../2026-10-21-review-package-update/batch-03/prepared/source-manifest.json',import.meta.url)));
 let total=0,eligible=0,candidates=0;
 for(const part of [1,2,3,4]) {
  const data=JSON.parse(fs.readFileSync(new URL(`../annotation-data/part-${part}.json`,import.meta.url)));await validateReviewedPart(data,part);
  for(const p of data.pages){const original=input.pages.find(x=>x.page===p.page);if(original){assert.equal(p.text,original.text);assert.deepEqual(p.source,original.source);}else{const item=manifest.pages.find(x=>x.page===p.page);assert.deepEqual(p.source,item.source);assert.equal(hash(p.text),item.source.textSha256);}total++;eligible+=p.eligible?1:0;candidates+=p.candidates.length;if(!p.eligible)assert.equal(p.candidates.length,0);}
 }
 assert.equal(total,552);assert.equal(eligible,summary.eligiblePages);assert.equal(candidates,summary.totalAiCandidates);assert.equal(summary.newHumanAnnotationConfirmations,0);
});
test('task counts omit old AI candidates for an independently verified changed personal source',async()=>{
 const indexes=Object.fromEntries([1,2,3,4].map(part=>[part,JSON.parse(fs.readFileSync(new URL(`../screening-data/part-${part}-index.json`,import.meta.url)))]));
 const index=JSON.parse(fs.readFileSync(new URL('../annotation-data/index.json',import.meta.url)));
 const storage={getItem:key=>key.endsWith('-2')?JSON.stringify({version:1,part:2,person:'甲',reviews:{270:{collation:{text:'独立重新校对的版本。',verified:true,checks:{wording:true},verifiedBy:'甲',verifiedAt:'2026-10-20T00:00:00Z'}}}}):null};
 await loadReviewedIndex(indexes,{storage,fetcher:async()=>({ok:true,json:async()=>index})});
 const context=annotationTaskContext(storage,assignments[1],indexes);
 assert.equal(context.candidates,index.pages.filter(p=>p.part===2&&p.page<=427&&p.eligible&&p.page!==270).reduce((n,p)=>n+p.candidateCount,0));
});
test('extending a returned batch preserves the original page revision and saved AI decisions',async()=>{
 const value=fixture();value.revision='extended-part-revision';value.pages[0].annotationRevision='original-page-revision';
 const item={page:530};await attachReviewedPart([item],value,3);
 const source=annotationSource(item),saved=confirmDefaultAnnotations(item,undefined,source,'甲');
 assert.equal(item.humanReviewed.revision,'original-page-revision');
 value.revision='another-part-extension';await attachReviewedPart([item],value,3);
 assert.equal(candidateView(item,{theoryAnnotations:saved},annotationSource(item)).pending.length,0);
});
test('context-dependent AI acceptance requires an explicit confirmation and keeps who checked context',()=>{
 const c={...candidate,contextStatus:'needs-context'};
 assert.throws(()=>reviewCandidate(undefined,text,c,'accepted','甲','initial','source'),/语境/);
 const data=reviewCandidate(undefined,text,c,'accepted','甲','initial','source','2026-10-20T01:00:00Z',{contextConfirmed:true});
 assert.equal(data.passages[0].contextVerifiedBy,'甲');assert.equal(data.passages[0].originalContextStatus,'needs-context');assert.equal(data.completion,null);
 const completed=completeAnnotations(data,text,'甲');assert.equal(completed.completion.kind,'marked');
});

test('one page confirmation retains default AI marks without per-candidate decisions or invented context checks',async()=>{
 const v=fixture();v.pages[0].candidates[0].contextStatus='needs-context';
 const item={page:530};await attachReviewedPart([item],v,3);const source=annotationSource(item);
 const data=confirmDefaultAnnotations(item,undefined,source,'甲');
 assert.equal(annotationView(data,text).completed,true);assert.equal(data.passages.length,1);
 assert.equal(data.passages[0].origin,'ai-page-confirmed');assert.equal(data.passages[0].contextStatus,'needs-context');
 assert.equal(data.passages[0].contextVerifiedBy,undefined);assert.equal(candidateView(item,{theoryAnnotations:data},source).pending.length,0);
 assert.equal(data.candidateReview.decisions[candidate.id].mode,'page-confirmed');
 assert.equal(confirmDefaultAnnotations(item,data,source,'甲').passages.length,1);
});

test('selection deletion trims only selected AI text, survives reload and preserves raw source and old records',async()=>{
 const item={page:530};await attachReviewedPart([item],fixture(),3);const source=annotationSource(item);
 const data=deleteDefaultAnnotation(item,undefined,source,9,12,'甲');
 assert.equal(data.text,text);assert.equal(data.completion,null);assert.equal(data.passages.length,0);
 const view=candidateView(item,{theoryAnnotations:JSON.parse(JSON.stringify(data))},source);
 assert.deepEqual(view.pending.map(c=>[c.start,c.end]),[[6,9],[12,16]]);
 const completed=confirmDefaultAnnotations(item,data,source,'甲');
 assert.deepEqual(annotationView(completed,text).ranges.map(c=>[c.start,c.end]),[[6,9],[12,16]]);
 assert.equal(candidateView(item,{theoryAnnotations:completed},source).pending.length,0);
 assert.equal(data.completion,null);assert.equal(source.text,text);
 const deleted=deleteDefaultAnnotation(item,completed,source,6,16,'甲');
 assert.equal(annotationView(deleted,text).ranges.length,0);assert.equal(deleted.completion,null);
 assert.equal(confirmDefaultAnnotations(item,deleted,source,'甲').completion.kind,'none');
});

test('default confirmation preserves existing manual marks and deletion splits them with history',async()=>{
 const item={page:530};await attachReviewedPart([item],fixture(),3);const source=annotationSource(item);
 const old=addAnnotation(undefined,text,8,11,'旧人');const before=JSON.stringify(old);
 const done=confirmDefaultAnnotations(item,old,source,'甲');
 assert.equal(JSON.stringify(old),before);assert.equal(done.passages.find(a=>a.id===old.passages[0].id).createdBy,'旧人');
 assert.equal(candidateView(item,{theoryAnnotations:done},source).pending.length,0);
 const deleted=deleteDefaultAnnotation(item,done,source,9,10,'甲');
 assert.ok(deleted.passages.some(a=>a.id===old.passages[0].id&&a.status==='removed'));
 assert.deepEqual(annotationView(deleted,text).ranges.map(a=>[a.start,a.end]),[[6,8],[8,9],[10,11],[11,16]]);
 assert.equal(confirmDefaultAnnotations(item,deleted,source,'甲').completion.kind,'marked');
});

test('deletion uses exact UTF16 source offsets and does not split astral characters or apply stale cuts',async()=>{
 const v=fixture();v.pages[0].text+='\r\n𠮷书𠮷书';const t=v.pages[0].text;
 Object.assign(v.pages[0].source,{revision:hash(t),textSha256:hash(t)});
 v.pages[0].segments=[{...v.pages[0].segments[0],end:t.length,quote:t}];
 v.pages[0].candidates=[{...candidate,start:t.length-6,end:t.length,quote:t.slice(-6)}];
 const item={page:530};await attachReviewedPart([item],v,3);const source=annotationSource(item);
 const data=deleteDefaultAnnotation(item,undefined,source,t.length-3,t.length,'甲');
 const done=confirmDefaultAnnotations(item,data,source,'甲');assert.equal(done.passages[0].quote,'𠮷书');assert.equal(done.text,t);
 assert.throws(()=>deleteDefaultAnnotation(item,undefined,source,t.length-2,t.length,'甲'),/选中/);
 const stale=structuredClone(data);stale.candidateReview.sourceRevision='old';
 assert.equal(candidateView(item,{theoryAnnotations:stale},source).pending[0].quote,'𠮷书𠮷书');
 assert.throws(()=>confirmDefaultAnnotations(item,data,source,''),/姓名/);
});

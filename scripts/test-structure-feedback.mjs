import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptyStructureFeedback,structureParagraphs,proposeStructure,deriveStructure,decideStructure,undoStructure,confirmStructure,structureChecks,structureAudit,saveStructureFeedback,mergeStructureFeedback,validateStructureFeedback} from '../src/annotation-structure-core.js';
const hash=t=>createHash('sha256').update(t).digest('hex');
const text='题\r\n甲𠮷乙。\r\n丙丁。后章\n戊己。',split=text.indexOf('后章');
const page={page:1,part:1,eligible:true,text,source:{textSha256:hash(text)},candidates:[]};
const block=(start,end,role='theory')=>({start,end,role,category:'书论'});
const make=(id,start,end,blocks)=>({id,workId:'w',workTitle:'测试书',title:id,author:'作者',contributors:[],volumeTitle:'',level:'section',start:{page:1,offset:start},end:{page:1,offset:end},fragments:[{page:1,part:1,start,end,textSha256:hash(text),candidateCount:0,blocks}],gaps:[],candidateCount:0});
const index={version:1,revision:'base',assignmentRevision:'base',eligiblePages:1,sourcePages:[1],works:[{id:'w',title:'测试书',author:'作者',chapters:['a','b']}],chapters:[make('a',0,split,[block(0,3,'structure'),block(3,10),block(10,split)]),make('b',split,text.length,[block(split,text.length)])],pageToChapters:{1:['a','b']},chapterAliases:{a:'a',b:'b'}};
const corpus={mode:'legacy',index,byPage:new Map([[1,page]])},revision='test-binding',empty=()=>emptyStructureFeedback(revision,'legacy');
const anchor=(start,end=start)=>({page:1,start,end,quote:text.slice(start,end),textSha256:hash(text)});
const add=(state,action,proposal={},at=anchor(3,7),chapterId='a')=>proposeStructure(state,corpus,{action,chapterId,anchor:at,proposal,comment:'对照原图核查',by:'隔离测试'},'2026-10-23T06:00:00Z');
const apply=s=>decideStructure(s,s.items.at(-1).id,'applied','核查人',corpus);
test('paragraphs preserve every source UTF16 unit and display CRLF without editing source',()=>{
 const ps=structureParagraphs(index.chapters[0],corpus.byPage);assert.equal(ps.flatMap(p=>p.parts.map(s=>text.slice(s.start,s.end))).join(''),text.slice(0,split));assert.ok(ps.some(p=>p.text.includes('𠮷')));assert.equal(page.text,text);
});
test('proposing is pending and does not change the index until adopted',()=>{
 const state=add(empty(),'split-paragraph',{},anchor(6));assert.equal(state.items[0].status,'pending');assert.deepEqual(deriveStructure(state,corpus),index);
});
test('split and merge paragraph are reversible with full source coverage',()=>{
 let s=apply(add(empty(),'split-paragraph',{},anchor(6)));let derived=deriveStructure(s,corpus);assert.equal(structureParagraphs(derived.chapters[0],corpus.byPage).length,4);
 s=apply(add(s,'merge-paragraph',{},anchor(3)));derived=deriveStructure(s,corpus);assert.equal(structureParagraphs(derived.chapters[0],corpus.byPage).length,3);
 s=undoStructure(s,'核查人',corpus);assert.equal(structureParagraphs(deriveStructure(s,corpus).chapters[0],corpus.byPage).length,4);
 s=undoStructure(s,'核查人',corpus);assert.deepEqual(deriveStructure(s,corpus),index);assert.equal(s.items.length,2);
});
test('split rejects a cut inside a surrogate pair and source mismatch',()=>{
 assert.throws(()=>add(empty(),'split-paragraph',{},anchor(5)),/字符/);
 assert.throws(()=>proposeStructure(empty(),corpus,{action:'split-paragraph',chapterId:'a',anchor:{...anchor(6),textSha256:'0'.repeat(64)},proposal:{},by:'人',comment:'核对'}),/正文|来源/);
});
test('chapter split and merge keep exact source order and generate no new text',()=>{
 let s=apply(add(empty(),'split-chapter',{title:'新分章'},anchor(10)));let d=deriveStructure(s,corpus);assert.equal(d.chapters.length,3);assert.equal(d.chapters[1].title,'新分章');assert.equal(d.chapters.flatMap(c=>c.fragments.map(f=>text.slice(f.start,f.end))).join(''),text);
 s=apply(add(s,'merge-chapter',{title:'合章'},anchor(3)));d=deriveStructure(s,corpus);assert.equal(d.chapters.length,2);assert.equal(d.chapters[0].title,'合章');assert.equal(d.chapters[0].fragments[0].end,split);
});
test('chapter boundary moves a prefix or suffix only between adjacent chapters of one work',()=>{
 let s=apply(add(empty(),'move-next',{},anchor(10)));let d=deriveStructure(s,corpus);assert.equal(d.chapters[0].fragments[0].end,10);assert.equal(d.chapters[1].fragments[0].start,10);
 s=apply(add(s,'move-previous',{},anchor(split), 'b'));d=deriveStructure(s,corpus);assert.equal(d.chapters[0].fragments[0].end,split);
 const separate=structuredClone(index);separate.chapters[1].workId='other';assert.throws(()=>proposeStructure(empty(),{...corpus,index:separate},{action:'merge-chapter',chapterId:'a',anchor:anchor(3),proposal:{title:'合章'},by:'人',comment:'核对'}),/同篇|相邻/);
});
test('role and title corrections are separate from text and annotation state',()=>{
 let s=apply(add(empty(),'role',{role:'editorial'},anchor(3)));s=apply(add(s,'rename-chapter',{title:'更正章名'},anchor(3)));const d=deriveStructure(s,corpus);assert.equal(d.chapters[0].title,'更正章名');assert.equal(structureParagraphs(d.chapters[0],corpus.byPage)[1].role,'editorial');assert.equal(page.text,text);
});
test('structure confirmations bind the current structure and become stale after correction',()=>{
 let s=confirmStructure(empty(),corpus,'a','paragraphs','核查人');assert.equal(structureChecks(s,corpus,'a').paragraphs,true);assert.equal(structureChecks(s,corpus,'a').chapters,false);
 s=apply(add(s,'split-paragraph',{},anchor(6)));assert.equal(structureChecks(s,corpus,'a').paragraphs,false);assert.equal(s.checks.length,1);
});
test('audit summaries expose independent current checks with their actual author and retain stale history separately',()=>{
 let s=confirmStructure(empty(),corpus,'a','paragraphs','段落核查人');s=confirmStructure(s,corpus,'b','chapters','章节核查人');let audit=structureAudit(s,corpus);
 assert.equal(audit.filter(c=>c.paragraphs.confirmed).length,1);assert.equal(audit.find(c=>c.chapterId==='b').chapters.by,'章节核查人');assert.equal(audit.find(c=>c.chapterId==='a').chapters.confirmed,false);
 s=apply(add(s,'split-paragraph',{},anchor(6)));audit=structureAudit(s,corpus);assert.equal(audit.find(c=>c.chapterId==='a').paragraphs.confirmed,false);assert.equal(s.checks.length,2);
});
test('stale feedback cannot silently overwrite later changes',()=>{
 let s=add(empty(),'rename-chapter',{title:'先提建议'},anchor(3));const id=s.items[0].id;s=apply(add(s,'rename-chapter',{title:'后来采用'},anchor(3)));assert.throws(()=>decideStructure(s,id,'applied','人',corpus),/结构.*变化/);
});
test('a paragraph correction does not rewrite unrelated original chapter boundaries or stale their feedback',()=>{
 const original=structuredClone(index);original.chapters[1].start={page:0,offset:null,pendingTextAnchor:true};const c={...corpus,index:original};
 let s=proposeStructure(empty(),c,{action:'rename-chapter',chapterId:'b',anchor:anchor(split),proposal:{title:'独立建议'},comment:'另一章独立意见',by:'测试人'});const id=s.items[0].id;
 s=proposeStructure(s,c,{action:'split-paragraph',chapterId:'a',anchor:anchor(6),proposal:{},comment:'章内分段',by:'测试人'});s=decideStructure(s,s.items.at(-1).id,'applied','核查人',c);
 assert.deepEqual(deriveStructure(s,c).chapters[1],original.chapters[1]);assert.doesNotThrow(()=>decideStructure(s,id,'applied','核查人',c));
});
test('feedback notes, decisions and undo retain author and history',()=>{
 let s=add(empty(),'note');s=decideStructure(s,s.items[0].id,'dismissed','核查人',corpus,'已回图，暂不调整');assert.equal(s.items[0].resolution,'已回图，暂不调整');assert.equal(s.events.length,2);assert.equal(s.items[0].by,'隔离测试');
 assert.throws(()=>add(empty(),'note',{},anchor(3), 'missing'),/章节/);assert.throws(()=>confirmStructure(empty(),corpus,'a','chapters',''),/姓名/);
});
test('save failure and CAS conflict never mutate the supplied state or previous disk value',()=>{
 let raw=null;const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};const s=add(empty(),'note');const saved=saveStructureFeedback(storage,'key',s,null,corpus,revision);assert.equal(raw,saved);assert.throws(()=>saveStructureFeedback(storage,'key',empty(),null,corpus,revision),/窗口/);assert.equal(raw,saved);
 assert.throws(()=>saveStructureFeedback({getItem:()=>null,setItem:()=>{throw Error('quota');}},'key',s,null,corpus,revision),/quota/);assert.equal(s.items[0].status,'pending');
});
test('import validates corpus binding, detects changed records, and keeps independent proposals',()=>{
 const a=add(empty(),'note'),b=add(empty(),'note');const merged=mergeStructureFeedback(a,b,corpus,revision);assert.equal(merged.items.length,2);assert.deepEqual(mergeStructureFeedback(a,a,corpus,revision),a);
 assert.throws(()=>validateStructureFeedback({...a,revision:'other'},corpus,revision),/版本/);const conflict=structuredClone(a);conflict.items[0].comment='不同意见';assert.throws(()=>mergeStructureFeedback(a,conflict,corpus,revision),/同.*反馈/);
});
test('cross-source paragraph merge and boundary changes preserve source units and refuse an audit gap',()=>{
 const extra='庚辛𠮷壬。',p3={...page,page:3,text:extra,source:{textSha256:hash(extra)}},i=structuredClone(index),b=i.chapters[1];
 b.fragments.push({page:3,part:1,start:0,end:extra.length,textSha256:hash(extra),candidateCount:0,blocks:[block(0,extra.length)]});b.end={page:3,offset:extra.length};i.eligiblePages=2;i.sourcePages=[1,3];i.pageToChapters[3]=['b'];
 const c={...corpus,index:i,byPage:new Map([[1,page],[3,p3]])},input={action:'merge-paragraph',chapterId:'b',anchor:anchor(split),proposal:{},comment:'接续跨页段落',by:'测试人'};
 let s=proposeStructure(empty(),c,input);s=decideStructure(s,s.items[0].id,'applied','核查人',c);const d=deriveStructure(s,c);assert.equal(structureParagraphs(d.chapters[1],c.byPage).length,1);assert.equal(structureParagraphs(d.chapters[1],c.byPage)[0].parts.map(p=>c.byPage.get(p.page).text.slice(p.start,p.end)).join(''),text.slice(split)+extra);
 const gap=structuredClone(i);gap.chapters[1].gaps=[{page:2,reasons:['未审核']}];assert.throws(()=>proposeStructure(empty(),{...c,index:gap},input),/缺口/);
 const move={action:'move-previous',chapterId:'b',anchor:{page:3,start:2,end:2,quote:'',textSha256:hash(extra)},proposal:{},comment:'改正两章分界',by:'测试人'};
 s=proposeStructure(empty(),c,move);s=decideStructure(s,s.items[0].id,'applied','核查人',c);const moved=deriveStructure(s,c);assert.equal(moved.chapters.flatMap(c=>c.fragments.map(f=>(f.page===1?text:extra).slice(f.start,f.end))).join(''),text+extra);
});

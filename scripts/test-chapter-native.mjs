import {chapterTaskUnits} from '../src/annotation-chapter-units.js';
import {validateChapterIndex} from '../src/annotation-chapters.js';
import {annotationReading} from '../src/annotation-reading.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {chapterRuns,mapChapterSelection,applyChapterSelection,confirmChapter,chapterIsConfirmed,effectiveChapterProgress,emptyChapterProgress,validateChapterProgress,saveChapterProgress,readChapterProgress,mergeChapterBackup,chapterProgressKey,chapterBackupState} from '../src/chapter-annotation-core.js';
import {addAnnotation,annotationView} from '../src/theory-annotations.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url))),index=read('../annotation-data/chapters.json');
const pages=[1,2,3,4].flatMap(n=>read(`../annotation-data/part-${n}.json`).pages),by=new Map(pages.map(p=>[p.page,p])),chapter=index.chapters.find(c=>c.title==='执笔第二十');
const legacy=Object.fromEntries([1,2,3,4].map(part=>[part,{version:1,part,person:'旧标注人',reviews:{}}]));
function fixture(){const old=structuredClone(legacy),p=by.get(850),start=p.text.indexOf('朱九江');old[4].reviews[850]={question:'旧记录',theoryAnnotations:addAnnotation(undefined,p.text,start,start+3,'旧标注人','2026-10-20T01:00:00Z','old-id')};return {old,p,state:emptyChapterProgress()};}
test('whole chapter runs include five complete qualified sources without page editing or line numbers',()=>{
 const {old,state}=fixture(),runs=chapterRuns(chapter,by,effectiveChapterProgress(old,state,by));assert.deepEqual([...new Set(runs.filter(r=>r.kind==='text').map(r=>r.page))],[850,851,852,853,854]);for(const r of runs.filter(r=>r.kind==='text'))assert.doesNotMatch(r.text,/\[\d{3,}\]/u);
});
test('one selection across page boundary maps exact source ranges and saves atomically without changing legacy data',()=>{
 const {old,state}=fixture(),before=JSON.stringify(old),runs=chapterRuns(chapter,by,effectiveChapterProgress(old,state,by)),a=runs.findLast(r=>r.page===850),z=runs.find(r=>r.page===851);
 const spans=mapChapterSelection(runs,a.id,Math.max(0,a.text.length-12),z.id,Math.min(12,z.text.length),by);assert.deepEqual(spans.map(s=>s.page),[850,851]);for(const s of spans)assert.equal(by.get(s.page).text.slice(s.start,s.end),s.quote);
 const next=applyChapterSelection(state,chapter,spans,'delete','测试',old,by);assert.ok(next.pages[850]);assert.ok(next.pages[851]);assert.equal(next.events.length,1);assert.equal(next.events[0].spans.length,2);assert.equal(JSON.stringify(old),before);assert.deepEqual(state,emptyChapterProgress());validateChapterProgress(next,by);
});
test('selection cannot cross review gaps or cut supplementary characters; repeated words use positions',()=>{
 const {old,state}=fixture(),c=index.chapters.find(c=>c.title==='宝南第九'),runs=chapterRuns(c,by,effectiveChapterProgress(old,state,by));assert.equal(runs[0].kind,'gap');
 const fake=[{kind:'text',id:'a',text:'甲',page:850},{kind:'gap'},{kind:'text',id:'b',text:'乙',page:851}];assert.throws(()=>mapChapterSelection(fake,'a',0,'b',1,by),/缺口/);
 const p={page:1,part:1,text:'[001] 同𠮷同\r\n[002] 同𠮷同',source:{textSha256:'a'.repeat(64)}},b=new Map([[1,p]]);const reading=annotationReading(p.text);
 const r={id:'x',kind:'text',page:1,part:1,start:0,end:p.text.length,text:reading.text,visibleStart:0,reading};const at=reading.text.lastIndexOf('𠮷');assert.throws(()=>mapChapterSelection([r],'x',at+1,'x',at+2,b),/完整字符/);const s=mapChapterSelection([r],'x',at,'x',at+2,b)[0];assert.equal(s.start,p.text.lastIndexOf('𠮷'));assert.equal(s.quote,'𠮷');
});
test('chapter confirmation does not become page confirmation or confirm other chapters on shared page',async()=>{
 const {old,state}=fixture(),before=JSON.stringify(old),next=await confirmChapter(state,chapter,'测试',old,by);assert.equal(await chapterIsConfirmed(chapter,by,old,next),true);assert.equal(await chapterIsConfirmed(index.chapters.find(c=>c.title==='卷五'),by,old,next),false);assert.equal(JSON.stringify(old),before);assert.deepEqual(next.pages,{});assert.equal(next.confirmations[chapter.id].scope,'available-chapter');
 const p=by.get(850),s={page:850,part:4,start:p.text.indexOf('古人作书'),end:p.text.indexOf('古人作书')+4,quote:'古人作书',textSha256:p.source.textSha256},changed=applyChapterSelection(next,chapter,[s],'delete','测试',old,by);assert.equal(await chapterIsConfirmed(chapter,by,old,changed),false);
});
test('addition and partial deletion keep old mark, old history and untouched source coordinates',()=>{
 const {old,state,p}=fixture(),start=p.text.indexOf('古人作书'),span={page:850,part:4,start,end:start+4,quote:'古人作书',textSha256:p.source.textSha256};let next=applyChapterSelection(state,chapter,[span],'add','测试',old,by);next=applyChapterSelection(next,chapter,[{...span,start:start+1,end:start+3,quote:p.text.slice(start+1,start+3)}],'delete','测试',old,by);
 const e=effectiveChapterProgress(old,next,by),view=annotationView(e[4].reviews[850].theoryAnnotations,p.text);assert.ok(view.ranges.some(r=>r.id==='old-id'));assert.ok(view.ranges.some(r=>r.start===start&&r.end===start+1));assert.ok(view.ranges.some(r=>r.start===start+3&&r.end===start+4));assert.equal(old[4].reviews[850].theoryAnnotations.passages.length,1);assert.equal(p.text,by.get(850).text);
});
test('single-key persistence rejects changed legacy, cross-tab writes and failed disk without erasing existing records',()=>{
 const {old,state,p}=fixture(),start=p.text.indexOf('古人作书'),next=applyChapterSelection(state,chapter,[{page:850,part:4,start,end:start+4,quote:'古人作书',textSha256:p.source.textSha256}],'delete','测试',old,by),map=new Map([['old','preserve']]),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const raw=saveChapterProgress(storage,next,null,by);assert.equal(readChapterProgress(storage,by).raw,raw);assert.throws(()=>saveChapterProgress(storage,state,null,by),/另一标签/);assert.equal(map.get('old'),'preserve');assert.throws(()=>saveChapterProgress({...storage,setItem:()=>{throw new Error('quota');}},state,raw,by),/quota/);assert.equal(map.get(chapterProgressKey),raw);
 const altered=structuredClone(old);altered[4].reviews[850].theoryAnnotations.events.push({action:'external'});assert.throws(()=>effectiveChapterProgress(altered,next,by),/其他入口变化/);
});
test('restore preserves all original history, merges disjoint records, rejects colliding page snapshots',()=>{
 const {old,state,p}=fixture(),start=p.text.indexOf('古人作书'),next=applyChapterSelection(state,chapter,[{page:850,part:4,start,end:start+4,quote:'古人作书',textSha256:p.source.textSha256}],'delete','测试',old,by);const imported=mergeChapterBackup(emptyChapterProgress(),JSON.parse(JSON.stringify(next)),by);assert.deepEqual(imported.pages,next.pages);assert.equal(imported.events.length,1);const conflict=structuredClone(next);conflict.pages[850].data.events.push({action:'different'});assert.throws(()=>mergeChapterBackup(next,conflict,by),/未自动覆盖/);assert.equal(next.events.length,1);
});

test('backup restores all legacy marks and notes in a fresh browser without writing original progress keys',()=>{
 const {old,state,p}=fixture(),start=p.text.indexOf('古人作书'),next=applyChapterSelection(state,chapter,[{page:850,part:4,start,end:start+4,quote:'古人作书',textSha256:p.source.textSha256}],'delete','测试',old,by);
 old[3].reviews[700]={question:'旧备注仍需保留',collation:{text:'历史稿',metricBaseline:{text:'底稿'}}};
 const archive=chapterBackupState(next,old),restored=mergeChapterBackup(emptyChapterProgress(),JSON.parse(JSON.stringify(archive)),by),fresh=structuredClone(legacy),before=JSON.stringify(fresh),effective=effectiveChapterProgress(fresh,restored,by);
 assert.equal(effective[3].reviews[700].question,'旧备注仍需保留');assert.equal(effective[4].person,'旧标注人');assert.ok(effective[4].reviews[850].theoryAnnotations.passages.some(p=>p.id==='old-id'));assert.equal(JSON.stringify(fresh),before);assert.equal(archive.legacyArchive[3].reviews[700].collation.metricBaseline.text,'底稿');fresh[3].reviews[700]={question:'本机新备注'};assert.equal(effectiveChapterProgress(fresh,restored,by)[3].reviews[700].question,'本机新备注');assert.equal(archive.legacyArchive[3].reviews[700].question,'旧备注仍需保留');
});
test('editing one chapter on a shared original page does not invalidate an unchanged neighbouring chapter',async()=>{
 const {old,state,p}=fixture(),volume=index.chapters.find(c=>c.title==='卷五'),confirmed=await confirmChapter(state,volume,'测试',old,by),start=p.text.indexOf('古人作书'),next=applyChapterSelection(confirmed,chapter,[{page:850,part:4,start,end:start+4,quote:'古人作书',textSha256:p.source.textSha256}],'delete','测试',old,by);assert.equal(await chapterIsConfirmed(volume,by,old,next),true);
});

test('native tasks retain complete original chapters, folding volume labels and chapter-internal lists without changing sources',()=>{
 const before=JSON.stringify(index),native=chapterTaskUnits(index,by);validateChapterIndex(native,by);assert.equal(JSON.stringify(index),before);assert.equal(native.chapters.length,186);assert.equal(native.chapters.filter(c=>c.fragments.length).length,175);
 const pen=native.chapters.find(c=>c.title==='执笔第二十');assert.ok(pen.sourceChapterIds.includes(volumeId()));assert.equal(pen.fragments[0].start,0);
 const purchase=native.chapters.find(c=>c.title==='购碑第三');assert.equal(purchase.sourceChapterIds.length,3);assert.ok(purchase.fragments.some(f=>f.page===776));assert.ok(purchase.gaps.some(g=>g.page===777));
 const ancient=native.chapters.find(c=>c.title==='古学篇'),make=native.chapters.find(c=>c.title==='造书篇'),yao=native.chapters.find(c=>c.title==='书要篇');assert.ok(ancient.fragments.some(f=>f.page===464));assert.ok(!yao.fragments.some(f=>f.page===464));assert.equal(make.fragments.length,0);assert.ok(ancient.gaps.some(g=>g.page===460));
 function volumeId(){return index.chapters.find(c=>c.title==='卷五').id;}
});

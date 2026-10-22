import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {annotationReading} from '../src/annotation-reading.js';
import {deleteDefaultAnnotation,confirmDefaultAnnotations,candidateView} from '../src/reviewed-annotation.js';
import {annotationSource} from '../src/annotation-source.js';

test('reading view removes line numbers, joins split sentences and keeps headings and real paragraph endings',()=>{
 const raw='[001] 书法之道当以古人为师，\r\n[002] 不可率意妄为。\r\n[003] 规矩\n[004] 古今论书，独推两晋。';
 const view=annotationReading(raw);
 assert.equal(view.text,'书法之道当以古人为师，不可率意妄为。\n规矩\n古今论书，独推两晋。');
 const start=view.text.indexOf('师'),end=view.text.indexOf('率');
 const sourceStart=view.sourceStart(start),sourceEnd=view.sourceEnd(end);
 assert.equal(raw.slice(sourceStart,sourceEnd),'师，\r\n[002] 不可');
 assert.equal(view.visibleOffset(sourceStart),start);assert.equal(view.visibleOffset(sourceEnd),end);
});

test('every displayed UTF16 unit maps to the original reviewed source, including astral and repeated words',()=>{
 for(const raw of ['[001] 𠮷书𠮷书\r\n[002] 原文。','[001] 原文\r[002] 重复','无序号正文。\n另一段。','']){
  const view=annotationReading(raw);
  for(let i=0;i<view.text.length;i++){
   const original=raw.slice(view.sourceStart(i),view.sourceEnd(i+1));
   assert.equal(original.replace(/\r\n?/g,'\n'),view.text[i]);
  }
 }
});
test('glued column labels disappear while cross-label selections retain exact original UTF16 positions',()=>{
 const raw='[001] 甲𠮷[002] 乙。\r\n[003] 原注[2]保留。',view=annotationReading(raw);
 assert.equal(view.text,'甲𠮷乙。\n原注[2]保留。');
 const a=view.text.indexOf('𠮷'),b=view.text.indexOf('乙')+1;
 assert.equal(raw.slice(view.sourceStart(a),view.sourceEnd(b)),'𠮷[002] 乙');
 for(let i=0;i<view.text.length;i++)assert.equal(raw.slice(view.sourceStart(i),view.sourceEnd(i+1)).replace(/\r\n?/g,'\n'),view.text[i]);
 assert.equal(view.visibleOffset(view.sourceStart(a)),a);assert.equal(view.visibleOffset(view.sourceEnd(b)),b);
});

test('all 552 real reviewed pages have no line numbers in reading view with unchanged source offsets',()=>{
 let pages=0;
 for(const part of [1,2,3,4])for(const p of JSON.parse(fs.readFileSync(new URL(`../annotation-data/part-${part}.json`,import.meta.url))).pages){
  pages++;const view=annotationReading(p.text);
  assert.doesNotMatch(view.text,/^\s*\[\d+\]/m);
  assert.doesNotMatch(view.text,/\[\d{3,}\]/);
  for(const r of p.candidates){const ranges=view.ranges([r]);assert.equal(ranges.length,1);assert.ok(ranges[0].end>ranges[0].start);}
 }
 assert.equal(pages,552);
});

test('deleting a reading selection across removed numbering affects exact raw mark and confirmation retains old data',()=>{
 const material=[1,2,3,4].map(n=>JSON.parse(fs.readFileSync(new URL(`../annotation-data/part-${n}.json`,import.meta.url)))).find(m=>m.pages.some(p=>p.eligible&&p.candidates.some(c=>/\n\[\d+\]/.test(c.quote))));
 const human=material.pages.find(p=>p.eligible&&p.candidates.some(c=>/\n\[\d+\]/.test(c.quote)));
 const p={page:human.page,humanReviewed:{...human,integrityChecked:true,revision:material.revision}};
 const source=annotationSource(p),view=annotationReading(source.text),c=human.candidates.find(c=>/\n\[\d+\]/.test(c.quote));
 const n=source.text.indexOf('\n[',c.start),start=view.visibleOffset(n)-1,end=start+3;
 const data=deleteDefaultAnnotation(p,undefined,source,view.sourceStart(start),view.sourceEnd(end),'甲');
 assert.equal(data.text,source.text);
 assert.equal(view.text.slice(start,end).includes('['),false);
 const done=confirmDefaultAnnotations(p,data,source,'甲');assert.ok(done.completion);
 const all=done.passages.filter(a=>a.status==='active');
 assert.ok(all.every(a=>a.end<=view.sourceStart(start)||a.start>=view.sourceEnd(end)));
 assert.equal(candidateView(p,{theoryAnnotations:done},source).pending.length,0);
});

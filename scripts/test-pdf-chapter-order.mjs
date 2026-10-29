import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateStandardCorpus} from '../src/annotation-corpus.js';
import {chapterRuns} from '../src/chapter-annotation-core.js';
const data=JSON.parse(fs.readFileSync('annotation-data/wolai-standard.json'));
test('原PDF276-280的语例字格不混入述书赋正文，条目采用原书顺序',async()=>{
 const corpus=await validateStandardCorpus(data),c=corpus.index.chapters.find(c=>c.id==='work-079'),text=chapterRuns(c,corpus.byPage,{}).filter(r=>r.kind==='text'&&!r.parallel).map(r=>r.text).join('');
 assert.ok(!/孔琳之|江蒨字彦渊|盘桓有威/.test(text),'语例字格范围不含述书赋及注');let at=-1;
 for(const word of ['吾弟尚辇君','忘情','天然','质朴','体裁','不伦','枯槁','专成','丰：','茂：','丽：','宏：','实：','乾：','滑：','放：','拔：','闲：','壮：','宽：','大历十年']){const next=text.indexOf(word,at+1);assert.ok(next>at,word+' should follow previous item in PDF order');at=next;}
});
import {chapterAnnotationFiles,chapterReadingText,validateChapterIndex} from '../src/annotation-chapters.js';
import {chapterReadingEvents} from '../src/annotation-pdf-order.js';
import {annotationBatches} from '../src/task-allocation.js';
import {readCorpusAssignments} from '../src/annotation-assignments.js';
import {emptyChapterProgress,chapterSignature,chapterIsConfirmed,applyChapterSelection,effectiveChapterProgress,mapChapterSelection,mergeChapterBackup} from '../src/chapter-annotation-core.js';
test('所有审核原件及全部UTF16来源窗口完整保留，PDF定位先后替代原合并次序',async()=>{
 const before=JSON.stringify(data),corpus=await validateStandardCorpus(data);validateChapterIndex(corpus.index,corpus.byPage);assert.equal(JSON.stringify(data),before);
 const covered=new Map();for(const c of corpus.index.chapters){let last=null;for(const e of chapterReadingEvents(c)){if(!e.f)continue;(covered.get(e.f.page)||covered.set(e.f.page,[]).get(e.f.page)).push([e.f.start,e.f.end]);if(e.pdf&&!e.parallel){const pos=e.pdf.page*1e6+e.pdf.start;assert.ok(last===null||pos>=last,c.id);last=pos;}}}
 for(const p of data.pages){let at=0;for(const [a,z]of covered.get(p.page).sort((a,b)=>a[0]-b[0])){assert.equal(a,at);at=z;}assert.equal(at,p.text.length);}
});
test('PDF263从陈代起为下篇；PDF525的书统续文不因页首换成古今',async()=>{
 const corpus=await validateStandardCorpus(data),up=corpus.index.chapters.find(c=>c.title==='述书赋上'),down=corpus.index.chapters.find(c=>c.title==='述书赋下');assert.ok(up&&down);
 const text=c=>chapterReadingText(c,corpus.byPage).split('〔PDF位置待核')[0];assert.ok(!text(up).includes('爰及陈氏'));assert.ok(text(down).includes('爰及陈氏'));assert.ok(text(down).indexOf('爰及陈氏')<text(down).indexOf('我巨唐'));
 const tong=corpus.index.chapters.find(c=>c.title==='书统'),gujin=corpus.index.chapters.find(c=>c.title==='古今');assert.ok(text(tong).includes('何畏于彼'));assert.ok(!text(gujin).includes('何畏于彼'));
 const pre=corpus.index.chapters.find(c=>c.title==='续书断序'),pin=corpus.index.chapters.find(c=>c.title==='品书论');assert.ok(!text(pre).includes('（二）品书论'));assert.ok(text(pin).includes('（二）品书论'));
});
test('重排不重分七人负责的章节ID，也不写本机分工',async()=>{
 const corpus=await validateStandardCorpus(data),expected=annotationBatches({index:data.index}),actual=annotationBatches(corpus),viaIndex=annotationBatches({index:corpus.index});assert.deepEqual(actual,expected);assert.deepEqual(viaIndex,expected);
 const snapshot=readCorpusAssignments({getItem:()=>null,setItem:()=>{throw Error('不得写入分工');}},corpus.index,corpus.mode);for(const group of expected)for(const id of group.chapterIds)assert.equal(snapshot.value.assignments[id],'member-batch-'+group.id);
});
test('旧范围的确认不自动确认新篇界，移出段落的人工标注仍能在正确章节中恢复',async()=>{
 const corpus=await validateStandardCorpus(data),old=data.index.chapters.find(c=>c.id==='work-079'),current=corpus.index.chapters.find(c=>c.id==='work-079'),p=corpus.byPage.get(20073),span={page:20073,part:1,start:1069,end:1072,quote:p.text.slice(1069,1072),textSha256:p.source.textSha256};
 const initial=emptyChapterProgress(),marked=applyChapterSelection(initial,old,[span],'add','隔离历史标注',{},corpus.byPage);marked.confirmations[old.id]={signature:await chapterSignature(old,corpus.byPage,{},marked),by:'旧审核人',at:'2026-10-28T00:00:00Z',scope:'available-chapter'};const raw=JSON.stringify(marked);assert.equal(await chapterIsConfirmed(current,corpus.byPage,{},marked),false);assert.equal(JSON.stringify(marked),raw);
 const restored=mergeChapterBackup(emptyChapterProgress(),JSON.parse(raw),corpus.byPage),upper=corpus.index.chapters.find(c=>c.title==='述书赋上'),runs=chapterRuns(upper,corpus.byPage,effectiveChapterProgress({},restored,corpus.byPage));assert.ok(runs.some(r=>r.start<=1069&&r.end>=1072&&r.html.includes('<mark')));assert.deepEqual(restored.pages,marked.pages);
});
test('跨重排条目仍按原源坐标保存；接顺的是显示分隔，不改原审核字符',async()=>{
 const corpus=await validateStandardCorpus(data),c=corpus.index.chapters.find(c=>c.id==='work-079'),runs=chapterRuns(c,corpus.byPage,{}),a=runs.find(r=>r.start===105&&r.end===118),b=runs.find(r=>r.start===0&&r.end===13),spans=mapChapterSelection(runs,a.id,0,b.id,6,corpus.byPage);assert.equal(spans[0].start,105);assert.equal(spans.at(-1).start,0);assert.equal(spans.at(-1).quote,'不伦：前浓后');assert.ok(!spans.some(s=>s.start>=5040));
 const reading=chapterReadingText(c,corpus.byPage);assert.ok(reading.includes('无细不闻'));assert.equal(corpus.byPage.get(20073).text,data.pages.find(p=>p.page===20073).text);assert.ok(runs.some(r=>r.parallel));
});
test('TXT、HTML、JSON和映射CSV共同记录原书顺序及原源坐标',async()=>{
 const corpus=await validateStandardCorpus(data),files=chapterAnnotationFiles(corpus.index,corpus.byPage),txt=files.find(f=>f.name.startsWith('按篇正文-work-079-')).content,html=files.find(f=>f.name==='章节整理.html').content,json=JSON.parse(files.find(f=>f.name==='章节整理.json').content).chapters.find(c=>c.id==='work-079');assert.ok(txt.indexOf('丽：')<txt.indexOf('实：'));assert.ok(txt.includes('无细不闻'));assert.ok(html.includes('原PDF第277页'));assert.ok(json.readingOrder.some(e=>e.source===20073&&e.start===1038&&e.pdf.page===279));assert.ok(files.some(f=>f.name==='PDF与TXT阅读映射.csv'));assert.ok(!txt.includes('孔琳之'));
});
import {emptyStructureFeedback,proposeStructure,decideStructure,deriveStructure,validateStructureFeedback} from '../src/annotation-structure-core.js';
test('原有已采用的本机结构修订保留在原版本，不被PDF阅读重排覆盖',async()=>{
 const corpus=await validateStandardCorpus(data),original={...corpus,index:data.index,allocationIndex:undefined},p=corpus.byPage.get(20073),anchor={page:20073,start:0,end:2,quote:p.text.slice(0,2),textSha256:p.source.textSha256},state=proposeStructure(emptyStructureFeedback('same-source-revision',corpus.mode),original,{chapterId:'work-079',action:'rename-chapter',anchor,proposal:{title:'本机保留章名'},comment:'隔离旧修订',by:'核查人'}),applied=decideStructure(state,state.items[0].id,'applied','核查人',original),raw=JSON.stringify(applied);
 validateStructureFeedback(applied,corpus,'same-source-revision');const draft=deriveStructure(applied,corpus);assert.equal(draft.chapters.find(c=>c.id==='work-079').title,'本机保留章名');assert.equal(JSON.stringify(applied),raw);assert.equal(corpus.index.chapters.find(c=>c.id==='work-079').title,'《述书赋》语例字格');
});

import {buildStandardBundle,bindCorpusProgress} from '../src/annotation-corpus.js';
test('完整ZIP保留真正的PDF篇界页码和原始审核语料，而不是把PDF标签替换成来源ID',async()=>{
 const corpus=await validateStandardCorpus(data),state=bindCorpusProgress(emptyChapterProgress(),corpus),bundle=await buildStandardBundle({corpus,state,legacy:{},legacyChapterRaw:null,person:'隔离验收'}),html=bundle.files.find(f=>f.name==='章节整理.html').content;
 assert.ok(html.includes('原PDF第276页'));assert.ok(!html.includes('缺口来源276页'));assert.deepEqual(JSON.parse(bundle.files.find(f=>f.name==='wolai标准语料.json').content),data);assert.ok(bundle.files.find(f=>f.name==='PDF与TXT阅读映射.csv').content.includes('审核TXT UTF16'));assert.ok(bundle.bytes.length>1000);
});

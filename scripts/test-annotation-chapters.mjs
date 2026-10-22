import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateChapterIndex,chapterFragmentView,chapterBodyHtml,chapterAnnotationFiles} from '../src/annotation-chapters.js';
import {deleteDefaultAnnotation,confirmDefaultAnnotations} from '../src/reviewed-annotation.js';
import {annotationSource} from '../src/annotation-source.js';
import {buildUnifiedAnnotationBundle} from '../src/theory-annotation-export.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url))),index=read('../annotation-data/chapters.json');
const pages=[1,2,3,4].flatMap(n=>read(`../annotation-data/part-${n}.json`).pages),by=new Map(pages.map(p=>[p.page,p]));
test('all qualified new and old text is covered once by original chapters; blocked text never enters chapter fragments',()=>{
 assert.equal(validateChapterIndex(index,by),index);assert.equal(index.eligiblePages,472);assert.equal(index.works.length,66);assert.equal(index.chapters.length,196);
 assert.equal(new Set(index.chapters.flatMap(c=>c.fragments.map(f=>f.page))).size,472);
 const bad=structuredClone(index);bad.chapters.find(c=>c.fragments.length).fragments[0].textSha256='0'.repeat(64);assert.throws(()=>validateChapterIndex(bad,by),/不匹配/);
 const overlap=structuredClone(index);const c=overlap.chapters.find(c=>c.fragments.length);c.fragments.push(c.fragments[0]);assert.throws(()=>validateChapterIndex(overlap,by),/不匹配/);
});
test('same physical page splits at exact chapter headings, each fragment reads back to unchanged TXT',()=>{
 const chapters=index.chapters.filter(c=>c.fragments.some(f=>f.page===850));assert.ok(chapters.length===2);
 for(const c of chapters)for(const f of c.fragments.filter(f=>f.page===850)){const v=chapterFragmentView(f,by);assert.equal(v.text,by.get(850).text.slice(f.start,f.end));assert.doesNotMatch(v.readingText,/\[\d{3,}\]/u);for(const a of v.aiCandidates){assert.equal(a.overlapQuote,by.get(850).text.slice(a.overlapStart,a.overlapEnd));assert.ok(a.overlapStart>=f.start&&a.overlapEnd<=f.end);}}
 const pen=chapters.find(c=>c.title==='执笔第二十');assert.ok(chapterBodyHtml(pen,by).includes('朱九江'));assert.ok(!chapterBodyHtml(pen,by).includes('缀法第二十一'));
});
test('missing original chapter headings locate following qualified text but their blocked body stays absent',()=>{
 const c=index.chapters.find(c=>c.title==='宝南第九');assert.equal(c.start.page,816);assert.deepEqual(c.fragments.map(f=>f.page),[817,818]);assert.ok(c.fragments.at(-1).end<by.get(818).text.length);assert.ok(c.gaps.some(g=>g.page===816));assert.ok(!c.fragments.some(f=>f.page===816));
 const h=index.chapters.filter(c=>c.workTitle==='笔势论十二章 并序');assert.ok(h.some(c=>c.title==='视形章第三'));assert.ok(h.some(c=>c.title==='教悟章第七'));assert.equal(h.filter(c=>c.title.endsWith('章第六')).length,1);
});
test('chapter reader applies saved deletion and confirmation without mutating progress or audit sources',()=>{
 const p=by.get(850),item={page:p.page,humanReviewed:{...p,revision:p.annotationRevision,integrityChecked:true}},source=annotationSource(item),candidate=p.candidates[0];
 const data=deleteDefaultAnnotation(item,undefined,source,candidate.start,candidate.end,'隔离测试');
 const progress={4:{reviews:{850:{theoryAnnotations:data}}}},snapshot=JSON.stringify(progress),raw=p.text;
 const f=index.chapters.flatMap(c=>c.fragments).find(f=>f.page===850&&f.start<=candidate.start&&f.end>candidate.start),v=chapterFragmentView(f,by,progress);
 assert.equal(v.aiCandidates.find(c=>c.id===candidate.id).decision,'rejected');assert.equal(JSON.stringify(progress),snapshot);assert.equal(p.text,raw);
 const confirmed=confirmDefaultAnnotations(item,data,source,'隔离测试');assert.equal(confirmed.completion.by,'隔离测试');
 assert.equal(chapterFragmentView(f,by,{4:{reviews:{850:{theoryAnnotations:confirmed}}}}).completed,true);
});
test('old marks for a different source version remain explicit pending history instead of being applied to canonical TXT',()=>{
 const p=by.get(850),other=p.text+'另版',item={page:p.page,humanReviewed:{...p,text:other,revision:p.annotationRevision,integrityChecked:true}},source={...p.source,text:other};
 const confirmed=confirmDefaultAnnotations(item,undefined,source,'隔离旧版本');
 const c=index.chapters.find(c=>c.title==='执笔第二十'),f=c.fragments.find(f=>f.page===850),progress={4:{reviews:{850:{theoryAnnotations:confirmed}}}},before=JSON.stringify(progress);
 const view=chapterFragmentView(f,by,progress);assert.ok(view.pendingAnnotations.length>0);assert.equal(view.manualRanges.length,0);assert.ok(chapterBodyHtml(c,by,progress).includes('对应其他正文版本'));assert.equal(JSON.stringify(progress),before);
});
test('chapter outputs keep all AI decisions and include true chapter files, gaps, and original UTF16 anchors',()=>{
 const before=JSON.stringify(pages),files=chapterAnnotationFiles(index,by),json=JSON.parse(files.find(f=>f.name==='章节整理.json').content);
 assert.equal(json.chapters.length,196);assert.equal(files.filter(f=>f.name.startsWith('按篇正文-')).length,66);
 assert.ok(files.find(f=>f.name==='章节整理.html').content.includes('来源缺口'));assert.doesNotMatch(files.find(f=>f.name==='章节整理.html').content,/\[\d{3,}\]/u);
 const ids=new Set(json.chapters.flatMap(c=>c.fragments.flatMap(f=>f.aiCandidates.map(a=>a.id))));assert.equal(ids.size,1468);assert.equal(JSON.stringify(pages),before);
});
test('unified ZIP includes chapters and preserves all four original backup structures',async()=>{
 const progressByPart={},pagesByPart={};
 for(const part of [1,2,3,4]){progressByPart[part]={version:1,part,person:'原标注人',reviews:{}};const originals=read(`../screening-data/part-${part}-index.json`).pages;pagesByPart[part]=originals.map(p=>({...p,ocr:'隔离测试OCR',...(by.has(p.page)?{humanReviewed:{...by.get(p.page),revision:by.get(p.page).annotationRevision,integrityChecked:true}}:{})}));}
 progressByPart[3].reviews[700]={question:'旧记录',collation:{text:'原草稿',metricBaseline:{text:'原底稿'}}};const snapshot=JSON.stringify(progressByPart);
 const bundle=await buildUnifiedAnnotationBundle({progressByPart,pagesByPart,chapterIndex:index,person:'隔离测试',exportedAt:'2026-10-21T12:00:00Z'});
 assert.equal(bundle.manifest.pageNumbers.length,472);assert.equal(bundle.manifest.parts.length,4);assert.ok(new TextDecoder().decode(bundle.bytes).includes('章节整理.json'));assert.equal(JSON.stringify(progressByPart),snapshot);
});

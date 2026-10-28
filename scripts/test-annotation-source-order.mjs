import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {chapterSourceEvents,chapterFragmentView,chapterAnnotationFiles} from '../src/annotation-chapters.js';
import {chapterRuns,mapChapterSelection} from '../src/chapter-annotation-core.js';
import {annotationReading} from '../src/annotation-reading.js';
const read=n=>JSON.parse(fs.readFileSync(new URL(n,import.meta.url))),pages=[1,2,3,4].flatMap(n=>read(`../annotation-data/part-${n}.json`).pages),by=new Map(pages.map(p=>[p.page,p])),index=read('../annotation-data/chapters.json');
const p=by.get(18),fragment=(start,end)=>({page:18,part:1,start,end,textSha256:p.source.textSha256,blocks:[{start,end,role:'theory'}]}),chapter={id:'ordered',workId:'w',title:'顺序测试',author:'测试',workTitle:'测试',gaps:[],fragments:[fragment(175,p.text.length),fragment(0,175)]};
test('same-page fragments assemble by original UTF16 position, not input file or AI category order',()=>{
 const before=JSON.stringify(chapter),events=chapterSourceEvents(chapter),runs=chapterRuns(chapter,by,{});assert.deepEqual(events.map(e=>e.f.start),[0,175]);assert.equal(runs.map(r=>r.text).join(''),annotationReading(p.text).text);assert.equal(JSON.stringify(chapter),before);
});
test('page and in-page order is shared by reader, HTML and TXT exports',()=>{
 const derived={...index,eligiblePages:1,works:[{id:'w',title:'测试',author:'测试',chapters:['ordered']}],chapters:[chapter],pageToChapters:{18:['ordered','ordered']}},files=chapterAnnotationFiles(derived,new Map([[18,p]])),txt=files.find(f=>f.name.startsWith('按篇正文-')).content,html=files.find(f=>f.name==='章节整理.html').content,json=JSON.parse(files.find(f=>f.name==='章节整理.json').content);
 assert.deepEqual(json.chapters[0].fragments.map(f=>f.start),[0,175]);assert.ok(txt.indexOf('历代书法论文选')<txt.indexOf('九势'));assert.ok(html.indexOf('历代书法论文选')<html.lastIndexOf('九势'));assert.ok(html.includes('浅蓝为AI初标')&&html.includes('#dceaf8'));
});
test('block order follows source positions without moving annotations to a different quote',()=>{
 const f={...fragment(0,p.text.length),blocks:[{start:175,end:p.text.length,role:'theory'},{start:0,end:175,role:'structure'}]},view=chapterFragmentView(f,by),before=JSON.stringify(f);assert.deepEqual(view.blocks.map(b=>b.start),[0,175]);assert.equal(view.readingText,annotationReading(p.text).text);assert.equal(JSON.stringify(f),before);
 const runs=chapterRuns({...chapter,fragments:[f]},by,{}),run=runs.at(-1),at=run.text.indexOf('藏锋'),spans=mapChapterSelection(runs,run.id,at,run.id,at+2,by);assert.equal(spans[0].quote,'藏锋');assert.equal(spans[0].start,p.text.indexOf('藏锋'));
});
test('all admitted chapter runs retain every source range once; legacy keeps physical page order',()=>{
 const standard=read('../annotation-data/wolai-standard.json');for(const [chapters,map] of [[index.chapters,by],[standard.index.chapters,new Map(standard.pages.map(p=>[p.page,p]))]])for(const c of chapters){const runs=chapterRuns(c,map,{}),text=runs.filter(r=>r.kind==='text');for(let n=0;n<text.length;n++){const r=text[n];assert.equal(r.text,r.reading.text.slice(r.visibleStart,r.visibleEnd));assert.equal(text.filter(x=>x.id===r.id).length,1);if(n&&map===by)assert.ok(text[n-1].page<r.page||text[n-1].page===r.page&&text[n-1].end<=r.start);}}
});

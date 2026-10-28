import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {reviewPagePairs,pairChapter,pairText} from '../src/annotation-page-pairs.js';
import {loadAnnotationCorpus} from '../src/annotation-corpus.js';
const page=text=>({text,eligible:true,source:{textSha256:'a'.repeat(64)}});
test('numeric page order keeps gaps and clips shared pages to chapter ranges',()=>{
 const by=new Map([[9,page('前章。甲𠮷\r\n乙。后章。')],[10,page('丙。')]]),c={fragments:[{page:10,start:0,end:2},{page:9,start:3,end:10}],gaps:[{page:11,reasons:['人工审核未完成']}]},before=JSON.stringify(c),rows=reviewPagePairs(c,by);
 assert.deepEqual(rows.map(r=>r.page),[9,10,11]);assert.equal(pairText(rows[0],by),by.get(9).text.slice(3,10));assert.equal(rows[2].status,'missing');assert.equal(pairChapter(c,rows[0]).fragments.length,1);assert.equal(JSON.stringify(c),before);
});
test('wolai references are not exact page mapping even when there is one reference',()=>{
 const p=page('甲𠮷乙丙');p.source.originalPages=[10];p.source.provenance=[];const c={fragments:[{page:20001,start:0,end:p.text.length}],gaps:[]},rows=reviewPagePairs(c,new Map([[20001,p]]));assert.equal(rows[0].status,'unmapped');assert.equal(rows[0].fragments.length,0);assert.equal(rows[1].key,'unlocated');assert.equal(rows[1].fragments[0].end,p.text.length);
});
test('explicit legacy provenance pairs only known UTF16 spans and leaves all other units accessible',()=>{
 const p=page('甲𠮷\r\n乙丙丁');p.source.originalPages=[10,12];p.source.provenance=[{origin:'legacy-reviewed-txt',page_id:10,start:0,end:3},{origin:'wolai-block',page_id:'unknown',start:5,end:7},{origin:'legacy-reviewed-txt',page_id:12,start:7,end:8}];const by=new Map([[20001,p]]),f={page:20001,start:0,end:p.text.length},c={fragments:[f],gaps:[]},rows=reviewPagePairs(c,by);
 assert.equal(rows[0].status,'partial');assert.equal(pairText(rows[0],by),'甲𠮷');const fragments=rows.flatMap(r=>r.fragments).sort((a,b)=>a.start-b.start);assert.equal(fragments.map(f=>p.text.slice(f.start,f.end)).join(''),p.text);assert.deepEqual(rows.map(r=>r.key),['10','12','unlocated']);
});
test('blocked pages do not enter the pair text',()=>{const p=page('未审核');p.eligible=false;assert.deepEqual(reviewPagePairs({fragments:[{page:1,start:0,end:3}],gaps:[]},new Map([[1,p]])),[]);});
const fetcher=async path=>({ok:true,json:async()=>JSON.parse(await fs.readFile(new URL('../'+path.replace(/^\.\//,'').split('?')[0],import.meta.url),'utf8'))});
for(const mode of ['legacy','wolai-standard'])test(mode+' every approved chapter UTF16 unit is covered exactly once by the page pairs',async()=>{
 const corpus=await loadAnnotationCorpus('?corpus='+mode,{fetcher});let count=0;
 for(const c of corpus.index.chapters){const rows=reviewPagePairs(c,corpus.byPage),actual=rows.flatMap(r=>r.fragments).sort((a,b)=>a.page-b.page||a.start-b.start),expected=c.fragments.filter(f=>corpus.byPage.get(f.page).eligible).slice().sort((a,b)=>a.page-b.page||a.start-b.start);
  for(const f of expected){const spans=actual.filter(s=>s.page===f.page&&s.start>=f.start&&s.end<=f.end);let at=f.start;for(const s of spans){assert.equal(s.start,at,c.id);at=s.end;}assert.equal(at,f.end,c.id);count+=f.end-f.start;}
  assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);assert.ok(rows.filter(r=>r.page!==null).every((r,i,a)=>!i||a[i-1].page<r.page));
 }assert.ok(count>200000);
});

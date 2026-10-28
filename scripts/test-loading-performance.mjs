import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {gunzipSync}from 'node:zlib';
import {fetchChunkedBytes} from '../src/chunked-transport.js';import {frozenTransports}from '../src/frozen-transports.js';
import {loadAnnotationTaskCorpus}from '../src/annotation-task-corpus.js';import{loadAnnotationCorpus,bindCorpusProgress,standardProgressKey}from'../src/annotation-corpus.js';
import {emptyChapterProgress,confirmChapter,chapterIsConfirmed}from'../src/chapter-annotation-core.js';
const read=path=>fs.readFile(new URL('../'+path.replace(/^\.\//,'').split('?')[0],import.meta.url));const fetcher=async path=>new Response(await read(path));
const storage=raw=>({getItem:key=>key===standardProgressKey?raw:null});
test('all parallel transports reassemble the exact approved source bytes with bounded part sizes',async()=>{
 for(const [file,entry]of Object.entries(frozenTransports)){assert.ok(entry.parts.every(p=>p.bytes<=128*1024));const bytes=await fetchChunkedBytes(file,{fetcher});assert.ok(gunzipSync(bytes).equals(await read(file)));}
});
test('cold task list loads only its small verified catalogue and keeps the original complete chapter scopes',async()=>{
 const calls=[],corpus=await loadAnnotationTaskCorpus('',storage(null),{fetcher:async path=>{calls.push(path);return fetcher(path);}}),original=JSON.parse(await read('annotation-data/wolai-standard.json'));
 assert.equal(corpus.catalogueOnly,true);assert.deepEqual(corpus.index,original.index);assert.equal(corpus.pages.reduce((n,p)=>n+p.candidateCount,0),original.pages.reduce((n,p)=>n+p.candidates.length,0));assert.deepEqual(calls,['./annotation-data/chapter-catalogue.json.gz?v=loading-20261028b']);assert.ok((await read('annotation-data/chapter-catalogue.json.gz')).length<130000);
 await assert.rejects(loadAnnotationTaskCorpus('',storage(null),{fetcher:async()=>new Response(JSON.stringify({version:1,revision:'wrong'}))}),/不匹配/);
});
test('existing annotations and confirmations load and validate the complete original corpus before showing progress',async()=>{
 const corpus=await loadAnnotationCorpus('',{fetcher}),legacy={},state=bindCorpusProgress(emptyChapterProgress(),corpus),chapter=corpus.index.chapters.find(c=>c.fragments.length),confirmed=await confirmChapter(state,chapter,'隔离核验',legacy,corpus.byPage);
 const raw=JSON.stringify(confirmed),loaded=await loadAnnotationTaskCorpus('',storage(raw),{fetcher});assert.equal(loaded.partial,true);assert.equal(loaded.byPage.size,1);assert.ok(await chapterIsConfirmed(chapter,loaded.byPage,legacy,confirmed));assert.equal(JSON.stringify(confirmed),raw);
 await assert.rejects(loadAnnotationTaskCorpus('',storage('{invalid'),{fetcher}),/JSON/);
});
test('failed part retries independently, cached successes are not downloaded twice and concurrency is bounded',async()=>{
 const file='annotation-data/wolai-standard.json',entry=frozenTransports[file],counts=new Map();let active=0,max=0;
 const bytes=await fetchChunkedBytes(file,{fetcher:async(url,options)=>{assert.equal(options.cache,'default');counts.set(url,(counts.get(url)||0)+1);active++;max=Math.max(max,active);try{await new Promise(r=>setTimeout(r,2));if(url.endsWith('002.bin')&&counts.get(url)===1)return new Response('',{status:503});return fetcher(url);}finally{active--;}}});
 assert.ok(gunzipSync(bytes).equals(await read(file)));assert.ok(max<=4&&max>1);assert.equal([...counts.values()].filter(n=>n===2).length,1);assert.equal(counts.size,entry.parts.length);
});
test('corrupt or missing parts fail closed and a stalled response body is aborted before a bounded retry',async()=>{
 const file='annotation-data/wolai-standard.json';let calls=0;await assert.rejects(fetchChunkedBytes(file,{fetcher:async()=>{calls++;return new Response('bad');}}),/校验/);assert.ok(calls<=4);
 const signals=[];await assert.rejects(fetchChunkedBytes(file,{timeoutMs:10,fetcher:async(_url,options)=>{signals.push(options.signal);return {ok:true,arrayBuffer:()=>new Promise(()=>{})};}}),/超时/);assert.ok(signals.every(s=>s.aborted));assert.ok(signals.length<=8);
 let misses=0;await assert.rejects(fetchChunkedBytes(file,{fetcher:async()=>{misses++;return new Response('',{status:404});}}),/404/);assert.ok(misses<=4);
});
test('chapter body loads on demand, matches every original field and failed pages never partially attach',async()=>{
 const original=JSON.parse(await read('annotation-data/wolai-standard.json')),calls=[],corpus=await loadAnnotationTaskCorpus('',storage(null),{fetcher:async path=>{calls.push(path);return fetcher(path);}});assert.equal(corpus.byPage.size,0);const first=corpus.index.chapters.find(c=>c.fragments.length),last=corpus.index.chapters.filter(c=>c.fragments.length).at(-1);await corpus.ensureChapter(first);assert.equal(corpus.byPage.size,1);assert.deepEqual(corpus.byPage.get(first.fragments[0].page),original.pages.find(p=>p.page===first.fragments[0].page));await corpus.ensureChapter(first);assert.equal(calls.length,2);await corpus.ensureChapter(last);assert.equal(corpus.byPage.size,2);
 const broken=await loadAnnotationTaskCorpus('',storage(null),{fetcher:async path=>path.includes('standard-pages')?new Response(JSON.stringify({...original.pages[0],text:'错误正文'})):fetcher(path)});await assert.rejects(broken.ensureChapter(first),/不匹配/);assert.equal(broken.byPage.size,0);
 const full=await loadAnnotationCorpus('',{fetcher}),incoming=await confirmChapter(bindCorpusProgress(emptyChapterProgress(),full),last,'恢复测试',{},full.byPage);await corpus.ensureProgress(incoming);bindCorpusProgress(incoming,corpus);assert.ok(await chapterIsConfirmed(last,corpus.byPage,{},incoming));
});
test('review catalogue keeps exact scopes and versions and contains no adjudicated progress',async()=>{
 const value=JSON.parse(await read('comparison-data/task-catalogue.json')),allocation=JSON.parse(await read('task-allocation.json'));assert.equal(value.reviewRevision,allocation.reviewRevision);assert.equal(value.gapRevision,allocation.gapRevision);assert.equal(value.items.filter(i=>i.page!==null).length,591);assert.equal(value.items.filter(i=>i.page===null).length,1062);assert.equal(value.gapIds.length,172);assert.ok(value.items.every(i=>i.status==='pending'));assert.deepEqual(new Set(value.items.map(i=>i.id)),new Set(allocation.groups.flatMap(g=>g.comparisonIds)));assert.ok((await read('comparison-data/task-catalogue.json.gz')).length<40000);
});

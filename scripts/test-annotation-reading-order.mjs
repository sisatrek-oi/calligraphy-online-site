import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {chapterRuns,mapChapterSelection,chapterSignature} from '../src/chapter-annotation-core.js';
const corpus=JSON.parse(fs.readFileSync('annotation-data/wolai-standard.json')),by=new Map(corpus.pages.map(p=>[p.page,p])),chapter=corpus.index.chapters.find(c=>c.id==='work-008');
test('笔论 reads author, biography, introduction, title, then ancient body in original book order',()=>{
 const text=chapterRuns(chapter,by,{}).map(r=>r.text||'').join('');
 const parts=['蔡 邕','蔡邕（一三三年','能总结前人','熹平四年','《 笔论》','笔论\n','书者，散也','夫书，先默坐','为书之体'];let cursor=-1;
 for(const part of parts){const at=text.indexOf(part,cursor+1);assert.ok(at>cursor,part+' must follow previous source passage');cursor=at;}
});
import {pdfReadingOrder} from '../src/annotation-pdf-order-data.js';
import {chapterFragmentView,chapterAnnotationFiles} from '../src/annotation-chapters.js';
import {emptyChapterProgress,applyChapterSelection,effectiveChapterProgress,confirmChapter,chapterIsConfirmed,mergeChapterBackup,validateChapterProgress} from '../src/chapter-annotation-core.js';
import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const hash=s=>createHash('sha256').update(s).digest('hex'),legacy=Object.fromEntries([1,2,3,4].map(part=>[part,{version:1,part,person:'',reviews:{}}]));
test('PDF mapping preserves every original source UTF16 unit exactly once without preserving the erroneous Wolai order',()=>{
 assert.equal(Object.keys(pdfReadingOrder.plans).length,256);
 for(const c of corpus.index.chapters)for(const f of c.fragments){const p=by.get(f.page),before=JSON.stringify(p),v=chapterFragmentView(f,by);assert.equal(hash(p.text),f.textSha256);let at=f.start;for(const b of v.blocks.slice().sort((a,b)=>a.start-b.start)){assert.equal(b.start,at);at=b.end;}assert.equal(at,f.end);assert.equal(JSON.stringify(p),before);}
});
test('reordered title/body selection maps decreasing source coordinates without including intervening biography',async()=>{
 const runs=chapterRuns(chapter,by,{}),a=runs.find(r=>r.start===534),z=runs.find(r=>r.start===5),spans=mapChapterSelection(runs,a.id,0,z.id,6,by);assert.deepEqual(spans.map(s=>s.start),[534,5]);assert.deepEqual(spans.map(s=>s.quote),['笔论\n','书者，散也。']);
 const initial=emptyChapterProgress(),added=applyChapterSelection(initial,chapter,spans,'add','测试',legacy,by),deleted=applyChapterSelection(added,chapter,spans,'delete','测试',legacy,by);validateChapterProgress(deleted,by);assert.equal(deleted.events.length,2);assert.ok(deleted.events.every(e=>e.spans.every(s=>s.start>=534||s.end<=11)));const restored=mergeChapterBackup(emptyChapterProgress(),JSON.parse(JSON.stringify(deleted)),by);assert.deepEqual(restored.pages,deleted.pages);
 const effective=effectiveChapterProgress(legacy,deleted,by),view=chapterFragmentView(chapter.fragments[0],by,effective);assert.ok(view.aiCandidates[0].remaining.every(r=>r.start>=11));assert.equal(view.aiCandidates[1].remaining[0].start,49);
 const confirmed=await confirmChapter(deleted,chapter,'测试',legacy,by);assert.equal(await chapterIsConfirmed(chapter,by,legacy,confirmed),true);
});
test('pre-fix confirmation signatures remain valid because only presentation order changes',async()=>{
 const state=emptyChapterProgress(),p=by.get(20003),f=chapter.fragments[0],view=chapterFragmentView(f,by,{}),old=hash(JSON.stringify({id:chapter.id,fragments:[[f.page,f.start,f.end,f.textSha256,p.candidates,[],view.aiCandidates.map(c=>[c.id,c.remaining.map(r=>[Math.max(r.start,f.start),Math.min(r.end,f.end)]).filter(([a,z])=>a<z)]),[]]],gaps:[]}));assert.equal(await chapterSignature(chapter,by,legacy,state),old);
 state.confirmations[chapter.id]={signature:old,by:'既有审核人',at:'2026-10-27T00:00:00Z',scope:'available-chapter'};assert.equal(await chapterIsConfirmed(chapter,by,legacy,state),true);
});
test('HTML/TXT/JSON reading exports use restored order and still carry raw source text and offsets',()=>{
 const full=corpus.index,idx={...full,eligiblePages:1,works:full.works.filter(w=>w.id===chapter.workId),chapters:[chapter],pageToChapters:{20003:['work-008']}},files=chapterAnnotationFiles(idx,new Map([[20003,by.get(20003)]]));
 for(const file of files.filter(f=>f.name.endsWith('.txt')||f.name.endsWith('.html'))){assert.ok(file.content.indexOf('蔡邕（一三三年')<file.content.indexOf('书者，散也'));}
 const json=JSON.parse(files.find(f=>f.name==='章节整理.json').content).chapters[0].fragments[0];assert.equal(json.text,by.get(20003).text);assert.equal(json.textSha256,by.get(20003).source.textSha256);assert.equal(json.blocks.find(b=>b.text.startsWith('书者')).start,5);
});
test('display order can be rebuilt from frozen evidence without changing the approved corpus',()=>{assert.match(execFileSync('python3',['scripts/build-pdf-reading-order.py','--check'],{encoding:'utf8'}),/"records": 3431/);});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateStandardCorpus,bindCorpusProgress} from '../src/annotation-corpus.js';
import {chapterIsConfirmed,effectiveChapterProgress} from '../src/chapter-annotation-core.js';
import {annotationBatches} from '../src/task-allocation.js';
import {returnedProgress} from '../src/returned-progress.js';
import {returnedProgressText} from '../src/task-allocation-cards.js';
import {validateComparison,validateRecheck,emptyRecheck} from '../src/annotation-compare-core.js';
import {pageComparison} from '../src/annotation-compare-pages.js';
import {validateGaps,validateGapState} from '../src/annotation-gaps-core.js';
const read=async file=>JSON.parse(await fs.readFile(new URL('../'+file,import.meta.url),'utf8'));
test('published delivery hashes, current bindings and allocation counts agree',async()=>{
 assert.deepEqual(await read('returned-data/progress.json'),returnedProgress);
 for(const f of returnedProgress.files)assert.equal(createHash('sha256').update(await fs.readFile(new URL('../'+f.file,import.meta.url))).digest('hex'),f.sha256);
 const ci=await read('comparison-data/index.json'),gi=await read('comparison-data/pdf-gaps-index.json');
 assert.equal(ci.sha256,returnedProgress.reviewRevision);assert.equal(gi.sha256,returnedProgress.gapRevision);
 const model=pageComparison(await validateComparison(await read(ci.file)),emptyRecheck(ci.sha256)),allocation=await read('task-allocation.json'),seen=new Set();
 for(const id of ['D','F','G']){
  const state=validateRecheck(await read(`returned-data/2026-11-01/${id}-review.json`),ci.sha256,model),g=allocation.groups.find(g=>g.id===id),r=Object.values(state.records),summary=returnedProgress.groups[id];
  for(const record of r){assert(g.comparisonIds.includes(record.id));assert(!seen.has(record.id));seen.add(record.id);}
  assert.equal(summary.records,r.length);assert.equal(summary.deferred,r.filter(x=>x.choice==='defer').length);
  assert.equal(summary.pages,r.filter(x=>x.id.startsWith('P')&&x.choice!=='defer').length);assert.equal(summary.unlocated,r.filter(x=>!x.id.startsWith('P')&&x.choice!=='defer').length);
  assert.equal(summary.openGlyphNotes,r.flatMap(x=>x.glyphNotes||[]).filter(x=>x.status==='open').length);
 }
 const gaps=validateGapState(await read('returned-data/2026-11-01/G-gaps.json'),gi.sha256,await validateGaps(await read(gi.file)));
 assert.equal(returnedProgress.groups.G.gaps,Object.values(gaps.records).filter(r=>r.choice!=='defer').length);
 assert.match(returnedProgressText(allocation.groups[0]),/存疑 1 条/);
 assert.match(returnedProgressText(allocation.groups[1]),/尚未收到/);
 assert.equal(returnedProgressText({id:'B'},{annotation:true,corpusSuffix:'&corpus=legacy'}),'');
});

test('returned chapter confirmations bind current standard chapter signatures',async()=>{
 const corpus=await validateStandardCorpus(await read('annotation-data/wolai-standard.json')),state=bindCorpusProgress(await read('returned-data/2026-11-01/B-chapters.json'),corpus),legacy=state.legacyArchive;
 effectiveChapterProgress(legacy,state,corpus.byPage);
 const batch=annotationBatches(corpus).find(g=>g.id==='B'),confirmed=corpus.index.chapters.filter(c=>state.confirmations[c.id]);
 for(const chapter of confirmed){assert(batch.chapterIds.includes(chapter.id));assert(await chapterIsConfirmed(chapter,corpus.byPage,legacy,state));}
 assert.equal(confirmed.length,returnedProgress.groups.B.chapters);assert.equal(batch.chapterIds.length,returnedProgress.groups.B.total);
});

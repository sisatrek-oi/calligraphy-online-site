import {pdfChapterIndex} from './annotation-pdf-order.js';
import {loadAnnotationCorpus,corpusMode,standardProgressKey,corpusDigest} from './annotation-corpus.js?v=loading-20261028b';
import {readChapterProgress} from './chapter-annotation-core.js?v=loading-20261028';
import {readJson} from './screening-loader.js?v=loading-20261028';
import {validateReviewedPart} from './reviewed-annotation.js?v=loading-20261028';
import {validateChapterIndex} from './annotation-chapters.js?v=loading-20261028';
import {catalogueSha256,catalogueSourceSha256} from './task-catalogue-revision.js?v=loading-20261028b';
// The complete index is pinned to the approved corpus. Each source object is independently pinned,
// so only the current chapter and the sources required to validate existing records need downloading.
export async function loadAnnotationTaskCorpus(search,storage,options){
 if(corpusMode(search)==='legacy')return loadAnnotationCorpus(search,options);
 const value=await readJson('./annotation-data/chapter-catalogue.json?v=loading-20261028b',{...options,preferGzip:true});
 if(await corpusDigest(value)!==catalogueSha256||value.sourceSha256!==catalogueSourceSha256)throw Error('章节目录与审核版本不匹配，原记录保留。');
 const index=pdfChapterIndex(value.index);const byPage=new Map(),entries=new Map(value.pages.map(p=>[p.page,p])),requests=new Map();
 validateChapterIndex(index,new Map(value.pages.map(p=>[p.page,{eligible:p.eligible,part:p.part,source:{textSha256:p.textSha256},text:{length:p.textLength}}])));
 async function load(page){
  if(byPage.has(page))return byPage.get(page);const entry=entries.get(page);if(!entry)throw Error('记录中的来源不属于当前审核语料，原记录保留。');
  if(!requests.has(page))requests.set(page,(async()=>{let p;for(let attempt=0;attempt<2;attempt++){try{p=await readJson('./'+entry.file,{...options,preferGzip:true});break;}catch(error){if(attempt||!/超时|HTTP 5\d\d|fetch|NetworkError|network/i.test(error.message))throw error;}}if(await corpusDigest(p)!==entry.sha256)throw Error('本章正文与原审核版本不匹配，原记录保留。');await validateReviewedPart({...value.header,pages:[p]},1);return p;})().catch(e=>{requests.delete(page);throw e;}));
  return requests.get(page);
 }
 async function ensurePages(pages){const ids=[...new Set(pages)],loaded=[];let next=0;await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];loaded.push([id,await load(id)]);}}));for(const [id,p]of loaded)byPage.set(id,p);}
 async function ensureProgress(state){const ids=[...Object.keys(state.pages).map(Number),...state.events.flatMap(e=>e.spans.map(s=>s.page)),...Object.keys(state.confirmations).flatMap(id=>index.chapters.find(c=>c.id===id)?.fragments.map(f=>f.page)||[])];await ensurePages(ids);}
 const state=readChapterProgress(storage,undefined,standardProgressKey).value;await ensureProgress(state);
 return {partial:true,catalogueOnly:byPage.size===0,mode:'wolai-standard',label:'wolai标准正文',key:standardProgressKey,index,allocationIndex:value.index,pages:value.pages,byPage,data:{revision:value.revision},ensureProgress,ensureChapter:chapter=>ensurePages(chapter.fragments.map(f=>f.page))};
}

import {loadAnnotationCorpus,corpusMode,standardProgressKey,corpusDigest} from './annotation-corpus.js?v=loading-20261028';
import {readChapterProgress} from './chapter-annotation-core.js?v=loading-20261028';
import {readJson} from './screening-loader.js?v=loading-20261028';
import {catalogueSha256,catalogueSourceSha256} from './task-catalogue-revision.js?v=loading-20261028';
// The read-only catalogue suffices when there are no annotations or confirmations to verify.
// Editing/export and every existing progress record still use the complete approved corpus.
export async function loadAnnotationTaskCorpus(search,storage,options){
 if(corpusMode(search)==='legacy')return loadAnnotationCorpus(search,options);
 const state=readChapterProgress(storage,undefined,standardProgressKey).value;
 if(Object.keys(state.pages).length||Object.keys(state.confirmations).length||state.events.some(e=>e.spans.length))return loadAnnotationCorpus(search,options);
 const value=await readJson('./annotation-data/task-catalogue.json?v=loading-20261028',{...options,preferGzip:true});
 if(await corpusDigest(value)!==catalogueSha256||value.sourceSha256!==catalogueSourceSha256)throw Error('章节目录与审核版本不匹配，原记录保留。');
 return {catalogueOnly:true,mode:'wolai-standard',label:'wolai标准正文',key:standardProgressKey,index:value.index,pages:value.pages,byPage:new Map(),data:{revision:value.revision}};
}

import {validateComparison,digestText,comparisonNeedsReview} from '../src/annotation-compare-core.js';
import {pageComparison} from '../src/annotation-compare-pages.js';
import {validateGaps} from '../src/annotation-gaps-core.js';
import {validateBatchCoverage} from '../src/task-allocation.js';
import {validateStandardCorpus} from '../src/annotation-corpus.js';
import fs from 'node:fs/promises';import {createHash}from 'node:crypto';import {gzipSync}from 'node:zlib';
const root=new URL('../',import.meta.url),check=process.argv.includes('--check'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function output(path,bytes){const url=new URL(path,root);if(check){if(!(await fs.readFile(url)).equals(Buffer.from(bytes)))throw Error('Rebuild loading assets: '+path);}else{await fs.mkdir(new URL('.',url),{recursive:true});await fs.writeFile(url,bytes);}}
const standard=JSON.parse(await fs.readFile(new URL('annotation-data/wolai-standard.json',root)));await validateStandardCorpus(standard);
const pages=[];
for(const p of standard.pages){const text=JSON.stringify(p),hash=sha(text),file='annotation-data/standard-pages/'+p.page+'-'+hash+'.json';await output(file,text);await output(file+'.gz',gzipSync(text,{level:9}));pages.push({page:p.page,part:p.part,eligible:p.eligible,candidateCount:p.candidates.length,textLength:p.text.length,textSha256:p.source.textSha256,file,sha256:hash});}
const catalogue={version:1,sourceSha256:standard.approval.corpusSha256,revision:standard.revision,header:{version:standard.version,batch:standard.batch,part:standard.part,revision:standard.revision},index:standard.index,pages};
const catalogueText=JSON.stringify(catalogue);await output('annotation-data/chapter-catalogue.json',catalogueText);await output('annotation-data/chapter-catalogue.json.gz',gzipSync(catalogueText,{level:9}));
const reviewIndex=JSON.parse(await fs.readFile(new URL('comparison-data/index.json',root))),gapIndex=JSON.parse(await fs.readFile(new URL('comparison-data/pdf-gaps-index.json',root)));
const reviewText=await fs.readFile(new URL(reviewIndex.file,root),'utf8'),gapText=await fs.readFile(new URL(gapIndex.file,root),'utf8');if(await digestText(reviewText)!==reviewIndex.sha256||await digestText(gapText)!==gapIndex.sha256)throw Error('Frozen review source changed.');
const review=pageComparison(await validateComparison(JSON.parse(reviewText)),{records:{}}),gaps=await validateGaps(JSON.parse(gapText)),groups=JSON.parse(await fs.readFile(new URL('task-allocation.json',root))).groups;validateBatchCoverage(groups,review.data.items,'comparison');validateBatchCoverage(groups,gaps.data.items,'gaps');
const reviewCatalogue={version:1,reviewRevision:reviewIndex.sha256,gapRevision:gapIndex.sha256,aliases:[...review.aliases],gapIds:gaps.data.items.map(i=>({id:i.id})),items:review.data.items.filter(comparisonNeedsReview).map(i=>({id:i.id,page:i.page,workId:i.workId,work:i.work,works:i.works,kinds:i.kinds,kind:i.kind,title:i.page!==null?'第 '+i.page+' 页 · 整页TXT · '+i.differences.length+' 处提示':i.id+' · 待定位',status:'pending'}))};
const reviewCatalogueText=JSON.stringify(reviewCatalogue);await output('comparison-data/task-catalogue.json',reviewCatalogueText);await output('comparison-data/task-catalogue.json.gz',gzipSync(reviewCatalogueText,{level:9}));
await output('src/task-catalogue-revision.js',`// Generated from unchanged verified sources by build-loading-assets.mjs.
export const catalogueSha256='${sha(catalogueText)}';
export const catalogueSourceSha256='${standard.approval.corpusSha256}';
export const reviewCatalogueSha256='${sha(reviewCatalogueText)}';
`);
const transports={};
for(const file of ['annotation-data/wolai-standard.json','comparison-data/wolai-human.json','comparison-data/pdf-gaps.json']){
 const bytes=await fs.readFile(new URL(file+'.gz',root)),hash=sha(bytes),parts=[];
 for(let i=0;i<bytes.length;i+=128*1024){const part=bytes.subarray(i,i+128*1024),path=file+'.parts/'+hash+'/'+String(parts.length).padStart(3,'0')+'.bin';await output(path,part);parts.push({file:path,bytes:part.length,sha256:sha(part)});}
 transports[file]={bytes:bytes.length,sha256:hash,parts};
}
await output('src/frozen-transports.js','// Generated transport parts; source JSON and gzip bytes are unchanged.\nexport const frozenTransports='+JSON.stringify(transports)+';\n');
console.log(check?'Loading assets match sources.':'Loading assets built.');

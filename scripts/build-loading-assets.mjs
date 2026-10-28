import {validateStandardCorpus} from '../src/annotation-corpus.js';
import fs from 'node:fs/promises';import {createHash}from 'node:crypto';import {gzipSync}from 'node:zlib';
const root=new URL('../',import.meta.url),check=process.argv.includes('--check'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function output(path,bytes){const url=new URL(path,root);if(check){if(!(await fs.readFile(url)).equals(Buffer.from(bytes)))throw Error('Rebuild loading assets: '+path);}else{await fs.mkdir(new URL('.',url),{recursive:true});await fs.writeFile(url,bytes);}}
const standard=JSON.parse(await fs.readFile(new URL('annotation-data/wolai-standard.json',root)));await validateStandardCorpus(standard);
const catalogue={version:1,sourceSha256:standard.approval.corpusSha256,revision:standard.revision,index:standard.index,pages:standard.pages.map(p=>({page:p.page,part:p.part,eligible:p.eligible,candidateCount:p.candidates.length}))};
const catalogueText=JSON.stringify(catalogue);await output('annotation-data/task-catalogue.json',catalogueText);await output('annotation-data/task-catalogue.json.gz',gzipSync(catalogueText,{level:9}));
await output('src/task-catalogue-revision.js',`// Generated from the unchanged approved corpus by build-loading-assets.mjs.\nexport const catalogueSha256='${sha(catalogueText)}';\nexport const catalogueSourceSha256='${standard.approval.corpusSha256}';\n`);
const transports={};
for(const file of ['annotation-data/wolai-standard.json','comparison-data/wolai-human.json','comparison-data/pdf-gaps.json']){
 const bytes=await fs.readFile(new URL(file+'.gz',root)),hash=sha(bytes),parts=[];
 for(let i=0;i<bytes.length;i+=128*1024){const part=bytes.subarray(i,i+128*1024),path=file+'.parts/'+hash+'/'+String(parts.length).padStart(3,'0')+'.bin';await output(path,part);parts.push({file:path,bytes:part.length,sha256:sha(part)});}
 transports[file]={bytes:bytes.length,sha256:hash,parts};
}
await output('src/frozen-transports.js','// Generated transport parts; source JSON and gzip bytes are unchanged.\nexport const frozenTransports='+JSON.stringify(transports)+';\n');
console.log(check?'Loading assets match sources.':'Loading assets built.');

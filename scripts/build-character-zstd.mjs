// Node.js 24+: build a lossless fast transport; original gzip stays available to older readers.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {gunzipSync,zstdCompress,constants} from 'node:zlib';
import assert from 'node:assert/strict';
import {decompress} from '../proofread/vendor/fzstd-0.1.1.mjs';
const root=new URL('../proofread/',import.meta.url),index=JSON.parse(await readFile(new URL('index.json',root),'utf8')),compress=promisify(zstdCompress),sha=data=>createHash('sha256').update(data).digest('hex');
let cursor=0,complete=0,gzipBytes=0,fastBytes=0;
await Promise.all(Array.from({length:2},async()=>{
 while(cursor<index.chapters.length){const entry=index.chapters[cursor++],t=entry.transport,pieces=[];
  for(const chunk of t.chunks){const bytes=await readFile(new URL(chunk.file,root));assert.equal(bytes.length,chunk.bytes);assert.equal(sha(bytes),chunk.sha256);pieces.push(bytes);}
  const gzip=Buffer.concat(pieces);assert.equal(sha(gzip),t.sha256);const raw=gunzipSync(gzip);assert.equal(raw.length,t.decodedBytes);assert.equal(sha(raw),entry.sha256);
  const packed=await compress(raw,{pledgedSrcSize:raw.length,params:{[constants.ZSTD_c_compressionLevel]:19,[constants.ZSTD_c_windowLog]:25}});
  assert((packed[4]>>6)||(packed[4]&32),'Frame must declare its content size before browser allocation');
  // Verify with the exact independent decoder shipped to browsers, not only the compressor.
  const decoded=decompress(packed);assert.equal(decoded.length,raw.length);assert.equal(sha(decoded),entry.sha256);
  const chunks=[];for(let offset=0;offset<packed.length;offset+=128*1024){const bytes=packed.subarray(offset,offset+128*1024),hash=sha(bytes),file=`chapters/${hash}.zstpart`;await writeFile(new URL(file,root),bytes);chunks.push({file,bytes:bytes.length,sha256:hash});}
  entry.fastTransport={encoding:'zstd',bytes:packed.length,sha256:sha(packed),decodedBytes:raw.length,chunks};gzipBytes+=gzip.length;fastBytes+=packed.length;
  if(++complete%20===0)console.log(JSON.stringify({complete,gzipBytes,fastBytes}));
 }
}));
const temporary=new URL('index.json.tmp',root);await writeFile(temporary,JSON.stringify(index));
const{rename}=await import('node:fs/promises');await rename(temporary,new URL('index.json',root));
console.log(JSON.stringify({chapters:complete,gzipBytes,fastBytes,allOriginalShaMatched:true}));

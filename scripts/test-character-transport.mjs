import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadChapter} from '../proofread/transport.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('chapter transport preserves exact UTF-16 text, source geometry and version; rejects corrupt content',async()=>{
 const originalFetch=globalThis.fetch,source={text:'𠮷\r\n书',parts:[{sourceGlyphs:[{id:'glyph-1',box:[11,22,33,44]}]}]},raw=Buffer.from(JSON.stringify(source)),gz=gzipSync(raw),chunks=[gz.subarray(0,13),gz.subarray(13)];
 const entry={file:'old.json',sha256:hash(raw),transport:{encoding:'gzip',bytes:gz.length,sha256:hash(gz),decodedBytes:raw.length,chunks:chunks.map((b,i)=>({file:`${i}.part`,bytes:b.length,sha256:hash(b)}))}};
 try{
  let retry=0;globalThis.fetch=async url=>{const i=Number(new URL(url).pathname.slice(1).split('.')[0]);if(i===0&&!retry++)throw Error('temporary connection failure');return new Response(chunks[i]);};
  assert.deepEqual(await loadChapter(entry,'https://test.invalid/'),source);assert.equal(retry,2);
  const bad=structuredClone(entry);bad.transport.chunks[0].sha256='0'.repeat(64);await assert.rejects(loadChapter(bad,'https://test.invalid/'),/分块校验失败/);
  const stale=structuredClone(entry);stale.sha256='0'.repeat(64);await assert.rejects(loadChapter(stale,'https://test.invalid/'),/版本校验失败/);
  const short=structuredClone(entry);short.transport.decodedBytes++;await assert.rejects(loadChapter(short,'https://test.invalid/'),/解压长度不匹配/);
  globalThis.fetch=async()=>new Response(raw);assert.deepEqual(await loadChapter({file:'old.json',sha256:hash(raw)},'https://test.invalid/'),source);
 }finally{globalThis.fetch=originalFetch;}
});
test('fast Zstandard transport restores exact original bytes and rejects mismatched versions',async()=>{
 const previousFetch=globalThis.fetch,source={text:'𠮷\r\n书',parts:[{sourceGlyphs:[{id:'glyph-1',box:[11,22,33,44]}]}]},raw=Buffer.from(JSON.stringify(source));
 // Independent precompressed fixture; does not require a native Zstandard compressor to test readers.
 const packed=Buffer.from('KLUv/SBYwQIAeyJ0ZXh0Ijoi8KCut1xyXG7kuaYiLCJwYXJ0cyI6W3sic291cmNlR2x5cGhzIjpbeyJpZCI6ImdseXBoLTEiLCJib3giOlsxMSwyMiwzMyw0NF19XX1dfQ==','base64'),gzip=gzipSync(raw);
 const transport=(data,encoding,file)=>({encoding,bytes:data.length,sha256:hash(data),decodedBytes:raw.length,chunks:[{file,bytes:data.length,sha256:hash(data)}]});
 const entry={sha256:hash(raw),transport:transport(gzip,'gzip','legacy.part'),fastTransport:transport(packed,'zstd','fast.part')};
 try{
  globalThis.fetch=async url=>{assert.equal(new URL(url).pathname,'/fast.part');return new Response(packed);};
  assert.deepEqual(await loadChapter(entry,'https://fast.test/'),source);assert.equal(source.text.length,5);
  await assert.rejects(loadChapter({...entry,sha256:'0'.repeat(64)},'https://fast.test/'),/版本校验失败/);
  const broken=structuredClone(entry);broken.fastTransport.chunks[0].sha256='0'.repeat(64);await assert.rejects(loadChapter(broken,'https://fast.test/'),/分块校验失败/);
  const oversized=structuredClone(entry);oversized.fastTransport.decodedBytes++;await assert.rejects(loadChapter(oversized,'https://fast.test/'),/解压长度不匹配/);
 }finally{globalThis.fetch=previousFetch;}
});

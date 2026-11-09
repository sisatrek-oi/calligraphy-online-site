import {readCompressed,saveCompressed} from './transport-cache.mjs?v=chapter-loading-20261109';
import {decompress as decodeZstd} from './vendor/fzstd-0.1.1.mjs';
// Transport packaging never changes the original chapter bytes or version binding.
const baseURL=new URL('./',import.meta.url);
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
function decodeSizedZstd(data,size){
 if(data[0]!==0x28||data[1]!==0xb5||data[2]!==0x2f||data[3]!==0xfd)throw Error('章节压缩格式无效。');
 const flag=data[4],single=(flag>>5)&1,kind=flag>>6,length=kind?1<<kind:single,offset=6-single;
 // Our builder writes one sized frame without an external dictionary. Bound allocation before decoding.
 if(flag&11||!length||offset+length>data.length)throw Error('章节压缩头无效。');
 let declared=kind===1?256:0;for(let i=0;i<length;i++)declared+=data[offset+i]*256**i;
 if(declared!==size)throw Error('章节解压长度不匹配。');
 // fzstd's optional output-buffer path coerces large typed arrays; its own allocator avoids that peak.
 return decodeZstd(data);
}
async function bytes(file,base){
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(new URL(file,base),{signal:controller.signal});if(!response.ok)throw Error(`章节资源读取失败（${response.status}）。`);return new Uint8Array(await response.arrayBuffer());}
  catch(error){if(attempt)throw error;}finally{clearTimeout(timer);}
 }
}
export async function loadChapter(entry,base=baseURL){
 let raw,key,compressed;
 if(entry.transport){
  const choices=entry.fastTransport?[entry.fastTransport,entry.transport]:[entry.transport];let t=choices[0];
  for(const candidate of choices){
   if(!['gzip','zstd'].includes(candidate.encoding)||!Array.isArray(candidate.chunks)||!candidate.chunks.length||!Number.isSafeInteger(candidate.bytes)||candidate.bytes<1||candidate.bytes>100*1024*1024||!Number.isSafeInteger(candidate.decodedBytes)||candidate.decodedBytes<1||candidate.decodedBytes>200*1024*1024||candidate.chunks.reduce((n,c)=>n+c.bytes,0)!==candidate.bytes)throw Error('章节资源清单无效。');
   const cached=await readCompressed(candidate.sha256);
   // Reuse an already verified gzip copy instead of downloading the newer encoding again.
   if(cached instanceof Uint8Array&&cached.length===candidate.bytes&&await sha(cached)===candidate.sha256){t=candidate;compressed=cached;break;}
  }
  key=t.sha256;
  if(!compressed){const chunks=new Array(t.chunks.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,chunks.length)},async()=>{
   while(cursor<chunks.length){const i=cursor++,c=t.chunks[i],data=await bytes(c.file,base);if(data.length!==c.bytes||await sha(data)!==c.sha256)throw Error('章节分块校验失败，已停止载入。');chunks[i]=data;}
  }));
  compressed=new Uint8Array(t.bytes);let offset=0;for(const chunk of chunks){compressed.set(chunk,offset);offset+=chunk.length;}
  }
  if(await sha(compressed)!==t.sha256)throw Error('章节压缩包校验失败。');
  if(t.encoding==='zstd')raw=decodeSizedZstd(compressed,t.decodedBytes);
  else{if(typeof DecompressionStream!=='function')throw Error('当前浏览器不支持章节解压，请更新浏览器。');raw=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());}
  if(raw.length!==t.decodedBytes)throw Error('章节解压长度不匹配。');
 }else raw=await bytes(entry.file,base);
 if(await sha(raw)!==entry.sha256)throw Error('本章版本校验失败，已停止载入。');
 const chapter=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(compressed)await saveCompressed(key,compressed);
 return chapter;
}

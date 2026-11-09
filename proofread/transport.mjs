// Transport packaging never changes the original chapter bytes or version binding.
const baseURL=new URL('./',import.meta.url);
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function bytes(file,base){
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(new URL(file,base),{signal:controller.signal});if(!response.ok)throw Error(`章节资源读取失败（${response.status}）。`);return new Uint8Array(await response.arrayBuffer());}
  catch(error){if(attempt)throw error;}finally{clearTimeout(timer);}
 }
}
export async function loadChapter(entry,base=baseURL){
 let raw;
 if(entry.transport){
  const t=entry.transport;
  if(t.encoding!=='gzip'||!Array.isArray(t.chunks)||!t.chunks.length||!Number.isSafeInteger(t.bytes)||t.bytes<1||t.bytes>100*1024*1024||!Number.isSafeInteger(t.decodedBytes)||t.decodedBytes>200*1024*1024||t.chunks.reduce((n,c)=>n+c.bytes,0)!==t.bytes)throw Error('章节资源清单无效。');
  const chunks=new Array(t.chunks.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,chunks.length)},async()=>{
   while(cursor<chunks.length){const i=cursor++,c=t.chunks[i],data=await bytes(c.file,base);if(data.length!==c.bytes||await sha(data)!==c.sha256)throw Error('章节分块校验失败，已停止载入。');chunks[i]=data;}
  }));
  const compressed=new Uint8Array(t.bytes);let offset=0;for(const chunk of chunks){compressed.set(chunk,offset);offset+=chunk.length;}
  if(await sha(compressed)!==t.sha256)throw Error('章节压缩包校验失败。');
  if(typeof DecompressionStream!=='function')throw Error('当前浏览器不支持章节解压，请更新浏览器。');
  raw=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(raw.length!==t.decodedBytes)throw Error('章节解压长度不匹配。');
 }else raw=await bytes(entry.file,base);
 if(await sha(raw)!==entry.sha256)throw Error('本章版本校验失败，已停止载入。');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
}

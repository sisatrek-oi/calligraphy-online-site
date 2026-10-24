// Compression changes transport only; callers still hash the exact original JSON text.
export async function fetchReviewText(file,revision,{request=globalThis.fetch,Inflate=globalThis.DecompressionStream}={}){
 if(typeof file!=='string'||!file.endsWith('.json')||!/^[a-f0-9]{64}$/.test(revision))throw Error('审核材料地址或版本无效。');
 const suffix='?revision='+revision,compressed=typeof Inflate==='function';
 let response=await request(file+(compressed?'.gz':'')+suffix,{cache:'no-cache'});
 if(compressed&&response.status===404)response=await request(file+suffix,{cache:'no-cache'});
 if(!response.ok)throw Error('审核正文读取失败（'+response.status+'），请重新读取。');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]===0x1f&&bytes[1]===0x8b){
  if(!compressed)throw Error('当前浏览器无法解压审核材料。');
  return new Response(new Blob([bytes]).stream().pipeThrough(new Inflate('gzip'))).text();
 }
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

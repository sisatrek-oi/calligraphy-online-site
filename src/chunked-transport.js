import {frozenTransports} from './frozen-transports.js?v=loading-20261028';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
// Each small immutable part has its own deadline; successful parts use the HTTP cache on retry.
export async function fetchChunkedBytes(url,{fetcher=fetch,timeoutMs=15000,signal}={}){
 const entry=frozenTransports[url.split('?')[0].replace(/^\.\//,'')];if(!entry)return null;
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let next=0;const parts=Array(entry.parts.length);
 async function load(part){
  for(let attempt=0;attempt<2;attempt++){
   const requestController=new AbortController(),stop=()=>requestController.abort();controller.signal.addEventListener('abort',stop,{once:true});let timer;
   try{
    if(controller.signal.aborted)throw Error('材料读取已取消。');
    const bytes=await Promise.race([(async()=>{const response=await fetcher('./'+part.file,{cache:'default',signal:requestController.signal});if(!response.ok){const error=Error('材料读取失败（HTTP '+response.status+'）');error.retryable=response.status>=500;throw error;}return new Uint8Array(await response.arrayBuffer());})(),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('材料读取超时，请检查网络后重试'));requestController.abort();},timeoutMs);})]);
    if(bytes.length!==part.bytes||await digest(bytes)!==part.sha256){const error=Error('材料分块校验失败，原记录保留。');error.retryable=false;throw error;}
    return bytes;
   }catch(error){if(attempt||controller.signal.aborted||error.retryable===false)throw error;}
   finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
  }
 }
 try{
  await Promise.all(Array.from({length:Math.min(4,entry.parts.length)},async()=>{while(next<entry.parts.length){const i=next++;parts[i]=await load(entry.parts[i]);}}));
  const bytes=new Uint8Array(entry.bytes);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}if(offset!==entry.bytes||await digest(bytes)!==entry.sha256)throw Error('材料传输校验失败，原记录保留。');return bytes;
 }finally{controller.abort();signal?.removeEventListener('abort',abort);}
}

// Disposable, verified compressed chapters only; never use the draft databases.
const budget=20*1024*1024;let pending;
async function database(){
 if(!pending)pending=new Promise((resolve,reject)=>{
  const request=globalThis.indexedDB.open('shulun-character-transport-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('chapters',{keyPath:'id'});
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();pending=null;};resolve(db);};
  request.onerror=request.onblocked=()=>reject(Error('Transport cache unavailable'));
 });return pending;
}
export async function readCompressed(id){
 try{const db=await database();return await new Promise((resolve,reject)=>{
  const request=db.transaction('chapters').objectStore('chapters').get(id);
  request.onsuccess=()=>resolve(request.result?.data||null);request.onerror=()=>reject(request.error);
 });}catch{return null;}
}
export async function saveCompressed(id,data){
 if(data.byteLength>budget)return;
 try{const db=await database();await new Promise((resolve,reject)=>{
  const tx=db.transaction('chapters','readwrite'),store=tx.objectStore('chapters');
  store.put({id,data,usedAt:Date.now()});const all=store.getAll();
  all.onsuccess=()=>{let total=0;for(const record of all.result.sort((a,b)=>(b.id===id)-(a.id===id)||b.usedAt-a.usedAt)){
   const size=record.data instanceof Uint8Array?record.data.byteLength:0;if(!size||total+size>budget)store.delete(record.id);else total+=size;
  }};
  tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);
 });}catch{}
}

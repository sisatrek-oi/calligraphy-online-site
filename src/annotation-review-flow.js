// Navigation filters are independent of source identities and saved review records.
const navigationKeys=['batch','work','kind','status','q'];
export function reviewQueue(params,item){
 const explicit=params.get('queue'),queue=explicit||((item?item.page===null:params.get('kind')==='reference-only')?'unlocated':'pages');
 if(!['pages','unlocated'].includes(queue))throw Error('复核队列无效，请返回分工入口。');
 if(explicit&&item&&!inReviewQueue(item,queue))throw Error('此任务不属于当前队列，请从对应入口进入。');
 return queue;
}
export const inReviewQueue=(item,queue)=>queue==='unlocated'?item.page===null:item.page!==null;
function navigationParams(params){const q=new URLSearchParams();for(const key of navigationKeys)if(params.has(key))q.set(key,params.get(key));return q;}
export function reviewTaskHref(item,params=new URLSearchParams(),{work=params.get('work'),queue=reviewQueue(params,item),kind=params.get('kind')||'all',status=params.get('status')||'all'}={}){
 const q=navigationParams(params);q.set('item',item.id);q.set('queue',queue);q.set('kind',kind);q.set('status',status);if(work)q.set('work',work);else q.delete('work');
 return './annotation-compare.html?'+q;
}
export function reviewDirectoryHref(params,item,{gaps=false}={}){
 const q=navigationParams(params);if(item)q.set('item',item.id);
 if(!gaps){q.set('view','directory');q.set('queue',reviewQueue(params,item));}
 return (gaps?'./annotation-gap-tasks.html?':'./annotation-compare.html?')+q;
}

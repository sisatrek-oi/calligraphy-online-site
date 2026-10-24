// Presentation scopes only: source text, assignments and saved progress remain shared.
const counts={annotation:3,review:4};
export const chapterWeight=c=>Math.max(1,c.fragments.reduce((n,f)=>n+f.end-f.start,0));
export function taskBatches(index,kind){
 const count=counts[kind];if(!count)throw Error('任务类型无效。');
 const chapters=index.chapters.filter(c=>kind==='review'||c.fragments.length),n=chapters.length;
 if(n<count)throw Error('当前篇章不足以建立指定份数。');
 const sum=[0];for(const c of chapters)sum.push(sum.at(-1)+chapterWeight(c));
 // Linear partition: preserve complete chapters and minimize the heaviest batch.
 const cost=Array.from({length:count+1},()=>Array(n+1).fill(Infinity)),cut=Array.from({length:count+1},()=>Array(n+1).fill(0));cost[0][0]=0;
 for(let k=1;k<=count;k++)for(let end=k;end<=n;end++)for(let start=k-1;start<end;start++){
  const value=Math.max(cost[k-1][start],sum[end]-sum[start]);if(value<cost[k][end]){cost[k][end]=value;cut[k][end]=start;}
 }
 const ranges=[];let end=n;for(let k=count;k>0;k--){const start=cut[k][end];ranges.unshift(chapters.slice(start,end));end=start;}
 return ranges.map((cs,i)=>({id:kind+'-'+(i+1),kind,number:i+1,count,chapters:cs,weight:cs.reduce((v,c)=>v+chapterWeight(c),0)}));
}
export function taskBatchScope(index,search,kind){
 const id=new URLSearchParams(search).get('batch');if(id===null)return null;
 const batch=taskBatches(index,kind).find(b=>b.id===id);if(!batch)throw Error('分份任务无效，请返回分份任务页重新进入。');return batch;
}
export const batchQuery=batch=>batch?'&batch='+encodeURIComponent(batch.id):'';
export function transferBatch(index,search,kind,chapterId){
 if(!new URLSearchParams(search).has('batch'))return '';
 const batch=taskBatches(index,kind).find(b=>b.chapters.some(c=>c.id===chapterId));return batchQuery(batch);
}

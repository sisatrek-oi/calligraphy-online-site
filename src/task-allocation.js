// Allocation only narrows navigation. Existing source, assignment and progress records stay intact.
export const allocationRevision='task-allocation-20261028';
export function balancedRanges(weights,count,baseWeights=Array(count).fill(0)){
 if(weights.length<count||weights.some(w=>!Number.isFinite(w)||w<=0))throw Error('分工正文量无效。');
 const sum=[0];for(const w of weights)sum.push(sum.at(-1)+w);
 const target=(sum.at(-1)+baseWeights.reduce((a,b)=>a+b,0))/count,dp=Array.from({length:count+1},()=>[]);dp[0][0]={cost:0,cuts:[]};
 for(let k=1;k<=count;k++)for(let r=k;r<=weights.length;r++)for(let l=k-1;l<r;l++){
  const prev=dp[k-1][l];if(!prev)continue;const cost=Math.max(prev.cost,Math.abs(sum[r]-sum[l]+baseWeights[k-1]-target));
  if(!dp[k][r]||cost<dp[k][r].cost)dp[k][r]={cost,cuts:[...prev.cuts,r]};
 }
 const ends=dp[count][weights.length].cuts;return ends.map((end,n)=>({start:n?ends[n-1]:0,end,weight:sum[end]-sum[n?ends[n-1]:0]}));
}
export function annotationBatches(corpus){
 const chapters=(corpus.allocationIndex||corpus.index).chapters.filter(c=>c.fragments.length),weights=chapters.map(c=>corpus.index.allocationWeights?.[c.id]??c.fragments.reduce((n,f)=>n+f.end-f.start,0));
 return balancedRanges(weights,3).map((r,n)=>({id:'ABC'[n],kind:'annotation',weight:r.weight,chapterIds:chapters.slice(r.start,r.end).map(c=>c.id)}));
}
export function selectedBatch(groups,search,kind){
 const params=search instanceof URLSearchParams?search:new URLSearchParams(search),id=params.get('batch');if(!params.has('batch'))return null;
 const group=groups.find(g=>g.id===id&&g.kind===kind);if(!group)throw Error('分工份次无效，请返回任务页选择。');return group;
}
export function chapterBatchScope(corpus,search,chapters=corpus.index.chapters){
 const batch=selectedBatch(annotationBatches(corpus),search,'annotation');if(!batch)return chapters;
 const ids=new Set(batch.chapterIds);return chapters.filter(c=>ids.has(c.id));
}
export function batchSuffix(search){const params=search instanceof URLSearchParams?search:new URLSearchParams(search);return params.has('batch')?'&batch='+encodeURIComponent(params.get('batch')):'';}
export function batchHref(href,id){const [path,query='']=href.split('?'),q=new URLSearchParams(query);if(id)q.set('batch',id);return path+'?'+q;}
export function reviewBatchItems(items,batch,kind){if(!batch)return items;const ids=new Set(kind==='gaps'?batch.gapIds:batch.comparisonIds);return items.filter(i=>ids.has(i.id));}
export function requireBatchTarget(items,id){if(id&&!items.some(i=>i.id===id))throw Error('该任务不在本份负责范围，请返回分工入口。');}
export async function loadReviewBatches({reviewRevision,gapRevision}={}){
 const res=await fetch('./task-allocation.json?v='+allocationRevision,{cache:'no-cache'});if(!res.ok)throw Error('分工清单读取失败。');const value=await res.json();
 if(value.version!==1||value.revision!==allocationRevision||reviewRevision&&value.reviewRevision!==reviewRevision||gapRevision&&value.gapRevision!==gapRevision||!Array.isArray(value.groups)||value.groups.length!==4)throw Error('分工与来源版本不匹配，请重新读取。');
 const seen={comparisonIds:new Set(),gapIds:new Set()};
 for(const [n,g]of value.groups.entries()){
  if(g.id!=='DEFG'[n]||g.kind!=='review'||!Number.isFinite(g.weight)||g.weight<=0)throw Error('复核分工无效。');
  for(const key of Object.keys(seen)){if(!Array.isArray(g[key]))throw Error('复核分工范围缺失。');for(const id of g[key]){if(typeof id!=='string'||seen[key].has(id))throw Error('复核分工重复。');seen[key].add(id);}}
 }
 return value.groups;
}
export function validateBatchCoverage(groups,items,kind){
 const key=kind==='gaps'?'gapIds':'comparisonIds',ids=groups.flatMap(g=>g[key]),available=new Set(items.map(i=>i.id));
 if(ids.length!==items.length||new Set(ids).size!==ids.length||ids.some(id=>!available.has(id)))throw Error('分工未完整覆盖当前任务，已停止载入。');
}

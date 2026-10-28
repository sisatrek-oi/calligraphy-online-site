// Page pairs are a view of approved source ranges, never rewritten TXT.
export const pairStatus={paired:'PDF ↔ TXT',partial:'PDF ↔ 已定位TXT片段',missing:'PDF · TXT待审核',unmapped:'PDF · TXT逐页待定位',unlocated:'TXT · PDF待定位'};
export function reviewPagePairs(chapter,byPage){
 const rows=new Map(),unlocated=[];
 const row=page=>{if(!rows.has(page))rows.set(page,{key:String(page),page,fragments:[],reasons:[]});return rows.get(page);};
 for(const gap of chapter.gaps||[])if(Number.isInteger(gap.page)&&gap.page>0&&gap.page<20001)row(gap.page).reasons.push(...(gap.reasons||[]));
 for(const f of chapter.fragments){
  const p=byPage.get(f.page);if(!p?.eligible)continue;
  if(f.page<20001){row(f.page).fragments.push({...f});continue;}
  for(const n of p.source.originalPages||[])row(n);
  const located=(p.source.provenance||[]).filter(s=>s.origin==='legacy-reviewed-txt'&&Number.isInteger(s.page_id)&&s.page_id>0&&s.page_id<20001&&s.start<f.end&&s.end>f.start).sort((a,b)=>a.start-b.start);
  let at=f.start;
  for(const s of located){
   const start=Math.max(f.start,s.start),end=Math.min(f.end,s.end);
   if(start<at)throw Error('逐页来源范围重叠，不能生成页对。');
   if(start>at)unlocated.push({...f,start:at,end:start});
   row(s.page_id).fragments.push({...f,start,end});at=end;
  }
  if(at<f.end)unlocated.push({...f,start:at});
 }
 const pending=unlocated.some(f=>byPage.get(f.page).text.slice(f.start,f.end).trim());
 const pairs=[...rows.values()].sort((a,b)=>a.page-b.page);
 for(const r of pairs){r.fragments.sort((a,b)=>a.page-b.page||a.start-b.start);r.status=r.fragments.length?(r.fragments.some(f=>f.page>=20001)&&pending?'partial':'paired'):(r.reasons.length||chapter.gaps?.some(g=>g.page===r.page)?'missing':'unmapped');}
 // Keep every source unit, including whitespace, available without guessing a page.
 if(unlocated.length)pairs.push({key:'unlocated',page:null,fragments:unlocated,reasons:[],status:'unlocated'});
 return pairs;
}
export function pairChapter(chapter,pair){
 return pair?{...chapter,fragments:pair.fragments,gaps:pair.page===null?[]:(chapter.gaps||[]).filter(g=>g.page===pair.page)}:chapter;
}
export function pairText(pair,byPage){return pair.fragments.map(f=>byPage.get(f.page).text.slice(f.start,f.end)).join('');}

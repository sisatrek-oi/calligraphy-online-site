import {assignmentCount,assignmentHref,assignmentProgress,segmentHasPage} from './team-assignments.js?v=release-20261022';
import {humanMarked} from './human-mark.js?v=human-mark-20261019';
// Combine public human records with local overrides by page, never by adding counts.
export function assignmentContext(storage,assignment,indexes){
 const local=assignmentProgress(storage,assignment);
 if(!local)return null;
 const parts=new Map();
 try{for(const s of assignment.segments){const raw=storage.getItem(`shulun-screening-v1-part-${s.part}`);parts.set(s.part,raw?JSON.parse(raw).reviews:{});}}
 catch{return null;}
 const pages=assignment.segments.flatMap(s=>(indexes[s.part]?.pages||[]).filter(p=>segmentHasPage(s,p.page)).map(p=>({...p,part:s.part,marked:humanMarked(p,parts.get(s.part)[p.page])})));
 if(pages.length!==assignmentCount(assignment))throw new Error('分工材料索引不完整');
 const recent=local.segments.filter(s=>s.lastPage).sort((a,b)=>b.savedAt-a.savedAt)[0];
 const target=recent?{part:recent.part,page:recent.lastPage}:pages.find(p=>!p.marked)||pages[0];
 return {marked:pages.filter(p=>p.marked).length,total:pages.length,href:assignmentHref(assignment.id,target.part,target.page),part:target.part,page:target.page,resume:Boolean(recent)};
}

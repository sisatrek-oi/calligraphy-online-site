import{assignmentFor,assignmentSegment}from'../src/team-assignments.js';
import{isTaskPage}from'../src/screening-page-policy.js';
export function taskScope(params,catalogue,pages){
 const assignment=assignmentFor(params.get('member')),rawPart=params.get('part'),part=rawPart===null?null:Number(rawPart);
 if(part!==null&&(!Number.isInteger(part)||part<1||part>4))throw Error('原分份无效，请从原文校对任务进入。');
 if(assignment&&part)assignmentSegment(assignment.id,part);
 const ranges=[[1,258],[259,527],[528,776],[777,1052]],contains=n=>isTaskPage(n)&&(assignment?assignment.segments.some(s=>s.start<=n&&n<=s.end):part?ranges[part-1][0]<=n&&n<=ranges[part-1][1]:true);
 const chapters=catalogue.chapters.filter(c=>!assignment&&!part||(pages[c.id]||[]).some(contains)).sort((a,b)=>(Math.min(...(pages[a.id]||[2000]))||2000)-(Math.min(...(pages[b.id]||[2000]))||2000));if(!chapters.length)throw Error('此分工暂没有可打开的章节。');
 const requestedPage=Number(params.get('page')),firstRange=assignment?.segments[0]||(part?{start:ranges[part-1][0],end:ranges[part-1][1]}:null),page=contains(requestedPage)&&requestedPage>0?requestedPage:firstRange?Array.from({length:firstRange.end-firstRange.start+1},(_,i)=>i+firstRange.start).find(contains):null;
 const atPage=chapters.filter(c=>c.characters>0&&page&&(pages[c.id]||[]).includes(page)).sort((a,b)=>(pages[a.id].length-pages[b.id].length)||Math.min(...pages[b.id])-Math.min(...pages[a.id]));
 const entry=chapters.find(c=>c.id===params.get('chapter'))||atPage[0]||chapters.find(c=>c.id===catalogue.defaultChapter)||chapters.find(c=>c.characters>0)||chapters[0];
 return{catalogue:{...catalogue,chapters,totalChapters:chapters.length,defaultChapter:entry.id},assignment:assignment?{memberId:assignment.id,name:assignment.name,segments:assignment.segments}:null,label:assignment?`成员 ${assignment.id} · ${assignment.name}`:part?`原第 ${part} 份`:'全书',entry:entry.id};
}
export async function loadTaskScope(params){const[index,pages,imagePages,imageCatalogue]=await Promise.all(['index.json?v=chapter-loading-zstd-20261109','chapter-pages.json','chapter-image-pages.json','image-catalogue.json'].map(async u=>{const r=await fetch(u);if(!r.ok)throw Error('逐字任务目录读取失败。');return r.json();}));return{...taskScope(params,index,pages),imagePages,imageCatalogue};}

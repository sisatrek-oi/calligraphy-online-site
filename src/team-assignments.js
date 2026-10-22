import { isTaskPage } from './screening-page-policy.js?v=20261003-trim';
import { isVerified } from './collation-core.js?v=20261013-typo-only';

export const assignmentRevision = 'seven-20261018';
export const assignments = Object.freeze([
  { id: 1, name: '肖源', received: 90, remaining: 58, segments: [{part:1,start:1,end:158}] },
  { id: 2, name: '郑雨荻', received: 169, remaining: 0, segments: [{part:2,start:259,end:427}] },
  { id: 3, name: '宋品宣', received: 121, remaining: 28, segments: [{part:3,start:528,end:676}] },
  { id: 4, name: '帅睿', received: 70, remaining: 105, segments: [{part:4,start:777,end:951}] },
  { id: 5, name: '尹正荣', received: 6, remaining: 127, segments: [{part:1,start:159,end:258},{part:2,start:428,end:460}] },
  { id: 6, name: '姜淼', received: 46, remaining: 87, segments: [{part:2,start:461,end:527},{part:3,start:677,end:742}] },
  { id: 7, name: '彭鹏', received: 50, remaining: 84, segments: [{part:3,start:743,end:776},{part:4,start:952,end:1051}] },
].map(a => Object.freeze({...a, segments:Object.freeze(a.segments.map(s=>Object.freeze(s)))})));

export function assignmentFor(id) {
  if (id === null || id === undefined) return null;
  const number = Number(id);
  const value = assignments.find(a=>a.id===number);
  if (!value || !/^[1-7]$/.test(String(id))) throw new Error('成员分工无效，请从团队任务选择成员1–7。');
  return value;
}

export function assignmentSegment(member, part) {
  const assignment = assignmentFor(member);
  if (!assignment) return null;
  const segment = assignment.segments.find(s=>s.part===part);
  if (!segment) throw new Error('该原分份不属于此成员，请从团队任务打开自己的页段。');
  return segment;
}

export const segmentHasPage = (segment, number) => isTaskPage(number) && number>=segment.start && number<=segment.end;
export const segmentCount = segment => Array.from({length:segment.end-segment.start+1},(_,i)=>i+segment.start).filter(isTaskPage).length;
export const assignmentCount = assignment => assignment.segments.reduce((sum,s)=>sum+segmentCount(s),0);

export function assignmentHref(member, part, page) {
  const segment=assignmentSegment(member,part);
  if (!segment) throw new Error('请选择成员分工。');
  const number=segmentHasPage(segment,Number(page)) ? Number(page) : Array.from({length:segment.end-segment.start+1},(_,i)=>i+segment.start).find(isTaskPage);
  return `./screening.html?part=${part}&member=${member}&page=${number}`;
}

export function assignmentPages(pages, member, part) {
  const segment = assignmentSegment(member,part);
  return pages.filter(p=>segment ? segmentHasPage(segment,p.page) : isTaskPage(p.page));
}

// Read only. The four legacy keys and all original records remain untouched.
export function assignmentProgress(storage, assignment) {
  try {
    let verified=0, draft=0;
    const segments=assignment.segments.map(segment=>{
      const raw=storage.getItem(`shulun-screening-v1-part-${segment.part}`);
      const saved=raw===null ? null : JSON.parse(raw);
      if(saved && (saved.version!==1 || saved.part!==segment.part || !saved.reviews || typeof saved.reviews!=='object' || Array.isArray(saved.reviews)))throw new Error('invalid-progress');
      for(let n=segment.start;n<=segment.end;n++){
        if(!isTaskPage(n))continue;
        const collation=saved?.reviews[n]?.collation;
        if(isVerified(collation))verified++;
        else if(typeof collation?.text==='string')draft++;
      }
      return {...segment,lastPage:segmentHasPage(segment,saved?.lastPage) ? saved.lastPage : null, savedAt:Date.parse(saved?.savedAt) || 0};
    });
    return {verified,draft,segments};
  } catch { return null; }
}

// One overview entrance per member; resume the most recently saved assigned segment.
export function assignmentEntry(assignment, progress) {
  const candidates = (progress?.segments || []).filter(s=>s.lastPage);
  const segment = candidates.reduce((latest,s)=>!latest || s.savedAt>latest.savedAt ? s : latest,null) || assignment.segments[0];
  return {part:segment.part,page:segment.lastPage || null,href:assignmentHref(assignment.id,segment.part,segment.lastPage)};
}

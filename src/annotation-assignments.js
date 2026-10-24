// Chapter responsibility is independent of proofreading and annotation content.
export const assignmentKey='shulun-annotation-assignments-v1';
export const standardAssignmentKey='shulun-wolai-standard-annotation-assignments-v1';
export const bookFoldKey='shulun-annotation-book-fold-v1';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const identity=name=>name.normalize('NFKC').toLocaleLowerCase();
export function assignmentName(value){const name=String(value??'').normalize('NFKC').trim();if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/u.test(name))throw new Error('请输入1–40字的负责人姓名。');return name;}
const empty=index=>({format:'shulun-chapter-assignments',version:1,chapterRevision:index.assignmentRevision||index.revision,members:[],assignments:{},events:[]});
export function validateAssignments(plan,index){
 const chapters=new Set(index.chapters.filter(c=>c.fragments.length).map(c=>c.id));
 if(plan?.format!=='shulun-chapter-assignments'||plan.version!==1||plan.chapterRevision!==(index.assignmentRevision||index.revision)||!Array.isArray(plan.members)||plan.members.length>200||!object(plan.assignments)||!Array.isArray(plan.events))throw new Error('分工文件格式或章节版本不匹配，原分工未改变。');
 const ids=new Set(),names=new Set();for(const m of plan.members){if(typeof m?.id!=='string'||!/^member-[a-zA-Z0-9-]{1,100}$/.test(m.id)||typeof m.name!=='string'||assignmentName(m.name)!==m.name||ids.has(m.id)||names.has(identity(m.name)))throw new Error('分工成员名单无效。');ids.add(m.id);names.add(identity(m.name));}
 for(const [chapter,member] of Object.entries(plan.assignments))if(!chapters.has(chapter)||!ids.has(member))throw new Error('分工包含不存在或未开放的章节／负责人。');
 const events=new Set();for(const e of plan.events){if(typeof e?.id!=='string'||!e.id||events.has(e.id)||!Number.isFinite(Date.parse(e.at))||!['assign','unassign','import'].includes(e.action)||!Array.isArray(e.changes))throw new Error('分工历史无效。');events.add(e.id);for(const c of e.changes)if(!chapters.has(c.chapterId)||![c.before,c.after].every(n=>typeof n==='string'&&(!n||assignmentName(n)===n)))throw new Error('分工历史范围无效。');}
 return plan;
}
export function readAssignments(storage,index,key=assignmentKey){const raw=storage.getItem(key);let value;if(raw===null)value=empty(index);else{try{value=JSON.parse(raw);}catch{throw new Error('本机分工记录无法读取，请先导出原记录后核对；未覆盖。');}}return {raw,value:validateAssignments(value,index)};}
export function saveAssignments(storage,plan,expectedRaw,index,key=assignmentKey){validateAssignments(plan,index);if(storage.getItem(key)!==expectedRaw)throw new Error('其他窗口更新了分工，请重新读取后再保存；本次未覆盖。');const raw=JSON.stringify(plan);storage.setItem(key,raw);return raw;}
export const assignedName=(plan,id)=>plan.members.find(m=>m.id===plan.assignments[id])?.name||'';
export function changeAssignments(plan,chapterIds,name,index,at=new Date().toISOString()){
 validateAssignments(plan,index);const next=structuredClone(plan),available=new Set(index.chapters.filter(c=>c.fragments.length).map(c=>c.id)),selected=[...new Set(chapterIds)];
 if(!selected.length||selected.some(id=>!available.has(id)))throw new Error('请勾选至少一个已开放的整章。');
 const normalized=name===null?'':assignmentName(name);let member=next.members.find(m=>identity(m.name)===identity(normalized));
 if(normalized&&!member){member={id:'member-'+crypto.randomUUID(),name:normalized};next.members.push(member);}
 const changes=[];for(const id of selected){const before=assignedName(next,id),after=member?.name||'';if(before===after)continue;changes.push({chapterId:id,before,after});if(member)next.assignments[id]=member.id;else delete next.assignments[id];}
 if(!changes.length)throw new Error('所选章节的分工没有变化。');
 next.events.push({id:crypto.randomUUID(),at,action:normalized?'assign':'unassign',changes});return validateAssignments(next,index);
}
export function mergeAssignments(current,incoming,index,at=new Date().toISOString()){
 validateAssignments(current,index);validateAssignments(incoming,index);const next=structuredClone(current),changes=[];
 for(const [chapter,id] of Object.entries(incoming.assignments)){
  const name=incoming.members.find(m=>m.id===id).name,before=assignedName(next,chapter);
  if(before&&identity(before)!==identity(name))throw new Error('同一章节已有不同负责人，未合并。请保留两份分工文件后核对。');
  let member=next.members.find(m=>identity(m.name)===identity(name));if(!member){member={id:'member-'+crypto.randomUUID(),name};next.members.push(member);}
  if(!before){next.assignments[chapter]=member.id;changes.push({chapterId:chapter,before:'',after:member.name});}
 }
 for(const m of incoming.members)if(!next.members.some(n=>identity(n.name)===identity(m.name)))next.members.push({id:'member-'+crypto.randomUUID(),name:m.name});
 const events=new Map(next.events.map(e=>[e.id,e]));for(const e of incoming.events){if(events.has(e.id)&&JSON.stringify(events.get(e.id))!==JSON.stringify(e))throw new Error('同编号分工历史内容不同，未合并。');if(!events.has(e.id)){next.events.push(structuredClone(e));events.set(e.id,e);}}
 if(changes.length)next.events.push({id:crypto.randomUUID(),at,action:'import',changes});return validateAssignments(next,index);
}

export function assignmentScope(plan,index,memberId){
 validateAssignments(plan,index);const member=plan.members.find(m=>m.id===memberId);
 if(!member)throw new Error('这位成员的分工已不存在，请返回任务页重新选择。');
 return {member,chapters:index.chapters.filter(c=>c.fragments.length&&plan.assignments[c.id]===memberId)};
}
export function memberTasks(plan,index,statuses=new Map()){
 validateAssignments(plan,index);
 return plan.members.map(member=>{const {chapters}=assignmentScope(plan,index,member.id);return {member,chapters,confirmed:chapters.filter(c=>statuses.get(c.id)).length,works:index.works.map(w=>({work:w,chapters:chapters.filter(c=>c.workId===w.id)})).filter(w=>w.chapters.length)};});
}

// Standard assignments inherit the original plan read-only until the first save.
export function readCorpusAssignments(storage,index,mode){
 const key=mode==='legacy'?assignmentKey:standardAssignmentKey,raw=storage.getItem(key);
 if(raw!==null||key===assignmentKey)return {...readAssignments(storage,index,key),key,inheritedKey:null,inheritedRaw:null};
 const inherited=readAssignments(storage,index,assignmentKey);return {raw:null,value:inherited.value,key,inheritedKey:assignmentKey,inheritedRaw:inherited.raw};
}
export function assignmentsUnchanged(storage,snapshot){return storage.getItem(snapshot.key)===snapshot.raw&&(!snapshot.inheritedKey||storage.getItem(snapshot.inheritedKey)===snapshot.inheritedRaw);}

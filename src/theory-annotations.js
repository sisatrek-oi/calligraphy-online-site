// Human passage annotations. Offsets use the textarea's UTF-16 code units.
// Text is stored separately from collation; a mark never implies proofreading.
export const annotationVersion = 1;
const stamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const boundary = (text, n) => !(n > 0 && n < text.length && /[\uD800-\uDBFF]/u.test(text[n-1]) && /[\uDC00-\uDFFF]/u.test(text[n]));
const validRange = (text, start, end) => Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length && boundary(text,start) && boundary(text,end);
const active = a => a.status === 'active';
const context = (text,start,end) => ({start,end,quote:text.slice(start,end),prefix:text.slice(Math.max(0,start-24),start),suffix:text.slice(end,end+24)});
const event = (action,id,by,at) => ({action,id,by,at});

export function validateAnnotations(data) {
  if (!data || data.version !== 1 || typeof data.text !== 'string' || !Array.isArray(data.passages) || !Array.isArray(data.events)) throw new Error('书论标注备份结构无效');
  const ids = new Set(), live = [];
  for (const a of data.passages) {
    if (!a || typeof a.id !== 'string' || !a.id || ids.has(a.id) || !['active','needs-review','removed'].includes(a.status) || typeof a.quote !== 'string' || !a.quote.trim() || !Number.isInteger(a.start) || a.start < 0 || !Number.isInteger(a.end) || a.end <= a.start || typeof a.createdBy !== 'string' || typeof a.createdAt !== 'string') throw new Error('书论标注范围或编号无效');
    ids.add(a.id);
    if (active(a)) {
      if (!validRange(data.text,a.start,a.end) || data.text.slice(a.start,a.end)!==a.quote) throw new Error('书论标注与备份正文不匹配');
      live.push(a);
    }
  }
  live.sort((a,b)=>a.start-b.start);
  if (live.some((a,i)=>i && a.start<live[i-1].end)) throw new Error('书论标注范围有重叠');
  if (data.completion != null && (!['marked','none'].includes(data.completion.kind) || typeof data.completion.by !== 'string' || typeof data.completion.at !== 'string' || data.passages.some(a=>a.status==='needs-review') || (data.completion.kind==='none' ? live.length!==0 : live.length===0))) throw new Error('书论标注完成状态无效');
  return data;
}

export function annotationView(data, text) {
  if (!data) return {passages:[],ranges:[],pending:[],completed:false,label:'未确认',removed:[]};
  validateAnnotations(data);
  const matches = data.text === text;
  const passages = data.passages.filter(a=>a.status!=='removed').map(a=>({...a,status:matches ? a.status : 'needs-review'}));
  const ranges = passages.filter(active).sort((a,b)=>a.start-b.start).map(a=>({...a,type:'manual'}));
  const pending = passages.filter(a=>a.status==='needs-review');
  const completed = matches && Boolean(data.completion) && !pending.length;
  return {passages,ranges,pending,completed,removed:data.passages.filter(a=>a.status==='removed'),
    label: pending.length ? `${pending.length} 处待重新定位` : completed ? data.completion.kind==='none'?'已确认无书论':'标注完成' : passages.length?'标注中':'未确认'};
}

function prepare(data,text) {
  if (!data) return {version:1,text,passages:[],events:[],completion:null};
  validateAnnotations(data);
  if(data.text===text) return {...data,passages:data.passages.map(a=>({...a})),events:[...data.events]};
  // A changed upstream source is not silently matched to another occurrence.
  return {...data,text,completion:null,passages:data.passages.map(a=>active(a)?{...a,status:'needs-review'}:{...a}),events:[...data.events]};
}

export function addAnnotation(data,text,start,end,by,at=stamp(),id=uid()) {
  if(!by.trim()) throw new Error('请先填写真实姓名，再标注书论。');
  if(!validRange(text,start,end) || !text.slice(start,end).trim()) throw new Error('请先在全文中选中属于书论的文字。');
  const next=prepare(data,text);
  if(next.passages.some(a=>active(a)&&start<a.end&&end>a.start)) throw new Error('选区与已有标注重叠。请先撤销旧标注，再选择需要的范围。');
  if(next.passages.some(a=>a.id===id)) throw new Error('标注编号重复，请重试。');
  next.passages.push({id,...context(text,start,end),status:'active',createdBy:by.trim(),createdAt:at,updatedAt:at});
  next.events.push(event('add',id,by.trim(),at)); next.completion=null;
  return next;
}

export function removeAnnotation(data,text,id,by,at=stamp()) {
  const next=prepare(data,text),a=next.passages.find(a=>a.id===id&&a.status!=='removed');
  if(!a) throw new Error('这条标注已不存在。');
  a.previousStatus=a.status; a.status='removed'; a.updatedAt=at;
  next.events.push(event('remove',id,by,at));next.completion=null;return next;
}

export function removeAnnotationSelection(data,text,start,end,by,at=stamp()) {
  if(!by.trim())throw new Error('请先填写真实姓名。');
  if(!validRange(text,start,end))throw new Error('请先选中要删除标注的文字。');
  const next=prepare(data,text);
  for(const a of [...next.passages]) {
    if(!active(a)||a.end<=start||a.start>=end)continue;
    a.previousStatus=a.status;a.status='removed';a.updatedAt=at;
    next.events.push(event('remove',a.id,by.trim(),at));
    for(const [s,e] of [[a.start,Math.min(start,a.end)],[Math.max(end,a.start),a.end]]) {
      if(e<=s||!text.slice(s,e).trim())continue;
      next.passages.push({...a,...context(text,s,e),id:uid(),parentId:a.id,status:'active',updatedAt:at});
    }
  }
  next.completion=null;return next;
}

export function restoreAnnotation(data,text,id,by,at=stamp()) {
  const next=prepare(data,text),a=next.passages.find(a=>a.id===id&&a.status==='removed');
  if(!a) throw new Error('没有可恢复的标注。');
  const locatable=a.previousStatus==='active'&&validRange(text,a.start,a.end)&&text.slice(a.start,a.end)===a.quote&&!next.passages.some(b=>active(b)&&a.start<b.end&&a.end>b.start);
  a.status=locatable?'active':'needs-review';a.updatedAt=at;
  next.events.push(event('restore',id,by,at));next.completion=null;return next;
}

export function relocateAnnotation(data,text,id,start,end,by,at=stamp()) {
  const next=prepare(data,text),a=next.passages.find(a=>a.id===id&&a.status!=='removed');
  if(!a || !validRange(text,start,end) || !text.slice(start,end).trim()) throw new Error('请先在全文中选中新的范围，再点重新定位。');
  if(next.passages.some(b=>b.id!==id&&active(b)&&start<b.end&&end>b.start)) throw new Error('新选区与其他标注重叠，请重新选择。');
  next.events.push({...event('relocate',id,by,at),previous:{start:a.start,end:a.end,quote:a.quote}});
  Object.assign(a,context(text,start,end),{status:'active',updatedAt:at});next.completion=null;return next;
}

export function completeAnnotations(data,text,by,at=stamp()) {
  if(!by.trim()) throw new Error('请先填写真实姓名。');
  const next=prepare(data,text),view=annotationView(next,text);
  if(view.pending.length) throw new Error('请先重新定位或撤销待核标注，再确认本页。');
  next.completion={kind:view.ranges.length?'marked':'none',by:by.trim(),at};
  next.events.push(event('complete','',by.trim(),at));return next;
}

export function rebaseAnnotations(data,before,after,by,at=stamp()) {
  if(!data || before===after) return data;
  const next=prepare(data,before);
  let start=0,end=before.length,newEnd=after.length;
  while(start<end && start<newEnd && before[start]===after[start])start++;
  while(end>start && newEnd>start && before[end-1]===after[newEnd-1]){end--;newEnd--;}
  const delta=newEnd-end;
  next.passages=next.passages.map(a=>{
    if(!active(a)) return a.status==='removed'?{...a,previousStatus:'needs-review'}:a;
    if(end<=a.start) return {...a,...context(after,a.start+delta,a.end+delta)};
    if(start>=a.end) return {...a,...context(after,a.start,a.end)};
    return {...a,status:'needs-review',updatedAt:at};
  });
  next.text=after;next.completion=null;
  next.events.push({...event('text-edit','',by,at),start,end,newEnd});return next;
}

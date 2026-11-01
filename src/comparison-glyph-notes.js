import {validateScanRegion} from './scan-region.js';
export const glyphKinds={uninputtable:'原字无法输入',variant:'疑似异体字',uncertain:'字形待辨认'};
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||/\u0000/.test(v)||[...v].some(c=>c.codePointAt(0)>=0xD800&&c.codePointAt(0)<=0xDFFF)||required&&!v.trim())throw Error('疑难字备注文字无效。');return v;};
const boundary=(s,n)=>Number.isInteger(n)&&n>=0&&n<=s.length&&!(n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]));
export function validateGlyphNotes(notes,item){
 if(!Array.isArray(notes)||notes.length>100||item.page===null&&notes.length)throw Error('疑难字备注必须属于已定位整页任务。');
 const ids=new Set();
 for(const n of notes){
  if(!n||!text(n.id,80,true)||!/^[A-Za-z0-9-]+$/.test(n.id)||ids.has(n.id)||!Object.hasOwn(glyphKinds,n.kind)||!['open','resolved'].includes(n.status)||!Number.isFinite(Date.parse(n.at)))throw Error('疑难字备注记录无效。');ids.add(n.id);
  text(n.textSnapshot,10000);text(n.quote,10000,n.anchor!=='scan');text(n.comment,3000,true);text(n.candidate,100);text(n.by,40,true);
  if(n.anchor!==undefined&&n.anchor!=='scan')throw Error('疑难字备注定位方式无效。');
  if(n.anchor==='scan'){if(n.textSnapshot!==''||n.start!==0||n.end!==0||n.quote!=='')throw Error('原图备注不能包含猜测的TXT选区。');}
  else if(!boundary(n.textSnapshot,n.start)||!boundary(n.textSnapshot,n.end)||n.start>=n.end||n.textSnapshot.slice(n.start,n.end)!==n.quote)throw Error('疑难字备注选区与当时文本不匹配。');
  validateScanRegion(n.region);if(n.region.page!==item.page)throw Error('疑难字原图必须是当前任务原文页。');
  if(n.status==='resolved'){text(n.resolution,3000,true);text(n.resolvedBy,40,true);if(!Number.isFinite(Date.parse(n.resolvedAt)))throw Error('疑难字处理时间无效。');}
  else if(n.resolution!==''||n.resolvedBy!==''||n.resolvedAt!==null)throw Error('未处理的疑难字状态无效。');
 }
 return notes;
}
export function createGlyphNote(item,{id=crypto.randomUUID(),kind='uninputtable',anchor,textSnapshot='',start=0,end=0,region,comment,candidate='',by,at=new Date().toISOString()}){
 const note={id,kind,...(anchor===undefined?{}:{anchor}),textSnapshot,start,end,quote:typeof textSnapshot==='string'?textSnapshot.slice(start,end):'',region:structuredClone(region),comment,candidate,by,at,status:'open',resolution:'',resolvedBy:'',resolvedAt:null};validateGlyphNotes([note],item);return note;
}
export function resolveGlyphNote(note,{by,resolution,at=new Date().toISOString(),reopen=false}){
 return {...note,status:reopen?'open':'resolved',resolution:reopen?'':text(resolution,3000,true),resolvedBy:reopen?'':text(by,40,true),resolvedAt:reopen?null:at};
}
export const openGlyphNotes=record=>(record?.glyphNotes||[]).filter(n=>n.status==='open');
export const glyphTextLocation=(note,currentText)=>note.anchor!=='scan'&&currentText===note.textSnapshot?{start:note.start,end:note.end}:null;
export function glyphContext(n,limit=30){return {before:Array.from(n.textSnapshot.slice(0,n.start)).slice(-limit).join(''),after:Array.from(n.textSnapshot.slice(n.end)).slice(0,limit).join('')};}
export function glyphNoteRows(records,corpus){return Object.entries(records).flatMap(([id,r])=>(r.glyphNotes||[]).map(note=>({item:corpus.items.get(id),note})));}
export function glyphNotesCsv(records,corpus){
 const cell=v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['任务','扫描页','篇目','原TXT片段','前文','后文','类型','备注','候选字','状态','处理说明','记录人','记录时间','原图区域','原图SHA256','来源SHA256']];
 for(const {item:i,note:n} of glyphNoteRows(records,corpus))rows.push([i.id,i.page,i.work,n.quote,glyphContext(n).before,glyphContext(n).after,glyphKinds[n.kind],n.comment,n.candidate,n.status==='open'?'待处理':'已处理',n.resolution,n.by,n.at,JSON.stringify(n.region.rect),n.region.imageSha256,i.manualSha256]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}

// Recheck decisions are independent of source texts and previous approval/annotation records.
export const compareKey=revision=>'shulun-wolai-human-recheck-v1:'+revision;
export const digestText=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),choices=new Set(['manual','reference','custom','defer']),kinds=new Set(['han','punctuation','unaligned','reference-only']);
const fail=message=>{throw Error(message);};
export const validBoundary=(text,n)=>Number.isInteger(n)&&n>=0&&n<=text.length&&!(n>0&&n<text.length&&/[\uD800-\uDBFF]/u.test(text[n-1])&&/[\uDC00-\uDFFF]/u.test(text[n]));
const range=(text,a,z)=>validBoundary(text,a)&&validBoundary(text,z)&&z>=a;
const clean=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\u0000]/u.test(value)||[...value].some(c=>c.codePointAt(0)>=0xD800&&c.codePointAt(0)<=0xDFFF))fail(label+'无效。');return value;};
export async function validateComparison(data){
 if(data?.version!==1||!Array.isArray(data.pages)||!Array.isArray(data.references)||!Array.isArray(data.items)||!Array.isArray(data.segments))fail('比对材料不完整。');
 const pages=new Map(),refs=new Map(),items=new Map();
 for(const p of data.pages){if(!Number.isInteger(p.page)||p.page<1||p.page>1052||pages.has(p.page)||typeof p.text!=='string'||typeof p.display!=='string'||!hash(p.sha256))fail('人工来源页无效。');pages.set(p.page,p);}
 for(const r of data.references){if(!r.id||refs.has(r.id)||typeof r.text!=='string'||!hash(r.sha256)||!/^https:\/\//.test(r.url))fail('wolai参照无效。');refs.set(r.id,r);}
 await Promise.all([...pages.values(),...refs.values()].map(async p=>{if(await digestText(p.text)!==p.sha256)fail('正文版本校验失败，未套用旧复核记录。');}));
 for(const i of data.items){
  if(!i.id||items.has(i.id)||!kinds.has(i.kind)||typeof i.local!=='string'||typeof i.reference!=='string')fail('差异记录无效。');const p=pages.get(i.page),r=refs.get(i.referenceId);
  if(i.kind==='reference-only'){if(i.page!==null||i.manualSha256!==null||!r)fail('wolai待对应范围无效。');}
  else if(!p||i.manualSha256!==p.sha256||!range(p.text,i.sourceStart,i.sourceEnd)||p.text.slice(i.sourceStart,i.sourceEnd)!==i.original||!range(p.display,i.localDisplayStart,i.localDisplayEnd)||p.display.slice(i.localDisplayStart,i.localDisplayEnd)!==i.local)fail('人工稿差异位置已失效。');
  if(i.referenceId!==null&&(!r||i.referenceSha256!==r.sha256||!range(r.text,i.referenceStart,i.referenceEnd)||r.text.slice(i.referenceStart,i.referenceEnd)!==i.reference))fail('wolai差异位置已失效。');
  if(['han','punctuation'].includes(i.kind)&&!r||i.kind==='unaligned'&&i.referenceId!==null)fail('两侧对应关系无效。');items.set(i.id,i);
 }
 return {data,pages,refs,items};
}
export const emptyRecheck=revision=>({format:'wolai-human-recheck',version:1,revision,records:{},events:[]});
const binding=i=>({id:i.id,page:i.page,manualSha256:i.manualSha256,referenceSha256:i.referenceSha256,sourceStart:i.sourceStart,sourceEnd:i.sourceEnd,referenceId:i.referenceId,referenceStart:i.referenceStart,referenceEnd:i.referenceEnd});
function checkRecord(record,corpus){
 const i=corpus.items.get(record?.id);if(!i||!object(record)||!choices.has(record.choice)||!record.by?.trim()||record.by.length>40||!Number.isFinite(Date.parse(record.at))||!object(record.binding)||Object.entries(binding(i)).some(([k,v])=>record.binding[k]!==v))fail('复核记录与本次两侧正文版本或位置不一致。');
 if(typeof record.deleteText!=='boolean')fail('删除选项无效。');clean(record.note,3000,'核定依据');clean(record.replacement,10000,'校订文字');if(record.scanPage!==null&&(!Number.isInteger(record.scanPage)||record.scanPage<1||record.scanPage>1052))fail('复核扫描页无效。');
 if(record.choice==='manual'&&i.page===null||record.choice==='reference'&&i.referenceId===null)fail('该差异没有可采用的对应文本。');
 if(record.deleteText&&(record.choice!=='custom'||record.replacement!==''))fail('删除与校订内容不一致。');
 if(record.choice==='custom'&&!record.replacement&&!record.deleteText)fail('请输入校订文字，或明确勾选删除。');
 if(record.choice==='manual'&&record.replacement!==i.original||record.choice==='reference'&&record.replacement!==i.reference||record.choice==='defer'&&record.replacement!=='')fail('核定文本与所选来源不一致。');
 return record;
}
export function validateRecheck(value,revision,corpus){
 if(value?.format!=='wolai-human-recheck'||value.version!==1||value.revision!==revision||!object(value.records)||!Array.isArray(value.events))fail('复核备份不属于当前比对版本。');
 for(const [id,r] of Object.entries(value.records)){if(id!==r?.id)fail('复核记录编号无效。');checkRecord(r,corpus);}
 for(const e of value.events)checkRecord(e,corpus);return value;
}
export function recordDecision(state,corpus,{id,choice,by,note='',replacement='',deleteText=false,scanPage=null,at=new Date().toISOString()}){
 const item=corpus.items.get(id);if(!item||!choices.has(choice))fail('请选择有效差异和复核结论。');by=clean(by,40,'核查人').trim();if(!by)fail('请填写真实核查人姓名。');
 const record={id,choice,by,note:clean(note,3000,'核定依据'),replacement:choice==='manual'?item.original:choice==='reference'?item.reference:choice==='custom'?(deleteText?'':clean(replacement,10000,'校订文字')):'',deleteText:choice==='custom'&&Boolean(deleteText),scanPage,at,binding:binding(item)};
 checkRecord(record,corpus);return {...state,records:{...state.records,[id]:record},events:[...state.events,record]};
}
export function saveRecheck(storage,key,next,raw,revision,corpus){validateRecheck(next,revision,corpus);if(storage.getItem(key)!==raw)fail('其他窗口更新了复核记录，本次未覆盖，请先备份再重新读取。');const encoded=JSON.stringify(next);storage.setItem(key,encoded);if(storage.getItem(key)!==encoded)fail('复核记录未能完整保存，请保留备份。');return encoded;}
export function mergeRecheck(current,incoming,revision,corpus){
 validateRecheck(current,revision,corpus);validateRecheck(incoming,revision,corpus);const records={...incoming.records,...current.records},events=[...current.events],seen=new Set(events.map(e=>JSON.stringify(e)));let conflicts=0;
 for(const [id,r] of Object.entries(incoming.records))if(current.records[id]&&JSON.stringify(r)!==JSON.stringify(current.records[id]))conflicts++;
 for(const e of incoming.events)if(!seen.has(JSON.stringify(e))){seen.add(JSON.stringify(e));events.push(e);}return {value:{...current,records,events},conflicts,added:Object.keys(records).length-Object.keys(current.records).length};
}
export const decisionResolved=r=>Boolean(r&&r.choice!=='defer');
export function comparisonTextParts(text,start,end,context=240){
 if(!range(text,start,end))fail('显示差异位置无效。');let a=Math.max(0,start-context),z=Math.min(text.length,end+context);if(!validBoundary(text,a))a--;if(!validBoundary(text,z))z++;return {before:text.slice(a,start),value:text.slice(start,end),after:text.slice(end,z),leading:a>0,trailing:z<text.length};
}

import {digestText,validBoundary} from './annotation-compare-core.js?v=wolai-recheck-20261024';
const fail=m=>{throw Error(m);},object=v=>v&&typeof v==='object'&&!Array.isArray(v),hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),choices=new Set(['corrected','covered','defer']);
export const gapsKey=revision=>'shulun-wolai-pdf-gaps-v1:'+revision;
export const emptyGaps=revision=>({format:'wolai-pdf-gap-proofread',version:1,revision,records:{},events:[]});
export async function validateGaps(data){
 if(data?.version!==1||data.purpose!=='wolai-pdf-gaps'||!Array.isArray(data.items)||!Array.isArray(data.pages)||!Array.isArray(data.references)||!Array.isArray(data.coverage)||!Array.isArray(data.unlocated))fail('缺文清单不完整。');
 const pages=new Map(),refs=new Map(),items=new Map();
 for(const p of data.pages){if(!Number.isInteger(p.page)||p.page<1||p.page>1052||pages.has(p.page)||!['human-return','machine-ocr'].includes(p.kind)||typeof p.text!=='string'||!hash(p.sha256)||!hash(p.imageSha256)||await digestText(p.text)!==p.sha256)fail('补核参考文字版本无效。');pages.set(p.page,p);}
 for(const r of data.references){if(!r.id||refs.has(r.id)||typeof r.text!=='string'||!/^https:\/\//.test(r.url)||await digestText(r.text)!==r.sha256)fail('wolai参照版本无效。');refs.set(r.id,r);}
 for(const i of data.items){const p=pages.get(i.page),r=refs.get(i.referenceId);if(!i.id||items.has(i.id)||!['confirmed','source-gap','anchored'].includes(i.kind)||!p||i.sourceSha256!==p.sha256||i.imageSha256!==p.imageSha256||!validBoundary(p.text,i.sourceStart)||!validBoundary(p.text,i.sourceEnd)||i.sourceEnd<i.sourceStart||typeof i.candidate!=='string'||p.text.slice(i.sourceStart,i.sourceEnd).replace(/^\s*\[\d{3,}\][ \t]*/gm,'')!==i.candidate||i.referenceId!==null&&(!r||r.sha256!==i.referenceSha256))fail('缺文目标位置或版本无效。');items.set(i.id,i);}
 return {data,pages,refs,items};
}
const binding=i=>Object.fromEntries(['id','page','sourceSha256','imageSha256','sourceStart','sourceEnd','referenceId','referenceSha256'].map(k=>[k,i[k]]));
const clean=(s,max)=>{if(typeof s!=='string'||s.length>max||s.includes('\0')||[...s].some(c=>c.codePointAt(0)>=0xd800&&c.codePointAt(0)<=0xdfff))fail('输入文字无效或过长。');return s;};
function check(r,c){
 const i=c.items.get(r?.id);if(!object(r)||!i||!choices.has(r.choice)||!clean(r.by,40).trim()||!Number.isFinite(Date.parse(r.at))||!object(r.binding)||Object.entries(binding(i)).some(([k,v])=>r.binding[k]!==v))fail('记录与PDF原图、参考文字或缺文位置不一致。');
 clean(r.text,10000);clean(r.draftText,10000);clean(r.note,3000);if(typeof r.proofread!=='boolean'||r.scanPage!==i.page)fail('请回到目标扫描页核对。');
 if(r.choice!=='defer'&&!r.proofread)fail('请明确确认已回看目标原图。');
 if(r.choice==='corrected'&&!r.text.trim())fail('请输入按图核对的补录文字。');
 if(r.choice!=='corrected'&&r.text!==''||r.choice==='covered'&&!r.note.trim())fail('非缺文须写明覆盖位置或依据。');return r;
}
export function validateGapState(s,revision,c){if(s?.format!=='wolai-pdf-gap-proofread'||s.version!==1||s.revision!==revision||!object(s.records)||!Array.isArray(s.events))fail('备份不属于当前PDF缺文清单。');for(const [id,r] of Object.entries(s.records)){if(id!==r?.id)fail('记录编号不一致。');check(r,c);}s.events.forEach(r=>check(r,c));return s;}
export function recordGap(s,c,input){const i=c.items.get(input.id);if(!i)fail('缺文目标不存在。');const r={id:i.id,choice:input.choice,by:clean(input.by,40).trim(),text:input.choice==='corrected'?clean(input.text,10000):'',draftText:input.choice==='corrected'?'':clean(input.text,10000),note:clean(input.note,3000),proofread:input.proofread===true,scanPage:input.scanPage,at:input.at||new Date().toISOString(),binding:binding(i)};if(!r.by)fail('请填写真实校对人姓名。');check(r,c);return {...s,records:{...s.records,[i.id]:r},events:[...s.events,r]};}
export function saveGapState(storage,key,next,raw,revision,c){validateGapState(next,revision,c);if(storage.getItem(key)!==raw)fail('其他窗口更新了记录，本次未覆盖。请下载备份后重新读取。');const encoded=JSON.stringify(next);storage.setItem(key,encoded);if(storage.getItem(key)!==encoded)fail('记录未完整保存，请下载备份。');return encoded;}
export function mergeGapState(local,incoming,revision,c){validateGapState(local,revision,c);validateGapState(incoming,revision,c);let conflicts=0;for(const [id,r] of Object.entries(incoming.records))if(local.records[id]&&JSON.stringify(local.records[id])!==JSON.stringify(r))conflicts++;const events=[...local.events],seen=new Set(events.map(e=>JSON.stringify(e)));for(const r of incoming.events)if(!seen.has(JSON.stringify(r))){events.push(r);seen.add(JSON.stringify(r));}return {value:{...local,records:{...incoming.records,...local.records},events},conflicts,added:Object.keys(incoming.records).filter(id=>!local.records[id]).length};}

export function gapBookWorks(corpus,state,{query='',status='all'}={}){
 const groups=new Map(),q=query.trim().toLocaleLowerCase();
 for(const item of corpus.data.items){let group=groups.get(item.workId);if(!group){group={id:item.workId,title:item.work,items:[],visible:[],resolved:0,deferred:0,pending:0};groups.set(item.workId,group);}group.items.push(item);const r=state.records[item.id],kind=!r?'pending':r.choice==='defer'?'defer':'resolved';group[kind==='defer'?'deferred':kind]++;if((status==='all'||status===kind)&&(!q||(item.work+' '+item.title+' '+item.page+' '+item.candidate).toLocaleLowerCase().includes(q)))group.visible.push(item);}
 return [...groups.values()].sort((a,b)=>Math.min(...a.items.map(i=>i.page))-Math.min(...b.items.map(i=>i.page)));
}

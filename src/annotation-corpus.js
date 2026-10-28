import {readJson} from './screening-loader.js?v=index-archive-20261027';
import {validateReviewedPart} from './reviewed-annotation.js?v=index-archive-20261027';
import {loadChapterIndex,validateChapterIndex,chapterAnnotationFiles,chapterFragmentView,orderedChapterFragments} from './annotation-chapters.js?v=source-order-20261028';
import {chapterTaskUnits} from './annotation-chapter-units.js?v=release-20261022';
import {chapterProgressKey,chapterBackupState,effectiveChapterProgress,chapterIsConfirmed,validateChapterProgress} from './chapter-annotation-core.js?v=source-order-20261028';
import {zipStore} from './zip-store.js?v=release-20261022';
export const standardProgressKey='shulun-wolai-standard-chapter-annotation-v1';
export const corpusMode=search=>new URLSearchParams(search).get('corpus')==='legacy'?'legacy':'wolai-standard';
export const corpusQuery=mode=>mode==='legacy'?'&corpus=legacy':'';
export const corpusDigest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
const fail=()=>{throw new Error('wolai标准语料与本次人工确认版本不匹配，已停止载入；旧记录保留。');};
export async function validateStandardCorpus(value){
 await validateReviewedPart(value,1);
 const a=value.approval;
 if(!value.revision||!value.index?.assignmentRevision||!value.index.chapterAliases||a?.status!=='approved'||!a.confirmedBy?.trim()||!Number.isFinite(Date.parse(a.confirmedAt))||!Array.isArray(a.pages)||a.pages.length!==value.pages.length||!/^([a-f0-9]{64})$/.test(a.corpusSha256))fail();
 if(await corpusDigest({revision:value.revision,pages:value.pages,index:value.index,summary:value.summary})!==a.corpusSha256)fail();
 const approved=new Map(a.pages.map(p=>[p.page,p.textSha256]));if(approved.size!==value.pages.length)fail();
 for(const p of value.pages){if(p.page<20001||p.part!==1||!p.eligible||p.source.standardCorpus!=='wolai-standard'||approved.get(p.page)!==p.source.textSha256||!p.source.displayLabel?.trim()||!Array.isArray(p.source.originalPages)||p.source.originalPages.some(n=>!Number.isInteger(n)||n<1||n>=20001)||p.source.sourceUrl&&!/^https:\/\//.test(p.source.sourceUrl))fail();}
 const byPage=new Map(value.pages.map(p=>[p.page,p]));validateChapterIndex(value.index,byPage);return {mode:'wolai-standard',label:'wolai标准正文',key:standardProgressKey,index:value.index,pages:value.pages,byPage,data:value};
}
export async function loadAnnotationCorpus(search='',options){
 if(corpusMode(search)!=='legacy')return validateStandardCorpus(await readJson('./annotation-data/wolai-standard.json?v=wolai-standard-20261022',options));
 const [source,...parts]=await Promise.all([loadChapterIndex(options),...[1,2,3,4].map(async n=>validateReviewedPart(await readJson(`./annotation-data/part-${n}.json?v=chapter-native-final-20261022`,options),n))]);
 const pages=parts.flatMap(p=>p.pages),byPage=new Map(pages.map(p=>[p.page,p]));validateChapterIndex(source,byPage);const index=chapterTaskUnits(source,byPage);validateChapterIndex(index,byPage);
 return {mode:'legacy',label:'旧人工审核正文',key:chapterProgressKey,index,pages,byPage};
}
export function bindCorpusProgress(state,corpus){
 validateChapterProgress(state,corpus.byPage);
 if(corpus.mode==='legacy')return state;
 if(state.corpusId===undefined&&state.corpusRevision===undefined&&!Object.keys(state.pages).length&&!Object.keys(state.confirmations).length&&!state.events.length)return {...state,corpusId:corpus.mode,corpusRevision:corpus.data.revision};
 if(state.corpusId!==corpus.mode||state.corpusRevision!==corpus.data.revision)throw new Error('进度备份不属于当前wolai标准语料版本，未套用或覆盖。');
 return state;
}
export function corpusBackup(state,legacy,corpus,legacyChapterRaw){
 const result=chapterBackupState(bindCorpusProgress(state,corpus),legacy);
 if(corpus.mode!=='legacy')result.legacyChapterArchives=[...new Set([...(state.legacyChapterArchives||[]),...(legacyChapterRaw===null?[]:[legacyChapterRaw])])];
 return result;
}
export function corpusSourceView(page,byPage){
 const source=byPage.get(page)?.source;
 const scan=page<20001?page:source?.originalPages?.[0];
 return {label:source?.displayLabel||`原图来源 ${page}`,scan:scan||null,url:source?.sourceUrl||'',originalPages:source?.originalPages||[]};
}
export async function buildStandardBundle({corpus,state,legacy,legacyChapterRaw,person,unsaved=false,assignmentRecords={}}){
 if(corpus.mode==='legacy')throw new Error('此导出入口只用于wolai标准任务。');
 bindCorpusProgress(state,corpus);if(!person.trim())throw new Error('请先填写真实姓名，再导出。');
 const effective=effectiveChapterProgress(legacy,state,corpus.byPage),statuses={};
 for(const c of corpus.index.chapters)statuses[c.id]={confirmed:await chapterIsConfirmed(c,corpus.byPage,legacy,state),...(state.confirmations[c.id]||{})};
 const files=chapterAnnotationFiles(corpus.index,corpus.byPage,effective,statuses).map(f=>({...f,content:f.content.replaceAll('原PDF页','正文来源ID').replaceAll('原PDF第','缺口来源').replaceAll('原 PDF 第','缺口来源 ').replaceAll('原图与来源 · 第','正文来源 · ID ')}));
 const backup=corpusBackup(state,legacy,corpus,legacyChapterRaw);
 const completeText='\ufeff'+corpus.index.chapters.map(c=>`${c.author} · 《${c.workTitle}》 · ${c.volumeTitle&&c.volumeTitle!==c.title?c.volumeTitle+' · ':''}${c.title}\n\n`+orderedChapterFragments(c).map(f=>chapterFragmentView(f,corpus.byPage,effective).readingText).join('\n')).join('\n\n');
 files.push({name:'wolai标准正文全集.txt',content:completeText},{name:'旧成员分工原始备份.json',content:assignmentRecords.legacy||'null'},{name:'标准成员分工原始备份.json',content:assignmentRecords.standard||'null'},{name:'wolai标准语料.json',content:JSON.stringify(corpus.data,null,2)},{name:'wolai标准标注进度.json',content:JSON.stringify(backup,null,2)},{name:'原四份记录完整备份.json',content:JSON.stringify(backup.legacyArchive,null,2)},{name:'旧整章记录完整备份.json',content:JSON.stringify(backup.legacyChapterArchives.map(raw=>JSON.parse(raw)),null,2)},{name:'标准来源映射.json',content:JSON.stringify(corpus.pages.map(p=>({sourceId:p.page,...p.source})),null,2)},{name:'使用说明.txt',content:`wolai标准任务；正文版本 ${corpus.data.revision}。\n${unsaved?'包含未保存进度，请妥善保留。\n':''}本任务仅确认已开放正文，不表示全书或来源缺文已补齐。AI初标不等于人工标注完成。标准语料／标注进度独立保存；原四份记录和旧整章记录是完整备份，未迁移或覆盖。\n恢复本任务请使用 wolai标准标注进度.json；原四份与旧整章备份分别在旧入口恢复。正文来源ID不是原PDF页码，实际原图定位见标准来源映射。`});
 return {name:'wolai标准-整章标注成果'+(unsaved?'（未保存）':'')+'.zip',bytes:zipStore(files),files};
}

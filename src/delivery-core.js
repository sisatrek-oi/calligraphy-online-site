import {mergeMemberBackup} from './member-task-export.js?v=release-20261019';
import { validateAnnotations } from './theory-annotations.js?v=annotations-20261019';
const ranges=[[1,258],[259,527],[528,776],[777,1052]];
export const progressKey=part=>`shulun-screening-v1-part-${part}`;
export function validateProgress(value){
 if(!value||value.version!==1||!Number.isInteger(value.part)||!ranges[value.part-1]||!value.reviews||typeof value.reviews!=='object'||Array.isArray(value.reviews)||(value.person!==undefined&&value.person!==null&&typeof value.person!=='string'))throw new Error('请选择原分份进度备份JSON，条目审核文件请进入独立审核。');
 const [start,end]=ranges[value.part-1];
 for(const [key,review]of Object.entries(value.reviews)){
  if(!/^\d+$/.test(key)||String(Number(key))!==key||Number(key)<start||Number(key)>end||!review||typeof review!=='object'||Array.isArray(review))throw new Error('备份页码或记录结构无效，原进度未改变。');
  if(review.theoryAnnotations!==undefined)validateAnnotations(review.theoryAnnotations);
  const d=review.collation;
  if(d!==undefined&&(!d||typeof d!=='object'||Array.isArray(d)||(d.text!==undefined&&typeof d.text!=='string')||(d.edits!==undefined&&!Array.isArray(d.edits))))throw new Error('备份正文或修改历史结构无效，原进度未改变。');
 }
 if(value.exportScope!==undefined)mergeMemberBackup(value,{version:1,part:value.part,reviews:{}},value.exportScope?.member);
 return value;
}
export function readProgress(storage,part){
 const raw=storage.getItem(progressKey(part));
 return {raw,value:raw===null?{version:1,part,person:'',reviews:{}}:validateProgress(JSON.parse(raw))};
}
export function restoreProgress(storage,value,expectedRaw){
 validateProgress(value);
 const key=progressKey(value.part);
 if(storage.getItem(key)!==expectedRaw)throw new Error('其他标签页已更新此分份，请重新选择备份并核对。');
 const next=value.exportScope!==undefined?mergeMemberBackup(value,readProgress(storage,value.part).value,value.exportScope.member):value;
 storage.setItem(key,JSON.stringify(next));
}
export function compareProgress(before,incoming){
 const old=before?.reviews||{},next=incoming.reviews;
 return {incoming:Object.keys(next).length,current:Object.keys(old).length,changed:Object.keys(next).filter(k=>old[k]&&JSON.stringify(old[k])!==JSON.stringify(next[k])).length,omitted:Object.keys(old).filter(k=>!Object.hasOwn(next,k)).length};
}

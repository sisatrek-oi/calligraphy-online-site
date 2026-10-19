import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProgress,readProgress,restoreProgress,compareProgress,progressKey} from '../src/delivery-core.js';
const source=()=>({version:1,part:1,person:'成员',lastPage:6,reviews:{5:{collation:{text:'旧已做正文',verified:true,metricBaseline:{version:1,text:'原底稿'},edits:[{before:'甲',after:'乙'}]}},7:{question:'排除页原记录'},200:{collation:{text:'移交页草稿',verified:false}}}});
function disk(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),map};}
test('backup validation preserves all old fields and rejects unrelated or malformed input',()=>{
 const old=source(),raw=JSON.stringify(old);assert.equal(validateProgress(old),old);assert.equal(JSON.stringify(old),raw);
 for(const change of [{...old,part:9},{...old,reviews:[]},{...old,reviews:JSON.parse('{"__proto__":{}}')},{...old,reviews:{259:{}}},{...old,reviews:{6:{collation:{text:17}}}},{type:'shulun-review-package'}]){
  assert.throws(()=>validateProgress(change));
 }
});
test('preview is read only and replacement is guarded against concurrent changes',()=>{
 const d=disk(),old=source(),key=progressKey(1);d.setItem(key,JSON.stringify(old));d.setItem(progressKey(2),'other part');
 const before=JSON.stringify([...d.map]);const current=readProgress(d,1),incoming={...source(),reviews:{6:{collation:{text:'恢复版本'}}}};
 assert.deepEqual(compareProgress(current.value,incoming),{incoming:1,current:3,changed:0,omitted:3});assert.equal(JSON.stringify([...d.map]),before);
 d.setItem(key,'another tab');assert.throws(()=>restoreProgress(d,incoming,current.raw),/其他标签页/);assert.equal(d.getItem(key),'another tab');
 d.setItem(key,current.raw);restoreProgress(d,old,current.raw);assert.deepEqual(JSON.parse(d.getItem(key)),old);assert.equal(d.getItem(progressKey(2)),'other part');
});
test('unreadable prior records are surfaced rather than silently replaced',()=>{
 const d=disk();d.setItem(progressKey(1),'{bad');assert.throws(()=>readProgress(d,1));assert.equal(d.getItem(progressKey(1)),'{bad');
});

test('legacy unnamed backups remain valid and page aliases cannot hide duplicate records',()=>{
 const v={version:1,part:1,reviews:{6:{collation:{text:'旧草稿'}}}};const before=JSON.stringify(v);assert.equal(validateProgress(v),v);assert.equal(JSON.stringify(v),before);assert.throws(()=>validateProgress({...v,reviews:{'006':{}}}));
});

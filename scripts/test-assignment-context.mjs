import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assignments} from '../src/team-assignments.js';
import {assignmentContext} from '../src/assignment-context.js';
const indexes=Object.fromEntries([1,2,3,4].map(part=>[part,JSON.parse(fs.readFileSync(new URL(`../screening-data/part-${part}-index.json`,import.meta.url),'utf8'))]));
test('overview uses the same effective human records as the reader without double counting',()=>{
 const records=new Map(),storage={getItem:k=>records.get(k)??null};const a=assignments[2];
 assert.equal(assignmentContext(storage,a,indexes).marked,121);assert.equal(assignmentContext(storage,a,indexes).page,649);
 const old={version:1,part:3,person:'test',lastPage:649,reviews:{528:{collation:{text:'本机未确认修改',verified:false}},649:{collation:{text:'已校',verified:true,checks:{wording:true}}},700:{collation:{text:'移交旧稿',verified:true,checks:{wording:true}}}}};
 records.set('shulun-screening-v1-part-3',JSON.stringify(old));const before=JSON.stringify([...records]);
 const result=assignmentContext(storage,a,indexes);assert.equal(result.marked,121);assert.equal(result.page,649);assert.equal(result.resume,true);assert.equal(JSON.stringify([...records]),before);
});
test('corrupt local records are reported without guessing zero progress',()=>{assert.equal(assignmentContext({getItem:()=>'{bad'},assignments[2],indexes),null);});

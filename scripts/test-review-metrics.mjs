import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readLocalTraces, filterRecords, summarize, replacementKind } from '../src/review-metrics-core.js';
const returned=JSON.parse(fs.readFileSync(new URL('../review-metrics-data.json',import.meta.url),'utf8'));
const storage=value=>({getItem:key=>key.endsWith('-3')?JSON.stringify(value):null,setItem(){throw Error('must remain read-only');}});
test('returned source snapshot retains exact evidence counts',()=>{
  assert.deepEqual(summarize(returned.records),{confirmations:552,notes:70,replacements:22,detailedPages:85});
  assert.deepEqual([1,2,3,4].map(part=>summarize(filterRecords(returned.records,{part})).confirmations),[96,215,155,86]);
  assert.equal(Object.keys(returned.sources).length,78);
});
test('returned replacements and categories retain originals',()=>{
  const records=filterRecords(returned.records,{kind:'replacement'});
  assert.deepEqual(records.slice(0,2).map(r=>[r.page,r.before,r.after]),[[548,'沓','骫'],[580,'软','欤']]);
  assert.ok(records.slice(0,2).every(r=>r.timeKind==='page'));
  assert.equal(filterRecords(returned.records,{kind:'note',category:'看不清／打不出／缺字占位'}).length,28);
});
test('filters intersect and do not mutate input',()=>{
  const original=JSON.stringify(returned);
  assert.equal(filterRecords(returned.records,{part:3,kind:'replacement',query:'沓'}).length,1);
  assert.equal(filterRecords(returned.records,{part:1,kind:'replacement'}).length,20);
  assert.equal(filterRecords(returned.records,{kind:'details'}).length,92);
  assert.equal(JSON.stringify(returned),original);
});
test('local records preserve source, unknown authors, Unicode, stale history and time meaning',()=>{
  const value={version:1,part:3,person:'任务署名不可猜测',reviews:{548:{question:'原话：缺𠮷',collation:{text:'[001] 𠮷。',verified:true,checks:{wording:true},verifiedBy:'确认人',verifiedAt:'2026-10-20T00:00:00Z',edits:[{before:'甲',after:'𠮷',createdAt:'2026-10-20T00:00:01Z',stale:true},{before:'',after:'补'},{before:'多',after:''}]}}}};
  const original=JSON.stringify(value),result=readLocalTraces(storage(value));
  assert.deepEqual(result.problems,[]);
  assert.deepEqual(summarize(result.records),{confirmations:1,notes:1,replacements:3,detailedPages:1});
  assert.equal(result.records[0].person,'确认人');
  const edits=filterRecords(result.records,{kind:'replacement'});
  assert.equal(edits[0].person,'逐条署名未知');assert.equal(edits[0].after,'𠮷');assert.equal(edits[0].stale,true);assert.equal(edits[0].timeKind,'event');assert.equal(edits[1].timeKind,'unknown');
  assert.deepEqual(edits.map(replacementKind),['替换','增补','删除']);
  assert.equal(JSON.stringify(value),original);
});
test('text differences without explicit edits never manufacture replacement history',()=>{
  const result=readLocalTraces(storage({version:1,part:3,reviews:{548:{collation:{text:'新字',metricBaseline:{text:'旧字'}}}}}));
  assert.equal(result.records.length,0);
});
test('malformed local sources remain untouched with visible problems',()=>{
  for(const value of [null,{version:2,part:3,reviews:{}},{version:1,part:3,reviews:[]}])assert.equal(readLocalTraces(storage(value)).problems.length,1);
  assert.equal(readLocalTraces({getItem(){throw Error('blocked');}}).problems.length,4);
  assert.equal(readLocalTraces({getItem:()=>null}).records.length,0);
});
test('invalid pages and edits are skipped, good records survive',()=>{
  const result=readLocalTraces(storage({version:1,part:3,reviews:{0:{question:'invalid'},13:{question:'wrong part'},548:{question:'保留',collation:{edits:[null,{before:'甲',after:'乙'}]}},549:{collation:{edits:{bad:true}}}}}));
  assert.equal(result.records.length,2);assert.ok(result.problems.length>=3);
});
test('invalid confirmations are excluded without deleting notes',()=>{
  assert.deepEqual(summarize(readLocalTraces(storage({version:1,part:3,reviews:{548:{question:'待核',collation:{text:'',verified:true,checks:{wording:true}}}}})).records),{confirmations:0,notes:1,replacements:0,detailedPages:1});
});

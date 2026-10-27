import test from 'node:test';
import assert from 'node:assert/strict';
import { assignments, assignmentCount, assignmentPages, assignmentFor, assignmentSegment, assignmentHref, assignmentProgress, assignmentEntry } from '../src/team-assignments.js';
import { createProgressStore } from '../src/screening-workflow.js';

test('seven assignments cover every active page once after archiving the 50 index pages',()=>{
  const pages=Array.from({length:1052},(_,i)=>({page:i+1}));
  const all=[];
  for(const a of assignments)for(const s of a.segments)all.push(...assignmentPages(pages,a.id,s.part).map(p=>p.page));
  assert.equal(all.length,991);assert.equal(new Set(all).size,991);
  assert.deepEqual(assignments.map(assignmentCount),[148,169,149,125,133,133,134]);
  assert.deepEqual(assignments.map(a=>a.remaining),[0,0,0,9,33,0,0]);
  assert.deepEqual(assignments.slice(0,4).map(a=>[248,269,249,225][a.id-1]-assignmentCount(a)),[100,100,100,100]);
  assert.equal(assignments.reduce((sum,a)=>sum+a.remaining,0),42);
});

test('strict assignment validation, original-part links, and legacy views',()=>{
  assert.equal(assignmentFor(null),null);
  for(const value of ['',0,8,'5x','01'])assert.throws(()=>assignmentFor(value));
  assert.throws(()=>assignmentSegment(5,3));
  assert.equal(assignmentHref(5,1,200),'./screening.html?part=1&member=5&page=200');
  assert.equal(assignmentHref(5,2,200),'./screening.html?part=2&member=5&page=428');
  assert.deepEqual(assignmentPages([{page:5},{page:7},{page:159}],null,1).map(p=>p.page),[5,159]);
});

test('reading seven-person progress does not migrate, overwrite or delete old keys or hidden drafts',()=>{
  const old={version:1,part:1,person:'原成员',lastPage:200,reviews:{
    5:{collation:{text:'已做正文',verified:true,checks:{wording:true},metricBaseline:{version:1,text:'旧底稿'},edits:[{before:'甲',after:'乙'}]}},
    159:{collation:{text:'移交段的旧个人草稿',verified:false}},7:{collation:{text:'目录历史'}}}};
  const entries=new Map([['shulun-screening-v1-part-1',JSON.stringify(old)]]);
  const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};
  const before=JSON.stringify([...entries]);
  assert.equal(assignmentProgress(storage,assignments[0]).verified,1);
  assert.equal(assignmentProgress(storage,assignments[0]).segments[0].lastPage,null);
  assert.equal(assignmentProgress(storage,assignments[4]).draft,1);
  assert.equal(JSON.stringify([...entries]),before);
  const store=createProgressStore(storage,'shulun-screening-v1-part-1',1);
  const restored=store.read();restored.reviews[6]={collation:{text:'新改的前段'}};
  assert.equal(store.save(restored).ok,true);
  const after=JSON.parse(storage.getItem('shulun-screening-v1-part-1'));
  assert.deepEqual(after.reviews[159],old.reviews[159]);
  assert.deepEqual(after.reviews[5],old.reviews[5]);
  assert.deepEqual(after.reviews[7],old.reviews[7]);
});

test('unreadable prior progress is surfaced without replacement',()=>{
  const storage={getItem:()=>'{bad',setItem:()=>assert.fail('must not write')};
  assert.equal(assignmentProgress(storage,assignments[4]),null);
});

test('single member entrance resumes the newest eligible segment without writing records',()=>{
  const records = {1:{version:1,part:1,lastPage:200,savedAt:'2026-10-18',reviews:{}},2:{version:1,part:2,lastPage:440,savedAt:'2026-10-19',reviews:{}}};
  const storage={getItem:k=>JSON.stringify(records[Number(k.split('-').at(-1))]),setItem:()=>assert.fail('read only')};
  const a=assignments[4];
  assert.deepEqual(assignmentEntry(a,assignmentProgress(storage,a)),{part:2,page:440,href:'./screening.html?part=2&member=5&page=440'});
  records[2].lastPage=329;
  assert.equal(assignmentEntry(a,assignmentProgress(storage,a)).page,200);
  records[1].lastPage=6;
  assert.deepEqual(assignmentEntry(a,assignmentProgress(storage,a)),{part:1,page:null,href:'./screening.html?part=1&member=5&page=159'});
  assert.equal(assignmentEntry(a,null).href,'./screening.html?part=1&member=5&page=159');
});

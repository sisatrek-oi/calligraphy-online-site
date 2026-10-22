import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {classifyHan,analyzeHan,untoned} from '../src/review-han-core.js';
import {txtRows,filterTxtRows} from '../src/review-txt-core.js';
const metadata=JSON.parse(fs.readFileSync(new URL('../review-han-data.json',import.meta.url),'utf8'));
test('official metadata identifies 日/曰 as different radicals with equal strokes, not a visual judgment',()=>{
  const result=classifyHan('日','曰',metadata.characters);
  assert.equal(result.shape,'otherNear');assert.equal(result.strokeGap,0);assert.equal(result.sound,'different');
  assert.equal(metadata.source.version,'17.0.0');assert.equal(metadata.characters['日'].pinyin,'rì');
});
test('第/篆 share radical but have a four-stroke difference',()=>{
  const result=classifyHan('第','篆',metadata.characters);
  assert.equal(result.shape,'far');assert.equal(result.commonRadical,true);assert.equal(result.strokeGap,4);
});
test('tone normalization removes only tone marks and preserves ü and ê',()=>{
  assert.equal(untoned('nǚ'),'nü');assert.equal(untoned('nǘ'),'nü');assert.notEqual(untoned('nǚ'),untoned('nǔ'));
  assert.equal(untoned('ế'),'ê');assert.notEqual(untoned('ế'),'e');
});
test('sound evidence supports exact, tone-only, non-overlap and missing partitions',()=>{
  const chars={'甲':{pinyin:'xíng háng'},'乙':{pinyin:'háng'},'丙':{pinyin:'hàng'},'丁':{pinyin:'nǚ'},'戊':{pinyin:'nǔ'}};
  assert.equal(classifyHan('甲','乙',chars).sound,'same');assert.equal(classifyHan('乙','丙',chars).sound,'tone');
  assert.equal(classifyHan('丁','戊',chars).sound,'different');assert.equal(classifyHan('甲','未',chars).sound,'missing');
});
test('structure uses actual radical form markers and minimum recorded stroke gap',()=>{
  const chars={'甲':{radical:"149'.3",strokes:'5 8'},'乙':{radical:'149.3',strokes:'7'},'丙':{radical:"149'.7",strokes:'10'},'丁':{radical:"149'.3",strokes:'8'}};
  assert.equal(classifyHan('甲','乙',chars).shape,'otherNear');assert.equal(classifyHan('甲','丙',chars).shape,'near');assert.equal(classifyHan('甲','丁',chars).shape,'same');
  assert.equal(classifyHan('甲','未知',chars).shape,'missing');
});
test('directions, repetition and page coverage count observed Han positions only',()=>{
  const rows=[{before:'甲',after:'乙',page:13,category:'汉字替换'},{before:'甲',after:'乙',page:14,category:'汉字替换'},{before:'乙',after:'甲',page:14,category:'汉字替换'},{before:'',after:'甲',page:14,category:'汉字增补'}];
  const a=analyzeHan(rows,{});assert.equal(a.total,3);assert.equal(a.uniquePairs,2);assert.equal(a.repeated,2);assert.equal(a.pairs[0].pages.size,2);
  assert.equal(filterTxtRows(rows,{hanPair:'甲→乙'}).length,2);assert.equal(filterTxtRows(rows,{hanShape:'missing',hanPair:'乙→甲'}).length,1);
  assert.equal(rows[3].han,undefined);
});
test('all observed Han classifications partition each comparison and retain exact pair counts',()=>{
  for(const [mode,total,unique,dayCount]of [['baseline',13611,8217,207],['ocr',34555,16594,350]]){
    const data=JSON.parse(fs.readFileSync(new URL(`../review-txt-${mode}.json`,import.meta.url),'utf8'));
    const rows=txtRows(data),a=analyzeHan(rows,metadata.characters);
    assert.equal(a.total,total);assert.equal(a.uniquePairs,unique);
    assert.equal(Object.values(a.shape).reduce((s,n)=>s+n,0),total);assert.equal(Object.values(a.sound).reduce((s,n)=>s+n,0),total);
    assert.equal(a.pairs.reduce((s,p)=>s+p.count,0),total);assert.equal(a.pairs[0].key,'日→曰');assert.equal(a.pairs[0].count,dayCount);
    for(const [key,count]of Object.entries(a.shape))assert.equal(filterTxtRows(rows,{hanShape:key}).length,count);
    for(const [key,count]of Object.entries(a.sound))assert.equal(filterTxtRows(rows,{hanSound:key}).length,count);
  }
});

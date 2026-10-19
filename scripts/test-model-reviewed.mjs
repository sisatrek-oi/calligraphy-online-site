import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validModelReview, modelReviewSummary, humanReviewStage } from '../src/model-reviewed.js';
import { defaultDraftText, draftForPage } from '../src/ocr-source-policy.js';
import { createMaterialLoader } from '../src/screening-loader.js';
import { exportText } from '../src/collation-core.js';
import { checksCsv } from '../src/collation-export.js';
const source=JSON.parse(fs.readFileSync(new URL('../screening-data/part-1-model-reviewed.json',import.meta.url)));
const fixture=()=>structuredClone(source.pages[0]);
test('published full text covers every detected column and remains a machine draft',()=>{
  assert.deepEqual(source.pages.map(p=>p.page),[129,147,244]);
  assert.equal(source.pages.reduce((s,p)=>s+p.columnCount,0),45);
  source.pages.forEach(p=>{assert.equal(validModelReview(p,p.page),true);assert.equal(p.humanConfirmed,false);});
  assert.match(source.pages[2].text,/二三二/);
  assert.equal(source.pages[2].units[0].machineCorrection.reviewerType,'AI-image-check');
});
test('missing, overlapping, unordered columns, wrong image hash and forged human states fail closed',()=>{
  for (const mutate of [p=>p.units.pop(),p=>p.units[1].columns=[1],p=>p.units.reverse(),p=>p.sourceSha256='bad',p=>p.humanConfirmed=true,p=>p.text+='编造',p=>p.reviewedColumnCount--,p=>p.requests[0].seconds=-1]) {
    const p=fixture();mutate(p);assert.equal(validModelReview(p,p.page),false);
  }
});
test('personal text and full human team editions outrank a model; raw, targeted and history stay intact',()=>{
  const modelReviewed=fixture(),item={page:129,ocr:'原OCR',layout:{text:'原OCR'},modelReviewed};
  assert.equal(defaultDraftText(item),modelReviewed.text);
  const review={collation:{text:'个人旧稿',verified:true,checks:{wording:true},edits:[{before:'甲',after:'乙'}],metricBaseline:{text:'旧底稿'}}};
  const before=JSON.stringify({item,review});assert.equal(draftForPage(item,review),review.collation);
  assert.equal(defaultDraftText({...item,collated:{text:'人工团队稿'}}),'人工团队稿');
  assert.equal(defaultDraftText({...item,modelReviewed:{...modelReviewed,text:'坏数据'},targeted:{text:'局部稿'}}),'[001] 局部稿');
  assert.equal(JSON.stringify({item,review}),before);
});
test('bad reviewed chunks attach no fields and can retry after correction',async()=>{
  const p=fixture(), summary=modelReviewSummary(p);
  const d={part:1,pages:[{page:129,modelReviewSummary:summary}],materials:{129:'x.json'}};
  let corrupt=true;
  const loader=createMaterialLoader(d,{fetcher:async()=>({ok:true,json:async()=>({version:1,part:1,pages:[{page:129,ocr:'原OCR',layout:{text:'原OCR'},contextual:{conservative:'原OCR',normalized:'原OCR',uncertainties:[]},modelReviewed:{...p,text:corrupt?'坏正文':p.text}}]})})});
  await assert.rejects(loader.ensurePage(129),/不完整/);assert.equal(d.pages[0].ocr,undefined);
  corrupt=false;await loader.ensurePage(129);assert.equal(d.pages[0].modelReviewed.text,p.text);
});
test('TXT exports reviewed working text without inventing personal progress; CSV separates model from human',()=>{
  const modelReviewed=fixture(),pages=[{page:129,local:129,ocr:'原OCR',modelReviewed}],reviews={};
  const text=exportText({part:1,person:'测试',pages,reviews});
  assert.match(text,/状态：未开始/);assert.match(text,/人工全文检查：待确认/);assert.ok(text.includes(modelReviewed.text));assert.deepEqual(reviews,{});
  const csv=checksCsv({pages,progress:{person:'测试',reviews}});assert.match(csv,/"已复核","待人工全文检查"/);
  reviews[129]={collation:{text:'人工修改',verified:true,checks:{wording:true,fulltext:true},fullTextChecked:true}};
  assert.match(exportText({part:1,person:'测试',pages,reviews}),/人工全文检查：已确认/);
  assert.equal(humanReviewStage(reviews[129]),'人工全文已确认');
  assert.equal(humanReviewStage({collation:{text:'[001] 旧稿',verified:true,checks:{wording:true}}}),'历史错字核对已确认');
});

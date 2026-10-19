import test from 'node:test';
import assert from 'node:assert/strict';
import { humanMarked, humanMarkLabel, nextUnmarkedIndex } from '../src/human-mark.js';
import { exportText } from '../src/collation-core.js';
const checked={collation:{text:'[001] 人工原稿',verified:true,checks:{wording:true},metricBaseline:{text:'旧比较底稿'},edits:[{before:'甲',after:'乙'}]}};
test('machine completion cannot mark a page, and old human confirmation does not need a new scope flag',()=>{
  for(const machine of [{},{modelReviewSummary:{status:'待人工全文检查'}},{modelReviewed:{text:'机器稿',status:'done'}},{targetedSummary:{confirmed:12}}]){
    const item={page:129,ocr:'原OCR',...machine};
    assert.equal(humanMarked(item),false);assert.equal(humanMarkLabel(item),'未标过');
    assert.equal(humanMarked(item,checked),true);assert.equal(humanMarkLabel(item,checked),'已标过');
    assert.equal(humanMarked(item,{seen:true}),false);
    assert.equal(humanMarked(item,{collation:{text:'未确认草稿',checks:{wording:true}}}),false);
  }
});
test('returned human pages stay marked, including unresolved glyphs; newer personal edits require a new mark',()=>{
  const item={page:5,ocr:'原OCR',publication:{pending:1},collated:{text:'[001] 团队原稿【待核：字】'}};
  assert.equal(humanMarked(item),true);assert.equal(humanMarked(item,checked),true);
  assert.equal(humanMarked(item,{collation:{text:'人工新改稿',verified:false}}),false);
  assert.equal(humanMarked(item,{collation:{text:'',verified:true,checks:{wording:true}}}),false);
  const before=JSON.stringify({item,checked});humanMarked(item,checked);assert.equal(JSON.stringify({item,checked}),before);
});
test('next page skips human marks alone and does not skip model-reviewed pages',()=>{
  const pages=[{page:5,publication:{}},{page:6,modelReviewSummary:{}},{page:13},{page:14}];
  const reviews={13:checked};
  assert.equal(nextUnmarkedIndex(pages,reviews,0),1);
  assert.equal(nextUnmarkedIndex(pages,reviews,1),3);
  assert.equal(nextUnmarkedIndex(pages,reviews,3),1);
});
test('TXT reflects the human mark and preserves returned team text, without attributing it to the exporter',()=>{
  const item={page:5,local:5,ocr:'旧OCR',publication:{},collated:{text:'[001] 团队原稿'}};
  const text=exportText({part:1,person:'下载者',pages:[item],reviews:{}});
  assert.match(text,/状态：已标过/);assert.match(text,/校验人：已回收团队记录/);assert.match(text,/团队原稿/);
  assert.doesNotMatch(text,/校验人：下载者|大模型已复核|待人工全文检查/);
});

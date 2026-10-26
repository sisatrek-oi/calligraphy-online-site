import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {txtRows,filterTxtRows,txtPage} from '../src/review-txt-core.js';
import {editDistance} from '../src/task-metrics.js';

for(const [mode,pages,changes,beforeChars]of [['baseline',744,59548,326178],['ocr',918,144607,390750]]){
  const data=JSON.parse(fs.readFileSync(new URL(`../review-txt-${mode}.json`,import.meta.url),'utf8'));
  test(mode+' TXT total categories and edits independently match website distance',()=>{
    const rows=txtRows(data);
    assert.equal(data.pages.length,pages);assert.equal(rows.length,changes);assert.equal(data.summary.beforeChars,beforeChars);
    assert.equal(Object.values(data.summary.categories).reduce((a,b)=>a+b,0),changes);
    assert.equal(Object.values(data.summary.operations).reduce((a,b)=>a+b,0),changes);
    assert.equal(data.pages.reduce((sum,p)=>sum+editDistance(p.before,p.after),0),changes);
    for(const c of data.categories)assert.equal(rows.filter(r=>r.category===c).length,data.summary.categories[c]);
    for(const kind of data.kinds)assert.equal(rows.filter(r=>r.kind===kind).length,data.summary.operations[kind]);
    assert.ok(data.pages.every(p=>(p.sourceAfter.includes('member-input')||p.sourceAfter.includes('extracted'))&&!p.after.includes('【空白页】')));
    assert.equal(rows.filter(r=>r.before===undefined||r.after===undefined).length,0);
  });
}
test('TXT Unicode positions and empty sides remain correct',()=>{
  const rows=txtRows({kinds:['replace','insert','delete'],categories:['汉字替换'],pages:[{page:13,part:1,before:'甲𠮷乙',after:'甲中丙',edits:[[0,0,1,1],[2,0,2,2],[1,0,3,2]]}]});
  assert.equal(rows[0].before,'𠮷');assert.equal(rows[0].after,'中');assert.ok(rows[0].beforeContext.includes('⟦𠮷⟧'));
  assert.equal(rows[1].after,'');assert.equal(rows[2].before,'');assert.equal(rows[2].after,'丙');
});
test('TXT filters intersect without mixing categories and operation types',()=>{
  const rows=[{page:13,kind:'replace',category:'汉字替换',before:'赵',after:'壹',beforeContext:'赵本',afterContext:'赵壹'},{page:14,kind:'insert',category:'标点／符号',before:'',after:'，',beforeContext:'甲',afterContext:'甲，'}];
  const before=JSON.stringify(rows);
  assert.equal(filterTxtRows(rows,{query:'赵壹',kind:'replace'}).length,1);
  assert.equal(filterTxtRows(rows,{category:'汉字替换',kind:'insert'}).length,0);
  assert.equal(filterTxtRows(rows,{query:'13'}).length,1);assert.equal(JSON.stringify(rows),before);
});
test('TXT pagination exposes every row with clamped and empty states',()=>{
  const rows=Array.from({length:11118},(_,i)=>i),last=txtPage(rows,99999);
  assert.equal(last.number,223);assert.equal(last.rows.length,18);assert.equal(last.end,11118);
  assert.equal(txtPage(rows,NaN).number,1);assert.equal(txtPage(rows,-2).number,1);
  assert.equal(txtPage([],1).start,0);assert.equal(txtPage([],1).totalPages,1);
});

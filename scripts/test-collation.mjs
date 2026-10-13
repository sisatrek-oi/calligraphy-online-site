import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDraft, numberLines, moveLine, validateDraft, isVerified, exportText } from '../src/collation-core.js';

test('formatting preserves source characters, column order, and Latin spacing', () => {
  assert.equal(makeDraft('右 數 君\n\n有 力\nLatin words'), '[001] 右數君\n[002] 有力\n[003] Latin words');
  const moved = moveLine('[001] 右栏\n[002] 左栏', 0, 1);
  assert.equal(moved.text, '[001] 左栏\n[002] 右栏');
  assert.equal(moved.caret, '[001] 左栏\n'.length);
  assert.equal(numberLines('[009] 甲\n[003] 乙'), '[001] 甲\n[002] 乙');
});

test('only missing body blocks the typo-only round; symbols and format remain advisory', () => {
  const checks = { wording:true };
  for (const text of ['', '  \n ', '[001]', '[001] \n[002] ']) {
    assert.ok(validateDraft({ text }).errors.length);
    assert.equal(isVerified({text, checks, verified:true}), false);
  }
  for (const text of ['[002] 甲', '甲，乙。', '[001] □', '[001] 【待核：字】', '[001] 甲\n[002]', '[001] 【空白页】']) {
    assert.deepEqual(validateDraft({ text }).errors, []);
    assert.equal(isVerified({ text, checks, verified:true }), true);
  }
  const unusual = validateDraft({text:'甲□\n甲□'}, '原有正文有很多个字');
  assert.ok(unusual.warnings.some(w => w.includes('20%')));
  assert.ok(unusual.warnings.some(w => w.includes('相同')));
  assert.ok(unusual.warnings.some(w => w.includes('标记')));
  assert.equal(isVerified({text:'甲□\n甲□', checks, verified:true}), true);
  assert.equal(isVerified({text:'[001] 甲', checks:{order:true}, verified:true}), false);
  assert.equal(isVerified({text:'[001] 甲', checks, verified:false}), false);
});

test('old completed pages stay verified and partial old drafts never become completed', () => {
  const legacy = {text:'[001] 甲', checks:{order:true,wording:true,continuity:true}, verified:true};
  assert.equal(isVerified(legacy), true);
  assert.equal(isVerified({...legacy, verified:false}), false);
  assert.equal(isVerified({text:'甲', checks:{wording:true}}), false);
  assert.equal(isVerified(null), false);
  const out = exportText({part:2, person:'测试', pages:[{page:259,local:1}], reviews:{259:{collation:legacy}}});
  assert.match(out, /状态：已校验/);
  assert.match(out, /\[x\] 已对照原页核对本页错字/);
  assert.match(out, /标点、符号、栏序和跨页衔接不属于本轮必检项/);
  assert.equal(out.includes('已核对本页首尾'), false);
});

test('TXT export preserves every page and differentiates drafts, old seen flags, and verification', () => {
  const out = exportText({part:2, person:'测试', pages:[{page:259,local:1},{page:260,local:2}],
    reviews:{259:{seen:true},260:{collation:{text:'[001] 甲',verified:false}}}});
  assert.match(out, /物理页 259｜分册第 1 页 =====\n状态：未开始/);
  assert.match(out, /物理页 260｜分册第 2 页 =====\n状态：草稿/);
  assert.equal(out.includes('状态：已校验'), false);
});

test('all 1052 layout suggestions preserve every non-whitespace source character', () => {
  let count = 0;
  for (let part = 1; part <= 4; part++) {
    const layout = JSON.parse(fs.readFileSync(new URL(`../screening-data/part-${part}-layout.json`, import.meta.url)));
    const raw = fs.readFileSync(new URL(`../screening-data/part-${part}-ocr.txt`, import.meta.url), 'utf8');
    const headings = [...raw.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
    assert.equal(headings.length, layout.pages.length);
    headings.forEach((heading,index) => {
      const source = raw.slice(heading.index + heading[0].length, headings[index+1]?.index ?? raw.length);
      assert.equal(layout.pages[index].page, Number(heading[1]));
      assert.equal(layout.pages[index].text.replace(/\s/g,''), source.replace(/\s/g,''));
      count++;
    });
  }
  assert.equal(count,1052);
});

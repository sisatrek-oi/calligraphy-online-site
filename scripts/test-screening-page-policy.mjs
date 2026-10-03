import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { excludedPages, isTaskPage, taskPageCount, taskOcrHref } from '../src/screening-page-policy.js';
import { exportText } from '../src/collation-core.js';

const excluded = [1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 1052];
const ranges = [[1, 258], [259, 527], [528, 776], [777, 1052]];
const read = name => fs.readFileSync(new URL(`../screening-data/${name}`, import.meta.url), 'utf8');
const blocks = text => {
  const headings = [...text.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
  return new Map(headings.map((h, i) => [Number(h[1]), text.slice(h.index, headings[i + 1]?.index ?? text.length)]));
};

test('only the 11 inspected pages are excluded; original page labels stay intact', () => {
  assert.deepEqual(Object.keys(excludedPages).map(Number), excluded);
  assert.deepEqual(ranges.map(range => taskPageCount(...range)), [248, 269, 249, 275]);
  assert.equal(taskPageCount(1, 1052), 1041);
  const pages = JSON.parse(read('part-1.json')).pages.filter(p => isTaskPage(p.page));
  assert.deepEqual(pages.slice(0, 3).map(p => [p.page, p.local]), [[5, 5], [6, 6], [13, 13]]);
  for (const page of [5, 6, 13, 16, 1046, 1051]) assert.ok(isTaskPage(page));
});

test('exports omit removed pages even when old saved drafts exist', () => {
  const pages = [...excluded, 5, 6, 13].map(page => ({ page, local: page }));
  const reviews = Object.fromEntries(pages.map(p => [p.page, { collation: { text: `[001] 测试页${p.page}` } }]));
  const before = JSON.stringify(reviews);
  const result = exportText({ part: 1, person: '范围测试', pages, reviews });
  assert.deepEqual([...blocks(result).keys()], [5, 6, 13]);
  assert.equal(JSON.stringify(reviews), before);
});

test('all task downloads retain complete source blocks without removed pages', () => {
  let count = 0;
  for (let part = 1; part <= 4; part++) {
    const raw = blocks(read(`part-${part}-ocr.txt`));
    const output = fs.readFileSync(new URL(`../${taskOcrHref(part)}`, import.meta.url), 'utf8');
    const actual = blocks(output);
    const expected = new Map([...raw].filter(([page]) => !excluded.includes(page)));
    assert.deepEqual(actual, expected);
    count += actual.size;
  }
  assert.equal(count, 1041);
});

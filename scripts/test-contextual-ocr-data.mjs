import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ranges = [[1, 258], [259, 527], [528, 776], [777, 1052]];

test('contextual OCR payloads cover every physical page with both versions', () => {
  let pages = [];
  for (let part = 1; part <= 4; part += 1) {
    const payload = JSON.parse(fs.readFileSync(new URL(`../screening-data/part-${part}-contextual.json`, import.meta.url), 'utf8'));
    assert.equal(payload.part, part);
    assert.deepEqual([payload.start, payload.end], ranges[part - 1]);
    assert.equal(payload.pages.length, payload.end - payload.start + 1);
    payload.pages.forEach(item => {
      assert.equal(typeof item.conservative, 'string');
      assert.equal(typeof item.normalized, 'string');
      assert.ok(Array.isArray(item.uncertainties));
    });
    pages = pages.concat(payload.pages.map(item => item.page));
  }
  assert.deepEqual(pages, Array.from({ length: 1052 }, (_, index) => index + 1));
});

test('comparison report records the full-book comparison scope', () => {
  const report = fs.readFileSync(new URL('../tasks/2026-10-11-ocr-cleaning/full-book-comparison.md', import.meta.url), 'utf8');
  assert.match(report, /物理页：1052/);
  assert.match(report, /忽略空白后有差异：732 页/);
});

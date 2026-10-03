import test from 'node:test';
import assert from 'node:assert/strict';
import { theoryRanges, highlightHtml } from '../src/theory-highlight.js';

test('highlights theory and nearby context without pure biography or publishing notes', () => {
  const text = '[001] 钟繇字元常，颍川长社人。\n[002] 善真书，笔力雄健。其妙如此。\n[003] 本书由上海书画出版社出版。';
  const ranges = theoryRanges(text);
  assert.equal(ranges.filter(r => r.type === 'theory').length, 1);
  assert.equal(ranges.filter(r => r.type === 'context').length, 1);
  assert.ok(ranges.every(r => !text.slice(r.start,r.end).includes('出版社')));
  assert.ok(ranges.every(r => !text.slice(r.start,r.end).includes('长社人')));
});

test('matches across column breaks and keeps exact source offsets', () => {
  const text = '[001] 用\n[002] 筆之法，在於藏鋒。';
  const ranges = theoryRanges(text);
  assert.equal(ranges.length, 1);
  assert.equal(text.slice(ranges[0].start,ranges[0].end), '用\n[002] 筆之法，在於藏鋒。');
});

test('preface theory is retained but a generic book introduction is not selected', () => {
  assert.equal(theoryRanges('[001] 序：用笔之法，在于藏锋。')[0].type, 'theory');
  assert.equal(theoryRanges('[001] 出版说明：本书选编历代书法论文。责任编校黄简。').length, 0);
  assert.equal(theoryRanges('[001] 张怀瓘，唐代书法家，海陵人。官至翰林院供奉。').length, 0);
});

test('highlight rendering escapes source markup and never edits the input', () => {
  const text = '[001] 用笔 <script> & 结体。';
  const html = highlightHtml(text,theoryRanges(text));
  assert.ok(html.includes('&lt;script&gt; &amp;'));
  assert.equal(html.replace(/<[^>]+>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'), text+'\n');
});

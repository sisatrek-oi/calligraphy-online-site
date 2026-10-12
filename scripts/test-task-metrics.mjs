import test from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, metricText, metricsCsv, pageMetrics, taskMetrics } from '../src/task-metrics.js';

test('task metrics ignore line labels and whitespace when measuring edits', () => {
  assert.equal(metricText('[001] 甲\n[002] 乙'), '甲乙');
  assert.equal(editDistance('甲乙', '甲丙'), 1);
  const pages = [{ page: 13, local: 1, ocr: '[001] 甲乙' }];
  const reviews = { 13: { seen: true, question: '待核', collation: {
    text: '[001] 甲丙', metricBaseline: { version: 1, text: '[001] 甲乙', label: '底稿' },
    checks: { order: true, wording: true, continuity: true }, verified: true,
  }, candidates: [{ quote: '甲' }] } };
  const row = pageMetrics(pages[0], reviews[13]);
  assert.equal(row.verified, true);
  assert.equal(row.changes, 1);
  assert.equal(row.modificationRate, 50);
  const summary = taskMetrics(pages, reviews);
  assert.equal(summary.completionRate, 100);
  assert.equal(summary.modificationRate, 50);
  assert.equal(summary.questionPages, 1);
  assert.equal(summary.candidates, 1);
  assert.match(metricsCsv({ part: 1, person: '测', pages, reviews }), /净修改率/);
});

test('unstarted pages have no fake modification rate', () => {
  const pages = [{ page: 14, local: 2, ocr: '乙' }];
  const summary = taskMetrics(pages, {});
  assert.equal(summary.total, 1);
  assert.equal(summary.unstarted, 1);
  assert.equal(summary.modificationRate, null);
});

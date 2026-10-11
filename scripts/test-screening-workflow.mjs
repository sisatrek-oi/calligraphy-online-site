import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressStore, initialPageIndex, matchesFilter, nextPendingIndex, progressSummary } from '../src/screening-workflow.js';

const pages = [5, 6, 13, 14].map(page => ({ page, ocr: '文字' }));
const verified = { text: '[001] 文字', checks: { order: true, wording: true, continuity: true }, verified: true };

test('explicit page beats resume; removed pages advance without renumbering', () => {
  assert.equal(initialPageIndex(pages, '13', 6), 2);
  assert.equal(initialPageIndex(pages, null, 13), 2);
  assert.equal(initialPageIndex(pages, '7', 5), 2);
  assert.equal(initialPageIndex(pages, null, undefined), 0);
  assert.equal(initialPageIndex(pages, '999', 5), 3);
});

test('next pending wraps across omissions, skips verified pages, stops on completion', () => {
  const reviews = { 5: { collation: verified }, 6: { collation: verified }, 14: { collation: verified } };
  assert.equal(nextPendingIndex(pages, reviews, 0), 2);
  assert.equal(nextPendingIndex(pages, reviews, 3), 2);
  assert.equal(nextPendingIndex(pages, reviews, 2), -1);
  reviews[13] = { collation: verified };
  assert.equal(nextPendingIndex(pages, reviews, 3), -1);
});

test('summary and filters preserve draft versus unstarted and legacy seen states', () => {
  const reviews = { 5: { collation: verified }, 6: { collation: { text: '[001] 草稿' } }, 13: { seen: true } };
  assert.deepEqual(progressSummary(pages, reviews), { verified: 1, draft: 1, unstarted: 2 });
  assert.equal(matchesFilter(pages[0], reviews, 'pending'), false);
  assert.equal(matchesFilter(pages[1], reviews, 'draft'), true);
  assert.equal(matchesFilter(pages[2], reviews, 'pending'), true);
});

function storageFixture() {
  const data = new Map(); let full = false;
  return { data, setFull(value) { full = value; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { if (full) throw new Error('QuotaExceededError'); data.set(key, value); } };
}
const payload = { version: 1, part: 1, reviews: {} };

test('failed saving remains retryable and cannot advance stored progress', () => {
  const storage = storageFixture(), store = createProgressStore(storage, 'progress', 1);
  store.read(); assert.equal(store.save(payload).ok, true);
  storage.setFull(true);
  assert.deepEqual(store.save({ ...payload, lastPage: 13 }), { ok: false, conflict: false });
  assert.equal(JSON.parse(storage.getItem('progress')).lastPage, undefined);
  storage.setFull(false);
  assert.equal(store.save({ ...payload, lastPage: 13 }).ok, true);
});

test('stale or deleted progress is never silently overwritten by another tab', () => {
  const storage = storageFixture(), first = createProgressStore(storage, 'progress', 1), second = createProgressStore(storage, 'progress', 1);
  first.read(); second.read(); first.save({ ...payload, lastPage: 13 });
  assert.deepEqual(second.save(payload), { ok: false, conflict: true });
  assert.equal(second.read().lastPage, 13);
  assert.equal(second.save(payload).ok, true);
  storage.data.delete('progress');
  assert.deepEqual(second.save(payload), { ok: false, conflict: true });
});

test('corrupt and wrong-part progress cannot be overwritten without explicit backup replacement', () => {
  for (const raw of ['broken', JSON.stringify({ ...payload, part: 2 }), JSON.stringify({ ...payload, reviews: [] })]) {
    const storage = storageFixture(); storage.data.set('progress', raw);
    const store = createProgressStore(storage, 'progress', 1);
    assert.throws(() => store.read());
    assert.deepEqual(store.save(payload), { ok: false, conflict: true });
    assert.equal(storage.getItem('progress'), raw);
    store.allowBackupReplacement(); assert.equal(store.save(payload).ok, true);
  }
});

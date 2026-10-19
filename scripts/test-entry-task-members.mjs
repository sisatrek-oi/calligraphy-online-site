import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
const context = {window: {}, crypto: {randomUUID}};
vm.runInNewContext(fs.readFileSync(new URL('../src/entry-task-members.js', import.meta.url), 'utf8'), context);
const api = context.window.EntryTaskMembers;
const memory = () => {
  const data = new Map([['calligraphy-workspace-v2:task-a', '{"rows":[{"id":"old","reviewed":true}]}'], ['shulun-screening-v1-part-3', '原稿与草稿']]);
  return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
};
test('local roster additions are task scoped and never alter entry or source records', () => {
  const storage = memory(), protectedData = [...storage.data];
  assert.equal(api.read(storage, 'task-a').members.length, 7);
  api.add(storage, 'task-a', '自定义成员');
  assert.equal(api.read(storage, 'task-a').members.length, 8);
  assert.equal(api.read(storage, 'task-b').members.length, 7);
  for (const [key, value] of protectedData) assert.equal(storage.getItem(key), value);
});
test('rejects empty, duplicate, overlong and multiline names; trims names', () => {
  const storage = memory();
  for (const name of ['', '  ', '肖源', '甲\n乙', '甲'.repeat(41)]) assert.throws(() => api.add(storage, 'a', name));
  api.add(storage, 'a', '  Alice  ');
  assert.equal(api.read(storage, 'a').members.at(-1).name, 'Alice');
  assert.throws(() => api.add(storage, 'a', 'ＡＬＩＣＥ'), /同名/);
});
test('reads latest additions and retains unknown metadata', () => {
  const storage = memory();
  storage.setItem(api.key('a'), JSON.stringify({version: 1, customMembers: [], future: {retain: true}}));
  api.add(storage, 'a', '甲'); api.add(storage, 'a', '乙');
  assert.equal(api.read(storage, 'a').members.length, 9);
  assert.equal(JSON.parse(storage.getItem(api.key('a'))).future.retain, true);
});
test('corrupt, future, duplicate and malformed rosters are never overwritten', () => {
  for (const raw of ['{bad', '{"version":2,"customMembers":[]}', '{"version":1,"customMembers":[{"id":"x","name":"肖源"}]}', '{"version":1,"customMembers":[null]}']) {
    const storage = memory(); storage.setItem(api.key('a'), raw);
    assert.throws(() => api.add(storage, 'a', '甲'));
    assert.equal(storage.getItem(api.key('a')), raw);
  }
});
test('storage errors and conflicting writes do not pretend success', () => {
  assert.throws(() => api.add({getItem() {throw new Error('blocked');}}, 'a', '甲'), /blocked/);
  const storage = memory(); storage.setItem = () => {throw new Error('quota');};
  assert.throws(() => api.add(storage, 'a', '甲'), /quota/);
  let reads = 0;
  assert.throws(() => api.add({getItem() {return ++reads === 1 ? null : 'changed';}, setItem() {assert.fail('must not write');}}, 'a', '甲'), /其他页面/);
});
test('collapse preference is independent for each task and separate from roster', () => {
  const storage = memory(); api.add(storage, 'a', '甲');
  const before = storage.getItem(api.key('a'));
  assert.equal(api.folded(storage, 'a'), true);
  api.setFolded(storage, 'a', false);
  assert.equal(api.folded(storage, 'a'), false);
  assert.equal(api.folded(storage, 'b'), true);
  assert.equal(storage.getItem(api.key('a')), before);
});

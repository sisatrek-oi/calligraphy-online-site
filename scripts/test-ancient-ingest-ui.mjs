import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(hostname = "") {
  const requests = [];
  const nodes = new Map();
  const document = { querySelector: (s) => nodes.get(s) || null, querySelectorAll: () => [], activeElement: null };
  const window = { location: { hostname }, addEventListener() {}, setTimeout: () => 1 };
  const context = vm.createContext({ window, document, clearTimeout() {}, Map, FormData: class { constructor(form) { this.form = form; } get(key) { return this.form[key]; } }, fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, finish: (payload, ok = true, status = ok ? 200 : 500) => resolve({ ok, status, json: async () => payload }) })) });
  const source = fs.readFileSync(new URL('../src/ancient-ingest.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace('window.AncientIngestUI =', 'window.testUI = { state, selectPage, savePage, importPages, bookTaskGroups }; window.AncientIngestUI ='), context);
  const { state } = window.testUI;
  Object.assign(state, { status: 'ready', selectedJobId: 'job-a', jobs: [{ id: 'job-a', records: [1, 2].map((printedPage) => ({ printedPage, status: 'complete' })) }] });
  return { ...window.testUI, ui: window.AncientIngestUI, requests, nodes };
}

test('hosted material preparation keeps file import available and explains local PDF processing', async () => {
  const h = harness('example.vercel.app');
  h.state.status = 'idle';
  await h.ui.load();
  assert.equal(h.requests.length, 0);
  const markup = h.ui.render();
  assert.match(markup, /导入已有材料/);
  assert.match(markup, /data-home-focus="file"/);
  assert.match(markup, /PDF 识别与逐页校对需在本地服务中进行/);
  assert.doesNotMatch(markup, /ancientIngestUploadForm/);
});

test('local material preparation offers existing files and PDF in the same workspace', () => {
  const h = harness('localhost');
  const markup = h.ui.render();
  assert.match(markup, /data-home-focus="file"/);
  assert.match(markup, /ancientIngestUploadForm/);
  assert.match(markup, /处理古籍 PDF/);
});

test('static local preview falls back to file import when PDF APIs are absent', async () => {
  const h = harness('127.0.0.1');
  h.state.status = 'idle';
  const loading = h.ui.load();
  h.requests[0].finish({}, false, 404);
  await loading;
  assert.equal(h.state.status, 'local-only');
  assert.match(h.ui.render(), /data-home-focus="file"/);
  assert.match(h.ui.render(), /bookTaskCreateForm/);
  assert.doesNotMatch(h.ui.render(), /请求失败/);
});

test('ancient books form separate tasks and editions remain inside their book', () => {
  const h = harness('localhost');
  h.ui.configure({
    bookTasks: () => [{ key: 'book:甲书', title: '甲书', count: 3 }],
    currentBookTask: () => ({ key: 'book:甲书', title: '甲书' }),
  });
  h.state.jobs = [
    { id: 'a1', bookTitle: '甲书', edition: '初版', sourceName: 'a.pdf', records: [], status: 'complete' },
    { id: 'a2', bookTitle: ' 甲书 ', edition: '再版', sourceName: 'a2.pdf', records: [], status: 'complete' },
    { id: 'b1', bookTitle: '乙书', sourceName: 'b.pdf', records: [], status: 'complete' },
  ];
  h.state.selectedBookKey = 'book:甲书';
  h.state.selectedJobId = 'a1';
  const groups = h.bookTaskGroups();
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups.find((group) => group.key === 'book:甲书').jobs, (job) => job.id), ['a1', 'a2']);
  const markup = h.ui.render();
  assert.match(markup, /按古籍选择任务/);
  assert.match(markup, /初版/);
  assert.match(markup, /再版/);
  assert.doesNotMatch(markup, /data-ingest-job="b1"/);
});

test('page import stops when the matching book workspace cannot be activated', async () => {
  const h = harness('localhost');
  let imported = false;
  h.ui.configure({ activateBookTask: () => false, importFiles: async () => { imported = true; } });
  h.state.jobs[0].bookTitle = '甲书';
  h.state.selectedBookKey = 'book:甲书';
  await h.importPages();
  assert.equal(imported, false);
  assert.match(h.state.error, /原文未导入当前主表/);
});

test('late page response cannot replace the newly selected page', async () => {
  const h = harness();
  const a = h.selectPage(1);
  const b = h.selectPage(2);
  h.requests[1].finish({ text: 'second', record: { printedPage: 2 } }); await b;
  h.requests[0].finish({ text: 'first', record: { printedPage: 1 } }); await a;
  assert.equal(h.state.pageText, 'second');
  assert.equal(h.state.pageRecord.printedPage, 2);
});

test('save completion for an old page cannot replace the new page', async () => {
  const h = harness();
  h.state.selectedPrintedPage = 1;
  h.state.pageStatus = 'ready';
  const save = h.savePage({ dataset: { page: '1' }, text: 'edited first' });
  const next = h.selectPage(2);
  h.requests[1].finish({ text: 'second', record: { printedPage: 2 } }); await next;
  h.requests[0].finish({ text: 'edited first', record: { printedPage: 1 } }); await save;
  assert.equal(h.state.pageText, 'second');
  assert.equal(h.state.pageRecord.printedPage, 2);
});

test('page drafts survive navigation and job refresh rerenders', async () => {
  const h = harness();
  const first = h.selectPage(1);
  h.requests[0].finish({ text: 'first', record: { printedPage: 1 } }); await first;
  const listeners = {};
  h.nodes.set('#ancientIngestPageForm textarea', { addEventListener: (name, fn) => { listeners[name] = fn; } });
  h.ui.attach();
  assert.ok(listeners.input, 'editor must track unsaved input');
  listeners.input({ target: { value: 'unsaved correction' } });
  assert.equal(h.state.pageText, 'unsaved correction');
  const second = h.selectPage(2); h.requests[1].finish({ text: 'second', record: { printedPage: 2 } }); await second;
  const back = h.selectPage(1); h.requests[2].finish({ text: 'first', record: { printedPage: 1 } }); await back;
  assert.equal(h.state.pageText, 'unsaved correction');
});

test('save sends page revision and refreshes invalidated candidate state', async () => {
  const h = harness();
  h.state.selectedPrintedPage = 1; h.state.pageStatus = 'ready';
  h.state.pageRecord = { printedPage: 1, revision: 4 };
  const saving = h.savePage({ dataset: { page: '1' }, text: 'revision five' });
  assert.equal(JSON.parse(h.requests[0].options.body).revision, 4);
  h.requests[0].finish({text:'revision five', rawText:'raw', record:{printedPage:1,revision:5}, job:{id:'job-a', records:[{printedPage:1,revision:5}], extractedCount:0, extractedPages:[]}});
  await saving;
  assert.equal(h.state.rawText, 'raw');
  assert.equal(h.state.jobs[0].extractedCount, 0);
  assert.equal(h.state.pageRecord.revision, 5);
});

test('save conflict preserves local draft across navigation', async () => {
  const h = harness(); h.state.selectedPrintedPage = 1; h.state.pageStatus = 'ready';
  const saving = h.savePage({ dataset: { page: '1' }, text: 'keep my draft' });
  h.requests[0].finish({error:'页面已被更新'}, false); await saving;
  assert.match(h.state.error, /页面已被更新/);
  const reading = h.selectPage(1);
  h.requests[1].finish({text:'server revision',rawText:'raw original',record:{printedPage:1,revision:9}});await reading;
  assert.equal(h.state.pageText, 'keep my draft');
  assert.equal(h.state.rawText, 'raw original');
});

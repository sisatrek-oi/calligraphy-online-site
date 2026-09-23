import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  const requests = [];
  const nodes = new Map();
  const document = { querySelector: (s) => nodes.get(s) || null, querySelectorAll: () => [], activeElement: null };
  const window = { addEventListener() {}, setTimeout: () => 1 };
  const context = vm.createContext({ window, document, clearTimeout() {}, Map, FormData: class { constructor(form) { this.form = form; } get(key) { return this.form[key]; } }, fetch: (url, options) => new Promise((resolve) => requests.push({ url, options, finish: (payload, ok = true) => resolve({ ok, status: ok ? 200 : 500, json: async () => payload }) })) });
  const source = fs.readFileSync(new URL('../src/ancient-ingest.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace('window.AncientIngestUI =', 'window.testUI = { state, selectPage, savePage }; window.AncientIngestUI ='), context);
  const { state } = window.testUI;
  Object.assign(state, { status: 'ready', selectedJobId: 'job-a', jobs: [{ id: 'job-a', records: [1, 2].map((printedPage) => ({ printedPage, status: 'complete' })) }] });
  return { ...window.testUI, ui: window.AncientIngestUI, requests, nodes };
}

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

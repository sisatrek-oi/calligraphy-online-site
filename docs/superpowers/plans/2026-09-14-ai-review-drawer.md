# AI Review Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing single-record AI suggestions from the permanent detail column into an on-demand right-side review drawer without changing the underlying extraction API or human-approval rules.

**Architecture:** Keep the current AI request and proposal state in `src/main.js`, add one `aiDrawerOpen` presentation flag, and render the drawer as a sibling of the three-column workbench so it overlays rather than resizes the table. Reuse the existing request-id and row-id guards; selection changes keep the drawer open while resetting the proposal.

**Tech Stack:** Vanilla JavaScript, semantic HTML, CSS, Node test runner, Python local API, CUA browser screenshots.

---

## File Map

- `src/main.js`: drawer state, render function, icon entry point, event handling, focus return, and removal of inline AI cards.
- `src/styles.css`: fixed drawer geometry, independent scrolling, sticky header/footer, desktop and narrow-screen behavior.
- `scripts/test-workflow-reliability.mjs`: rendering, state isolation, keyboard, and stale-response regression tests.
- `index.html`: cache version bump for the changed frontend assets.

### Task 1: Lock Drawer State Behavior With Tests

**Files:**
- Modify: `scripts/test-workflow-reliability.mjs:198-270`
- Modify: `src/main.js:130-190`

- [x] **Step 1: Add a failing state-transition test**

```js
test("AI drawer stays open while row changes clear the prior proposal", () => {
  const a = app();
  loadSample(a);
  a.run("state.aiDrawerOpen = true; state.aiProposal = {proposal:{fields:{author:'旧建议'}}}; state.aiStatus = 'ready'");
  const secondId = a.get("state.rows.find(row => row.id !== state.selectedId).id");
  a.run(`selectRow("${secondId}")`);
  assert.equal(a.get("state.aiDrawerOpen"), true);
  assert.equal(a.get("state.aiProposal"), null);
  assert.equal(a.get("state.aiRowId"), secondId);
});
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --test --test-name-pattern='AI drawer stays open' scripts/test-workflow-reliability.mjs`  
Expected: FAIL because `aiDrawerOpen` and drawer-preserving selection behavior do not exist.

- [x] **Step 3: Add the presentation state without changing AI data semantics**

```js
const state = {
  // existing fields
  aiDrawerOpen: false,
  aiStatus: "idle",
  aiProposal: null
};

function openAiDrawer() {
  state.aiDrawerOpen = true;
  renderAiDrawer();
}

function closeAiDrawer() {
  state.aiDrawerOpen = false;
  renderAiDrawer();
}
```

Keep `resetAiForRow(row)` responsible for clearing row-bound candidate data. Do not reset `aiDrawerOpen` during row selection.

- [x] **Step 4: Run the focused test and verify success**

Run: `node --test --test-name-pattern='AI drawer stays open' scripts/test-workflow-reliability.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit only the state and test files**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git commit -m "test: lock AI drawer row isolation"
```

### Task 2: Replace the Inline Card With the Drawer

**Files:**
- Modify: `src/main.js:2287-2315`
- Modify: `src/main.js:2579-2655`
- Modify: `src/main.js:2840-2935`
- Modify: `src/main.js:5260-5290`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: Add failing markup assertions**

```js
test("AI uses one icon entry and one non-modal drawer", () => {
  const a = app();
  loadSample(a);
  assert.match(a.run("reviewControls(selectedRow())"), /data-ai-drawer-open/);
  assert.doesNotMatch(a.run("detailPanel(selectedRow())"), /ai-suggestion-card/);
  a.run("state.aiDrawerOpen = true");
  const drawer = a.run("aiReviewDrawer(selectedRow())");
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="false"/);
  assert.match(drawer, /data-ai-drawer-close/);
});
```

- [x] **Step 2: Run the focused markup test and verify failure**

Run: `node --test --test-name-pattern='AI uses one icon' scripts/test-workflow-reliability.mjs`  
Expected: FAIL because the card is still inline and no drawer entry exists.

- [x] **Step 3: Add the icon entry and semantic drawer shell**

Use an icon-only control in `reviewControls(row)`:

```html
<button type="button" class="icon-control ai-drawer-trigger" data-ai-drawer-open
  aria-label="打开 AI 审校助手" data-tooltip="打开 AI 审校助手">✦</button>
```

Render the drawer once beside the detail workbench:

```js
function aiReviewDrawer(row) {
  if (!state.aiDrawerOpen || !row) return "";
  const title = `${fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目"} · ${row.id}`;
  return `<aside class="ai-review-drawer" role="dialog" aria-modal="false" aria-labelledby="aiDrawerTitle">
    <header class="ai-drawer-head"><div><span>AI 审校助手</span><h2 id="aiDrawerTitle">${escapeHtml(title)}</h2></div>
      <button type="button" class="icon-control" data-ai-drawer-close aria-label="关闭 AI 审校助手">×</button></header>
    <div class="ai-drawer-scroll">${aiSuggestionContent(row)}</div>
    <footer class="ai-drawer-actions">${aiDrawerActions(row)}</footer>
  </aside>`;
}
```

Define `aiSuggestionContent(row)` by moving the status header, current excerpt, error, differences, evidence, and abstentions markup from `aiSuggestionCard(row)`. Define `aiDrawerActions(row)` by moving its generate, retry, clear, and apply buttons into the fixed drawer footer. Remove both `${aiSuggestionCard(row)}` insertions from `detailPanel(row)` and render `${aiReviewDrawer(row)}` once from the main detail view.

- [x] **Step 4: Bind open, close, generate, clear, and apply through existing delegation**

```js
if (event.target.closest("[data-ai-drawer-open]")) openAiDrawer();
if (event.target.closest("[data-ai-drawer-close]")) closeAiDrawer();
```

Make `updateAiDom(row)` replace `.ai-review-drawer` while it is open. Preserve the existing `data-ai-generate`, `data-ai-clear`, and `data-ai-apply` handling.

- [x] **Step 5: Add focus return and Escape behavior**

Store the trigger element when opening. On `Escape`, close the drawer and call `trigger.focus()`. Do not trap focus because `aria-modal="false"` and the table remains operable.

- [x] **Step 6: Run focused AI and shortcut tests**

Run: `node --test --test-name-pattern='AI|shortcut' scripts/test-workflow-reliability.mjs`  
Expected: all matching tests PASS.

- [ ] **Step 7: Commit the functional drawer change**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git commit -m "feat: move AI suggestions into review drawer"
```

### Task 3: Add Overlay and Responsive Styling

**Files:**
- Modify: `src/styles.css:5035-5160`
- Modify: `src/styles.css:6020-6110`
- Modify: `index.html:9,22`

- [x] **Step 1: Add fixed overlay geometry and stable regions**

```css
.ai-review-drawer {
  position: fixed;
  z-index: 45;
  top: var(--topbar-height, 68px);
  right: 0;
  bottom: 0;
  width: clamp(420px, 38vw, 520px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: #fff;
  border-left: 1px solid var(--line);
  box-shadow: -14px 0 36px rgba(30, 39, 31, .12);
}

.ai-drawer-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.ai-drawer-head, .ai-drawer-actions { background: #fff; }
```

Use the current neutral-white and muted-green tokens. Do not add a backdrop, gradient, oversized heading, or nested cards.

- [x] **Step 2: Add narrow-screen behavior**

```css
@media (max-width: 760px) {
  .ai-review-drawer { width: min(100vw, 520px); }
}
```

Verify that long Chinese field values wrap and never force horizontal page scrolling.

- [x] **Step 3: Remove obsolete inline-card layout rules**

Delete selectors that only position `.ai-suggestion-card` inside `.detail-dock-body`. Keep reusable typography, evidence chips, diff rows, and action styles by retargeting them under `.ai-review-drawer`.

- [x] **Step 4: Bump the frontend cache key**

Change the `src/main.js` and `src/styles.css` query values in `index.html` to `v=20260914-ai-drawer`.

- [x] **Step 5: Run syntax and diff checks**

Run: `node --check src/main.js && git diff --check`  
Expected: exit code 0 with no output from `git diff --check`.

- [ ] **Step 6: Commit styling and cache changes**

```bash
git add src/styles.css index.html
git commit -m "style: add responsive AI review drawer"
```

### Task 4: Validate Real Use and Regressions

**Files:**
- Test: `scripts/test-workflow-reliability.mjs`
- Verify: `src/main.js`, `src/styles.css`, `server.py`, `api/ai/extract.js`

- [x] **Step 1: Run the complete automated suite**

Run: `npm test`  
Expected: all Node and Python tests PASS.

- [x] **Step 2: Start the configured local server**

Run: `set -a && source .env.local && set +a && python3 server.py --host 127.0.0.1 --port 8765`  
Expected: service reports `http://127.0.0.1:8765/index.html`.

- [x] **Step 3: Verify a real DeepSeek proposal without accepting it**

Open `http://127.0.0.1:8765/index.html#detail`, open the AI drawer, generate one suggestion, and confirm the drawer shows model name, prompt version, field differences, evidence status, and clear/apply controls. Do not click apply.

- [x] **Step 4: Capture desktop and narrow-screen screenshots**

At desktop width, confirm the main table and original-text detail remain visible behind the drawer. At a width below `760px`, confirm the drawer fits the viewport, scrolls internally, and can be closed.

- [x] **Step 5: Inspect browser errors and server response**

Expected: browser console has no errors and `/api/ai/extract` returns HTTP 200 for the real generation.

- [ ] **Step 6: Commit any test-only refinements**

```bash
git add scripts/test-workflow-reliability.mjs
git commit -m "test: verify AI drawer interaction"
```

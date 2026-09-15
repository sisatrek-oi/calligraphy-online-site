# M1 Import Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first genuinely usable single-person workflow: multi-CSV import, field mapping, problem tags, review queue, and layered export.

**Architecture:** Keep the current UI and interaction style. Add small pure JavaScript modules under `src/` for import normalization, tag policy, review queue derivation, and export shaping; wire them into the existing `src/main.js` state without redesigning the dashboard.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, local static server, CSV text parsing already present in `src/main.js`, browser `Blob` exports, existing Supabase cloud store for future sync.

---

## File Structure

- Create: `src/schema.js`
  - Owns canonical field names, import aliases, required fields, and problem tag definitions.
- Create: `src/import-workflow.js`
  - Owns multi-CSV normalization, field mapping inference, row merging, and import batch metadata.
- Create: `src/review-workflow.js`
  - Owns problem tag helpers, review queue filters, and row quality signals.
- Create: `src/export-workflow.js`
  - Owns main table, problem table, and review log export shaping.
- Modify: `index.html`
  - Load the new modules before `src/main.js`.
- Modify: `src/main.js`
  - Use the new helpers while preserving existing UI layout.
- Modify: `package.json`
  - Add syntax checks for new files.

## Task 1: Canonical Schema And Tags

**Files:**

- Create: `src/schema.js`
- Modify: `package.json`

- [ ] **Step 1: Create canonical schema module**

Add `src/schema.js`:

```js
(function () {
  const canonicalFields = [
    { key: "id", label: "条目 ID", required: true, aliases: ["id", "编号", "条目ID"] },
    { key: "page", label: "页码", required: true, aliases: ["page", "页码", "页"] },
    { key: "sourceFile", label: "原文文件", required: false, aliases: ["sourceFile", "原文文件", "来源文件"] },
    { key: "author", label: "书家", required: false, aliases: ["author", "书家", "作者", "人名"] },
    { key: "script", label: "书体", required: false, aliases: ["script", "书体", "可能书体"] },
    { key: "excerpt", label: "摘录", required: true, aliases: ["excerpt", "摘录", "原文摘录", "片段"] },
    { key: "sourceText", label: "原文上下文", required: false, aliases: ["sourceText", "原文上下文", "原文"] },
    { key: "evidenceLevel", label: "证据等级", required: false, aliases: ["evidenceLevel", "证据等级", "置信等级"] },
    { key: "status", label: "审校状态", required: false, aliases: ["status", "状态", "审校状态"] },
    { key: "notes", label: "审校备注", required: false, aliases: ["notes", "备注", "审校备注"] },
  ];

  const problemTags = [
    { key: "unlocated", label: "未定位", severity: "high" },
    { key: "source_mismatch", label: "原文不符", severity: "high" },
    { key: "duplicate", label: "疑似重复", severity: "medium" },
    { key: "missing_field", label: "字段缺失", severity: "medium" },
    { key: "author_issue", label: "书家异常", severity: "medium" },
    { key: "script_issue", label: "书体异常", severity: "medium" },
    { key: "page_issue", label: "页码异常", severity: "medium" },
    { key: "manual_review", label: "需人工判断", severity: "low" },
  ];

  function normalizeHeader(value) {
    return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  }

  function inferFieldMapping(headers) {
    const mapping = {};
    for (const header of headers) {
      const normalized = normalizeHeader(header);
      const match = canonicalFields.find((field) =>
        field.aliases.some((alias) => normalizeHeader(alias) === normalized)
      );
      if (match) mapping[header] = match.key;
    }
    return mapping;
  }

  window.CalligraphySchema = {
    canonicalFields,
    problemTags,
    inferFieldMapping,
    normalizeHeader,
  };
})();
```

- [ ] **Step 2: Load schema in HTML**

In `index.html`, add before `src/main.js`:

```html
<script defer src="./src/schema.js"></script>
```

- [ ] **Step 3: Update syntax check**

In `package.json`, include:

```json
"check": "node --check src/schema.js && node --check src/main.js && node --check src/cloud-store.js && node --check api/config.js && node --check api/search.js && node --check scripts/verify-cloud-isolation.mjs && python3 -m py_compile server.py && node scripts/verify-cloud-isolation.mjs"
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run check
```

Expected: command exits `0`.

## Task 2: Multi-CSV Import Model

**Files:**

- Create: `src/import-workflow.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `package.json`

- [ ] **Step 1: Create import workflow module**

Add `src/import-workflow.js`:

```js
(function () {
  function createImportBatch(files) {
    return {
      id: `batch-${Date.now()}`,
      createdAt: new Date().toISOString(),
      fileNames: files.map((file) => file.name),
      fileCount: files.length,
    };
  }

  function normalizeImportedRows(csvRows, mapping, batch) {
    return csvRows.map((rawRow, index) => {
      const row = {
        id: rawRow.id || `${batch.id}-${index + 1}`,
        importBatchId: batch.id,
        importFileNames: batch.fileNames,
        problemTags: [],
      };
      for (const [sourceKey, targetKey] of Object.entries(mapping)) {
        row[targetKey] = rawRow[sourceKey] ?? "";
      }
      return row;
    });
  }

  function mergeRows(existingRows, incomingRows) {
    const merged = [...existingRows];
    const seen = new Set(existingRows.map((row) => String(row.id)));
    for (const row of incomingRows) {
      const key = String(row.id);
      if (seen.has(key)) {
        merged.push({ ...row, id: `${key}-dup-${merged.length + 1}`, problemTags: ["duplicate"] });
      } else {
        merged.push(row);
        seen.add(key);
      }
    }
    return merged;
  }

  window.CalligraphyImportWorkflow = {
    createImportBatch,
    normalizeImportedRows,
    mergeRows,
  };
})();
```

- [ ] **Step 2: Load import workflow in HTML**

In `index.html`, add before `src/main.js` and after `src/schema.js`:

```html
<script defer src="./src/import-workflow.js"></script>
```

- [ ] **Step 3: Replace single-file import path in `src/main.js`**

Find the current file input handler. Change it to accept `input.files`, create one import batch, parse each CSV, infer field mapping with `window.CalligraphySchema.inferFieldMapping(headers)`, normalize each file through `window.CalligraphyImportWorkflow.normalizeImportedRows()`, then merge with `window.CalligraphyImportWorkflow.mergeRows()`.

The handler must preserve existing sample-data loading and existing row rendering.

- [ ] **Step 4: Verify**

Run:

```bash
npm run check
```

Then import two CSV files manually. Expected:

- one visible unified main table;
- rows include both files;
- duplicate IDs become tagged rather than overwriting existing rows.

## Task 3: Problem Tags And Review Queue

**Files:**

- Create: `src/review-workflow.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `package.json`

- [ ] **Step 1: Create review workflow module**

Add `src/review-workflow.js`:

```js
(function () {
  function uniqueTags(tags) {
    return [...new Set((tags || []).filter(Boolean))];
  }

  function addProblemTag(row, tagKey) {
    return { ...row, problemTags: uniqueTags([...(row.problemTags || []), tagKey]) };
  }

  function removeProblemTag(row, tagKey) {
    return { ...row, problemTags: uniqueTags(row.problemTags || []).filter((tag) => tag !== tagKey) };
  }

  function hasProblem(row) {
    return Boolean(row.flagged || (row.problemTags || []).length || row.evidenceLevel === "待复核");
  }

  function buildReviewQueue(rows, options = {}) {
    const status = options.status || "all";
    const tag = options.tag || "all";
    return rows.filter((row) => {
      if (status === "problem" && !hasProblem(row)) return false;
      if (tag !== "all" && !(row.problemTags || []).includes(tag)) return false;
      return true;
    });
  }

  window.CalligraphyReviewWorkflow = {
    addProblemTag,
    removeProblemTag,
    buildReviewQueue,
    hasProblem,
  };
})();
```

- [ ] **Step 2: Load review workflow in HTML**

In `index.html`, add before `src/main.js`:

```html
<script defer src="./src/review-workflow.js"></script>
```

- [ ] **Step 3: Wire problem tags into the detail panel**

In `src/main.js`, reuse existing manual flag UI and add a compact tag control:

```js
state.activeProblemTagFilter = state.activeProblemTagFilter || "all";
```

Render tag buttons from:

```js
window.CalligraphySchema.problemTags
```

On click:

```js
row.problemTags.includes(tagKey)
  ? window.CalligraphyReviewWorkflow.removeProblemTag(row, tagKey)
  : window.CalligraphyReviewWorkflow.addProblemTag(row, tagKey)
```

- [ ] **Step 4: Add review queue filter**

Add a filter option named `问题队列`. Its row source must be:

```js
window.CalligraphyReviewWorkflow.buildReviewQueue(state.rows, { status: "problem" })
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run check
```

Manual expected result:

- tagging a row immediately marks it as problem;
- problem queue shows tagged rows;
- removing the last tag removes it from problem queue unless it is still manually flagged.

## Task 4: Layered Export

**Files:**

- Create: `src/export-workflow.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `package.json`

- [ ] **Step 1: Create export workflow module**

Add `src/export-workflow.js`:

```js
(function () {
  function toCsvValue(value) {
    const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows, fields) {
    const header = fields.map((field) => field.label).map(toCsvValue).join(",");
    const body = rows.map((row) => fields.map((field) => toCsvValue(row[field.key])).join(",")).join("\n");
    return [header, body].filter(Boolean).join("\n");
  }

  function buildMainExport(rows, fields) {
    return rowsToCsv(rows, fields);
  }

  function buildProblemExport(rows, fields) {
    return rowsToCsv(rows.filter((row) => (row.problemTags || []).length || row.flagged), fields);
  }

  function buildReviewLogExport(events) {
    const fields = [
      { key: "createdAt", label: "时间" },
      { key: "rowId", label: "条目 ID" },
      { key: "action", label: "动作" },
      { key: "actor", label: "操作者" },
      { key: "detail", label: "详情" },
    ];
    return rowsToCsv(events || [], fields);
  }

  window.CalligraphyExportWorkflow = {
    rowsToCsv,
    buildMainExport,
    buildProblemExport,
    buildReviewLogExport,
  };
})();
```

- [ ] **Step 2: Load export workflow in HTML**

In `index.html`, add before `src/main.js`:

```html
<script defer src="./src/export-workflow.js"></script>
```

- [ ] **Step 3: Split export buttons**

Modify export controls in `src/main.js` so the user can export:

- `统一主表.csv`
- `问题条目.csv`
- `审校日志.csv`

Use `window.CalligraphyExportWorkflow` for each output.

- [ ] **Step 4: Verify**

Run:

```bash
npm run check
```

Manual expected result:

- main export contains all visible canonical fields;
- problem export contains only tagged or flagged rows;
- log export contains review events when available and still downloads a valid CSV when empty.

## Task 5: UI Acceptance Pass

**Files:**

- Modify: `src/styles.css`
- Modify: `src/main.js`

- [ ] **Step 1: Preserve current visual style**

No new hero, no decorative panels, no large animation. New controls must reuse existing button, filter, panel, and table styles.

- [ ] **Step 2: Check overflow**

At desktop width, verify:

- no horizontal page overflow;
- long tags wrap or scroll inside their own control area;
- detail panel and review form do not overlap.

- [ ] **Step 3: Check keyboard workflow**

Verify:

- `J` or ArrowDown moves to next row;
- `K` or ArrowUp moves to previous row;
- Enter confirms and moves next;
- tag controls do not break text input behavior.

- [ ] **Step 4: Run final local smoke test**

Run:

```bash
npm run check
python3 server.py --host 127.0.0.1 --port 8765
```

Open:

```text
http://127.0.0.1:8765/index.html
```

Expected:

- sample dataset loads;
- main table visible;
- detail panel usable;
- tag and review queue work;
- export files download.

## Self-Review

- Spec coverage: covers M1 single-person workflow from `docs/product-goals-roadmap.md`.
- Placeholder scan: no TBD/TODO placeholders.
- Scope check: excludes real-time collaboration and advanced automatic evidence extraction; those belong to M2/M3.
- Risk: `src/main.js` is large. This plan introduces small modules but does not require a broad rewrite.

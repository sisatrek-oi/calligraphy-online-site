# AI 字段理由审校台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将遮挡原字段的 AI 覆盖抽屉改造成可与统一主表、原字段及原文同时查看的字段理由审校台，并让人工逐字段裁定后只采纳认可的建议。

**Architecture:** 保留当前无框架单页结构，在 `api/ai/extract.js` 的模型协议中增加白名单化的字段理由，在 `src/main.js` 中增加与工作区和条目绑定的临时裁定状态。桌面端把 AI 面板作为 `.review-screen` 的第四个网格子元素，开启时收起数据集栏形成主表、原文、AI 三栏；移动端通过分段控件在原字段和 AI 理由之间切换。所有 AI 结果仍是候选，只有人工认可的变更字段能写入，最终确认流程保持不变。

**Tech Stack:** 原生 JavaScript ES modules、HTML/CSS Grid、Node.js `node:test`、Python 本地 API 服务、DeepSeek OpenAI-compatible API

---

## File Map

- Modify: `api/ai/extract.js` - 扩展模型提示词和服务端响应规范，清洗 `reasoning`。
- Modify: `scripts/test-ai-extract.mjs` - 覆盖字段理由、非法字段、非法决策、长度限制和证据命中。
- Modify: `src/main.js` - 管理 AI 面板、逐字段裁定、部分采纳、问题队列和条目隔离。
- Modify: `scripts/test-workflow-reliability.mjs` - 覆盖面板语义、栏状态恢复、逐字段裁定、部分采纳、存疑和旧响应丢弃。
- Modify: `src/styles.css` - 删除覆盖抽屉规则，建立桌面三栏、独立滚动和移动分段布局。
- Modify: `index.html` - 更新静态资源版本参数，避免浏览器继续使用旧 CSS/JS。
- Create: `docs/superpowers/ai-evidence-workbench-desktop.png` - 1280px 桌面验收截图。
- Create: `docs/superpowers/ai-evidence-workbench-mobile.png` - 390px 移动验收截图。

## Execution Guard

当前工作树包含本功能之前尚未提交的产品改动。执行时不得重置或覆盖这些改动；每个任务的“提交”步骤只有在 `git diff --cached` 能单独包含本任务改动时才执行，否则记录为本地检查点并继续，避免把既有用户改动混入提交。

### Task 1: 扩展并约束模型字段理由协议

**Files:**
- Modify: `api/ai/extract.js:1-135`
- Test: `scripts/test-ai-extract.mjs:5-55`

- [ ] **Step 1: 写入字段理由协议的失败测试**

在第一条接口测试的模型返回中加入：

```js
reasoning: [
  {
    fieldId: "author",
    decision: "change",
    reason: "原文直接出现书家姓名。",
    evidenceQuote: "王羲之"
  },
  {
    fieldId: "invented",
    decision: "change",
    reason: "非法字段不得保留。",
    evidenceQuote: "王羲之"
  },
  {
    fieldId: "author",
    decision: "guess",
    reason: "非法决策不得保留。",
    evidenceQuote: "王羲之"
  }
]
```

并增加断言：

```js
assert.match(body.messages[1].content, /每个字段都必须输出一条 reasoning/);
assert.deepEqual(result.proposal.reasoning, [{
  fieldId: "author",
  decision: "change",
  reason: "原文直接出现书家姓名。",
  evidenceQuote: "王羲之",
  evidenceVerified: true
}]);
```

再增加一个长度限制测试：

```js
test("AI reasoning is length-limited and unmatched quotes stay unverified", async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      fields: { author: "王羲之" },
      evidence: [],
      abstentions: [],
      reasoning: [{
        fieldId: "author",
        decision: "keep",
        reason: "理".repeat(900),
        evidenceQuote: "未在原文出现".repeat(100)
      }]
    }) } }] })
  });
  const result = await runExtraction(input, {
    apiUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "secret",
    model: "test-model",
    fetcher
  });
  assert.equal(result.proposal.reasoning[0].reason.length, 800);
  assert.equal(result.proposal.reasoning[0].evidenceQuote.length, 500);
  assert.equal(result.proposal.reasoning[0].evidenceVerified, false);
});
```

- [ ] **Step 2: 运行接口测试并确认新断言失败**

Run: `node --test scripts/test-ai-extract.mjs`

Expected: FAIL，原因是提示词尚未要求 `reasoning`，响应也尚未返回 `proposal.reasoning`。

- [ ] **Step 3: 在服务端加入理由提示词与白名单清洗**

在常量区增加：

```js
const MAX_REASON_LENGTH = 800;
const MAX_EVIDENCE_QUOTE_LENGTH = 500;
const REASONING_DECISIONS = new Set(["keep", "change", "abstain"]);
```

将用户提示中的输出格式改为：

```js
"输出格式：{\"fields\":{\"字段ID\":\"值\"},\"evidence\":[{\"fieldId\":\"字段ID\",\"quote\":\"原文中的最短逐字证据\"}],\"reasoning\":[{\"fieldId\":\"字段ID\",\"decision\":\"keep|change|abstain\",\"reason\":\"保留、修改或弃答的理由\",\"evidenceQuote\":\"支持判断的最短原文\"}],\"abstentions\":[{\"fieldId\":\"字段ID\",\"reason\":\"弃答原因\"}]}。",
"每个字段都必须输出一条 reasoning；即使保留当前值，也要说明保留理由。证据不足时使用 abstain，不得猜测。",
```

在 `normalizeProposal` 中加入：

```js
const reasoning = (Array.isArray(raw?.reasoning) ? raw.reasoning : []).flatMap((item) => {
  const fieldId = String(item?.fieldId || "");
  const decision = String(item?.decision || "");
  const reason = String(item?.reason || "").trim().slice(0, MAX_REASON_LENGTH);
  const evidenceQuote = String(item?.evidenceQuote || "").trim().slice(0, MAX_EVIDENCE_QUOTE_LENGTH);
  if (!allowed.has(fieldId) || !REASONING_DECISIONS.has(decision) || !reason) return [];
  return [{
    fieldId,
    decision,
    reason,
    evidenceQuote,
    evidenceVerified: Boolean(evidenceQuote) && sourceText.includes(evidenceQuote)
  }];
}).slice(0, MAX_FIELDS);
return { fields, evidence, reasoning, abstentions };
```

- [ ] **Step 4: 运行接口测试确认通过**

Run: `node --test scripts/test-ai-extract.mjs`

Expected: 所有 AI 接口测试 PASS。

- [ ] **Step 5: 提交或记录检查点**

```bash
git add api/ai/extract.js scripts/test-ai-extract.mjs
git diff --cached --check
git commit -m "feat: add field-level AI reasoning contract"
```

若暂存区包含本任务之外的既有改动，则执行 `git restore --staged api/ai/extract.js scripts/test-ai-extract.mjs`，不创建混合提交。

### Task 2: 建立前端字段理由和人工裁定状态

**Files:**
- Modify: `src/main.js:21-24, 192-198, 2582-2743`
- Test: `scripts/test-workflow-reliability.mjs:216-333`

- [ ] **Step 1: 写入响应清洗和条目切换清理的失败测试**

将测试返回补充为：

```js
reasoning: [
  { fieldId: "author", decision: "change", reason: "原文直接出现书家姓名。", evidenceQuote: "王羲之", evidenceVerified: true },
  { fieldId: "unknown", decision: "change", reason: "不得进入前端。", evidenceQuote: "王羲之", evidenceVerified: true },
  { fieldId: "author", decision: "invalid", reason: "非法决策。", evidenceQuote: "王羲之", evidenceVerified: true }
]
```

并增加：

```js
assert.equal(a.get("state.aiProposal.proposal.reasoning.length"), 1);
assert.equal(a.get("state.aiProposal.proposal.reasoning[0].decision"), "change");
assert.deepEqual(a.get("state.aiFieldJudgments"), {});
```

在“切换条目”测试中预置并断言清理：

```js
state.aiFieldJudgments = { author: "accept" };
// selectResult 后
assert.deepEqual(a.get("state.aiFieldJudgments"), {});
```

- [ ] **Step 2: 运行工作流测试并确认失败**

Run: `node --test scripts/test-workflow-reliability.mjs`

Expected: FAIL，原因是 `aiFieldJudgments` 与前端 `reasoning` 清洗尚不存在。

- [ ] **Step 3: 添加面板状态和统一重置逻辑**

把 `aiDrawerTrigger` 改名为 `aiPanelTrigger`，并把状态扩展为：

```js
aiPanelOpen: false,
aiStatus: "idle",
aiProposal: null,
aiError: "",
aiRowId: "",
aiWorkspaceId: "",
aiRequestId: 0,
aiFieldJudgments: {},
aiMobilePane: "fields",
aiRailWasCollapsed: null,
aiDetailWasCollapsed: null,
aiTableFocusWasActive: null,
```

在 `resetAiForRow` 最后加入：

```js
state.aiFieldJudgments = {};
state.aiMobilePane = "fields";
```

在 `normalizedAiResponse` 中加入允许值限制：

```js
const decisions = new Set(["keep", "change", "abstain"]);
const reasoning = Array.isArray(payload?.proposal?.reasoning)
  ? payload.proposal.reasoning.flatMap((item) => {
      const fieldId = String(item?.fieldId || "");
      const decision = String(item?.decision || "");
      const reason = String(item?.reason || "").trim().slice(0, 800);
      const evidenceQuote = String(item?.evidenceQuote || "").trim().slice(0, 500);
      if (!allowed.has(fieldId) || !decisions.has(decision) || !reason) return [];
      return [{
        fieldId,
        decision,
        reason,
        evidenceQuote,
        evidenceVerified: Boolean(item?.evidenceVerified)
      }];
    }).slice(0, 30)
  : [];
```

并在 `proposal` 中返回 `reasoning`。

- [ ] **Step 4: 运行工作流测试确认状态与清洗通过**

Run: `node --test scripts/test-workflow-reliability.mjs`

Expected: 新增的响应清洗和切换条目清理断言 PASS；旧抽屉语义测试仍可能失败，留给 Task 4 更新。

- [ ] **Step 5: 提交或记录检查点**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git diff --cached --check
git commit -m "feat: track AI field review decisions"
```

若文件包含无法独立拆分的既有改动，则取消暂存并保留本地检查点。

### Task 3: 实现逐字段裁定、部分采纳和问题回流

**Files:**
- Modify: `src/main.js:2597-2619, 2801-2832`
- Test: `scripts/test-workflow-reliability.mjs:285-333`

- [ ] **Step 1: 写入部分采纳、驳回和存疑的失败测试**

增加：

```js
test("AI apply writes only accepted changed fields and records rejected feedback", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = {
      proposal: {
        fields: { author: "模型书家", scriptType: "模型书体" },
        evidence: [],
        reasoning: [
          { fieldId: "author", decision: "change", reason: "作者证据", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "scriptType", decision: "change", reason: "书体证据", evidenceQuote: "草书", evidenceVerified: false }
        ],
        abstentions: []
      },
      meta: { model: "test-model", promptVersion: 7 }
    };
    state.aiFieldJudgments = { author: "accept", scriptType: "reject" };
  `);
  const originalScript = a.get("fieldValue(selectedRow(), 'scriptType')");
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "模型书家");
  assert.equal(a.get("fieldValue(selectedRow(), 'scriptType')"), originalScript);
  assert.equal(a.get("selectedRow().history.at(-1).decisions.scriptType"), "reject");
  assert.equal(a.get("selectedRow().reviewed"), false);
});

test("uncertain AI fields keep their values and route the row to the problem queue", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = { proposal: { fields: { author: "候选" }, evidence: [], reasoning: [], abstentions: [] }, meta: { model: "test", promptVersion: 1 } };
    state.aiFieldJudgments = { author: "uncertain" };
  `);
  const before = a.get("fieldValue(selectedRow(), 'author')");
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before);
  assert.equal(a.get("selectedRow().problemResolution.status"), "pending_review");
  assert.match(a.get("selectedRow().history.at(-1).reason"), /存疑/);
});
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `node --test --test-name-pattern="AI apply|uncertain AI" scripts/test-workflow-reliability.mjs`

Expected: FAIL，当前逻辑会写入所有差异，并且不记录逐字段裁定。

- [ ] **Step 3: 增加裁定入口和可采纳字段计算**

在 AI 辅助函数区加入：

```js
function setAiFieldJudgment(fieldId, judgment) {
  const allowedFields = new Set(orderedSchema().map((field) => field.id));
  const allowedJudgments = new Set(["accept", "reject", "uncertain"]);
  if (!allowedFields.has(fieldId) || !allowedJudgments.has(judgment)) return false;
  state.aiFieldJudgments = { ...state.aiFieldJudgments, [fieldId]: judgment };
  updateAiDom();
  return true;
}

function aiReviewedFields(row) {
  const proposals = state.aiProposal?.proposal?.fields || {};
  const reasoningByField = new Map((state.aiProposal?.proposal?.reasoning || []).map((item) => [item.fieldId, item]));
  return orderedSchema({ includeHidden: false }).map((field) => {
    const reasoning = reasoningByField.get(field.id) || {
      fieldId: field.id,
      decision: "abstain",
      reason: "模型未提供该字段的判断理由。",
      evidenceQuote: "",
      evidenceVerified: false,
      missing: true
    };
    const before = String(fieldValue(row, field.id) || "");
    const after = Object.prototype.hasOwnProperty.call(proposals, field.id) ? String(proposals[field.id] || "") : before;
    return { field, before, after, reasoning, judgment: state.aiFieldJudgments[field.id] || "" };
  });
}
```

- [ ] **Step 4: 将采纳逻辑改为只写入认可的变更字段**

用以下决策骨架替换 `applyAiProposal` 的全量差异计算：

```js
const reviewedFields = aiReviewedFields(row);
const acceptedChanges = reviewedFields
  .filter((item) => item.judgment === "accept" && item.before !== item.after)
  .map(({ field, before, after }) => ({ fieldId: field.id, before, after }));
const decisions = Object.fromEntries(reviewedFields
  .filter((item) => item.judgment)
  .map((item) => [item.field.id, item.judgment]));
const uncertain = reviewedFields.filter((item) => item.judgment === "uncertain");
const rejected = reviewedFields.filter((item) => item.judgment === "reject");
if (!Object.keys(decisions).length) return false;

const checkpoint = rememberUndo(row, "核验 AI 字段建议");
acceptedChanges.forEach((change) => setFieldValue(row, change.fieldId, change.after));
row.aiDraft = {
  ...(row.aiDraft || {}),
  ...Object.fromEntries(acceptedChanges.map((change) => [change.fieldId, change.after]))
};
if (uncertain.length) {
  row.problemResolution = {
    status: "pending_review",
    at: new Date().toISOString(),
    reason: `AI 字段存疑：${uncertain.map((item) => item.field.label).join("、")}`
  };
}
```

历史记录必须保存：

```js
addHistory(row, {
  type: "ai-field-review",
  actor: "human",
  reason: `人工核验 AI 字段建议：认可 ${acceptedChanges.length} 项，驳回 ${rejected.length} 项，存疑 ${uncertain.length} 项。`,
  promptVersion: state.aiProposal.meta.promptVersion,
  modelVersion: state.aiProposal.meta.model,
  evidence: state.aiProposal.proposal.evidence,
  reasoning: state.aiProposal.proposal.reasoning,
  decisions,
  changes: acceptedChanges
});
```

保持 `row.reviewed = false`，并继续通过 `finishReviewChange` 持久化。没有字段值变化、但存在驳回或存疑时也必须允许保存反馈。

- [ ] **Step 5: 运行目标测试确认通过**

Run: `node --test --test-name-pattern="AI apply|uncertain AI" scripts/test-workflow-reliability.mjs`

Expected: 两个测试 PASS。

- [ ] **Step 6: 提交或记录检查点**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git diff --cached --check
git commit -m "feat: add human verification for AI fields"
```

若无法隔离既有改动则取消暂存，不提交。

### Task 4: 用并排审校台替换覆盖抽屉

**Files:**
- Modify: `src/main.js:192-198, 2621-2726, 2914-2957` 以及详情页 `review-screen` 渲染处
- Test: `scripts/test-workflow-reliability.mjs:216-283`

- [ ] **Step 1: 将抽屉语义测试改成并排面板验收**

用以下测试替换“non-modal drawer”测试：

```js
test("AI uses one icon entry and one docked evidence panel", () => {
  const a = app();
  loadSample(a);
  const entry = a.run("reviewControls(selectedRow())");
  assert.match(entry, /data-ai-panel-open/);
  assert.match(entry, /aria-controls="aiEvidencePanel"/);
  assert.match(entry, /aria-label="打开 AI 字段理由"/);
  a.run("state.aiPanelOpen = true");
  const panel = a.run("aiReviewPanel(selectedRow())");
  assert.match(panel, /id="aiEvidencePanel"/);
  assert.match(panel, /class="ai-review-panel/);
  assert.match(panel, /aria-labelledby="aiPanelTitle"/);
  assert.doesNotMatch(panel, /role="dialog"|aria-modal/);
  assert.match(panel, /data-ai-panel-close/);
});
```

更新 Escape 测试的选择器和状态名，并增加栏恢复断言：

```js
a.run("state.railCollapsed = false; state.aiPanelOpen = true; state.aiRailWasCollapsed = false; aiPanelTrigger = trigger");
// Escape 后
assert.equal(a.get("state.aiPanelOpen"), false);
assert.equal(a.get("state.railCollapsed"), false);
```

- [ ] **Step 2: 运行面板语义测试并确认失败**

Run: `node --test --test-name-pattern="AI uses one icon|Escape closes" scripts/test-workflow-reliability.mjs`

Expected: FAIL，因为当前仍生成 `role="dialog"` 和 `.ai-review-drawer`。

- [ ] **Step 3: 重命名面板生命周期并保存左栏原状态**

实现：

```js
function openAiPanel(trigger) {
  const row = selectedRow();
  if (!row) return false;
  if (state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId) resetAiForRow(row);
  aiPanelTrigger = trigger || document.activeElement || null;
  if (!state.aiPanelOpen) {
    state.aiRailWasCollapsed = state.railCollapsed;
    state.aiDetailWasCollapsed = state.detailCollapsed;
    state.aiTableFocusWasActive = state.tableFocus;
  }
  state.aiPanelOpen = true;
  state.railCollapsed = true;
  state.detailCollapsed = false;
  state.tableFocus = false;
  aiPanelTrigger?.setAttribute?.("aria-expanded", "true");
  renderDetail();
  document.querySelector("#aiPanelTitle")?.focus({ preventScroll: true });
  return true;
}

function closeAiPanel({ restoreFocus = true } = {}) {
  if (!state.aiPanelOpen) return false;
  state.aiPanelOpen = false;
  if (state.aiRailWasCollapsed !== null) state.railCollapsed = state.aiRailWasCollapsed;
  if (state.aiDetailWasCollapsed !== null) state.detailCollapsed = state.aiDetailWasCollapsed;
  if (state.aiTableFocusWasActive !== null) state.tableFocus = state.aiTableFocusWasActive;
  state.aiRailWasCollapsed = null;
  state.aiDetailWasCollapsed = null;
  state.aiTableFocusWasActive = null;
  aiPanelTrigger = null;
  renderDetail();
  const trigger = document.querySelector("[data-ai-panel-open]");
  trigger?.setAttribute?.("aria-expanded", "false");
  if (restoreFocus) trigger?.focus({ preventScroll: true });
  return true;
}
```

关闭面板不调用 `clearAiProposal`，不采纳数据。

- [ ] **Step 4: 生成字段理由卡和并排 `aside`**

`aiReviewPanel(row)` 应返回以下稳定结构：

```html
<aside id="aiEvidencePanel" class="ai-review-panel ready" aria-labelledby="aiPanelTitle" data-row-id="ROW_ID">
  <header class="ai-panel-head">
    <div><p class="kicker">AI Evidence</p><h2 id="aiPanelTitle" tabindex="-1">条目标题</h2></div>
    <span class="ai-panel-status">待核验</span>
    <button type="button" class="icon-control" data-ai-generate aria-label="重新生成 AI 理由" title="重新生成 AI 理由">↻</button>
    <button type="button" class="icon-control" data-ai-panel-close aria-label="关闭 AI 字段理由" title="关闭 AI 字段理由">×</button>
  </header>
  <div class="ai-panel-scroll">字段理由卡</div>
  <footer class="ai-panel-actions">清除与采纳控件</footer>
</aside>
```

每个 `ai-field-review` 卡必须同时输出字段名、证据状态、当前值、建议值、`reason`、`evidenceQuote` 和三个图标裁定按钮：

```html
<div class="ai-judgment" role="group" aria-label="书家人工裁定">
  <button type="button" data-ai-judgment="accept" data-field-id="author" aria-pressed="false" aria-label="认可书家建议" title="认可书家建议">✓</button>
  <button type="button" data-ai-judgment="reject" data-field-id="author" aria-pressed="false" aria-label="驳回书家建议" title="驳回书家建议">×</button>
  <button type="button" data-ai-judgment="uncertain" data-field-id="author" aria-pressed="false" aria-label="将书家标为存疑" title="将书家标为存疑">?</button>
</div>
```

所有动态文本继续经过 `escapeHtml`。`keep` 必须显示“建议保留”，`change` 显示新值，`abstain` 显示“模型弃答”。
若模型漏掉某个可见字段的 `reasoning`，仍显示该字段，并明确写出“模型未提供该字段的判断理由”，不得隐藏该字段或替模型补理由。

- [ ] **Step 5: 将面板放入详情页网格并加入移动分段控件**

详情页 `review-screen` 类名加入：

```js
${state.aiPanelOpen ? "ai-review-open" : ""}
${state.aiPanelOpen ? `ai-mobile-${state.aiMobilePane}` : ""}
```

在 `detailPanel(row)` 后直接渲染：

```js
${state.aiPanelOpen ? aiReviewPanel(row) : ""}
```

面板开启时，在工作区顶部渲染仅移动端可见的分段控件：

```html
<div class="ai-mobile-switch" role="group" aria-label="移动端审校面板">
  <button type="button" data-ai-mobile-pane="fields" aria-pressed="true">原字段</button>
  <button type="button" data-ai-mobile-pane="reasoning" aria-pressed="false">AI 理由</button>
</div>
```

- [ ] **Step 6: 运行面板语义和状态恢复测试**

Run: `node --test --test-name-pattern="AI panel stays|AI uses one icon|Escape closes" scripts/test-workflow-reliability.mjs`

Expected: 更新后的三个面板测试 PASS。

- [ ] **Step 7: 提交或记录检查点**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git diff --cached --check
git commit -m "feat: dock AI evidence beside source fields"
```

若无法隔离既有改动则取消暂存，不提交。

### Task 5: 接通面板交互与未裁定提示

**Files:**
- Modify: `src/main.js` 的 click 事件委托、`handleWorkbenchShortcut` 和 AI action 文案
- Test: `scripts/test-workflow-reliability.mjs`

- [ ] **Step 1: 写入裁定按钮和移动分段切换的失败测试**

增加：

```js
test("AI field judgments are exclusive and preserve proposal state", () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; resetAiForRow(selectedRow())");
  assert.equal(a.run("setAiFieldJudgment('author', 'accept')"), true);
  assert.equal(a.get("state.aiFieldJudgments.author"), "accept");
  assert.equal(a.run("setAiFieldJudgment('author', 'reject')"), true);
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "reject" });
  assert.equal(a.run("setAiFieldJudgment('unknown', 'accept')"), false);
});

test("mobile AI pane switch changes visibility state without clearing decisions", () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; state.aiFieldJudgments = { author: 'accept' }; setAiMobilePane('reasoning')");
  assert.equal(a.get("state.aiMobilePane"), "reasoning");
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "accept" });
});
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `node --test --test-name-pattern="AI field judgments|mobile AI pane" scripts/test-workflow-reliability.mjs`

Expected: FAIL，移动分段切换和完整事件接线尚不存在。

- [ ] **Step 3: 实现移动分段状态函数**

```js
function setAiMobilePane(pane) {
  if (!state.aiPanelOpen || !["fields", "reasoning"].includes(pane)) return false;
  state.aiMobilePane = pane;
  renderDetail();
  return true;
}
```

- [ ] **Step 4: 在既有 click 委托中接通新选择器**

加入互斥分支：

```js
const aiOpen = event.target.closest("[data-ai-panel-open]");
if (aiOpen) return openAiPanel(aiOpen);
if (event.target.closest("[data-ai-panel-close]")) return closeAiPanel();
const judgment = event.target.closest("[data-ai-judgment]");
if (judgment) return setAiFieldJudgment(judgment.dataset.fieldId, judgment.dataset.aiJudgment);
const mobilePane = event.target.closest("[data-ai-mobile-pane]");
if (mobilePane) return setAiMobilePane(mobilePane.dataset.aiMobilePane);
```

删除旧的 `data-ai-drawer-open`、`data-ai-drawer-close` 分支。Escape 调用 `closeAiPanel()`。

- [ ] **Step 5: 让底部采纳按钮显示核验进度**

`aiPanelActions(row)` 计算：

```js
const fields = aiReviewedFields(row);
const decided = fields.filter((item) => item.judgment).length;
const accepted = fields.filter((item) => item.judgment === "accept").length;
const pending = Math.max(0, fields.length - decided);
const canApply = status === "ready" && decided > 0;
const applyLabel = pending ? `保存核验（待处理 ${pending}）` : `保存核验（认可 ${accepted}）`;
```

按钮仅在没有任何人工裁定时禁用；这允许只有驳回或存疑的反馈被保存。

- [ ] **Step 6: 运行交互测试确认通过**

Run: `node --test --test-name-pattern="AI field judgments|mobile AI pane|AI extraction stays" scripts/test-workflow-reliability.mjs`

Expected: 所有目标测试 PASS。

- [ ] **Step 7: 提交或记录检查点**

```bash
git add src/main.js scripts/test-workflow-reliability.mjs
git diff --cached --check
git commit -m "feat: wire field-level AI verification controls"
```

若无法隔离既有改动则取消暂存，不提交。

### Task 6: 建立三栏自适应布局和独立滚动

**Files:**
- Modify: `src/styles.css:4515-4584, 5046-5368, 6152-6254`
- Modify: `index.html:9,22`

- [ ] **Step 1: 删除覆盖抽屉定位并定义桌面四子项网格**

用 `.ai-review-panel` 替换 `.ai-review-drawer`，核心规则为：

```css
.detail-shell .review-screen.ai-review-open {
  grid-template-columns: minmax(420px, 1fr) minmax(300px, 28vw) minmax(340px, 31vw);
  gap: 12px;
}

.detail-shell .review-screen.ai-review-open .dataset-rail {
  display: none;
}

.detail-shell .review-screen.ai-review-open .workbench-main {
  grid-column: 1;
}

.detail-shell .review-screen.ai-review-open .detail-panel {
  grid-column: 2;
}

.detail-shell .review-screen.ai-review-open .ai-review-panel {
  grid-column: 3;
}

.ai-review-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid #d9ded9;
  border-radius: 6px;
  background: #fff;
  color: #292c29;
}

.ai-panel-scroll {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 14px 16px 20px;
}
```

不得保留 `position: fixed`、`right: 0`、遮挡阴影或 `z-index: 45`。

- [ ] **Step 2: 为字段理由卡和图标裁定组添加稳定尺寸**

```css
.ai-field-list {
  display: grid;
  gap: 10px;
}

.ai-field-review {
  display: grid;
  gap: 9px;
  border-bottom: 1px solid #ebe7e0;
  padding: 4px 0 14px;
}

.ai-field-values {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 6px 8px;
  margin: 0;
}

.ai-field-reason,
.ai-field-evidence {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.55;
}

.ai-judgment {
  display: grid;
  grid-template-columns: repeat(3, 32px);
  gap: 6px;
}

.ai-judgment button {
  width: 32px;
  min-width: 32px;
  height: 30px;
  padding: 0;
  border: 1px solid #d8d6d0;
  border-radius: 4px;
  background: #fff;
}

.ai-judgment button[aria-pressed="true"] {
  border-color: #76947c;
  background: #eaf3eb;
  color: #245b31;
}
```

- [ ] **Step 3: 处理 1160px 以下和移动端分段布局**

在现有响应式规则之后加入：

```css
@media (max-width: 1160px) and (min-width: 761px) {
  .detail-shell .review-screen.ai-review-open {
    grid-template-columns: minmax(280px, 1fr) minmax(260px, 30vw) minmax(300px, 34vw);
    gap: 8px;
    padding-inline: 8px;
  }
}

.ai-mobile-switch {
  display: none;
}

@media (max-width: 760px) {
  .detail-shell .review-screen.ai-review-open {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    padding: 8px;
  }

  .detail-shell .review-screen.ai-review-open .workbench-main,
  .detail-shell .review-screen.ai-review-open .dataset-rail {
    display: none;
  }

  .ai-mobile-switch {
    grid-column: 1;
    grid-row: 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    border: 1px solid #dedbd5;
    border-radius: 5px;
    padding: 2px;
    background: #f2f2ef;
  }

  .detail-shell .review-screen.ai-review-open .detail-panel,
  .detail-shell .review-screen.ai-review-open .ai-review-panel {
    position: relative;
    inset: auto;
    grid-column: 1;
    grid-row: 2;
    width: 100%;
    height: 100%;
    max-width: none;
  }

  .detail-shell .review-screen.ai-mobile-fields .ai-review-panel,
  .detail-shell .review-screen.ai-mobile-reasoning .detail-panel {
    display: none;
  }
}
```

- [ ] **Step 4: 更新静态资源版本参数**

在 `index.html` 中改为：

```html
<link rel="stylesheet" href="./src/styles.css?v=20260914-ai-evidence-workbench" />
<script defer src="./src/main.js?v=20260914-ai-evidence-workbench"></script>
```

- [ ] **Step 5: 运行语法检查和完整 Node 测试**

Run: `npm run check && node --test scripts/test-*.mjs`

Expected: 语法、隔离验证和全部 Node 测试 PASS。

- [ ] **Step 6: 提交或记录检查点**

```bash
git add src/styles.css src/main.js index.html scripts/test-workflow-reliability.mjs
git diff --cached --check
git commit -m "style: add responsive AI evidence workbench"
```

若无法隔离既有改动则取消暂存，不提交。

### Task 7: 浏览器视觉验收和真实模型冒烟测试

**Files:**
- Create: `docs/superpowers/ai-evidence-workbench-desktop.png`
- Create: `docs/superpowers/ai-evidence-workbench-mobile.png`
- Verify: `src/main.js`, `src/styles.css`, `api/ai/extract.js`

- [ ] **Step 1: 停止旧服务并启动唯一实例**

先读取当前服务进程，只终止工作目录指向本仓库的旧实例，然后运行：

```bash
npm start
```

Expected: `http://127.0.0.1:8765/index.html#detail` 返回 200，服务进程保持运行。

- [ ] **Step 2: 验证浏览器实际加载新资源**

```bash
curl -s http://127.0.0.1:8765/index.html | rg "ai-evidence-workbench"
curl -s "http://127.0.0.1:8765/src/styles.css?v=20260914-ai-evidence-workbench" | rg "ai-review-open|ai-review-panel|ai-field-review"
```

Expected: HTML 和 CSS 都命中新版本标识及新选择器。

- [ ] **Step 3: 在 1280px 桌面视口完成一次真实 DeepSeek 生成**

登录本地演示账号，打开统一主表，选择有原文的条目，打开 AI 字段理由，点击生成。不得点击保存核验或确认条目。

Expected:

- 主表、原字段与原文、AI 理由三栏同时可见。
- 左侧数据集栏自动隐藏。
- AI 对保留和修改字段都显示理由。
- 证据逐字命中状态可见。
- 页面控制台无错误。

- [ ] **Step 4: 保存 1280px 桌面截图并逐项检查**

将截图保存为 `docs/superpowers/ai-evidence-workbench-desktop.png`。检查右侧两栏无重叠，底部操作栏可见，三栏分别滚动，表格内部水平滚动不会把页面撑出视口。

- [ ] **Step 5: 在 390px 移动视口检查分段切换**

切换“原字段 / AI 理由”，保留一个人工裁定后往返切换。

Expected: 不出现覆盖抽屉；裁定不会丢失；没有不可控横向滚动；关闭按钮可见。

- [ ] **Step 6: 保存 390px 移动截图并逐项检查**

将截图保存为 `docs/superpowers/ai-evidence-workbench-mobile.png`，确认长理由与证据在卡片内换行，图标按钮不挤压或重叠。

- [ ] **Step 7: 运行完整回归测试**

Run: `npm test`

Expected: 全部 Node 和 Python 测试 PASS。

- [ ] **Step 8: 检查最终差异和敏感信息**

```bash
git diff --check
git diff --stat
git status --short
rg -n "sk-[A-Za-z0-9]+" --glob '!\.env.local' .
```

Expected: 无空白错误；没有 API 密钥进入版本文件；只保留本功能与既有未提交工作的预期差异。

- [ ] **Step 9: 提交视觉证据或记录最终检查点**

```bash
git add docs/superpowers/ai-evidence-workbench-desktop.png docs/superpowers/ai-evidence-workbench-mobile.png
git diff --cached --check
git commit -m "test: capture AI evidence workbench QA"
```

若仓库状态不适合提交，则保留截图和测试结果，不创建混合提交。

## Completion Evidence

- `node --test scripts/test-ai-extract.mjs` 证明服务端理由协议、白名单、长度与证据命中校验有效。
- `node --test scripts/test-workflow-reliability.mjs` 证明逐字段裁定、部分采纳、栏状态恢复、条目隔离和旧响应丢弃有效。
- `npm test` 证明现有 Node 与 Python 回归测试未被破坏。
- 两张验收截图证明 1280px 三栏并排和 390px 分段切换没有遮挡、重叠或不可控溢出。
- 一次真实 DeepSeek 生成证明线上协议可返回字段理由；测试期间不采纳模拟数据。

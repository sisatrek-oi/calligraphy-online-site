# AI 一键认可 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 字段理由面板中增加一个只批量选择、不直接写入主表的“一键认可”操作。

**Architecture:** 复用现有 `aiFieldJudgments` 临时状态和字段级裁定按钮。新增批量状态更新函数，只处理 `reasoning.missing !== true` 的可见字段，并通过原地 DOM 更新同步按钮和底部计数，从而保持滚动位置与焦点；真正写入仍由现有 `applyAiProposal()` 完成。

**Tech Stack:** 原生 JavaScript、HTML 字符串模板、CSS、Node.js `node:test`、现有本地 Python 静态服务。

---

### Task 1: AI 核验批量认可

**Files:**
- Modify: `index.html:9-22`
- Modify: `src/main.js:2630-2760`
- Modify: `src/main.js:5525-5555`
- Modify: `src/styles.css:5140-5235`
- Test: `scripts/test-workflow-reliability.mjs:480-545`

- [x] **Step 1: 写入失败测试**

在 `scripts/test-workflow-reliability.mjs` 增加测试，构造两个有有效理由的字段和其他缺失理由字段：

```js
test("AI accept-all selects only reasoned fields without applying them", () => {
  const a = app();
  loadSample(a);
  const before = a.get("fieldValue(selectedRow(), 'author')");
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = {
      proposal: {
        fields: { author: "模型书家" },
        evidence: [],
        reasoning: [
          { fieldId: "author", decision: "change", reason: "作者证据", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "scriptType", decision: "keep", reason: "书体与原文一致", evidenceQuote: "草书", evidenceVerified: true }
        ],
        abstentions: []
      },
      meta: { model: "test", promptVersion: 1 }
    };
    state.aiInputSignature = aiInputSignature(selectedRow());
    state.aiFieldJudgments = { author: "reject" };
  `);
  assert.equal(a.run("acceptAllAiFieldJudgments(selectedRow())"), true);
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "accept", scriptType: "accept" });
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before);
  assert.match(a.run("aiPanelActions(selectedRow())"), /data-ai-accept-all[^>]*disabled/);
  assert.equal(a.run("acceptAllAiFieldJudgments(selectedRow())"), false);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node --test --test-name-pattern="AI accept-all" scripts/test-workflow-reliability.mjs`

Expected: FAIL，提示 `acceptAllAiFieldJudgments is not defined`。

- [x] **Step 3: 实现批量状态与原地 DOM 更新**

在 `src/main.js` 中将单字段更新抽为可接收字段集合的函数，并增加批量认可函数：

```js
function updateAiFieldJudgmentsDom(fieldIds) {
  const panel = document.querySelector("#aiEvidencePanel");
  if (!panel) return false;
  const allowed = new Set(fieldIds);
  const buttons = [...document.querySelectorAll("[data-ai-judgment]")]
    .filter((button) => allowed.has(button.dataset.fieldId));
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.aiJudgment === state.aiFieldJudgments[button.dataset.fieldId]));
  });
  const actions = panel.querySelector(".ai-panel-actions");
  if (actions) actions.innerHTML = aiPanelActions(selectedRow());
  return Boolean(buttons.length || actions);
}

function updateAiFieldJudgmentDom(fieldId) {
  return updateAiFieldJudgmentsDom([fieldId]);
}

function acceptAllAiFieldJudgments(row = selectedRow()) {
  if (!row || state.aiStatus !== "ready" || !state.aiProposal) return false;
  const eligible = aiReviewedFields(row).filter((item) => !item.reasoning.missing);
  if (!eligible.length || eligible.every((item) => state.aiFieldJudgments[item.field.id] === "accept")) return false;
  state.aiFieldJudgments = {
    ...state.aiFieldJudgments,
    ...Object.fromEntries(eligible.map((item) => [item.field.id, "accept"]))
  };
  updateAiFieldJudgmentsDom(eligible.map((item) => item.field.id));
  return true;
}
```

在 `aiPanelActions()` 中计算有效字段，并在“清除”之前加入图标按钮：

```js
const reasonedFields = fields.filter((item) => !item.reasoning.missing);
const canAcceptAll = status === "ready" && reasonedFields.some((item) => item.judgment !== "accept");
```

```html
<button type="button" class="icon-control" data-ai-accept-all ${canAcceptAll ? "" : "disabled"} aria-label="认可全部 AI 建议" title="认可全部 AI 建议">✓✓</button>
```

在 AI 面板点击委托中绑定批量操作：

```js
if (event.target.closest("[data-ai-accept-all]")) {
  acceptAllAiFieldJudgments(selectedRow());
  return;
}
```

在 `src/styles.css` 中让批量按钮保持固定图标尺寸，同时不改变现有保存按钮的主操作样式：

```css
.ai-panel-actions [data-ai-accept-all] {
  flex: 0 0 34px;
  inline-size: 34px;
  padding: 0;
}
```

- [x] **Step 4: 运行针对性与全量测试**

Run: `node --test --test-name-pattern="AI accept-all|AI judgment updates" scripts/test-workflow-reliability.mjs`

Expected: 新增批量认可测试和既有焦点/滚动测试 PASS。

Run: `npm run check && npm test && git diff --check`

Expected: 语法、云端隔离、107 个 Node 测试、10 个 Python 测试以及空白检查全部通过。

- [x] **Step 5: 浏览器验收**

在 `http://127.0.0.1:8765/index.html#detail` 打开 AI 字段理由，生成一次候选并检查：

1. 底部显示 `✓✓`，悬停提示为“认可全部 AI 建议”。
2. 点击后，有有效理由的字段全部变为认可，缺失理由字段仍未裁定。
3. 主表字段没有立刻改变，保存按钮仍是独立操作。
4. AI 面板滚动位置不跳动，桌面三栏没有重叠；移动端按钮不溢出。

- [x] **Step 6: 提交实现**

```bash
git add src/main.js src/styles.css scripts/test-workflow-reliability.mjs docs/superpowers/plans/2026-09-15-ai-accept-all.md
git commit -m "feat: add AI review accept-all control"
```

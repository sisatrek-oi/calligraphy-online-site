# 批量选择与处理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有统一主表中加入任意多选，并安全完成批量三模型核验、确认、问题标记、导出和删除。

**Architecture:** 选择和任务进度作为当前工作区的临时前端状态，实际字段、审计和问题状态继续写入现有工作区数据。人工批量操作使用现有 checkpoint 原子保存；AI 批处理逐条调用现有 `/api/ai/consensus`，每条独立保存并隔离失败。

**Tech Stack:** 原生 JavaScript、HTML/CSS、现有 localStorage/cloud workspace 适配层、Python `ThreadingHTTPServer` AI 代理、Node test runner、Python unittest。

---

### Task 1: 多选状态与表格入口

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 写选择状态失败测试**

在 `scripts/test-workflow-reliability.mjs` 增加测试，加载样本后调用 `toggleBatchSelection`、`setVisibleBatchSelection` 和 `reconcileBatchSelection`，断言：单选不改变 `selectedId`；全选仅覆盖 `visibleRows()`；筛选变化后已选有效 ID 保留；删除后的 ID 被清理。

- [x] **Step 2: 运行目标测试确认失败**

Run: `node --test --test-name-pattern='batch selection' scripts/test-workflow-reliability.mjs`

Expected: FAIL，提示批量选择函数或状态不存在。

- [x] **Step 3: 实现最小选择模型**

在 `state` 中增加：

```js
batchSelectedIds: new Set(),
batchJob: null,
batchIssueOpen: false,
```

在 `src/main.js` 增加边界明确的函数：

```js
function batchSelectedRows() {
  const ids = state.batchSelectedIds;
  return state.rows.filter((row) => ids.has(row.id));
}

function reconcileBatchSelection() {
  const existing = new Set(state.rows.map((row) => row.id));
  state.batchSelectedIds = new Set([...state.batchSelectedIds].filter((id) => existing.has(id)));
}

function toggleBatchSelection(rowId, checked) {
  if (!state.rows.some((row) => row.id === rowId)) return false;
  const next = new Set(state.batchSelectedIds);
  if (checked) next.add(rowId); else next.delete(rowId);
  state.batchSelectedIds = next;
  return true;
}

function setVisibleBatchSelection(checked) {
  const next = new Set(state.batchSelectedIds);
  visibleRows().forEach((row) => checked ? next.add(row.id) : next.delete(row.id));
  state.batchSelectedIds = next;
}
```

- [x] **Step 4: 在主表加入复选框**

把当前最左侧“回检”列改为固定宽度选择列。表头复选框使用 `aria-label="选择当前筛选条目"`，根据可见条目计算 `checked` 和 `indeterminate`；行复选框使用 `data-batch-select`。点击复选框时阻止行导航，行点击其余区域继续调用 `selectResult`。

- [x] **Step 5: 加入不挤压内容的选择样式**

在 `src/styles.css` 中增加固定 `40px` 选择列、16px 复选框和已选行的低对比度背景。不得改变右侧详情宽度，不使用进场动画。

- [x] **Step 6: 运行目标测试**

Run: `node --test --test-name-pattern='batch selection' scripts/test-workflow-reliability.mjs`

Expected: PASS。

### Task 2: 上下文批量工具栏与人工动作

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 写工具栏与人工动作失败测试**

覆盖以下行为：无选择时工具栏不渲染；有选择时显示数量及六个带 `aria-label` 的符号操作；批量人工确认只影响选中条目；保存失败恢复行、历史、选择与回收站；批量删除后选择集合清空被删 ID。

- [x] **Step 2: 运行目标测试确认失败**

Run: `node --test --test-name-pattern='batch toolbar|batch confirm|batch delete' scripts/test-workflow-reliability.mjs`

Expected: FAIL。

- [x] **Step 3: 实现上下文工具栏**

新增 `batchActionBar()`，放在摘要和 `.table-shell` 之间。按钮使用符号与悬停提示：`AI`、`✓`、`!`、`⇩`、`×`、`清除选择`对应的简洁图标；每个按钮有完整 `aria-label` 和 `title`。AI 运行时显示 `完成/总数`、通过、待复核、失败和停止按钮。

- [x] **Step 4: 实现原子批量确认**

新增 `batchConfirmSelected()`：对选中行建立 `reviewChangeCheckpoint(rows)`；设置 `reviewed/reviewedAt`，写入 `batch-confirm` 历史；一次 `saveWorkspace()`；失败时 `restoreReviewCheckpoint(checkpoint)`，成功后重建 manifest 并保留选择。

- [x] **Step 5: 实现批量删除**

新增 `batchDeleteSelected()`：二次确认数量；建立 checkpoint；写入 `batch-delete` 历史并移入 `trashRows`；更新 `reviewState.deletedIds`；一次保存；失败整批回滚，成功后清理选择和无效 `selectedId`。

- [x] **Step 6: 绑定事件并验证**

在 `attachDetailEvents()` 绑定工具栏与表头/行复选框事件。运行目标测试，Expected: PASS。

### Task 3: 批量问题标签与选中范围导出

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 写问题标记和导出失败测试**

断言问题标记对话框复用 `CalligraphySchema.problemTags`；提交后仅选中行增加标签、批注和 `batch-issue` 历史；保存失败回滚。断言 `deliveryRows()` 在 `exportScope === "selected"` 时严格返回已选行，CSV/JSON 不包含未选条目。

- [x] **Step 2: 运行目标测试确认失败**

Run: `node --test --test-name-pattern='batch issue|selected export' scripts/test-workflow-reliability.mjs`

Expected: FAIL。

- [x] **Step 3: 实现轻量问题对话框**

新增 `batchIssueModal()`，使用现有 `.modal-backdrop .edit-modal.workflow-modal` 结构。表单包含一个必选问题标签和可选备注。`batchMarkIssue(form)` 对选中行统一追加标签、annotation、问题状态和审计，使用 checkpoint 原子保存。

- [x] **Step 4: 扩展导出范围**

`openExportPanel("selected")` 设置 `state.exportScope = "selected"`；`deliveryRows()` 增加 selected 分支；导出弹窗范围中仅在存在选择时显示“选中条目”；正式成果 metadata 的 `scopeLabel` 正确写入“选中条目”。批量工具栏导出按钮直接打开此范围。

- [x] **Step 5: 运行目标测试**

Run: `node --test --test-name-pattern='batch issue|selected export' scripts/test-workflow-reliability.mjs`

Expected: PASS。

### Task 4: 三模型批处理队列

**Files:**
- Modify: `src/main.js`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 写 AI 队列失败测试**

模拟 `fetch` 并覆盖：启动前提示 `条目数 × 已启用模型数`；条目串行、每条只发一个 consensus 请求；`auto_approve_record` 自动应用和确认；`adopt_fields`/`needs_human_review` 进入待复核；单条 HTTP 失败继续下一条；停止后不启动新请求；输入签名变化时不覆盖；每条完成后保存。

- [x] **Step 2: 运行目标测试确认失败**

Run: `node --test --test-name-pattern='batch AI' scripts/test-workflow-reliability.mjs`

Expected: FAIL。

- [x] **Step 3: 提取可复用的单条共识请求**

新增：

```js
async function requestConsensusForRow(row, sourceText) {
  const response = await fetch("./api/ai/consensus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(consensusRequestPayload(row, sourceText))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `模型服务返回 ${response.status}`);
  return window.CalligraphyAiConsensus.normalizeConsensusResponse(payload);
}
```

单条 AI 面板与批量队列共用此函数，避免两套请求契约漂移。

- [x] **Step 4: 实现逐条批任务**

新增 `startBatchAiReview()`、`stopBatchAiReview()` 和 `runBatchAiRow(row, job)`。启动时锁定 ID 快照并初始化统计；依次获取 `cachedSourceText`、记录输入签名、调用共识接口。若签名未变化且结果允许自动通过，复用现有共识应用规则；否则写入待复核状态及 `batch-ai-review` 审计。每条调用一次 `saveWorkspace()`，保存失败回滚该条并计入失败。

- [x] **Step 5: 明确判过规则**

批量请求将 `reviewMode` 显式设为 `auto`，因为用户启动批任务前已经确认调用量与自动判过语义；单条 AI 面板继续使用项目设置。只有服务端返回 `auto_approve_record` 时自动确认。`adopt_fields` 只应用可采纳字段并保留为待复核；`needs_human_review` 不覆盖字段。任何模型失败、阻塞项或证据不足均不得自动判过。

- [x] **Step 6: 运行目标测试**

Run: `node --test --test-name-pattern='batch AI' scripts/test-workflow-reliability.mjs`

Expected: PASS。

### Task 5: 响应式视觉与完整验证

**Files:**
- Modify: `src/styles.css`
- Modify: `index.html`
- Test: `scripts/test-workflow-reliability.mjs`

- [x] **Step 1: 增加布局测试**

断言批量栏在桌面使用单行紧凑布局，在 `max-width: 760px` 下允许横向滚动或分两行；所有按钮有稳定尺寸；没有覆盖 `.detail-panel` 或 `.ai-evidence-panel` 的 fixed 定位。

- [x] **Step 2: 完成响应式样式和缓存版本**

批量栏使用 `position: sticky`、小于等于 4px 圆角、稳定高度、克制的绿色状态提示和红色危险按钮。更新 `index.html` 的 CSS/JS 查询版本，确保浏览器获取新资源。

- [x] **Step 3: 运行静态与完整测试**

Run: `npm run check && npm test`

Expected: 语法、云端隔离、全部 Node/Python 测试通过。

- [x] **Step 4: 真实三模型联调**

在本地服务上分别提交：一条出处与字段明确的短样本；一条证据不足样本。记录 DeepSeek、千问、Kimi 的状态与耗时，断言正常样本无模型失败，证据不足样本不得自动判过。不得输出 API Key。

- [x] **Step 5: 浏览器视觉检查**

重启 `127.0.0.1:8765`，在桌面与窄屏打开统一主表，实际勾选多条并截图检查：工具栏、表头选择框、右侧详情和 AI 面板无重叠；运行状态不会改变表格宽度；删除和对话框焦点行为正常。

- [x] **Step 6: 检查差异与密钥安全**

Run: `git diff --check && git status --short`

同时读取本地运行时密钥并仅检查它是否出现在 `git ls-files` 中，输出命中文件名而不输出密钥。Expected: 无命中，`.runtime/model-config.json` 仍被忽略且权限为 `0600`。

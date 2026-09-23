# 古籍入库三栏工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把古籍入库页改成单视口、桌面三栏、移动端固定上下分区的校读工作台，并保持现有入库、校对、导出和 AI 候选行为不变。

**Architecture:** 保留 `AncientIngestUI` 的状态与 API 边界，只重组渲染出的工作台语义区块，并用 CSS Grid 分配固定视口。扫描、OCR 文本和结果列表分别承担自己的滚动；视觉脚本同时检查桌面三栏、移动端完整可见性和页面无滚动。

**Tech Stack:** 原生 JavaScript、CSS Grid、Python 本地服务、Playwright。

---

### Task 1: 固定验收条件

**Files:**
- Modify: `scripts/visual-ancient-ingest-check.mjs`

- [x] 扩展 Playwright 几何检查：页面纵横方向都不溢出视口。
- [x] 桌面端断言控制、扫描、编辑三栏从左到右排列，并存在页码导航。
- [x] 移动端断言任务、页码输入、扫描、文本和输出均未被隐藏，且主要区域按上下顺序排列。
- [x] 运行视觉检查，确认三栏实现满足新断言。

### Task 2: 重组校读结构

**Files:**
- Modify: `src/ancient-ingest.js`

- [x] 从左栏任务详情移除逐页按钮条，保留任务进度与计数。
- [x] 将校读区拆成扫描栏和编辑/输出栏；无任务、无完成页时仍渲染稳定的三栏占位结构。
- [x] 在扫描栏增加上一页、下一页和逐页状态导航，并复用现有 `data-ingest-page` 事件路径。
- [x] 保持保存文本、载入材料库、下载 CSV/JSON、生成 AI 候选的原有事件与 API 不变。

### Task 3: 实现单视口响应式布局

**Files:**
- Modify: `src/styles.css`
- Modify: `index.html`

- [x] 桌面端将工作台设为三列，并让左栏、扫描画布、OCR 文本和结果列表分别滚动。
- [x] 中等宽度下保持三栏但收窄控制栏，避免扫描图或编辑区被挤成不可用宽度。
- [x] 手机端把控制区放在上部可滚动区域，扫描区与编辑/结果区放在下部固定分区，保留所有任务与页码控件。
- [x] 更新静态资源版本参数，避免浏览器继续使用旧 CSS/JS。

### Task 4: 验证和人工复核

**Files:**
- Modify: `scripts/visual-ancient-ingest-check.mjs`
- Refresh: `docs/superpowers/verification/ancient-ingest/desktop.png`
- Refresh: `docs/superpowers/verification/ancient-ingest/mobile.png`

- [x] 运行 `npm run check`，所有语法、Python 编译和隔离检查通过。
- [x] 运行与古籍入库相关的自动测试，任务恢复、TXT 复用和输出接口继续通过。
- [x] 启动本地服务并运行视觉脚本，桌面和移动端几何断言通过且控制台无错误。
- [x] 查看两张新截图，顶栏模块名持续可见、页面内大标题已移除、桌面三栏清晰、移动端没有因隐藏控件而丢失操作；脚本额外验证了“下一页”切换到书页 155。

## 自检

- 覆盖了三栏职责、固定视口、内部滚动、移动端上下分区和顶部状态保留。
- 不改变后端、任务数据、OCR 策略或导入/导出语义。
- 当前工作树已有未提交改动；本计划只编辑上述文件，不提交、不推送、不部署。

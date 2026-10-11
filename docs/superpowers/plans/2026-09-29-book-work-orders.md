# 古籍任务发布与分工 Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Preserve existing uncommitted changes.

**Goal:** 在五账号本地演练中提供管理员发布、按页段/环节分工、成员提交、管理员验收的可用闭环。

**Architecture:** `simulation_auth.py` 保存共享总任务、工作项与事件，`simulation_server.py` 进行同源及身份校验后路由 API。独立 `team-tasks.html` 与 `src/team-tasks.js` 实现管理员和成员界面；静态页面只说明连接条件。

**Tech Stack:** Python 3 标准库 SQLite/HTTP，原生 JavaScript、HTML/CSS，`unittest` 和 `node --test`。

---

### Task 1: 存储与状态机

**Files:** `simulation_auth.py`, `scripts/test_team_tasks.py`

- [x] 写测试：两本书独立；同书同环节页段不可重叠；只有 `test01` 可创建、发布、改派、验收；成员只可读写被分配工作项；过期修订返回冲突；操作事件保留。
- [x] 在 SQLite 中加共享 `book_tasks`、`work_units`、`work_unit_events`，每个状态转换包在事务中。服务端从认证会话取用户名，工作项操作不接受客户端声明的操作者。
- [x] 运行 `python3 -B -m unittest scripts.test_team_tasks -v`，确认通过。

### Task 2: HTTP API

**Files:** `simulation_server.py`, `scripts/test_team_tasks.py`

- [x] 写测试：匿名、工作人员发布、越权读写、跨站、过期修订均被拒绝；管理员与成员列表只返回对应可见任务。
- [x] 加受权限约束的任务列表、工作项详情、创建、拆分、发布、保存、提交、改派、验收、退回接口。保留原模拟工作区和 OCR 路由。
- [x] 运行 `python3 -B -m unittest scripts.test_team_tasks -v`。

### Task 3: 管理员与成员页面

**Files:** `team-tasks.html`, `src/team-tasks.js`, `src/team-tasks.css`, `simulation_server.py`, `index.html`

- [x] 在浏览器走通管理员创建、划分页段、指定成员、发布、退回与验收；成员保存、提交、查看退回理由并重交。静态预览明确说明不可在线协作。
- [x] 实现 `team-tasks.html` 和独立脚本；所有动态文本做 HTML 转义。模拟服务允许该页面与其静态资源访问，首页提供团队任务入口。
- [x] 在 390px 与桌面宽度浏览器检查可读性、表单保存及无横向溢出。

### Task 4: 回归和文档

**Files:** `docs/five-user-simulation.md`, `docs/product-goals-roadmap.md`, `package.json`

- [x] 更新演练操作说明、正式上线边界与当前路线状态；`npm run check` 覆盖新脚本。
- [x] 运行 `npm test`、`npm run check`、`git diff --check`，复核新页面与旧古籍导入/文件审核入口。
- [x] 报告实现、验证、未部署范围；不触碰已有用户数据，也不推送或部署。

# 书论工作区云端用户隔离方案

Review date: 2026-09-03

## 目标

把当前单人本地工作台升级为团队可协作的云端工作台。核心隔离边界是：

- 团队成员只能看到自己所属团队的数据。
- 项目成员只能处理当前项目/工作区的数据。
- 审校员可以确认、标注、批注；不能管理团队成员。
- 管理员可以导入材料、创建工作区、分配与导出。
- 旧的 `localStorage` 只作为离线草稿或迁移来源，不能作为云端协作的主存储。

## 推荐技术栈

- Auth: Supabase Auth
- Database: Supabase Postgres
- Isolation: Postgres Row Level Security
- File storage: Supabase Storage
- Frontend hosting: Vercel
- Search proxy: Serverless Function，保留当前 `/api/search` 接口形态

## 数据隔离层级

每条协作数据都必须带上这些字段中的至少前三个：

```text
team_id
project_id
workspace_id
created_by
updated_by
```

这样同一套云端数据库可以同时承载多个团队、多个书论项目、多个整理工作区，不会互相串数据。

## 角色权限

| 角色 | 典型权限 |
| --- | --- |
| owner | 管理团队、项目、成员、所有数据 |
| admin | 创建项目、导入材料、导出成果、分配任务 |
| editor | 编辑统一主表、维护原文页、处理回检 |
| reviewer | 确认条目、人工标注、写批注、提交回检 |
| viewer | 只读查看 |

## 已新增迁移

迁移文件：

```text
supabase/migrations/20260903094500_cloud_collaboration_isolation.sql
```

它包含：

- `profiles`
- `teams`
- `team_members`
- `team_invites`
- `projects`
- `workspaces`
- `materials`
- `source_pages`
- `review_rows`
- `review_events`
- `annotations`
- `search_logs`

并启用了 RLS：

- `select`：团队成员可读。
- `insert/update`：按 `owner/admin/editor/reviewer/viewer` 分层控制。
- `review_rows`：`reviewer` 及以上可更新审校状态。
- `team_members`：只有 `owner/admin` 可管理。
- `create_team_with_owner()`：解决首次创建团队时还没有成员身份的问题。
- `accept_team_invite()`：被邀请邮箱登录后接受邀请，写入 `team_members`。

## 前端迁移路线

当前前端主要使用：

```text
localStorage
state.rows
state.reviewState
state.uploadedPages
```

云端化时按这个顺序替换：

1. 加登录态：初始化 Supabase client，顶部用户从“本地用户”改为真实账号。
2. 加团队/项目选择：启动时读取 `teams -> projects -> workspaces`。
3. 导入 CSV 后写入：
   - `materials`
   - `source_pages`
   - `review_rows`
4. 审校动作写入：
   - 更新 `review_rows.review_status / flagged / fields`
   - 追加 `review_events`
5. 批注写入：
   - `annotations`
6. 搜索记录写入：
   - `search_logs`
7. 导出时只读当前 `workspace_id` 下的数据。

## 当前代码接入状态

已新增：

- `src/cloud-store.js`：Supabase 数据访问入口。
- `cloud-config.example.json`：前端云端配置样例。
- `scripts/verify-cloud-isolation.mjs`：静态检查迁移文件是否包含核心表、RLS 和关键策略函数。
- 顶部用户状态：
  - 未配置：显示“本地用户”。
  - 已配置但未登录：显示“云端未登录”，点击后输入邮箱，走 Supabase magic link。
  - 已登录：显示账号和“同步”，点击后把当前工作区批量同步到云端。
- 首页右栏“云端协作”：
  - 显示状态、团队、项目、工作区、成员数。
  - 已登录后可同步当前工作区。
  - 已登录后可邀请成员，角色支持 `owner/admin/editor/reviewer/viewer`。
- 启动读取顺序：
  - 有云端配置且已登录，并且云端工作区已有数据：优先读取云端。
  - 云端不可用或云端无数据：继续读取本地 `localStorage` / 样本数据。
- 单条自动同步：
  - 确认
  - 人工标注/取消标注
  - 修改字段
  - 删除
- 批量同步内容：
  - 当前导入批次写入 `materials`
  - 原文页写入 `source_pages`
  - 审校行写入 `review_rows`
  - 本地批注写入 `annotations`
  - 单条审校动作写入 `review_events`

## 部署形态

现在仓库已经包含 Vercel 部署入口：

- `vercel.json`：静态页面入口和缓存策略。
- `api/config.js`：从部署环境变量生成前端云端配置。
- `api/search.js`：线上搜索代理，接口保持 `/api/search?q=关键词`。
- `server.py`：本地开发服务器，接口与线上保持一致。

生产部署时优先使用环境变量，不需要提交真实 `cloud-config.json`：

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
CLOUD_SYNC_ENABLED=true
DEFAULT_TEAM_NAME=书论研究团队
DEFAULT_PROJECT_NAME=书论整理项目
DEFAULT_WORKSPACE_NAME=书论统一主表
```

`SUPABASE_ANON_KEY` 是浏览器公开 key，真正的数据边界由 RLS 策略控制。不要把 Supabase service role key 放进前端、`.env` 示例、`cloud-config.json` 或 Vercel 前端可读配置。

如果只做纯静态预览，可以把 `cloud-config.example.json` 复制为 `cloud-config.json`，并填写：

```json
{
  "enabled": true,
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseAnonKey": "your-anon-key",
  "defaultTeamName": "书论研究团队",
  "defaultProjectName": "书论整理项目",
  "defaultWorkspaceName": "书论统一主表"
}
```

## 部署前检查

- Supabase 项目已经创建。
- 已在 Supabase SQL Editor 或 CLI 中运行：

```text
supabase/migrations/20260903094500_cloud_collaboration_isolation.sql
```

- Vercel 环境变量已经配置：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
CLOUD_SYNC_ENABLED
DEFAULT_TEAM_NAME
DEFAULT_PROJECT_NAME
DEFAULT_WORKSPACE_NAME
```

- 本地静态检查通过：

```bash
npm run check
```

- 本地 API smoke check 通过：

```bash
npm start
curl -fsS http://127.0.0.1:8765/api/health
curl -fsS http://127.0.0.1:8765/api/config
curl -fsS "http://127.0.0.1:8765/api/search?q=王羲之"
```

- 用两个测试用户验证：
  - 用户 A 创建团队和项目。
  - 用户 B 未加入时不能读取任何项目数据。
  - 用户 B 加入为 `reviewer` 后可以读项目、改审校状态、写批注。
  - 用户 B 不能增删成员。
  - 用户 C 加入另一团队后不能看到 A 团队数据。
  - 用户 D 收到邀请前没有团队；登录后应进入被邀请团队，而不是自动创建新团队。

## 当前限制

迁移、前端云端 store、登录、同步、邀请入口已经具备基础。还需要真实 Supabase 项目进行端到端联调，包括 RLS 权限、magic link 登录、邀请接受、批量同步和多用户并发审校。

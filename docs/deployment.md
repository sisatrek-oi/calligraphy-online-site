# 书论工作区部署说明

Review date: 2026-09-03

## 目标

把当前本地工作台部署成可团队协作的网页版本。推荐组合：

- Vercel：托管静态页面、`/api/config`、`/api/search`。
- Supabase：登录、团队隔离、主表数据、审校记录、批注。

## 部署前准备

1. 创建 Supabase 项目。
2. 在 Supabase 执行迁移：

```text
supabase/migrations/20260903094500_cloud_collaboration_isolation.sql
```

3. 在 Vercel 项目环境变量中配置：

```text
SUPABASE_URL
SUPABASE_ANON_KEY
CLOUD_SYNC_ENABLED=true
DEFAULT_TEAM_NAME=书论研究团队
DEFAULT_PROJECT_NAME=书论整理项目
DEFAULT_WORKSPACE_NAME=书论统一主表
```

4. 不要配置或暴露 `SUPABASE_SERVICE_ROLE_KEY`。前端只能使用 anon key，权限靠 RLS 控制。

## 本地验证

```bash
npm run check
npm start
curl -fsS http://127.0.0.1:8765/api/health
curl -fsS http://127.0.0.1:8765/api/config
curl -fsS "http://127.0.0.1:8765/api/search?q=王羲之"
```

## Vercel 部署

仓库根目录已经包含：

- `vercel.json`
- `api/config.js`
- `api/search.js`
- `package.json`

Vercel 导入仓库后使用默认设置即可。该项目没有构建步骤，输出就是仓库根目录的静态文件。

## 上线后验收

- 打开首页，顶部应显示“云端未登录”或已登录账号。
- `/api/config` 返回 `enabled: true`。
- 搜索面板能返回网页结果。
- 第一个用户登录后可以创建默认团队、项目和工作区。
- 第二个未被邀请用户不能看到第一个团队的数据。
- 被邀请为 `reviewer` 的用户可以确认条目、标注问题和写批注，但不能管理成员。

## 回滚

- 前端问题：在 Vercel 回滚到上一个部署。
- 数据问题：暂停写入入口，保留数据库，不删除表；按迁移文件审查后再补修复 SQL。
- 搜索问题：临时隐藏搜索面板或让 `/api/search` 返回空结果，不影响主表审校。

# 书论工作区部署说明

Review date: 2026-09-15

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

## 模型接口配置

本地运行 `server.py` 时，可以在“项目设置 → 模型连接”中测试、保存、切换或删除 OpenAI Chat Completions 兼容接口。保存后的配置位于 `.runtime/model-config.json`，该目录已被 Git 忽略；API Key 只由本地服务读取，浏览器状态、工作区数据和公开配置接口均不保存或返回完整密钥。

本地网页配置优先于环境变量。删除本地配置后，服务会回退到以下环境变量：

```text
MODEL_API_URL
MODEL_API_KEY
MODEL_NAME
```

GitHub Pages 等纯静态托管无法写入服务器配置，设置界面会显示“不支持本地保存”。Vercel 部署继续使用上面的环境变量，不要把 API Key 写入仓库或前端代码。团队版本如需网页端动态切换模型，应把配置存入受权限控制的服务端密钥存储，并单独实现管理员权限与审计记录。

## 本地验证

```bash
npm run check
npm start
curl -fsS http://127.0.0.1:8765/api/health
curl -fsS http://127.0.0.1:8765/api/config
curl -fsS http://127.0.0.1:8765/api/model-config
curl -fsS "http://127.0.0.1:8765/api/search?q=王羲之"
```

`/api/model-config` 只返回接口地址、模型名、配置来源和密钥末四位，不返回完整 API Key。

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

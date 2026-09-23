# 书论工作区部署说明

Review date: 2026-09-23

## 部署架构

- Vercel：静态页面、健康检查、公开配置、搜索、单模型抽取和三模型共识。
- Supabase：登录、团队隔离、工作区与审校记录持久化。
- 本地 `server.py`：PDF 盘点、OCR、逐页文本、CSV 与古籍入库任务。这些功能需要本地文件系统和 OCR 运行时，不放进 Vercel Function。

## Vercel 项目设置

1. 导入 GitHub 仓库，Root Directory 指向本站点目录。
2. Framework Preset 选择 `Other`，Build Command 和 Output Directory 留空。
3. 先配置 Preview 环境变量并发布预览版，验收后再复制到 Production。
4. 环境变量更改后需要重新部署才会进入新函数实例。

仓库根目录的 `vercel.json` 已为 AI 函数设置 60 秒最长执行时间。三个模型会并行请求；任意一个失败都会保留错误并转人工复核，不会当作共识通过。

## 环境变量

从 `.env.example` 复制名称，真实值只填在 Vercel Project Settings 中，不要提交 `.env`。

### 云协作

```text
SUPABASE_URL
SUPABASE_ANON_KEY
CLOUD_SYNC_ENABLED=true
REMEMBER_EMAIL_ENABLED=true
DEFAULT_TEAM_NAME=书论研究团队
DEFAULT_PROJECT_NAME=书论整理项目
DEFAULT_WORKSPACE_NAME=书论统一主表
```

不要向前端或 Vercel 公开配置写入 `SUPABASE_SERVICE_ROLE_KEY`。客户端只使用 anon key，权限依靠 Supabase RLS。初次部署前在 Supabase 执行：

```text
supabase/migrations/20260903094500_cloud_collaboration_isolation.sql
```

### 模型接口

```text
MODEL_PRIMARY_API_URL
MODEL_PRIMARY_API_KEY
MODEL_PRIMARY_NAME
MODEL_PRIMARY_FAMILY

MODEL_SECONDARY_API_URL
MODEL_SECONDARY_API_KEY
MODEL_SECONDARY_NAME
MODEL_SECONDARY_FAMILY

MODEL_TERTIARY_API_URL
MODEL_TERTIARY_API_KEY
MODEL_TERTIARY_NAME
MODEL_TERTIARY_FAMILY

MODEL_REVIEW_MODE=assist
MODEL_DEFAULT_CONSENSUS=standard
AI_AUTH_REQUIRED=true
CONSENSUS_SNAPSHOT_SECRET
```

API URL 必须是 HTTPS 的 OpenAI Chat Completions 兼容端点。旧的 `MODEL_API_URL` / `MODEL_API_KEY` / `MODEL_NAME` 仍可作为 primary 单模型回退。只有三个槽位都完整配置时，前端才会开启三模型共识。

`CONSENSUS_SNAPSHOT_SECRET` 用于签发无状态单模型重试令牌，建议配置独立的长随机值。未配置时后端会从三个服务端模型密钥派生签名键。令牌与原文、字段模板和审核策略绑定，篡改后会被拒绝。

`AI_AUTH_REQUIRED=true` 时，AI 接口必须携带有效的 Supabase 会话，请求中的云端工作区必须能通过该用户的 RLS 查询，且团队角色至少为 reviewer；viewer 不能消耗模型额度。Vercel 环境默认启用此门禁，不要在生产环境将其关闭。

`/api/model-config` 只返回模型名、接口地址、模型家族和密钥末四位；不返回完整密钥。Vercel 环境下的模型配置为只读，页面不会尝试把新密钥保存到无状态函数。

## 本地验证

```bash
npm run check
npm test
npm start
```

本地服务启动后：

```bash
curl -fsS http://127.0.0.1:8765/api/health
curl -fsS http://127.0.0.1:8765/api/config
curl -fsS http://127.0.0.1:8765/api/model-config
curl -fsS "http://127.0.0.1:8765/api/search?q=王羲之"
```

## Preview 验收

将下面的 `$PREVIEW_URL` 替换为 Vercel 预览域名：

```bash
curl -fsS "$PREVIEW_URL/api/health"
curl -fsS "$PREVIEW_URL/api/config"
curl -fsS "$PREVIEW_URL/api/model-config"
```

应确认：

- `/api/health` 返回 `ok: true`，能力开关与实际变量一致。
- `/api/config` 不包含任何模型密钥。
- `/api/model-config` 不包含完整 API Key，且三个 profile 的模型家族正确。
- 未登录用户看不到团队数据；reviewer 能审校但不能管理成员。
- 单模型抽取能返回候选；三模型失败一路时只进入人工复核。
- 线上打开“古籍入库”时显示本地服务说明，不请求 `/api/ancient-ingest/*`。

## 上线门槛

`MODEL_REVIEW_MODE=auto` 默认禁用。启用前必须在至少 200 条已人工审核记录上回放，自动可判过子集的整条精确率不低于 99.5%，且书家归属、原文出处和页码不得错误通过。任一高风险字段错误通过时，立即回退到 `assist`。

## 回滚

- 代码问题：在 Vercel Deployments 中把 Production 别名切回上一个已验证版本。
- 模型问题：移除对应槽位变量并重新部署，页面会降级为单模型或禁用 AI。
- 搜索问题：临时隐藏搜索入口或让接口返回空结果，不影响主表审校。
- 数据问题：暂停写入，保留 Supabase 数据与审计记录，不删表。

# Workspace Redesign Implementation Plan

**Goal:** 将五工作区Lovart设计实现为本地可验收的真实交互，首页只导航、记住有效登录，保留现有校勘数据。

**Architecture:** 原生HTML/JS/CSS共用导航与视觉变量；main.js继续管理主表/导入，screening.js继续管理校勘，独立材料与交付页只调用现有格式和验证器。新增纯函数用于设备记忆与范围选择；不改框架、数据协议或生产部署。

**Tech Stack:** 原生ES modules/classic scripts、CSS grid/flex、localStorage、现有Python服务、Node test和隔离Playwright。

执行方式：本会话逐项实现与核验。用户已经授权本地实现，完成后停在本地验收，不推送。

- [x] 保存并逐张查看Lovart图；design记录实图、项目链接和风格依据。
- [x] 创建src/workspace-ui.js和src/workspace-ui.css：统一五入口导航、图标、手机导航及共享变量；所有HTML加载同一资源。
- [x] 创建src/device-session.js，修改main.js入口恢复/登录/退出与cloud-store.js会话选项。纯函数测试覆盖过期、坏数据、30天期限、退出和云端不接受本地门禁。
- [x] main.js首页改四入口，关闭无操作首页自动载样本；主表/回检/独立审核同一组视图标签。修改只触及渲染、路由和设备会话，不改审校数据处理器。
- [x] team-tasks.js选择成员界面精简，沿用所有七人页段与旧链接；记住选择，人工统计按有效页和本机覆盖去重。
- [x] screening.js正文改为同屏单一可编辑textarea，确认区常驻；添加人工页码筛选和成员/段切换，历史备注抽屉不再有第二正文。保持原自动保存与冲突流程。
- [x] materials.html/src/materials.js：当前工作TXT、原始PDF/OCR、人工材料、折叠历史；保留真实本地导入处理入口。
- [x] delivery.html/src/delivery.js：选择范围调用原材料loader/ZIP构建器；JSON预览后恢复原分份完整记录；负责人只读回收检查明确文件类别，不自动合入。错误不写入旧记录。
- [x] review.html/file-review.js套用共用导航与条目视图，保留离线审核包、独立意见和汇总流程。
- [x] 运行npm test、npm run check、git diff --check；用隔离浏览器检查桌面/手机、实际ZIP/恢复、旧人工稿/基准保护、保存失败和登录记忆；查看截图后修正。
- [x] 检查screening-data零差异、生产远端未改变，更新任务README与canonical指导文档，保持本地服务供用户验收。无push/PR/部署。

主要检查命令（site目录）：`npm test`、`npm run check`、`git diff --check`、`node --test scripts/test-device-session.mjs`。浏览器证据放任务evidence目录，检查脚本放任务browser-check.mjs。

发布确认仍未获得：本计划的本地实现与验收已完成，后续不得自行推送。

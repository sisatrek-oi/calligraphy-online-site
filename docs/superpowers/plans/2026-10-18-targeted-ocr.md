# 首批局部OCR结果发布 Implementation Plan

**Goal:** 发布22页62区域的对图裁决与10处参照纠错，显示真实的局部完成/待核状态。

**Architecture:** 新增独立targeted层，由现有逐页材料构建器打包；默认正文优先个人稿、团队整页稿、局部复核载体、原OCR。载体以网页现有OCR为底，按已回图定位的62个区间替换；区间外逐字节不变，整页完成标志始终false。旧OCR、成员稿、比较底稿和历史修改率保留。

**Tech Stack:** Python/Pillow/RapidOCR本机推理；ES modules；静态GitHub Pages。

本文件为发布前计划快照；线上交付以本轮提交、GitHub Pages部署及发布验收记录为准。

- [x] 在独立worktree冻结清单，使用本机medium模型识别62区域两尺度；对两个截断区域扩框补识别。依据`../执行方案.md`逐区核字，保存`region-decisions.json`。
- [ ] 数据发布：`../build_release.py`生成`screening-data/part-{1,4}-targeted.json`、TXT、状态CSV和公开逐区证据；对`part-{1,2}-collated.json`按唯一上下文应用10项确认修正，298页增加待核说明；重建下载。
- [ ] 层校验：新增`src/targeted-ocr.js`，校验非整页、区域状态、候选和唯一ID；`scripts/build-screening-materials.mjs`生成索引摘要；`src/screening-loader.js`逐chunk校验，拒绝不匹配摘要后才附载。
- [ ] 正文与状态：`src/ocr-source-policy.js`仅为无个人稿者选择新增层；`src/screening.js`沿用已有抽屉显示区域记录、待核、证据下载。`src/team-tasks.js`显示每份局部计数；资源URL更新版本防止旧脚本缓存。
- [ ] 回归：`node --test scripts/test-targeted-ocr.mjs scripts/test-team-collation.mjs scripts/test-screening-loader.mjs scripts/test-ocr-safety.mjs`，核验62覆盖、原图hash、法合并后无去/X残片、待核未冒充全页完成、个人稿及baseline不变、损坏targeted元数据整chunk拒载。
- [ ] 构建与检查：`npm run build:screening`、`npm test`、`npm run check`；检查diff仅为授权数据、必要兼容代码和文档，原始1052页数据不变。
- [ ] 用户可见验收：本机临时静态服务，通过浏览器打开62/100/828及274/298页，检查正文、状态、原图、下载和个人稿保留；全屏框架保持既有布局。
- [ ] 发布：提交并以fast-forward推送`HEAD:main`，等待Pages部署，线上抽查及文件哈希核对；记录commit、部署与结果，保留worktree和证据，不清理用户修改。

Plan self-review: 数据范围、P0切栏修复、原稿保留、局部/整页状态、待核、回滚和发布后检查均已覆盖。按用户已明确授权的工作在当前会话内逐项执行，不另起任务。

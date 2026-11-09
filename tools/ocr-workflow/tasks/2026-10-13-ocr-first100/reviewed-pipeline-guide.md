# 当前OCR入口：small默认、异常定向候选、大模型待核建议

2026-10-18起，`run_ocr.py`的普通调用使用small默认、异常定向修框/medium候选，并按用户授权追加大模型待核建议层。大模型会向现有DeepSeek官方接口发送本批待核原图定位图、裁片与OCR候选；默认整批最多12次调用、按记录的公开峰值价保守预留0.25美元。**所有建议先待人工回图，未确认不改有效正文。** 使用`--no-vlm`可只运行本机OCR，不上传或调用接口。网页旧Tesseract导入服务仍是另一条入口。

## 逐字映射为固定OCR产物（2026-11-08）

当前标准链路为：**原图裁剪 → OCR识别并保留字符位置 → 绑定当前TXT版本 → 按篇章组织逐字审核 → 人工校改／调框 → 保存与导出**。映射信息随整条链路保留，不能只交TXT而丢掉原图对应关系。逐页JSON只是原图溯源容器，网站入口和阅读仍按篇目／整章组织。

普通 `run_ocr.py` 新批次清单已将 `configuration.characterMapping.required` 设为 `true`；不需要额外开关。基线必须保留字符ID、裁片／栏序、原图像素坐标、原图路径／SHA256及尺寸；原旋转裁片坐标须还原至整页原图。坐标暂缺时保留正文和未映射记录，不能借相邻字的框。

每次识别、复核采纳或重新导出，固定生成：

- `character-maps/NNNN.json`：当前逐页有效正文的精确文本、SHA256、UTF-16起止范围、字符ID和原图框；附实际采用的 `sourceGlyphs` 几何来源、原图版本、批次及事件版本。
- `character-map-index.json`：全部请求页的映射状态、文件SHA、原图SHA和TXT SHA。旧稿没有坐标记为 `legacy_without_geometry`，OCR失败记为 `page_failed`。`available`只表示映射文件可用，不表示每个字符都有位置或已人工审核；处理是否完成另看逐页处理状态。
- `review-status.json.characterMapping`：映射索引路径及可用／历史缺坐标／失败数量。正常CLI结束摘要也会报告此信息。

选择修框small／medium等复识候选时，文字与该候选自己的几何一起导出；后续预览和重新对齐继续使用同一候选池，不能换回旧基线坐标。若复识候选未返回几何，保留该候选的文字占位及空坐标，不回借另一候选的框。自定义或模型建议文字采用后，重新建立它与实际图中字形的对应，新增及无法唯一对应的文字保留空位置。映射不等于OCR正确或人工审核完成。

网站比例缩放只改变显示，映射始终使用原图像素坐标。网站人工调框作为独立 `manualCrops` 修订层保存在章草稿及JSON备份中。原OCR基线与复识记录保留，不直接覆盖；新图、新正文或新识别批次不能继承旧版本的人工确认。正式书论标注仍只准入与审核记录匹配的人工TXT，wolai已确认版本优先，机器新稿不能直接进入正式标注。

本机验收命令（不请求模型接口）：

```sh
"/Users/liujianing/Desktop/project worker/output/2026-09-23-hanwei-fu-ocr-sample/.venv-v5/bin/python" run_ocr.py --pages 13,16,244 --output 新的空批次目录 --no-vlm
```

新产物可用现有 `build_character_preview.py --run 批次目录 --output 新预览目录` 做几何包检查；如索引或原图版本不匹配则拒绝打包。正式任务沿用网站整章入口，不能把检查工具的原页清单当作新的逐页审核主流程。

其他OCR引擎接入也须提供等价映射；旧Tesseract或历史纯文字输出须先在新目录用 `map_ocr_characters.py` 只读补定位。不得给旧数据伪造已有映射、审核或新批次状态。代码／配置指纹变化后新建批次，历史批次保留。

## 运行

在本目录，以既有OCR Python运行：

```sh
"/Users/liujianing/Desktop/project worker/output/2026-09-23-hanwei-fu-ocr-sample/.venv-v5/bin/python" run_ocr.py --pages 62,100 --output runs/my-reviewed-batch
```

接口密钥优先读取`DEEPSEEK_API_KEY`，否则使用本工作区既有平台`.env.local`的DeepSeek官方配置；不把密钥写入批次，也不通过命令参数传密钥。缺少配置时标记“接口配置不可用”，保留small，返回非零状态；不能当作复核成功。

只运行本机、不请求接口：在上述命令添加`--no-vlm`。`--vlm-max-calls`与`--vlm-max-usd`可明确设置本批限制；它们是整批累计上限，不因恢复运行重置。策略、代码、预算改变需新建批次，不直接修改旧清单。

`--all`仍指本目录四份各前100页，共400页；也可用`--pages`指定1—1052内页面。未指定`--output`时自动新建独立`runs/reviewed-批次ID/`。新输出目录必须为空，不能指向历史材料目录。默认明确选择`PP-OCRv6_rec_small.onnx`；两套权重必须已在本机，路径可通过`--models`指定。

再次运行同一命令、使用相同输出目录时，已完成页直接复用；进程中断留下的未完成页继续处理，已保存基线不重跑。候选失败需显式加`--retry-failed`，以前的错误尝试仍保留。参数、源图、权重、依赖或核心代码发生变化时拒绝混用同一批，需新建输出目录。存在页面处理失败或未处理的候选失败时，命令返回2，同时保留可恢复结果。

## 何时生成候选

- 任一短段分数低于0.93，或缺少有效分数；这里只表示需要复核，不是错误概率。
- 有明显墨迹却无汉字输出：可能截字、图示或噪点，不能自动补字。
- 裁框边界有墨迹、异常宽栏；版面覆盖不足另标页级待核。
- 对分数≥0.97区域按区域ID确定性抽查2%，作为当前操作性比例，不作已校准概率或充分抽样的声明。
- 修框计划显式指定的区域，包括既有罕字待核。

低分本身不会触发通用扩框。正常栏只保留small。边界异常栏才生成受相邻栏中点约束的几何候选，内部切点优先移到空隙；没有合适几何变更则只复核medium。所有候选都保留原始文字、分数、框、时间及失败原因，权重哈希和策略在批次清单中记录。**一致也不自动采纳。**

## 显式修框与跨栏合并

用`--repair-plan plan.json`载入数组。每项含`page`、`columns`、`sourceSha256`、`reason`；需要修框时另给`boxes`，不提供`boxes`只强制原框medium复核。

坐标使用原图像素`[left,top,right,bottom]`，不可越界；多个短段须连续无重叠，整体须覆盖消费栏。跨栏合并必须明确相邻消费栏，例如第62页的16/17栏；派生正文只输出合并后的一个结果，不能在“去。”后再补“法”。不匹配的源图哈希、重复消费或不完整裁框会被拒绝。实际计划示例见工作区`tasks/2026-10-18-ocr-review-integration/repair-plan-v2.json`。

## 回图处理与状态

输出目录保留：

- `manifest.json`：批次、策略、源图、模型、依赖和代码指纹。
- `baseline/`：原框small基线，不因复核改写。
- `machine/`：定向候选、失败与重试历史，供机器结果审计。
- `crops/`：包含原框与候选框的复核裁片，附坐标和SHA256。
- `events/`：逐次追加、带哈希链的回图处理记录，不改写候选。
- `review-status.json`、`review-status.csv`：逐区域候选、差异、一致性、当前revision、采纳来源、复核人/依据/时间及状态。
- `page-status.csv`：包括失败、无文字页面在内的逐页处理状态；整页校勘字段始终为“否”。
- `effective-text.txt`：派生正文；未确认处保留small，只有回图确认的局部才采用所选文字。它不是全部已人工校勘的交付稿。

状态区分“未触发复核”“待回图”“候选失败”“待核·尚未回图”“已回图·仍待核”“保留small”“局部已修改完毕”。全部局部处理完也只标“局部复核项已处理·整页未校”。

## 大模型待核建议层

大模型重点复核原有异常区域及成功候选间的文字分歧，并保留原有分数≥0.97区域的确定性2%抽查。调度先安排高分抽查、随后每5组为其保留机会，避免全部预算都被异常区域占用；预算不足的区域明确标“预算或调用上限·未复核”，不能视为正确。

已有独立批次可不重跑OCR，直接追加建议：

```sh
"/Users/liujianing/Desktop/project worker/output/2026-09-23-hanwei-fu-ocr-sample/.venv-v5/bin/python" review_ocr.py suggest --run runs/my-reviewed-batch
```

同一页每次最多3个区域。模型可返回完整建议或无法确定；缺项、重复ID、截断、无效JSON均整次拒绝采纳。失败请求不自动重试；明确需要时加`--vlm-retry-failed`，仍受剩余累计预算约束。上次发送后中断且计费不明的请求保留预留，不在恢复时悄悄重发。HTTP失败、配置缺失和过期依据会返回非零状态，small基线保留。

新增保存：

- `vlm/manifest.json`：provider、模型别名、提示/代码/策略指纹、参数、价格来源/核验日期和批次预算。
- `vlm/sources/`：调用涉及页面的原图精确副本；原图路径、SHA及像素框同时记录。
- `vlm/context/`：同页定位图；局部裁片仍在原`crops/`，发送前核对其与原图像素一致。
- `vlm/requests/`：每次调用独立记录，含原始响应、图片/候选输入、开始结束时间、墙钟、usage、公开峰/谷价估算及失败/不明状态；不保存密钥。
- `vlm/proposals/`与`vlm/proposal-history/`：逐区域建议、字符修改范围、依据、候选、请求关联、待核状态及旧版本。
- `vlm/summary.json`：按请求去重的费用/耗时汇总。一个请求含多个区域时，不把每个区域显示的共享请求费用重复相加。公开价估算不是账户账单，未包含人工费用。
- `human-review-queue.csv`：原图/裁片、候选、small、大模型建议与依据、建议指纹、当前revision及留空的人工确认栏。

`review-status.json/CSV`同时显示OCR处理状态、大模型建议状态、人工状态。大模型“建议已生成”、与small相同、分数高或模型一致都不会变成人工完成。

确认单为JSON数组，逐项填写区域`unitId`、从当前状态表复制的`expectedRevision`、`choice`、`reviewer`、`note`、`imageChecked`与裁片相对路径`evidence`。选择可以是实际存在的`baseline_small`、`repaired_small`、`baseline_medium`、`repaired_medium`、`trimmed_small`、`trimmed_medium`、`joined_small`、`joined_medium`，以及`custom`或`pending`；不存在/失败候选不能采纳，`custom`另填`text`。需要采纳时必须确认已看对应原图；尚未看图的`pending`不会标成“已回图”。

启用大模型建议层的批次，所有非`pending`选择还须由真正的人工复核者填写`reviewerType: "human"`、`humanConfirmed: true`。采纳大模型建议使用`choice: "vlm"`并提供当前`proposalFingerprint`。系统校验当前源图、裁片、请求、候选与建议指纹，过期或失败建议不能采纳；AI不得代填人工声明。本地CLI只能校验声明和证据字段，尚无登录身份认证，不能声称技术上证明了操作者是真人。

人工确认会追加事件，派生正文只在确认后采用选择的文字；原始small和机器候选始终不改写。建议改变时不自动撤销与它无关的人工选择；已采纳的模型建议若输入变化则显示过期待重新确认。真实验收批次未代替用户作任何人工确认。

```sh
python3 review_ocr.py apply --run runs/my-reviewed-batch --decisions decisions.json
python3 review_ocr.py export --run runs/my-reviewed-batch
```

上述状态管理只用标准Python，不必再次加载模型。实际已填的、带裁片证据的确认单见工作区`tasks/2026-10-18-ocr-review-integration/verified-decisions.json`；其revision仅适用原批次，不能跨批复制。重复或过期确认会被拒绝，必须重新读取状态。整个确认单先校验，再追加事件；磁盘写入故障时以已落盘事件为准，可重新导出核对，不应盲目重复提交。候选重试若改变复核依据，旧采纳会失效并显示待重新确认，避免沿用陈旧判断。

上面的旧确认单是本轮之前的AI回图记录示例，不满足新建议层所要求的人工声明，不能直接用来批准本轮建议。当前真实接入验收、API调用与未采纳状态见`../2026-10-18-ocr-vlm-integration/README.md`。

请保留整个批次目录：单独TXT不包含全部状态和来源，单独CSV也不包含完整事件历史。恢复导出应从批次目录的清单、基线、机器结果和事件重建，不从最终TXT反推审校记录。

## 历史记录与回退

历史`pages/`、四份TXT/JSONL及已发布材料保留。本次接入不将新版结果写入成员稿或网站。旧`retry_empty.py`、`retry_context.py`和`package_results.py`默认阻止改写历史记录；确需复现旧流程时，分别显式加`--legacy`，旧主入口同样使用`run_ocr.py --legacy --all`。新版不需要再串联这些旧脚本。旧运行脚本副本保存在本次接入任务的`before/`中，可用于追溯旧清单所指的脚本版本。


## 2026-10-26：竖排数字裁片复核

当前策略 `small-targeted-review-v2-numeral-crops` 增加两类独立候选：首尾长留白触发 `trimmed_small/medium`；同栏连续短段两侧出现“一二三”时触发 `joined_small/medium`，合并原图范围后重识别，不执行文本合字。“一一”等可能是合法字间关系，整段候选也可能引入其他错字，必须回图选择；高分和模型一致不视为完成。原切分基线与旧事件保留，新识别请使用新的批次目录（代码／策略哈希变化时旧批次恢复会被拒绝）。

本轮只跑本机 `--no-vlm`，未替换审核正文、未代填人工确认。完整对照、26片段数字串诊断、10页去留白回归与真实CLI输出见 `../2026-10-26-vertical-numeral-ocr/README.md`。

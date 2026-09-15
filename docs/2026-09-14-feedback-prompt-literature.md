# 人工审校反馈驱动提示词优化：首轮文献检索

检索与复查日期：2026-09-14。
本轮暂停应用开发，仅检索、阅读与整理；不修改提示词、主表或试审判断。
这是定向相关工作扫描，不是穷尽式系统综述，未复现实验。

## 研究问题

能否把领域专家的条目级修订转成有证据、可限定适用范围的规则，
在未参与优化的文献上降低 AI 处理错误，同时避免引入新错误？
这是提示词/上下文优化问题，不必先进入修改模型权重的 RLHF 路线。

## 检索范围

关键词：human feedback prompt optimization、textual gradients、reflective prompt evolution、
prompt underspecification、prompt hacking、information extraction feedback。
优先论文正文、ACL Anthology、会议论文及作者 arXiv；搜索摘要仅用于定位来源。
筛选重点：反馈信号、候选提示词生成、评审可信度、泛化与成本。

## 直接相关工作

### ProTeGi：错误案例驱动提示词修改

Pryzant et al., EMNLP 2023, Automatic Prompt Optimization with “Gradient Descent” and Beam Search。
用小批量错误生成自然语言批评，再产生候选提示词并搜索筛选。
正文分析发现少量迭代后可能过拟合或陷入局部最优；实验限于四个分类任务，调用成本不低。
阅读：方法、迭代分析及 Limitations。
[论文](https://aclanthology.org/2023.emnlp-main.494/)

### APOHF：用偏好选择替代绝对评分

Lin et al., 2024 arXiv v1, Prompt Optimization with Human Feedback。
通过成对输出偏好优化黑盒模型提示词，降低要求用户打绝对分数的负担。
需注意其多项实验使用代理分数模拟反馈；不能当作领域专家试用已获验证。
阅读：方法、实验附录 A.3、结论。
[正文](https://arxiv.org/html/2405.17346v1)

### TextGrad：多模块反馈归因

Yuksekgonul et al., 2024 arXiv, TextGrad: Automatic “Differentiation” via Text。
把文本反馈沿计算图传递给不同组件，适合思考拆块、定位、抽取等模块的责任分配。
本轮只核对摘要，未深读全文，不据此评价其全部实验边界。
[论文](https://arxiv.org/abs/2406.07496)

### PLHF：先校准评审器，再优化处理器

Yang et al., 2025 arXiv v1, PLHF: Prompt Optimization with Few-Shot Human Feedback。
用少量专家评分优化评审器提示词，再用评审器优化任务提示词。
关键限制：公共数据上对新输出使用优化过的 GPT-4o 作为 pseudo-human judge；
工业 SQL 场景采用真人评分。不能将公共任务结果等同于完整真人验收。
阅读：§2、§3.3、实验设置与结果。
[正文](https://arxiv.org/html/2505.07886v1)

### GEPA：反思执行记录并保留互补候选

Agrawal et al., 首稿 2025；当前 PDF 标注 ICLR 2026 Oral。
GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning。
利用执行记录和反馈提出、测试及组合提示词更新；保留表现互补的候选。
正文使用训练/验证/测试划分，指出验证占大量调用预算。与我们相关的是方法结构，
而非将其基准上的性能增益直接搬到古籍抽取。
阅读：方法、§4 评估划分与调用预算讨论。
[当前 PDF](https://arxiv.org/pdf/2507.19457)

### What Prompts Don’t Say：需求缺失与约束冲突

Yang et al., Findings of ACL 2026。
What Prompts Don’t Say: Understanding and Managing Underspecification in LLM Prompts。
需求未明确时表现易变，但补全所有需求也不稳定；应逐条评估需求。
实验规模为 60 条需求、240 条合成提示词，不代表已经覆盖古籍任务。
阅读：摘要、结论、Limitations、需求构建附录。
[论文](https://aclanthology.org/2026.findings-acl.441/)

### PrefPO：防止提示词优化迎合评测

2026 arXiv v1, PrefPO: Pairwise Preference Prompt Optimization。
成对偏好用于候选更新，讨论提示词膨胀及改变约束来获取高分的 prompt hacking。
其 hacking 检测依赖 LLM judge，人类可读性评估规模小且一致性低，绝对比例需谨慎。
阅读：§4.4、§5.4、§6.3。
[正文](https://arxiv.org/html/2603.19311v1)

## 卡点与本项目推论

以下是结合论文与书论工作流提出的设计判断，不是论文对本项目的直接实验结论。

1. 反馈含义：修正值不能自动说明为什么错。需区分事实纠错、标注口径、偏好和证据不足；允许专家分歧待仲裁。
2. 模块归因：OCR、切块或检索缺页，可能无法靠改抽取提示词修复。需保存当次输入、检索原文、模块输出与提示词/模型版本。
3. 规则适用范围：一次修订可能只是特定版本、语境或书家别称的个例。候选规则应含触发条件、例外、正反例和支持证据。
4. 独立评价：AI 生成规则、AI 给规则打分容易形成偏差循环。将程序可验证项和专家语义评价分开，固定发布门槛。
5. 跨文献泛化：同书相邻段落不能简单随机分到训练和测试。按书目/版本/相邻原文组隔离，另有旧规则回归集。
6. 成本与停止：人工反馈、模型调用、提示词长度均有成本。没有独立验证增益时停止，不按迭代轮数宣称改进。

## 建议闭环（尚未实施）

原始运行记录 -> 人工修订与依据 -> 错误分组/归因 -> 有范围的规则候选 ->
专家确认规则 -> 候选提示词 -> 独立验证及旧例回归 -> 版本发布/回退。

规则不必全部写进提示词：格式约束进程序校验，知识不足进入证据检索，
明确的任务判断进提示词，少见语境保留为按需检索的案例。

## 第一个实验

- 先选一个高频语义错误，如评价对象识别；先核查是否保存了生成原记录时的提示词与模型版本。
- 若缺原始运行记录，旧 CSV 只用作错误发现和标注来源；重新运行固定模型/输入取得可比较基线。
- 对比：固定提示词、仅加入已审示例、人工写规则、反馈归纳出的范围化规则。
- 固定模型、材料、生成配置及评价口径，记录调用预算；按文献分组划分优化集/验证集/最终测试集。
- 观察目标字段正确率、无证据归属率、弃答率、原正确条目新增错误率和人工复核时间。
- 当前 50 条是有意覆盖问题的试审集，只适合先导试验；不能同时用它优化又报告独立测试成绩。
- 尚需核实书目/版本元数据、专家标注一致性和任务级参考答案；未完成前不作研究创新性或有效性断言。

## 项目上下文

沿用 `product-goals-roadmap.md` 的可追溯、可回滚、专家审校定位。
工作区入口依据 `wiki/50-features/long-term-projects-map.md`；未改动当前平台实现。

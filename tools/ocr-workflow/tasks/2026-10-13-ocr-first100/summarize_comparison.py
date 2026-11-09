from compare_versions import *

s=json.loads((OUT/'summary.json').read_text());rows=[json.loads(l) for l in (OUT/'400页-全文与统计.jsonl').read_text().splitlines()]
tot={r['version']:r for r in s['aggregates'] if r['part']==0}
parts=[r for r in s['aggregates'] if r['version']=='raw' and r['part']]
examples=[
    {'page':53,'old':'旧原始：王次仲亚国除和到基','new':'王次仲班固徐幹贾逵','finding':'人名恢复明显：原图此列确为王次仲、班固、徐幹、賈逵。此页纯汉字差异93.10%，属于差异特别大的名单页。'},
    {'page':259,'old':'旧原始：半及字数元；旧语义：卞壶字望之','new':'羊欣字敬元','finding':'新识别与扫描图一致；旧语义稿把书家身份改成了另一人。此例亦已在上轮原图评测中核对。'},
    {'page':528,'old':'旧语义：夫天地之间，物有不俱全者，气使之然也','new':'穹壤之间，齿角爪翼，物不俱全，气禀使然也','finding':'原图为后者（繁体字形）；旧语义稿改写且省掉“齿角爪翼”。新识别恢复了具体原句。'},
    {'page':599,'old':'旧模型：张从申《万静辜》……','new':'《淳化最佳为《潭》《绛》诸帖所自出，然皆不及也','finding':'旧保守模型稿的汉字串与原始第600页完全相同；第599页原图确从《淳化》起。是此前已回退修复的历史串页问题；本次未重新核验线上状态。'},
    {'page':53,'old':'扫描图：崔瑗','new':'催暖','finding':'新版也仍有错误。本例说明不能因大部分人名改善，就把新版全部当作正确转写。'},
]
dump(OUT/'抽查实例.json',examples)
md=['# 400页新旧OCR逐字比对','',
    '2026-10-13。四份各100页；以本轮RapidOCR为新版，分别比对旧原始OCR、修复前保守模型稿和修复前语义模型稿，共1200组页级比较。','',
    '**核心发现：新旧差异主要包含识别文字、标点和旧模型处理痕迹。抽查可确认新版修复了若干人名及原句，但仍有错字，不能把差异率当成准确率提升。**','',
    '## 总体统计','',
    '| 比较对象 → 本轮OCR | 统一繁简后汉字差异 | 含标点差异（去空白） | 替换 | 旧有新无 | 新有旧无 |',
    '|---|---:|---:|---:|---:|---:|']
for v,r in tot.items():md.append(f'| {LABELS[v]} | {r["han_difference_pct"]:.2f}% | {r["compact_difference_pct"]:.2f}% | {r["replace"]:,} | {r["delete_from_old"]:,} | {r["insert_in_new"]:,} |')
md+=['','增删替换计数来自“去空白、保留实际字形与标点”这一口径。旧原始OCR→新版合计51,028次最短字符编辑；统一繁简、只看汉字后为27,803次差异／137,089个旧汉字，即20.28%。382个有文字页均有差异；18个空白扫描页在原始OCR和新版之间一致。','',
     '各页距离先单独计算，再用总距离除以旧版总字数；不是简单平均，也不是错误率。页边篇名、页码和阅读顺序均保留，栏序/页边文字移动也会计入增删。','',
     '## 四个任务分别比较旧原始OCR','',
     '| 任务 | 汉字差异 | 含标点差异 |','|---|---:|---:|']
for r in parts:md.append(f'| 第{r["part"]}份 | {r["han_difference_pct"]:.2f}% | {r["compact_difference_pct"]:.2f}% |')
md+=['','## 对照扫描图确认的例子','']
for e in examples:md += [f'### 第{e["page"]}页',f'- 之前：{e["old"]}',f'- 新版：{e["new"]}',f'- 核对：{e["finding"]}','']
md+=['## 标点、模型痕迹与统计边界','',
     '- 按Unicode标点类别计数，旧原始OCR含21,545个标点，新版12,642个，净少8,903个（41.32%）。旧标点本身也可能错误；这只是数量差，不等于确认漏掉8,903个正确标点。第528页等原图有句读而新版漏出，说明标点仍是新版需要补校的一项。',
     '- 旧语义稿有2,376个“【待核”标记；包装符号及解释文字会增加差异。“纯汉字”只去掉非汉字，仍保留标记内“待核”和说明的汉字，所以不能把模型稿更高的差异全部归为正文错字。',
     '- 第259、599、836页的模型稿在此前修复中已回退。此报告使用修复前留存稿追溯旧结果；旧原始OCR则与上一轮留存的SHA-256一致。当前线上状态没有在此轮重新网络核查。',
     '- 第599页旧模型串页可精确复核：统一繁简后的旧保守模型正文，与旧原始第600页汉字串完全相同；与第599页不同。该页相对短旧稿的差异率可超过100%，这是旧字数作分母和大量新增导致，并非统计错误。',
     '- 汉字数口径包含Unicode CJK字及〇，并使用OpenCC t2s；与上轮简化的范围计数137,173不是同一口径。本次新版规范化汉字为137,256。三组比较均使用完全相同的新版及规则。',
     '- 全文逐字比对是计算完成；对原图的正确性判断仅覆盖列出的抽查实例，未建立400页人工金标准。两种口径的编辑距离不能简单相减来分摊“标点错误”。','',
     '## 如何查看','',
     '- 打开 [高亮对照总览](index.html)，进入任一任务，点页码跳转。红色删除线表示旧版不同字符，绿色下划线表示新版不同字符；各页可展开两版历史模型稿和保留空白的原文。',
     '- [400页逐页统计](400页-逐页比对.csv)：1200行，三种旧版本×400页。',
     '- [400页逐字增删替换](400页-逐字增删替换.csv)：每行一次字符编辑，带页码、旧新字符、位置和上下文；位置按去空白后的文本、从1开始计数。插入的旧位置/删除的新位置表示边界，可等于相应长度+1。',
     '- [全文与统计JSONL](400页-全文与统计.jsonl)、[输入哈希及汇总](summary.json)、[高频差异](高频差异.json)、[差异最大20页](差异最大20页.json)。',
     '- 原扫描图链接回到工作区；HTML与CSV自身可离线阅读，搬离工作区后原图链接需要对应原图目录。','',
     '本轮只生成比对材料，未覆盖OCR文本、模型稿、网站材料或成员校勘稿。','']
(OUT/'比对结论.md').write_text('\n'.join(md))

body='<header><p class="note">书论 · OCR复核 / 2026-10-13 / 400页 · 1200组对照</p><h1>新旧OCR：逐字比对</h1><p>新版修复了抽查中的若干人名和原句，但仍有错字与标点遗漏。<strong>以下是版本差异率，不是OCR错误率或准确率提升。</strong></p></header>'
body+='<nav aria-label="任务对照">'+''.join(f'<a href="part-{p}.html">第{p}份 · 100页高亮对照 →</a>' for p in range(1,5))+'</nav>'
body+='<h2>总体结果</h2><div class="table-wrap"><table><caption>旧版本 → 本轮OCR；按旧版字符总数加权</caption><thead><tr><th scope="col">比较对象</th><th scope="col">汉字差异<br><small>统一繁简</small></th><th scope="col">含标点差异<br><small>去空白</small></th><th scope="col">替换</th><th scope="col">旧有新无</th><th scope="col">新有旧无</th></tr></thead><tbody>'
for v,r in tot.items():body+=f'<tr><th scope="row">{LABELS[v]}</th><td>{fmt(r["han_difference_pct"])}</td><td>{fmt(r["compact_difference_pct"])}</td><td>{r["replace"]:,}</td><td>{r["delete_from_old"]:,}</td><td>{r["insert_in_new"]:,}</td></tr>'
body+='</tbody></table></div><p class="note">保留页边文字与阅读顺序；正文异文、移位和标点都可能产生编辑。旧原始→新版：382页有差异，18个空白扫描页一致。</p>'
body+='<h2>四份任务分别看</h2><table><caption>仅与旧原始OCR比较</caption><thead><tr><th scope="col">任务</th><th scope="col">汉字差异</th><th scope="col">含标点差异</th></tr></thead><tbody>'
for r in parts:body+=f'<tr><th scope="row"><a href="part-{r["part"]}.html">第{r["part"]}份</a></th><td>{fmt(r["han_difference_pct"])}</td><td>{fmt(r["compact_difference_pct"])}</td></tr>'
body+='</tbody></table><h2>看图核对：区别落在哪里</h2>'
for e in examples:
    part=next(r['part'] for r in rows if r['source_page']==e['page'])
    body+=f'<article><h3><a href="part-{part}.html#p{e["page"]}">第{e["page"]}页：打开整页对照 →</a></h3><div class="pair"><div><p class="note">之前 / 参照</p><div class="text">{H(e["old"])}</div></div><div><p class="note">本轮OCR</p><div class="text">{H(e["new"])}</div></div></div><p>{H(e["finding"])}</p></article>'
body+='<h2>阅读这些数字时</h2><ul><li>旧原始OCR有21,545个Unicode标点，新版12,642个；净少8,903个，不意味着这些旧标点全是正确的。标点仍需对图补校。</li><li>旧语义稿含2,376个“【待核”标记，解释和包装也会增加版本差异。汉字统计仍包含解释里的汉字。</li><li>旧模型稿取自修复前留存。第259、599、836页此前已经回退修复；报告不是当前线上故障清单。</li><li>各页单独做精确最短编辑对齐；总距离除以旧字数。旧版很短时可超过100%。同一最短距离可能有多种对齐路径。</li><li>只对列出的实例作原图判断；400页没有逐字人工金标准。本轮未修改任何已有OCR或成员稿。</li></ul>'
body+='<h2>明细与复核材料</h2><ul>'+''.join(f'<li><a href="{H(f)}">{H(label)}</a></li>' for f,label in [('400页-逐页比对.csv','1200组逐页统计 CSV'),('400页-逐字增删替换.csv','逐字编辑 CSV：旧新字符、位置与上下文'),('比对结论.md','完整结论与统计口径'),('summary.json','输入文件哈希、版本和汇总'),('400页-全文与统计.jsonl','全部旧新原文与统计 JSONL')])+'</ul><p class="note">本地HTML，无外部脚本或字体。原扫描图链接依赖现有工作区；文本对照可独立阅读。红删绿增仅表示差异，不判定正误。</p>'
(OUT/'index.html').write_text(doc('400页新旧OCR逐字比对',body))
print('Wrote report and index')

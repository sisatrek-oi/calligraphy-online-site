import {shapeLabels,soundLabels} from './review-han-core.js?v=release-20261022';
const esc=window.WorkspaceUI.esc,number=n=>n.toLocaleString('zh-CN');
const pct=(n,d)=>d?(n/d*100).toFixed(2)+'%':'0%';

export function hanMarkup(analysis,characters,state,chart) {
  const a=analysis;
  return `<section class="workspace-panel han-analysis"><h2>汉字替换：类型与集中度</h2><p class="metrics-intro">只分析当前口径中的“汉字替换”，不包含增补、删除或已单列的简繁／异体候选。读音、结构是同一批替换的独立分类维度，不能相加，也不表示已确认的出错原因。</p>
    <div class="metrics-stats han-stats" aria-label="汉字替换整体统计">${[['汉字替换',a.total,'处'],['不同替换字对',a.uniquePairs,'种'],['重复字对覆盖',a.repeated,'处'],['前10字对覆盖',a.top10,'处']].map(([label,value,unit])=>`<div class="metrics-stat"><span>${label}</span><strong>${number(value)}</strong><small>${unit}</small></div>`).join('')}</div>
    <p class="han-insight">${number(a.total)} 处替换涉及 ${number(a.uniquePairs)} 种有方向字对。出现至少2处的字对共覆盖 ${pct(a.repeated,a.total)} 的汉字替换；前10字对覆盖 ${pct(a.top10,a.total)}。数量按字符替换位置计，不是实际操作次数。</p>
    ${state.metadataError?`<div class="metrics-error" role="alert">${esc(state.metadataError)}</div>`:`<div class="metrics-charts"><section class="workspace-panel"><h2>部首与笔画关系</h2><p>单位：处 / 占汉字替换总量 · 点击筛选</p><div class="metrics-bars txt-bars">${Object.entries(shapeLabels).map(([key,label])=>chart(label,a.shape[key],Math.max(...Object.values(a.shape)),a.total,`data-han-shape="${key}"`,state.hanShape===key)).join('')}</div></section>
    <section class="workspace-panel"><h2>常用读音关系</h2><p>按字库常用读音比对 · 仅为同音候选</p><div class="metrics-bars txt-bars">${Object.entries(soundLabels).map(([key,label])=>chart(label,a.sound[key],Math.max(...Object.values(a.sound)),a.total,`data-han-sound="${key}"`,state.hanSound===key,true)).join('')}</div></section></div>`}
    <section class="han-pairs"><h3>高频替换字对 · 前10种</h3><p>有方向统计，A→B与B→A分开。点击字对查看全部对应上下文。</p><div class="han-pair-grid">${a.pairs.slice(0,10).map(pair=>`<button type="button" data-han-pair="${esc(pair.key)}" aria-pressed="${state.hanPair===pair.key}"><strong>${esc(pair.key)}</strong><span>${number(pair.count)} 处 · ${pct(pair.count,a.total)}</span><small>涉及 ${pair.pages.size} 页</small></button>`).join('')||'<p>当前范围没有汉字替换。</p>'}</div></section>
    <details class="han-rules"><summary>分类依据、缺失资料与分析边界</summary><p>字库为 <a href="https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip" target="_blank" rel="noopener">Unicode Unihan 17.0.0</a>，使用 <a href="https://www.unicode.org/reports/tr38/tr38-39.html#kMandarin" target="_blank" rel="noopener">kMandarin</a>、<a href="https://www.unicode.org/reports/tr38/tr38-39.html#kRSUnicode" target="_blank" rel="noopener">kRSUnicode</a> 和 <a href="https://www.unicode.org/reports/tr38/tr38-39.html#kTotalStrokes" target="_blank" rel="noopener">kTotalStrokes</a>，元数据在本地读取。<a href="./unihan-license.txt" target="_blank" rel="noopener">字库许可</a>。</p><p>部首按原始编号与简化形标记比较，有任一共同值视作同部首；总笔画取记录值之间的最小差。“相差≤2画”是本页分析规则，并非官方形似判断；异部首同样可能形近，例如日→曰。结构和读音缺失时独立归入“资料不足”，不补猜。</p><p>读音只比较字库列出的常用拼音，有任一相同值即归同音同调；去掉声调后有交集才归音节相同、声调不同，保留ü与u的区别。未重合不代表排除了多音字、古音或语境读音。不能据此自动判为形近误识、同音误写、通假或人名/术语修复；这些原因需要逐处回图与语境审核。</p></details>
    ${state.hanPair?`<p class="workspace-notice">当前字对：${esc(state.hanPair)} <button type="button" class="quiet-button" id="clearHanPair">清除字对筛选</button></p>`:''}</section>`;
}

export function hanEvidence(row,characters) {
  if(!row.han)return '';
  const a=characters[row.before]||{},b=characters[row.after]||{};
  return `<details class="metrics-provenance"><summary>汉字细分依据</summary><small>${esc(shapeLabels[row.han.shape])} · ${esc(soundLabels[row.han.sound])}</small><code>常用拼音：${esc(a.pinyin||'缺资料')} → ${esc(b.pinyin||'缺资料')}</code><code>部首-余笔画：${esc(a.radical||'缺资料')} → ${esc(b.radical||'缺资料')}</code><code>总笔画：${esc(a.strokes||'缺资料')} → ${esc(b.strokes||'缺资料')}；最小差 ${row.han.strokeGap??'未知'}</code></details>`;
}

import { taskPageCount } from './screening-page-policy.js?v=index-archive-20261027';
import { readLocalTraces, filterRecords, summarize, replacementKind, recordLabels } from './review-metrics-core.js?v=index-archive-20261027';
import { createTxtView } from './review-txt.js?v=index-archive-20261027';

const ui = window.WorkspaceUI, esc = ui.esc, host = document.querySelector('#metricsContent');
ui.mount('proof');
const txtView = createTxtView(host);
const state = { source: 'txt', returned: null, returnedDate: '', records: [], problems: [], kind: 'details', category: '', query: '', error: '' };
let request = 0;
function timeLabel(record) {
  if (!record.at) return '时间未记录';
  const date = new Date(record.at);
  if (!Number.isFinite(date.getTime())) return '时间格式无法识别';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}
function bar(label, count, max, attribute, active, alt = false) {
  return `<button type="button" class="metrics-bar ${alt ? 'alt' : ''}" ${attribute} aria-pressed="${active}"><span>${esc(label)}</span><span class="metrics-bar-track" aria-hidden="true"><span class="metrics-bar-fill" style="width:${max ? count/max*100 : 0}%"></span></span><b>${count}</b></button>`;
}
function row(record) {
  const source = state.source === 'returned' ? `成员回收件 · 原第${record.part}份` : record.source;
  const detail = record.kind === 'replacement' ? `<span class="metrics-before">${esc(record.before || '（空）')}</span> → <span class="metrics-after">${esc(record.after || '（空）')}</span><small>${record.line ? `记录位置：第 ${esc(record.line)} 行${record.char ? ` · 第 ${esc(record.char)} 字` : ''}` : '位置未记录'}${record.stale ? ' · 位置已被后续修改' : ''}</small>` : record.kind === 'note' ? `<span class="metrics-note">${esc(record.note)}</span><small>${esc(record.category)}</small>` : '已对照原页核对本页错字';
  return `<tr><td><a href="./screening.html?part=${record.part}&page=${record.page}">第 ${record.page} 页 ↗</a><small>原第 ${record.part} 份</small></td><td>${esc(recordLabels[record.kind])}</td><td>${detail}</td><td>${esc(timeLabel(record))}<small>${record.timeKind === 'event' ? '替换记录时间（北京）' : record.timeKind === 'page' ? '页级确认时间（北京）' : '无逐条时间'}</small></td><td>${esc(source)}${record.csvSource ? `<details class="metrics-provenance"><summary>来源路径</summary><code>${esc(record.csvSource)}</code><code>${esc(record.txtSource)}</code></details>` : ''}</td></tr>`;
}
function render() {
  for (const b of document.querySelectorAll('[data-source]')) b.setAttribute('aria-pressed', String(b.dataset.source === state.source));
  if (state.error) {
    host.innerHTML = `<div class="metrics-error" role="alert">${esc(state.error)}。可点击“刷新记录”重试，或切换数据来源。</div>`;
    return;
  }
  if (state.records === null) { host.innerHTML = '<p role="status">正在读取人工审核记录…</p>'; return; }
  const returned = state.source === 'returned';
  const scope = state.records;
  const summary = summarize(scope);
  const selected = filterRecords(state.records, state);
  const categories = returned ? ['看不清／打不出／缺字占位','字形／读法备注','页眉处理','空白页说明','删除片段'] : ['替换','增补','删除'];
  const counts = categories.map(category => scope.filter(r => returned ? r.kind === 'note' && r.category === category : r.kind === 'replacement' && replacementKind(r) === category).length);
  const editCategories=['替换','增补','删除'];
  const editCounts=editCategories.map(category=>scope.filter(r=>r.kind==='replacement'&&replacementKind(r)===category).length);
  const filterCategories=returned ? [...categories,...editCategories] : categories;
  host.innerHTML = `<p class="metrics-intro">${returned ? `已回收快照 · 截至 ${esc(state.returnedDate)} · 原成员 TXT／CSV／JSON。重复页去重，仅统计明确保留的人工痕迹。` : '本浏览器保存的确认、备注与直接替换记录。'} 仅展示当前来源的总数据。两种来源分别查看，不相加；记录不完整，人工总修改次数未知。</p>
    ${state.problems.length ? `<div class="metrics-error" role="alert">${state.problems.map(esc).join('；')}。以下仅展示可读取部分，不能视为完整统计。</div>` : ''}
    ${returned ? `<p class="metrics-intro" data-proofreading-scope>原文校对已确认 ${summary.confirmations} / ${taskPageCount(1,1052)} 页（${(summary.confirmations/taskPageCount(1,1052)*100).toFixed(2)}%），剩余 ${taskPageCount(1,1052)-summary.confirmations} 页；902—951页50页索引已归档。</p>` : ''}
    <div class="metrics-stats" aria-label="当前来源总数据">${[['逐页确认',summary.confirmations,'页'],['人工备注',summary.notes,'页'],['直接替换记录',summary.replacements,'条'],['有备注或替换细节',summary.detailedPages,'页']].map(([label,value,unit])=>`<div class="metrics-stat"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`).join('')}</div>
    <div class="metrics-charts">
    <section class="workspace-panel"><h2>${returned ? '人工备注说了什么' : '直接替换做了什么'}</h2><p>${returned ? '按备注原话分类 · 单位：有该类备注的页数' : '按保留的替换记录分类 · 单位：条'} · 点击查看明细</p><div class="metrics-bars">${counts.some(Boolean) ? categories.map((label,i)=>bar(label,counts[i],Math.max(...counts),`data-chart-category="${esc(label)}"`,state.category===label,true)).join('') : '<div class="metrics-chart-empty">当前范围暂无此类留痕；不能据此认定未做修改。</div>'}</div></section>
    ${returned ? `<section class="workspace-panel"><h2>直接替换做了什么</h2><p>保留的明确改字记录 · 单位：条</p><div class="metrics-bars">${editCategories.map((label,i)=>bar(label,editCounts[i],Math.max(...editCounts),`data-chart-category="${label}"`,state.category===label)).join('')}</div><p class="metrics-edit-limit">仅涵盖导出中保留的记录，不能推算全部人工改字次数。</p></section>` : ''}</div>
    <section class="workspace-panel metrics-details"><h2>逐条回查</h2><div class="metrics-filters"><label>记录类型<select id="metricsKind">${[['details','备注与替换'],['','全部记录'],...Object.entries(recordLabels)].map(([key,label])=>`<option value="${key}" ${state.kind===key?'selected':''}>${label}</option>`).join('')}</select></label><label>分类<select id="metricsCategory"><option value="">全部分类</option>${filterCategories.map(label=>`<option value="${esc(label)}" ${state.category===label?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label>搜索页码、字词或原话<input id="metricsQuery" type="search" value="${esc(state.query)}" placeholder="例如：548、沓、页眉"></label><button id="resetMetrics" type="button" class="quiet-button">重置筛选</button></div>
    <p class="metrics-result-count">图表与上方数量统计当前来源的总数据；下方筛选后共 ${selected.length} 条记录${state.category ? ` · ${esc(state.category)}` : ''}。</p><div class="metrics-table-wrap"><table class="metrics-table"><thead><tr><th scope="col">原页</th><th scope="col">留痕类型</th><th scope="col">修改前后 / 人工原话</th><th scope="col">记录时间</th><th scope="col">证据来源</th></tr></thead><tbody>${selected.length ? selected.map(row).join('') : '<tr><td colspan="5">当前筛选没有记录。可重置筛选，或到“成果交付”恢复个人进度 JSON 后查看本机记录。</td></tr>'}</tbody></table></div>
    <p class="workspace-hint">直接替换按条计，备注和确认按页计；一条替换可含多个字。页级确认时间不代表改字发生时间，也不用于计算耗时。只有确认的页面可能缺少改字细节；已有记录可能被后续编辑或撤销，不据此判断当前字形正确与否。本机保留记录可能包含恢复的旧记录，与回收件重叠。</p></section>`;
  document.querySelector('#metricsKind').onchange = e => { state.kind=e.target.value; state.category=''; render(); };
  document.querySelector('#metricsCategory').onchange = e => { state.category=e.target.value; if(state.category)state.kind=editCategories.includes(state.category)?'replacement':'note'; render(); };
  document.querySelector('#metricsQuery').oninput = e => {
    state.query=e.target.value;
    const matches=filterRecords(state.records,state);
    host.querySelector('tbody').innerHTML=matches.length ? matches.map(row).join('') : '<tr><td colspan="5">当前筛选没有记录，可重置筛选后查看。</td></tr>';
    host.querySelector('.metrics-result-count').textContent=`图表与上方数量统计当前来源的总数据；下方筛选后共 ${matches.length} 条记录${state.category ? ` · ${state.category}` : ''}。`;
  };
  document.querySelector('#resetMetrics').onclick=()=>{state.kind='details';state.category='';state.query='';render();};
  host.querySelectorAll('[data-chart-category]').forEach(b=>b.onclick=()=>{state.category=state.category===b.dataset.chartCategory?'':b.dataset.chartCategory;state.kind=editCategories.includes(b.dataset.chartCategory)?'replacement':'note';render();});
}
async function load() {
  const id=++request;
  for (const b of document.querySelectorAll('[data-source]')) b.setAttribute('aria-pressed', String(b.dataset.source === state.source));
  if(state.source==='txt'){txtView.show();return;}
  txtView.hide();
  state.error='';state.problems=[];
  try {
    if (state.source === 'local') {
      const result=readLocalTraces(localStorage);state.records=result.records;state.problems=result.problems;
    } else {
      if (!state.returned) {
        state.records=null;render();
        const response=await fetch('./review-metrics-data.json?v=member5-return-20261026');
        if(!response.ok)throw Error('已回收人工记录读取失败');
        const data=await response.json();
        if(data.version!==1 || !Array.isArray(data.records) || data.records.some(r=>!recordLabels[r.kind] || !Number.isInteger(r.page) || ![1,2,3,4].includes(r.part)))throw Error('已回收人工记录格式无效');
        state.returned=data.records;
        state.returnedDate=typeof data.date==='string' ? data.date : '日期未记录';
      }
      if(id!==request)return;
      state.records=state.returned;
    }
  } catch(error) { if(id!==request)return;state.error=error.message; }
  if(id===request)render();
}
document.querySelectorAll('[data-source]').forEach(button=>button.onclick=()=>{state.source=button.dataset.source;state.kind='details';state.category='';state.query='';load();});
document.querySelector('#refreshMetrics').onclick=()=>{if(state.source==='txt'){txtView.refresh();return;}state.returned=null;load();};
window.addEventListener('storage',event=>{if(state.source==='local' && (event.key===null || event.key.startsWith('shulun-screening-v1-part-')))load();});
window.addEventListener('pageshow',()=>{if(state.source==='local')load();});
load();

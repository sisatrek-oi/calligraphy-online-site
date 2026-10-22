import {readJson} from './screening-loader.js?v=release-20261022';
import {teamRelease} from './team-collation.js?v=release-20261022';
import {targetedRelease} from './targeted-ocr.js?v=20261018-part4';
import {taskOcrHref} from './screening-page-policy.js?v=20261003-trim';
const ui=window.WorkspaceUI,host=document.querySelector('#workspacePage');ui.mount('materials');
let part=Number(new URLSearchParams(location.search).get('part'))||1;
if(![1,2,3,4].includes(part))part=1;
function row(name,scope,source,href,download=false){return `<tr><td>${ui.esc(name)}</td><td>${ui.esc(scope)}</td><td>${ui.esc(source)}</td><td><a href="${href}" ${download?'download':'target="_blank" rel="noopener"'}>${download?'下载':'打开'} ↗</a></td></tr>`;}
function group(title,rows,open=true){return `<details class="workspace-panel" ${open?'open':''}><summary>${title}</summary><table class="workspace-table"><thead><tr><th>材料名称</th><th>范围</th><th>来源</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></details>`;}
async function render(){
 host.innerHTML=`<header class="workspace-page-header"><div><h1>材料管理</h1><p>查看来源与版本，保留原始文件。</p></div><a class="action-button" href="./index.html#ingest">＋ 导入材料</a></header><div class="workspace-page-content"><div class="workspace-fields"><label>当前古籍<select disabled><option>历代书法论文选</option></select></label><label>原分份<select id="materialPart">${[1,2,3,4].map(p=>`<option value="${p}" ${p===part?'selected':''}>原第 ${p} 份</option>`).join('')}</select></label></div><div class="import-steps"><span>① 选择文件</span><span>→</span><span>② 核对范围</span><span>→</span><span>③ 预览确认</span></div><p class="workspace-hint">PDF 导入与 OCR 处理需要连接本机服务。校勘正文无需重新生成。</p><div id="materialGroups" role="status">读取材料范围…</div></div>`;
 document.querySelector('#materialPart').onchange=e=>{part=Number(e.target.value);history.replaceState(null,'',`?part=${part}`);render();};
 try{
  const requested=part,index=await readJson(`./screening-data/part-${part}-index.json?v=release-20261022`);
  if(requested!==part)return;
  const scope=`物理页 ${index.start}–${index.end}`;
  let current=row(`原第${part}份 · 当前工作TXT`,scope,'当前公开工作稿',`./screening-data/part-${part}-work.txt`,true);
  const original=row(`原第${part}份 · 扫描PDF`,scope,'原始扫描',`./screening-data/part-${part}.pdf`)+row(`原第${part}份 · 原始OCR`,scope,'原始识别，保留原样',taskOcrHref(part),true);
  let human=teamRelease.parts[part]?row('已回收人工修订TXT',`${teamRelease.parts[part].pages} 页`,'团队回收稿',`./screening-data/part-${part}-collated.txt`,true)+row('回收状态与处理记录','同回收稿','历史处理记录',`./screening-data/part-${part}-collated-status.csv`,true):'';
  human+=`<tr><td>本机个人稿与草稿</td><td>按成员分工</td><td>本浏览器记录</td><td><a href="./delivery.html?part=${part}">导出或恢复 →</a></td></tr>`;
  const historyRows=(targetedRelease.parts[part]?row('局部修订TXT','仅局部区域','历史修订',`./screening-data/part-${part}-targeted.txt`,true)+row('局部处理状态表','同局部修订','历史处理记录',`./screening-data/part-${part}-targeted-status.csv`,true):'')+row('历史模型保守稿','全书','未核历史版本','./tasks/2026-10-11-ocr-cleaning/full-book-conservative.txt',true)+row('历史模型语义稿','全书','未核历史版本','./tasks/2026-10-11-ocr-cleaning/full-book-normalized.txt',true)+row('两版比较说明','全书','历史说明','./tasks/2026-10-11-ocr-cleaning/full-book-comparison.md');
  document.querySelector('#materialGroups').innerHTML=group('当前工作材料',current)+group('原始材料',original)+group('人工成果',human)+group('历史版本',historyRows,false);
 }catch(error){document.querySelector('#materialGroups').textContent=error.message+'，原材料未改变。';}
}
render();

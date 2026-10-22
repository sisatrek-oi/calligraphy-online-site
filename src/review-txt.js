import {txtRows,filterTxtRows,txtPage} from './review-txt-core.js?v=release-20261022';
import {analyzeHan,shapeLabels,soundLabels} from './review-han-core.js?v=release-20261022';
import {hanMarkup,hanEvidence} from './review-han.js?v=release-20261022';

const esc=window.WorkspaceUI.esc;
const labels={replace:'替换',insert:'增补',delete:'删除'};
const number=value=>value.toLocaleString('zh-CN');
const percent=(value,total)=>total?(value/total*100).toFixed(2)+'%':'0%';

export function createTxtView(host) {
  const state={mode:'baseline',view:'all',category:'',kind:'',query:'',hanShape:'',hanSound:'',hanPair:'',page:1,data:null,rows:[],analysis:null,metadataError:'',error:'',loading:false};
  const cache=new Map();let generation=0,active=false,characters=null;
  function chart(name,count,max,total,attribute,selected,alt=false) {
    return `<button type="button" class="metrics-bar ${alt?'alt':''}" ${attribute} aria-pressed="${selected}"><span>${esc(name)}</span><span class="metrics-bar-track" aria-hidden="true"><span class="metrics-bar-fill" style="width:${max?count/max*100:0}%"></span></span><b>${number(count)}<small>${percent(count,total)}</small></b></button>`;
  }
  function row(r) {
    return `<tr><td><a href="./screening.html?part=${r.part}&page=${r.page}">第 ${r.page} 页 ↗</a></td><td>${esc(r.category)}<small>${labels[r.kind]}</small></td><td><span class="metrics-before">${esc(r.before||'（空）')}</span> → <span class="metrics-after">${esc(r.after||'（空）')}</span></td><td class="txt-context"><div><small>修改前</small>${esc(r.beforeContext)}</div><div><small>回收TXT</small>${esc(r.afterContext)}</div></td><td>${state.metadataError?'':hanEvidence(r,characters||{})}<details class="metrics-provenance"><summary>前后版本来源</summary><small>对照底稿</small><code>${esc(r.sourceBefore)}</code><small>回收TXT</small><code>${esc(r.sourceAfter)}</code></details></td></tr>`;
  }
  function details() {
    const p=txtPage(filterTxtRows(state.rows,state),state.page);state.page=p.number;
    host.querySelector('#txtResultCount').textContent=`共 ${number(p.total)} 个差异字符；当前展示 ${number(p.start)}–${number(p.end)}。筛选仅影响明细，图表统计完整对照范围。`;
    host.querySelector('#txtRows').innerHTML=p.rows.length?p.rows.map(row).join(''):'<tr><td colspan="5">当前筛选没有差异，可重置筛选。</td></tr>';
    const pagination=host.querySelector('#txtPagination');
    pagination.innerHTML=`<button type="button" id="txtPrevious" class="quiet-button" ${p.number===1?'disabled':''}>上一页</button><label>明细第 <input id="txtPageNumber" type="number" min="1" max="${p.totalPages}" value="${p.number}" aria-label="明细页码"> / ${p.totalPages} 页</label><button type="button" id="txtNext" class="quiet-button" ${p.number===p.totalPages?'disabled':''}>下一页</button>`;
    const move=page=>{state.page=page;details();host.querySelector('.txt-table-wrap').scrollTop=0;};
    host.querySelector('#txtPrevious').onclick=()=>move(state.page-1);
    host.querySelector('#txtNext').onclick=()=>move(state.page+1);
    host.querySelector('#txtPageNumber').onchange=e=>move(Number(e.target.value));
  }
  function render() {
    if(!active)return;
    if(state.loading){host.innerHTML='<p role="status">正在读取TXT修改分类与前后版本…</p>';return;}
    if(state.error){host.innerHTML=`<div class="metrics-error" role="alert">${esc(state.error)}。可点击“刷新记录”重试，或切换其他视图。</div>`;return;}
    const data=state.data,s=data.summary,baseline=state.mode==='baseline';
    host.innerHTML=`<div class="txt-scope"><label>TXT对照范围<select id="txtComparison"><option value="baseline" ${baseline?'selected':''}>可还原的已保存底稿 → 回收TXT（${baseline?s.pages:data.returnedPages-data.blankPages-data.missingBaselines}页）</option><option value="ocr" ${!baseline?'selected':''}>原始OCR → 全部回收TXT正文（${baseline?data.returnedPages-data.blankPages:s.pages}页）</option></select></label></div>
      <p class="metrics-intro">${data.returnedPages}页回收件中，${baseline?`${s.pages}页可还原已保存底稿；另外${data.missingBaselines}页非空白页缺少可核对的历史底稿，${data.blankPages}页空白标记不计正文。`:`${s.pages}页为非空白文本（含索引），${data.blankPages}页空白状态标记不计正文修改；统一使用原始OCR作对照，不代表每页实际开始编辑时的底稿。`} 只展示总数据；后续AI回图稿不纳入。</p>
      <div class="metrics-stats" aria-label="TXT整体差异统计">${[['参与对照',s.pages,'页'],['对照底稿字符',s.beforeChars,'字'],['回收TXT字符',s.afterChars,'字'],['差异字符',s.changes,'字']].map(([label,value,unit])=>`<div class="metrics-stat"><span>${label}</span><strong>${number(value)}</strong><small>${unit}</small></div>`).join('')}</div>
      <p class="txt-method">TXT修改量按两个版本之间的最小字符编辑差异统计，<strong>不等于人工操作次数或已裁定错字数</strong>。只忽略行首栏号和空白，保留标点及原字；不计算准确率。与“审核留痕”中的直接替换记录不相加。</p>
      <div class="txt-view-tabs" role="group" aria-label="TXT分析维度"><button type="button" data-txt-view="all" aria-pressed="${state.view==='all'}">全部TXT修改</button><button type="button" data-txt-view="han" aria-pressed="${state.view==='han'}">汉字替换细分 · ${number(state.analysis.total)} 处</button></div>
      ${state.view==='han'?hanMarkup(state.analysis,characters,state,chart):`<div class="metrics-charts"><section class="workspace-panel"><h2>TXT改动分布</h2><p>按字符类型分类 · 数量 / 占全部差异的比例 · 点击筛选</p><div class="metrics-bars txt-bars">${data.categories.map(c=>chart(c,s.categories[c],Math.max(...Object.values(s.categories)),s.changes,`data-txt-category="${esc(c)}"`,state.category===c)).join('')}</div></section>
      <section class="workspace-panel"><h2>替换、增补与删除</h2><p>包含汉字、标点及其他字符 · 单位：字符</p><div class="metrics-bars txt-bars">${data.kinds.map(kind=>chart(labels[kind],s.operations[kind],Math.max(...Object.values(s.operations)),s.changes,`data-txt-kind="${kind}"`,state.kind===kind,true)).join('')}</div><p class="metrics-edit-limit">字符类型与增删替换是同一批差异的两个分类角度，不能叠加。简繁／异体仅为规则候选；占位符差异不等于疑字个数，字形及语义正确性仍需回图核定。</p></section></div>`}
      <section class="workspace-panel metrics-details"><h2>TXT修改前后</h2><div class="metrics-filters"><label>字符分类<select id="txtCategory"><option value="">全部分类</option>${data.categories.map(c=>`<option value="${esc(c)}" ${state.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>改动类型<select id="txtKind"><option value="">全部类型</option>${data.kinds.map(kind=>`<option value="${kind}" ${state.kind===kind?'selected':''}>${labels[kind]}</option>`).join('')}</select></label>${state.view==='han'?`<label>结构细分<select id="hanShape"><option value="">全部结构</option>${Object.entries(shapeLabels).map(([key,label])=>`<option value="${key}" ${state.hanShape===key?'selected':''}>${label}</option>`).join('')}</select></label><label>读音细分<select id="hanSound"><option value="">全部读音</option>${Object.entries(soundLabels).map(([key,label])=>`<option value="${key}" ${state.hanSound===key?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<label>搜索页码、字词或上下文<input id="txtQuery" type="search" value="${esc(state.query)}" placeholder="例如：13、赵壹、书法"></label><button id="resetTxt" type="button" class="quiet-button">重置筛选</button></div><p class="metrics-result-count" id="txtResultCount"></p>
      <div class="metrics-table-wrap txt-table-wrap"><table class="metrics-table"><thead><tr><th scope="col">原页</th><th scope="col">字符分类</th><th scope="col">修改前 → 回收TXT</th><th scope="col">前后上下文</th><th scope="col">证据来源</th></tr></thead><tbody id="txtRows"></tbody></table></div><div class="txt-pagination" id="txtPagination"></div><p class="workspace-hint">每条是一处最小编辑路径上的字符差异，非逐次保存、改字或撤销日志。同样长度的最小编辑路径可能存在不同对齐方式，当前沿用已核验分析的固定路径。原页链接打开当前工作正文；表内上下文来自本口径的历史版本。统计快照日期：${esc(data.date||'2026-10-19')}。</p></section>`;
    host.querySelector('#txtComparison').onchange=e=>{state.mode=e.target.value;reset();load();};
    host.querySelector('#txtCategory').onchange=e=>{state.category=e.target.value;if(state.category!=='汉字替换'){state.view='all';clearHan();}state.page=1;render();};
    host.querySelector('#txtKind').onchange=e=>{state.kind=e.target.value;if(state.kind&&state.kind!=='replace'){state.view='all';clearHan();}state.page=1;render();};
    host.querySelector('#txtQuery').oninput=e=>{state.query=e.target.value;state.page=1;details();};
    host.querySelector('#resetTxt').onclick=()=>{reset();render();};
    host.querySelectorAll('[data-txt-category]').forEach(b=>b.onclick=()=>{state.category=state.category===b.dataset.txtCategory?'':b.dataset.txtCategory;state.page=1;render();});
    host.querySelectorAll('[data-txt-kind]').forEach(b=>b.onclick=()=>{state.kind=state.kind===b.dataset.txtKind?'':b.dataset.txtKind;state.page=1;render();});
    host.querySelectorAll('[data-txt-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.txtView;reset();render();});
    for(const [attribute,key]of [['shape','hanShape'],['sound','hanSound'],['pair','hanPair']]){
      host.querySelectorAll(`[data-han-${attribute}]`).forEach(b=>b.onclick=()=>{const value=b.getAttribute(`data-han-${attribute}`);state[key]=state[key]===value?'':value;state.page=1;render();});
    }
    for(const id of ['hanShape','hanSound']){const input=host.querySelector('#'+id);if(input)input.onchange=e=>{state[id]=e.target.value;state.page=1;render();};}
    const clearPair=host.querySelector('#clearHanPair');if(clearPair)clearPair.onclick=()=>{state.hanPair='';state.page=1;render();};
    details();
  }
  function clearHan(){state.hanShape='';state.hanSound='';state.hanPair='';}
  function reset(){state.category=state.view==='han'?'汉字替换':'';state.kind=state.view==='han'?'replace':'';state.query='';state.page=1;clearHan();}
  async function load(fresh=false) {
    const token=++generation,mode=state.mode;state.loading=true;state.error='';render();
    try{
      if(fresh)cache.delete(mode);
      let result=cache.get(mode);
      if(!result){
        const response=await fetch(`./review-txt-${mode}.json?v=20261020`);
        if(!response.ok)throw Error('TXT修改数据暂时无法读取');
        const data=await response.json();
        if(data.version!==1||data.mode!==mode||!Array.isArray(data.pages)||!Array.isArray(data.categories)||!data.summary||!Number.isFinite(data.summary.changes))throw Error('TXT修改数据格式无效');
        const rows=txtRows(data);
        if(rows.length!==data.summary.changes)throw Error('TXT分类与差异总数不一致');
        let metadataError='';
        if(!characters){
          try{
            const metadataResponse=await fetch('./review-han-data.json?v=20261020');
            if(!metadataResponse.ok)throw Error('汉字细分类资料暂时无法读取');
            const metadata=await metadataResponse.json();
            if(metadata.version!==1||!metadata.characters||typeof metadata.characters!=='object'||Array.isArray(metadata.characters))throw Error('汉字细分类资料格式无效');
            characters=metadata.characters;
          }catch{metadataError='汉字字库暂时无法读取，仅展示总量与字对频次；结构、读音分类暂不可用，可点击“刷新记录”重试。';}
        }
        const analysis=analyzeHan(rows,characters||{});
        result={data,rows,analysis,metadataError};cache.set(mode,result);
      }
      if(token!==generation||!active)return;
      state.data=result.data;state.rows=result.rows;state.analysis=result.analysis;state.metadataError=result.metadataError;
    }catch(error){if(token!==generation||!active)return;state.error=error.message;}
    if(token===generation&&active){state.loading=false;render();}
  }
  return {show(){active=true;load();},hide(){active=false;generation++;},refresh(){load(true);}};
}

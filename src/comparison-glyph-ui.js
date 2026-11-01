import {bindScanRegion,verifyScanRegion} from './scan-region.js';
import {bindFeedbackWindow} from './feedback-window.js';
import {createGlyphNote,openGlyphNotes} from './comparison-glyph-notes.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountGlyphNotes({app,getContext,canAct,saveNotes,showScan,notice}){
 const $=id=>app.querySelector('#'+id);let draft=null,itemId=null,viewToken=0;
 app.insertAdjacentHTML('beforeend',`<section id="glyphWindow" class="glyph-window" role="dialog" aria-modal="false" aria-label="疑难字备注" hidden><header><button id="glyphDrag" type="button" aria-label="拖动疑难字备注窗，方向键可移动">疑难字备注</button><button id="glyphClose" type="button">收起</button></header><div class="glyph-scroll"><p id="glyphHint" role="status">在PDF原图中框选字形，再填写备注。</p><form id="glyphForm" hidden><p id="glyphRegionSummary"></p><label>备注<textarea id="glyphComment" maxlength="3000" required placeholder="说明这个字的问题，例如：原字无法输入。"></textarea></label><div class="glyph-actions"><button id="glyphSave" type="submit">保存备注</button><button id="glyphCancel" type="button">取消</button></div></form><div id="glyphRecords"></div></div></section>`);
 const panel=$('glyphWindow'),floating=bindFeedbackWindow(panel,$('glyphDrag'),()=>!panel.hidden),image=$('compareScan'),regionTools=$('glyphRegionTools'),layer=$('glyphRegionLayer');
 function open(){panel.hidden=false;floating.layout();}
 function hint(text){$('glyphHint').textContent=text;notice(text);}
 function updateDraft(){
  $('glyphForm').hidden=!draft?.region;regionTools.hidden=!draft||Boolean(draft.region);
  $('glyphRegionSummary').textContent=draft?.region?'扫描第 '+draft.region.page+' 页 · 已框选原字':'';
  $('glyphRegionRecords').hidden=!(getContext().record?.glyphNotes?.length);
 }
 const picker=bindScanRegion({image,layer,box:$('glyphRegionBox'),toggle:$('glyphRegionToggle'),declare:$('glyphRegionDeclare'),clear:$('glyphRegionClear'),status:$('glyphRegionStatus'),
  words:{noun:'疑难字备注',hint:'在PDF原图上拖动框选字形，松开后填写备注。'},
  getContext:()=>({page:getContext().scan,itemId:getContext().item?.id,draftId:draft?.id}),
  canSelect:()=>Boolean(canAct()&&draft&&draft.itemId===getContext().item?.id&&getContext().scan===getContext().item?.page),beforeSelect:()=>{panel.hidden=true;},
  onDeclare:region=>{draft.region=region;updateDraft();open();hint('已框选原字，请填写备注并保存。');$('glyphComment').focus({preventScroll:true});},onClear:()=>{}
 });
 function cancelDraft(){viewToken++;draft=null;picker.reset();$('glyphComment').value='';updateDraft();}
 async function begin(){
  if(!canAct())return;const {item}=getContext();if(!item||item.page===null)return;
  if(draft?.region){open();return;}
  draft={id:draft?.id||crypto.randomUUID(),itemId:item.id,region:null};
  showScan(item.page);const token=++viewToken;picker.reset();updateDraft();panel.hidden=true;
  try{await image.decode();if(token!==viewToken||draft?.itemId!==getContext().item?.id||getContext().scan!==item.page)return;
   if(!canAct())return;$('glyphRegionToggle').click();
  }catch{if(token===viewToken){cancelDraft();open();hint('原图载入失败，请重试或打开原PDF。');}}
 }
 // Reuse the picker validation before opening the note; no extra confirmation step.
 layer.addEventListener('pointerup',()=>{if(draft&&!$('glyphRegionDeclare').disabled)$('glyphRegionDeclare').click();});
 layer.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229&&canAct()){cancelDraft();open();hint('已取消框选。');}});
 function refresh(){
  const {item,record}=getContext(),notes=record?.glyphNotes||[];
  if(itemId!==item?.id){cancelDraft();panel.hidden=true;itemId=item?.id;}
  if(draft&&notes.some(n=>n.id===draft.id))cancelDraft();
  $('compareGlyphNotes').hidden=!item||item.page===null;$('compareGlyphNotes').textContent='疑难字备注'+(notes.length?' · '+notes.length+'条':'');
  $('compareAdoptManual').textContent=item?.page!==null&&openGlyphNotes(record).length?'保存存疑并继续':item?.page!==null?'确认保存整页':'采用人工稿';
  $('compareEditHint').textContent=openGlyphNotes(record).length?'本页仍有疑难字备注，先保存为存疑；处理完后删除备注，再确认整页。':'本页全部文字一起审核，完成后点击“确认保存整页”。';
  $('compareAdoptManual').title=openGlyphNotes(record).length?'本页有疑难字备注，先存疑保存，不计入已核定页。':'核对整页TXT后保存并继续';
  $('glyphRecords').innerHTML='<h3>本页备注 · '+notes.length+' 条</h3>'+notes.map(n=>`<article class="glyph-record"><p>${esc(n.comment)}</p>${n.quote?'<p>原TXT片段：'+esc(n.quote)+'</p>':''}${n.candidate?'<p>原候选字：'+esc(n.candidate)+'</p>':''}${n.resolution?'<p>原处理说明：'+esc(n.resolution)+'</p>':''}<small>${esc(n.by)} · ${esc(n.at)}</small><div class="glyph-actions"><button type="button" data-glyph-view="${esc(n.id)}">查看原字</button><button type="button" data-glyph-delete="${esc(n.id)}">删除备注</button></div></article>`).join('');updateDraft();floating.layout();
 }
 async function viewRegion(region){
  if(!canAct())return;const id=getContext().item?.id;
  try{showScan(region.page);const token=++viewToken;await image.decode();await verifyScanRegion(image,region);if(token!==viewToken||getContext().item?.id!==id)throw Error('任务已变化，请重新查看备注。');picker.show(region);panel.hidden=true;notice('已显示扫描第 '+region.page+' 页的原字框选。');}catch(e){notice(e.message);}
 }
 $('compareGlyphNotes').onclick=begin;
 $('glyphRegionCancel').onclick=()=>{if(!canAct())return;cancelDraft();open();hint('已取消框选。');};
 $('glyphRegionRecords').onclick=()=>{if(!canAct())return;cancelDraft();open();};
 $('glyphClose').onclick=()=>{if(canAct())panel.hidden=true;};
 $('glyphCancel').onclick=()=>{if(!canAct())return;cancelDraft();hint('已取消未保存的备注。');};
 $('glyphForm').addEventListener('keydown',e=>{if(['Enter','Escape'].includes(e.key)&&(e.isComposing||e.keyCode===229))e.preventDefault();});
 $('glyphForm').onsubmit=e=>{e.preventDefault();if(!canAct()||!draft?.region)return;try{const {item,record}=getContext();if(item?.id!==draft.itemId)throw Error('任务已变化，请重新框选。');const note=createGlyphNote(item,{id:draft.id,anchor:'scan',region:draft.region,comment:$('glyphComment').value,by:getContext().by});if(saveNotes([...(record?.glyphNotes||[]),note])){refresh();hint('备注和本页校订稿已保存到本机，本页保持存疑。');}}catch(error){hint(error.message);}};
 $('glyphRecords').onclick=e=>{
  const id=e.target.dataset.glyphView||e.target.dataset.glyphDelete;if(!id||!canAct())return;
  const {record}=getContext(),note=record?.glyphNotes?.find(n=>n.id===id);if(!note)return;
  if(draft){hint('请先保存或取消当前备注。');return;}
  if(e.target.dataset.glyphView){viewRegion(note.region);return;}
  if(saveNotes(record.glyphNotes.filter(n=>n.id!==id))){refresh();hint('备注已删除，本页仍需核对后确认保存。');}
 };
 return {refresh,hasDraft:()=>Boolean(draft),scanChanging(){viewToken++;picker.reset();},layout(){picker.geometryChanged();floating.layout();},guardLeave(){if(!draft)return true;hint('请先保存或取消疑难字备注，再切换任务。');return false;}};
}

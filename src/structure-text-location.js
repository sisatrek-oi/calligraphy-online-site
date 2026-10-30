import {annotationReading} from './annotation-reading.js?v=release-20261022';

function sourceRange(el,byPage,lo,hi){
 const page=Number(el.dataset.page),p=byPage.get(page),start=Number(el.dataset.start),end=Number(el.dataset.end),reading=annotationReading(p.text),visible=reading.visibleOffset(start);
 if(reading.text.slice(visible,reading.visibleOffset(end))!==el.textContent)throw Error('TXT显示内容已变化，请重新载入。');
 const a=lo===el.textContent.length?end:Math.min(end,reading.sourceStart(visible+lo));
 const z=lo===hi?a:Math.min(end,reading.sourceEnd(visible+hi));
 return {page,start:a,end:z,quote:p.text.slice(a,z),textSha256:p.source.textSha256};
}
const offset=(el,node,n)=>{const r=el.ownerDocument.createRange();r.selectNodeContents(el);r.setEnd(node,n);return r.toString().length;};
export function structureSelection(editor,byPage,selection=editor.ownerDocument.getSelection()){
 if(!selection?.rangeCount||selection.isCollapsed)return [];
 const range=selection.getRangeAt(0);
 if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer))return [];
 return [...editor.querySelectorAll('.structure-source-run')].filter(el=>range.intersectsNode(el)).map(el=>{
  const lo=el.contains(range.startContainer)?offset(el,range.startContainer,range.startOffset):0;
  const hi=el.contains(range.endContainer)?offset(el,range.endContainer,range.endOffset):el.textContent.length;
  return sourceRange(el,byPage,lo,hi);
 }).filter(s=>s.end>s.start);
}
export function structurePoint(editor,byPage,x,y,target=null){
 const doc=editor.ownerDocument,element=target?.nodeType===1?target:target?.parentElement;
 if(element?.closest('.structure-gap,[data-gap]'))return null;
 let paragraph=element?.closest('[data-paragraph]');
 if(!paragraph||!editor.contains(paragraph)){
  const distance=el=>{const r=el.getBoundingClientRect();return y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;};
  paragraph=[...editor.querySelectorAll('[data-paragraph]')].sort((a,b)=>distance(a)-distance(b))[0];
 }
 if(!paragraph)return null;
 const elements=[...paragraph.querySelectorAll('.structure-source-run')];if(!elements.length)return null;
 const caret=doc.caretPositionFromPoint?.(x,y),range=!caret&&doc.caretRangeFromPoint?.(x,y),node=caret?.offsetNode||range?.startContainer,n=caret?.offset??range?.startOffset;
 if(node)for(const el of elements){
  const r=doc.createRange();r.selectNodeContents(el);const side=r.comparePoint(node,n);
  if(side===0&&el.contains(node)){const at=offset(el,node,n);return sourceRange(el,byPage,at,at);}
  if(side===-1)return sourceRange(el,byPage,0,0);
 }
 const el=node||y>=paragraph.getBoundingClientRect().bottom?elements.at(-1):elements[0],at=el===elements.at(-1)?el.textContent.length:0;
 return sourceRange(el,byPage,at,at);
}

// DOM offsets are UTF-16; capture before controls take focus, never search text.
export function chapterDomSelection(editor,runs,selection=window.getSelection()){
 if(!selection||selection.rangeCount!==1||selection.isCollapsed)return null;
 const range=selection.getRangeAt(0);if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer))return null;
 const closest=node=>(node.nodeType===1?node:node.parentElement)?.closest('[data-run-id]');
 const first=closest(range.startContainer),last=closest(range.endContainer);if(!first||!last)throw new Error('请在已开放的本章正文内重新选择。');
 for(const gap of editor.querySelectorAll('[data-gap]'))if(range.intersectsNode(gap))throw new Error('选区跨过未审核正文缺口，请分段标注。');
 const offset=(element,node,n)=>{const r=document.createRange();r.selectNodeContents(element);r.setEnd(node,n);return r.toString().length;};
 const a=runs.find(r=>r.id===first.dataset.runId),z=runs.find(r=>r.id===last.dataset.runId);if(!a||!z||first.textContent!==a.text||last.textContent!==z.text)throw new Error('阅读内容已变化，请重新选择。');
 return {firstId:a.id,firstOffset:offset(first,range.startContainer,range.startOffset),lastId:z.id,lastOffset:offset(last,range.endContainer,range.endOffset)};
}

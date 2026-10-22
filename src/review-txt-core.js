// Indices in the packaged TXT comparisons are Unicode code points, not UTF-16.
export function txtRows(data) {
  return data.pages.flatMap(page => {
    const a=Array.from(page.before), b=Array.from(page.after);
    return page.edits.map(([kind,category,i,z],index)=>({
      id:`${page.page}-${index}`,page:page.page,part:page.part,
      kind:data.kinds[kind],category:data.categories[category],
      before:kind===1?'':a[i],after:kind===2?'':b[z],
      beforeIndex:i,afterIndex:z,
      beforeContext:a.slice(Math.max(0,i-12),i).join('')+'⟦'+(kind===1?'增补位置':a[i])+'⟧'+a.slice(i+(kind===1?0:1),i+13).join(''),
      afterContext:b.slice(Math.max(0,z-12),z).join('')+'⟦'+(kind===2?'删去位置':b[z])+'⟧'+b.slice(z+(kind===2?0:1),z+13).join(''),
      sourceBefore:page.sourceBefore,sourceAfter:page.sourceAfter,
    }));
  });
}
export function filterTxtRows(rows,{category='',kind='',query='',hanShape='',hanSound='',hanPair=''}={}) {
  const needle=query.trim().toLocaleLowerCase();
  return rows.filter(r=>(!category||r.category===category)&&(!kind||r.kind===kind)&&(!hanShape||r.han?.shape===hanShape)&&(!hanSound||r.han?.sound===hanSound)&&(!hanPair||r.han?.key===hanPair)&&(!needle||[r.page,r.before,r.after,r.beforeContext,r.afterContext].join(' ').toLocaleLowerCase().includes(needle)));
}
export function txtPage(rows,page=1,size=50) {
  const totalPages=Math.max(1,Math.ceil(rows.length/size));
  const number=Math.max(1,Math.min(totalPages,Number.isFinite(Number(page))?Math.floor(Number(page)):1));
  const start=(number-1)*size;
  return {rows:rows.slice(start,start+size),number,totalPages,total:rows.length,start:rows.length?start+1:0,end:Math.min(start+size,rows.length)};
}

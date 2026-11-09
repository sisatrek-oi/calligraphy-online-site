// Reviewers see every available crop; historical machine diagnostics stay in the source files.
export function reviewRows(rows,glyphs,images){
 const byId=new Map(glyphs.map(g=>[g.id,g]));
 return rows.map(row=>{
  if(row.status==='spacing')return row;
  const glyph=byId.get(row.glyphId),page=row.sourcePage??glyph?.sourcePage,size=images[String(page)]?.size;
  const candidates=[row.box,row.candidateBox,glyph?.box,glyph?.candidateBox,glyph?.rawBox];
  const box=candidates.find(b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&size&&0<=b[0]&&b[0]<b[2]&&b[2]<=size[0]&&0<=b[1]&&b[1]<b[3]&&b[3]<=size[1])||null;
  const {geometryFlags,candidateBox,status,...position}=row;
  return {...position,sourcePage:page,box,status:box?'paired':'unmapped'};
 });
}

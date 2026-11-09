export const cropKey=(partId,start)=>JSON.stringify([partId,start]);
export function validBox(box,size){return Array.isArray(box)&&box.length===4&&box.every(Number.isInteger)&&size&&box[0]>=0&&box[1]>=0&&box[2]>box[0]&&box[3]>box[1]&&box[2]<=size[0]&&box[3]<=size[1];}
export function validateCrops(value,parts,images){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('字图草稿格式不正确，原记录已保留。');
 const byId=new Map(parts.map(p=>[p.id,p]));
 for(const[key,c]of Object.entries(value)){
  const part=byId.get(c?.partId),image=images[String(c?.page)];
  if(!part||!Number.isInteger(c.start)||!Number.isInteger(c.end)||c.start<0||c.end<=c.start||c.end>part.text.length||part.text.slice(c.start,c.end)!==c.text||[...c.text].length!==1||key!==cropKey(c.partId,c.start)||!image||c.imageSha256!==image.sha256||!validBox(c.box,image.size))throw Error('字图草稿的位置或原图版本不匹配，原记录已保留。');
 }
 return value;
}
export function shiftCrops(crops,partId,start,end,replacement){
 const next={},delta=replacement.length-(end-start);
 for(const c of Object.values(crops)){
  let item=c;
  if(c.partId===partId){
   if(c.end<=start){}
   else if(c.start>=end)item={...c,start:c.start+delta,end:c.end+delta};
   else if(c.start===start&&c.end===end&&[...replacement].length===1)item={...c,end:start+replacement.length,text:replacement};
   else continue;
  }
  next[cropKey(item.partId,item.start)]=item;
 }
 return next;
}
export function withCrops(rows,partId,crops){return rows.map(row=>{const c=crops[cropKey(partId,row.start)];return c&&c.end===row.end&&c.text===row.text?{...row,box:c.box,sourcePage:c.page,status:'paired',cropSource:'manual'}:row;});}

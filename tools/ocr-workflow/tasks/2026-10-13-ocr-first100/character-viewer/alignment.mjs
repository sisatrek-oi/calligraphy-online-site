export const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');

function distances(a,b){
 const rows=[Uint32Array.from({length:b.length+1},(_,i)=>i)];
 for(let i=1;i<=a.length;i++){
  const r=new Uint32Array(b.length+1),prev=rows.at(-1);r[0]=i;
  for(let j=1;j<=b.length;j++)r[j]=Math.min(prev[j]+1,r[j-1]+1,prev[j-1]+Number(a[i-1]!==b[j-1]));
  rows.push(r);
 }
 return rows;
}

export function alignIndices(source,target){
 const a=Array.from(source),b=Array.from(target),n=a.length,m=b.length;
 if(source===target)return b.map((_,i)=>[i,'equal']);
 if((n+1)*(m+1)>4000000)return b.map(()=>[null,'alignment_limit']);
 const f=distances(a,b),back=distances([...a].reverse(),[...b].reverse()),total=f[n][m],result=[];
 for(let j=0;j<m;j++){
  const choices=new Set();
  for(let i=0;i<=n;i++){
   if(f[i][j]+1+back[n-i][m-j-1]===total)choices.add(null);
   if(i<n&&f[i][j]+Number(a[i]!==b[j])+back[n-i-1][m-j-1]===total)choices.add(i);
  }
  const index=choices.size===1?[...choices][0]:null;
  result.push([index,index!==null?(a[index]===b[j]?'equal':'substituted'):choices.size===1&&choices.has(null)?'inserted':'ambiguous']);
 }
 return result;
}

export function mapText(glyphs,text,ignoreLineLabels=false){
 const source=glyphs.filter(g=>!/^\s+$/u.test(g.text)),rows=[];let offset=0;
 const ignored=new Set();
 if(ignoreLineLabels)for(const m of text.matchAll(/^\[\d{3,}\][ \t]?/gm))for(let i=m.index;i<m.index+m[0].length;i++)ignored.add(i);
 for(const char of text){rows.push({text:char,start:offset,end:offset+char.length});offset+=char.length;}
 const target=rows.filter(r=>!/^\s$/u.test(r.text)&&!ignored.has(r.start));
 const links=alignIndices(source.map(g=>g.text).join(''),target.map(g=>g.text).join(''));
 let cursor=0;
 return rows.map(r=>{
  if(ignored.has(r.start))return {...r,status:'line_label',box:null};
  if(/^\s$/u.test(r.text))return {...r,status:'spacing',box:null};
  const[index,status]=links[cursor++],g=index===null?{}:source[index];
  return {...r,status:index!==null&&!g.box?'no_geometry':status,glyphId:g.id??null,box:g.box??null,quad:g.quad??null,score:g.score??null,ocrText:g.text,column:g.column,piece:g.piece};
 });
}

export function replaceText(text,transaction,value){
 if(transaction.snapshot!==text||text.slice(transaction.start,transaction.end)!==transaction.before)throw Error('文字已变化，请重新选择要改的字。');
 return text.slice(0,transaction.start)+value+text.slice(transaction.end);
}

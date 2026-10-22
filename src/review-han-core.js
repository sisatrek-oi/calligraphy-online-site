export const shapeLabels={
  same:'同部首 · 同笔画',near:'同部首 · 相差1–2画',far:'同部首 · 相差≥3画',
  otherNear:'异部首 · 笔画差≤2',otherFar:'异部首 · 笔画差≥3',missing:'结构资料不足',
};
export const soundLabels={same:'常用读音同音同调',tone:'常用音节相同、声调不同',different:'常用音节未重合',missing:'读音资料不足'};
const toneMarks=/[\u0300\u0301\u0304\u030c]/gu;
// Preserve diaeresis/circumflex: nü ≠ nu and ê ≠ e; only remove tone marks.
export const untoned=reading=>reading.normalize('NFD').replace(toneMarks,'').normalize('NFC');
const readings=value=>(value||'').normalize('NFC').toLowerCase().split(/\s+/u).filter(Boolean);
const radicals=value=>(value||'').split(/\s+/u).map(x=>x.match(/^(\d+)('{0,3})\.-?\d+$/u)?.slice(1).join('')).filter(Boolean);
const strokes=value=>(value||'').split(/\s+/u).filter(x=>/^\d+$/u.test(x)).map(Number);

export function classifyHan(before,after,characters) {
  const a=characters[before]||{},b=characters[after]||{};
  const ar=radicals(a.radical),br=radicals(b.radical),as=strokes(a.strokes),bs=strokes(b.strokes);
  const commonRadical=ar.some(r=>br.includes(r));
  const strokeGap=as.length&&bs.length?Math.min(...as.flatMap(i=>bs.map(j=>Math.abs(i-j)))):null;
  const shape=!ar.length||!br.length||strokeGap===null?'missing':commonRadical?(strokeGap===0?'same':strokeGap<=2?'near':'far'):(strokeGap<=2?'otherNear':'otherFar');
  const ap=readings(a.pinyin),bp=readings(b.pinyin);
  const sound=!ap.length||!bp.length?'missing':ap.some(p=>bp.includes(p))?'same':ap.some(p=>bp.map(untoned).includes(untoned(p)))?'tone':'different';
  return {shape,sound,strokeGap,commonRadical};
}

export function analyzeHan(rows,characters) {
  const shape=Object.fromEntries(Object.keys(shapeLabels).map(key=>[key,0]));
  const sound=Object.fromEntries(Object.keys(soundLabels).map(key=>[key,0]));
  const pairs=new Map();let total=0;
  for(const row of rows){
    if(row.category!=='汉字替换')continue;
    const key=row.before+'→'+row.after;
    let pair=pairs.get(key);
    if(!pair){pair={key,before:row.before,after:row.after,count:0,pages:new Set(),...classifyHan(row.before,row.after,characters)};pairs.set(key,pair);}
    pair.count++;pair.pages.add(row.page);row.han=pair;
    shape[pair.shape]++;sound[pair.sound]++;total++;
  }
  const ranked=[...pairs.values()].sort((a,b)=>b.count-a.count||(a.key<b.key?-1:a.key>b.key?1:0));
  const repeated=ranked.filter(p=>p.count>1).reduce((sum,p)=>sum+p.count,0);
  const top10=ranked.slice(0,10).reduce((sum,p)=>sum+p.count,0);
  return {total,shape,sound,pairs:ranked,uniquePairs:pairs.size,repeated,top10};
}

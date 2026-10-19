// Usage: node scripts/publish-fulltext.mjs INPUT.json [CORRECTIONS.json]
// Then npm run build:screening. Corrections are explicit machine image checks,
// never human approvals. The original API responses stay in the offline batch.
import fs from 'node:fs';
import { validModelReview } from '../src/model-reviewed.js';
const [input,corrections] = process.argv.slice(2);
if (!input) throw new Error('Expected an offline model-reviewed.json');
const payload = JSON.parse(fs.readFileSync(input,'utf8'));
if (payload.version !== 1 || ![1,2,3,4].includes(payload.part) || !Array.isArray(payload.pages) || !payload.pages.length) throw new Error('Invalid part');
const patch = corrections ? JSON.parse(fs.readFileSync(corrections,'utf8')) : [];
if (!Array.isArray(patch)) throw new Error('Invalid corrections');
for (const c of patch) {
  const units = payload.pages.flatMap(p=>p.units);
  const u = units.find(u=>u.id===c.unitId);
  if (!u || u.text!==c.before || c.reviewerType!=='AI-image-check' || typeof c.after!=='string' || !c.after.trim() || typeof c.note!=='string' || !c.note.trim()) throw new Error('Correction is not bound to current machine text');
  u.machineCorrection=c; u.text=c.after; u.note += `；${c.note}`;
}
const ids = new Set(), [start,end] = [[1,258],[259,527],[528,776],[777,1052]][payload.part-1];
for (const p of payload.pages) {
  p.text = p.units.map((u,i)=>`[${String(i+1).padStart(3,'0')}] ${u.text}`).join('\n');
  if (ids.has(p.page) || p.page<start || p.page>end || !validModelReview(p,p.page)) throw new Error('Incomplete full-page review');
  ids.add(p.page);
}
payload.pages.sort((a,b)=>a.page-b.page);
const root = new URL('../screening-data/',import.meta.url), prefix=`part-${payload.part}-model-reviewed`;
const previous = new URL(`${prefix}.json`,root);
if (fs.existsSync(previous)) {
  const old = JSON.parse(fs.readFileSync(previous,'utf8'));
  for (const p of old.pages) {
    const replacement = payload.pages.find(n=>n.page===p.page);
    if (!replacement) payload.pages.push(p);
    else if (JSON.stringify(p)!==JSON.stringify(replacement) && p.revision===replacement.revision) throw new Error('Changed page needs a new revision');
  }
  payload.pages.sort((a,b)=>a.page-b.page);
}
const lines=['《历代书法论文选》｜大模型复核全文工作TXT','机器识别—大模型复核—人工全文检查','以下页面均待人工全文检查；不标出修改处。',''];
const rows=[['原PDF物理页','机器识别','大模型','复核栏数','总栏数','处理状态','人工确认','复核版本','API请求数','API秒数','估算峰价美元','费用口径']];
for (const p of payload.pages) {
  lines.push(`===== 原 PDF 物理页 ${p.page}｜分册第 ${p.page-start+1} 页 =====`,'状态：大模型已复核·待人工全文检查',p.text,'');
  rows.push([p.page,p.machineModel,p.model,p.reviewedColumnCount,p.columnCount,p.status,'否',p.revision,p.requests.length,p.requests.reduce((n,r)=>n+r.seconds,0),p.requests.reduce((n,r)=>n+r.estimatedUSDPeak,0),'公开峰价估算，非账单实付']);
}
fs.writeFileSync(previous,JSON.stringify(payload,null,2)+'\n');
fs.writeFileSync(new URL(`${prefix}.txt`,root),'\ufeff'+lines.join('\n'));
fs.writeFileSync(new URL(`${prefix}-status.csv`,root),'\ufeff'+rows.map(r=>r.map(c=>`"${String(c).replaceAll('"','""')}"`).join(',')).join('\r\n')+'\r\n');
console.log(`Published ${payload.pages.length} machine-reviewed pages; zero human approvals.`);

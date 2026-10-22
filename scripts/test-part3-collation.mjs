import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { teamRelease, publicationLabel } from '../src/team-collation.js';
import { createMaterialLoader } from '../src/screening-loader.js';
import { defaultDraftText, draftForPage } from '../src/ocr-source-policy.js';
import { pageMetrics } from '../src/task-metrics.js';
const read=name=>fs.readFileSync(new URL(`../screening-data/${name}`,import.meta.url));
const json=name=>JSON.parse(read(name));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const release=json('part-3-collated.json');
const pages=new Map(release.pages.map(p=>[p.page,p]));

test('third return includes exactly 75 checked pages with original text, scans and explicit unresolved glyphs',()=>{
 assert.deepEqual([...pages.keys()],[...Array.from({length:121},(_,i)=>528+i),...Array.from({length:34},(_,i)=>743+i)]);
 assert.deepEqual(teamRelease.parts[3],{pages:155,complete:142,pending:13});
 assert.deepEqual(release.pages.filter(p=>p.page<=602&&p.pending.length).map(p=>p.page),[537,555,566,586]);
 assert.equal(release.pages.filter(p=>p.page<=602).reduce((sum,p)=>sum+p.pending.length,0),6);
 for(const p of release.pages){
  assert.equal(sha(p.memberText),p.memberTextSha256);
  assert.equal(sha(read(`scans/page-${String(p.page).padStart(4,'0')}.jpg`)),p.imageSha256);
  assert.equal(p.status,p.pending.length?'已修订·待核':'已修改完毕');
  if(!p.humanSource)assert.equal([...p.text.matchAll(/【待核：/g)].length,p.pending.length);
  assert.ok(read('part-3-collated.txt').toString('utf8').includes(p.text));
  assert.ok(read('part-3-collated-status.csv').toString('utf8').includes(`${p.page},${p.status},${p.corrections.length},${p.pending.length},${p.reviewedAt}`));
  if(!p.humanSource)assert.ok(p.notes.some(n=>n.includes('AI助手')&&n.includes('未进行独立专家盲审')));
  assert.equal(p.metricBaseline,undefined);
  for(const f of p.facsimiles||[]) assert.ok(read(f.src.replace('./screening-data/','')).length>100);
 }
});

test('member questions are resolved from visible glyphs, while historical glyphs and uncertain readings stay explicit',()=>{
 assert.match(pages.get(541).memberText,/瑷奇/);assert.match(pages.get(541).text,/瓌奇/);
 assert.match(pages.get(555).text,/衰【待核：苶／茶】/);
 assert.equal(pages.get(566).pending.length,2);
 assert.match(pages.get(566).text,/「殺」字/);assert.match(pages.get(566).text,/「昜」字/);
 assert.match(pages.get(573).memberText,/必故  之/);assert.match(pages.get(573).text,/必故壓之/);
 assert.equal(pages.get(586).pending.length,2);assert.match(pages.get(586).text,/梅君【待核：/);
 assert.match(pages.get(595).text,/邵䶵书亦本之/);
 assert.match(pages.get(589).text,/号俗口/);assert.match(pages.get(600).text,/圆湛稳适/);
 assert.match(pages.get(593).text,/开宝前/);
});

test('published third-part materials exclude the 25 draft pages and all later untouched pages',async()=>{
 const index=json('part-3-index.json');
 const loader=createMaterialLoader(index,{fetcher:async path=>({ok:true,json:async()=>json(path.replace('./screening-data/',''))})});
 await loader.ensureAll();
 assert.deepEqual(index.pages.filter(p=>p.collated).map(p=>p.page),[...pages.keys()]);
 for(const p of index.pages){
  if(!pages.has(p.page)){assert.equal(p.collated,undefined);assert.equal(p.publication,undefined);}
  else {assert.equal(defaultDraftText(p),pages.get(p.page).text);assert.ok(publicationLabel(p));}
 }
});

test('personal original, draft, verification, history and known or unknown metric baseline take priority without mutation',()=>{
 for(const n of [528,541,555,566,602])for(const known of [true,false])for(const verified of [true,false]){
  const item={page:n,ocr:'[001] 原OCR',collated:pages.get(n)};
  const collation={text:`[001] 个人保留稿${n}□`,verified,checks:{wording:true},verifiedBy:'宋品宣',verifiedAt:'2026-10-13',edits:[{before:'甲',after:'乙'}],...(known?{metricBaseline:{version:1,text:'历史比较稿',label:'原底稿'}}:{})};
  const saved={question:'历史疑问',collation};const before=JSON.stringify(saved);
  assert.equal(draftForPage(item,saved),collation);
  assert.deepEqual(pageMetrics(item,saved),pageMetrics({...item,collated:undefined},saved));
  assert.equal(JSON.stringify(saved),before);
 }
});

test('numbering repairs preserve readable paragraph boundaries including formerly glued and duplicate records',()=>{
 for(const n of [551,552,554,562,563,564,565,568,573,579,589,597]){
  const lines=pages.get(n).text.split('\n');
  lines.forEach((line,i)=>assert.ok(line.startsWith(`[${String(i+1).padStart(3,'0')}] `),`${n}:${i+1}`));
  assert.equal(lines.filter(l=>/\[\d{3}\].*\[\d{3}\]/.test(l)).length,0);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const context = vm.createContext({ crypto: webcrypto, TextEncoder });
vm.runInContext(readFileSync(new URL('../src/file-review-core.js', import.meta.url), 'utf8'), context);
const C = context.ShulunFileReview;
const workspace = () => ({ type:'calligraphy-workspace', datasetName:'五人审核验收', schema:[{id:'author',label:'书家'},{id:'quote',label:'摘录'},{id:'sourceFile',label:'原文文件'}], rows:[{id:'r1',fields:{author:'示例甲',quote:'演示材料，非研究结论',sourceFile:'page_1.txt'}},{id:'r2',fields:{author:'示例乙',quote:'第二条演示',sourceFile:'page_2.txt'}}], uploadedPages:{'page_1.txt':'原文第一段','page_2.txt':'原文第二段'}, reviewState:{ secret:'不可外发' }, customTemplates:['private'], trashRows:['private'] });
const entries = p => p.material.rows.map(r => ({rowId:r.id,decision:'pass',note:'',values:{...r.values}}));
const make = () => C.createBatch(C.fromWorkspace(workspace()), ['甲','乙','丙','丁','戊']);
test('workspace projection strips all history and unrelated pages', () => {
 const w = workspace(); w.uploadedPages.secret = 'private'; const m = C.fromWorkspace(w);
 assert.equal(m.rows[0].sourceText,'原文第一段'); assert.ok(!JSON.stringify(m).includes('private')); assert.equal(m.rows.length,2);
});
test('five reviewers round trip with independent packages, disagreement and no source mutation', async () => {
 let b = await make(); const baseline = C.canonical(b.material);
 for (let i=0;i<5;i++) { const p = C.packageFor(b,b.assignments[i]); await C.validatePackage(p); const es=entries(p); if(i===1){ es[0].decision='change'; es[0].values.author='建议姓名'; es[0].note='原文另有记载'; } if(i===2){ es[1].decision='uncertain';es[1].note='证据不足'; } const r = await C.resultFor(p,es,1); b=C.merge(b,r).batch; }
 await C.validateBatch(b); assert.equal(C.summarize(b)[0].status,'有分歧'); assert.equal(C.summarize(b)[1].reviews.length,5); assert.equal(C.canonical(b.material),baseline);
 assert.equal(new Set(b.assignments.map(a=>a.packageId)).size,5); assert.ok(!JSON.stringify(C.packageFor(b,b.assignments[0])).includes('建议姓名'));
});
test('wrong batch, member and material fingerprints rejected',async()=>{
 const b=await make(),p=C.packageFor(b,b.assignments[0]),r=await C.resultFor(p,entries(p),1);
 for(const [k,v] of [['batchId','other'],['packageId','other'],['reviewer','冒名'],['fingerprint','wrong']]) assert.throws(()=>C.merge(b,{...r,[k]:v}));
 const bad=C.clone(p);bad.material.rows[0].values.author='changed'; await assert.rejects(()=>C.validatePackage(bad),/指纹/);
});
test('missing, duplicate, unknown rows and incomplete fields rejected',async()=>{
 const b=await make(),p=C.packageFor(b,b.assignments[0]);
 await assert.rejects(()=>C.resultFor(p,entries(p).slice(0,1),1),/未审核/);
 const dup=entries(p);dup[1].rowId='r1';await assert.rejects(()=>C.resultFor(p,dup,1),/重复/);
 const wrong=entries(p);wrong[1].rowId='unknown';await assert.rejects(()=>C.resultFor(p,wrong,1),/条目/);
 const missing=entries(p);delete missing[0].values.author;await assert.rejects(()=>C.resultFor(p,missing,1),/字段/);
});
test('uncertainty needs explanation, changed values cannot silently pass',async()=>{
 const b=await make(),p=C.packageFor(b,b.assignments[0]);const es=entries(p);es[0].decision='uncertain';await assert.rejects(()=>C.resultFor(p,es,1),/理由/);es[0].note='字迹模糊';await C.resultFor(p,es,1);
 es[0].decision='pass';es[0].values.author='不同';await assert.rejects(()=>C.resultFor(p,es,1),/修改字段/);
});
test('repeat result is idempotent; changed same revision conflicts; newer retains old; older blocked',async()=>{
 let b=await make();const p=C.packageFor(b,b.assignments[0]),r=await C.resultFor(p,entries(p),1);b=C.merge(b,r).batch;
 assert.equal(C.merge(b,r).status,'duplicate');const modified=C.clone(r);modified.entries[0].note='补充';assert.throws(()=>C.merge(b,modified),/冲突/);
 modified.revision=3;b=C.merge(b,modified).batch;assert.equal(b.submissions.length,2);assert.equal(C.summarize(b)[0].reviews[0].revision,3);
 assert.throws(()=>C.merge(b,{...r,revision:2}),/较旧/);
});
test('complete agreement remains pending owner confirmation; missing reviewers tracked',async()=>{
 let b=await make();let p=C.packageFor(b,b.assignments[0]);b=C.merge(b,await C.resultFor(p,entries(p),1)).batch;assert.equal(C.summarize(b)[0].missing,4);
 for(const a of b.assignments.slice(1)){p=C.packageFor(b,a);b=C.merge(b,await C.resultFor(p,entries(p),1)).batch;}assert.match(C.summarize(b)[0].status,/负责人确认/);
});
test('CSV quotes multiline and formula-like notes, retains original and proposal',async()=>{
 let b=await make();const p=C.packageFor(b,b.assignments[0]);const es=entries(p);es[0].note='=SUM(1,2)\n"comment"';b=C.merge(b,await C.resultFor(p,es,1)).batch;const csv=C.csv(b);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=SUM"));assert.ok(csv.includes('""comment""'));assert.ok(csv.includes('书家（原值）'));
});
test('prototype keys, unsafe images and duplicate identities are rejected',async()=>{
 const m=C.fromWorkspace(workspace());m.fields[0].id='__proto__';assert.throws(()=>C.validateMaterial(m));
 assert.throws(()=>C.image('data:image/svg+xml;base64,PHN2Zz4='));assert.throws(()=>C.image('https://example.com/a.png'));
 await assert.rejects(()=>C.createBatch(C.fromWorkspace(workspace()),['甲','甲']));
});
test('malformed backup is rejected without altering live data',async()=>{
 const b=await make(); const bad=C.clone(b);bad.assignments.push(bad.assignments[0]);await assert.rejects(()=>C.validateBatch(bad),/重复/);assert.equal(b.assignments.length,5);
 assert.throws(()=>C.parse('{'),/JSON/);
});

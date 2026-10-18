import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildCollationBundle, createBundleExporter } from '../src/collation-export.js';
import { zipStore } from '../src/zip-store.js';
import { pageMetrics } from '../src/task-metrics.js';

function fixture(part = 1) {
  const [start,end] = [[1,258],[259,527],[528,776],[777,1052]][part-1];
  const pages = Array.from({length:end-start+1},(_,i)=>({page:start+i,local:i+1,ocr:'甲乙。'}));
  const active = pages.filter(p=>![1,2,3,4,7,8,9,10,11,12,1052].includes(p.page));
  const first = active[0].page, second = active[1].page;
  const progress = { version:1, part, person:'校验人,甲',lastPage:first,savedAt:'2026-10-17T01:02:03.000Z',
    reviews:{[first]:{seen:true,question:'第一行\n=待核,"引号"',candidates:[{author:'某书家',style:'篆书',quote:'甲乙',basis:'形态',uncertainty:'待核'}],
      collation:{text:'[001] 甲丙。□【待核：𠮷】',verified:true,checks:{wording:true,order:true,continuity:true},verifiedBy:'旧成员',verifiedAt:'2026-10-17T00:00:00Z',
        metricBaseline:{version:1,text:'[001] 甲乙。',label:'旧底稿'},edits:[{line:'001',charStart:2,charEnd:2,before:'乙',after:'丙'}]}},
    [second]:{collation:{text:'[001] 旧草稿无底稿',verified:false,checks:{wording:false}}}} };
  if (part===1) progress.reviews[7]={collation:{text:'历史目录保留',verified:true,checks:{wording:true}}};
  return {progress,pages,exportedAt:'2026-10-18T12:34:56.000Z',exportId:'fixture-export'};
}

function unzip(bundle) {
  // Python zipfile is an independent reader: central directory, UTF-8 flags,
  // stored-entry CRC, content hashes and JSON/CSV decoding must all work.
  const result = spawnSync('python3',['-c',`
import io,sys,zipfile,json,hashlib,csv
raw=sys.stdin.buffer.read()
assert raw[:4]==b'PK\\x03\\x04'
with zipfile.ZipFile(io.BytesIO(raw)) as z:
 assert z.testzip() is None
 assert all(x.flag_bits & 0x800 for x in z.infolist())
 manifest=json.loads(z.read('文件清单.json'))
 assert len(z.namelist())==8
 assert {x['name'] for x in manifest['files']}==set(z.namelist())-{'文件清单.json'}
 for x in manifest['files']:
  b=z.read(x['name']);assert len(b)==x['bytes'];assert hashlib.sha256(b).hexdigest()==x['sha256']
 out={n:z.read(n).decode('utf-8-sig') for n in z.namelist()}
 out['checks']=list(csv.DictReader(io.StringIO(out[f"第{manifest['part']}份-TXT校验表.csv"])))
 print(json.dumps(out,ensure_ascii=False))
`],{input:bundle.bytes,maxBuffer:10_000_000,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}

test('one standard ZIP contains all eight files and a verifiable manifest for each task', async () => {
  for (const part of [1,2,3,4]) {
    const input=fixture(part),before=JSON.stringify(input);
    const bundle=await buildCollationBundle(input), out=unzip(bundle);
    assert.match(bundle.name,new RegExp(`^第${part}份-校勘交付包-.*\\.zip$`));
    assert.equal(bundle.manifest.pageNumbers.length,[248,269,249,275][part-1]);
    assert.deepEqual(bundle.manifest.counts,{verified:1,draft:1,unstarted:[246,267,247,273][part-1]});
    assert.equal(out.checks.length,bundle.manifest.pageNumbers.length);
    assert.match(out[`第${part}份-逐页校勘.txt`],/□【待核：𠮷】/u);
    assert.deepEqual(JSON.parse(out[`第${part}份-初筛进度备份.json`]),input.progress);
    assert.equal(JSON.stringify(input),before);
  }
});

test('status, edits and original metric baselines stay consistent without inventing drafts or changing progress', async () => {
  const input=fixture(), bundle=await buildCollationBundle(input), out=unzip(bundle);
  const first=out.checks.find(r=>r['原PDF物理页']==='5'), second=out.checks.find(r=>r['原PDF物理页']==='6');
  assert.equal(first['校勘状态'],'已校验'); assert.equal(first['校验人'],'旧成员');
  assert.match(first['直接替换记录'],/乙 → 丙/);
  assert.equal(first['净修改率(%)'],String(pageMetrics(input.pages.find(p=>p.page===5),input.progress.reviews[5]).modificationRate));
  assert.equal(second['校勘状态'],'草稿'); assert.equal(second['净修改率(%)'],'');
  const untouched=out.checks.find(r=>r['原PDF物理页']==='13');
  assert.equal(untouched['校勘状态'],'未开始'); assert.equal(untouched['提醒（不影响本轮完成）'],'');
  assert.doesNotMatch(out['第1份-逐页校勘.txt'],/物理页 7｜/);
  assert.equal(JSON.parse(out['第1份-初筛进度备份.json']).reviews[7].collation.text,'历史目录保留');
  assert.match(out['第1份-逐页校勘.txt'],/（未录入）/);
  assert.match(out['第1份-新证据候选回收表.csv'],/某书家/);
});

test('unsaved or conflicting edits are recoverable and never labelled as saved', async () => {
  const input={...fixture(),unsaved:true,saveConflict:true};
  input.progress.reviews[5].question='=HYPERLINK("bad")';
  const bundle=await buildCollationBundle(input),out=unzip(bundle);
  assert.equal(bundle.manifest.unsaved,true); assert.equal(bundle.manifest.saveConflict,true);
  assert.match(out['交付说明.txt'],/尚未保存/); assert.match(out['第1份-修改率汇总.csv'],/含未保存修改/);
  assert.equal(out.checks[0]['备注（选填）'],"'=HYPERLINK(\"bad\")");
  assert.equal(JSON.parse(out['第1份-初筛进度备份.json']).reviews[5].question,input.progress.reviews[5].question);
});

test('incomplete sources and invalid progress cannot silently produce a partial handoff', async () => {
  const input=fixture();
  for (const bad of [{...input,progress:{...input.progress,person:''}}, {...input,pages:input.pages.slice(0,20)},
    {...input,pages:input.pages.map(p=>p.page===5?{...p,ocr:undefined}:p)}, {...input,exportedAt:'bad'}])
    await assert.rejects(buildCollationBundle(bad));
  assert.throws(()=>zipStore([{name:'../bad',content:'x'}]));
  assert.throws(()=>zipStore([{name:'同名',content:'x'},{name:'同名',content:'y'}]));
});

test('one click freezes progress before loading; concurrent clicks skip, failures retry without writing state', async () => {
  const progress={reviews:{5:{text:'点击时'}}};let release,downloads=0,loaded=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const run=createBundleExporter({capture:()=>progress,loadMaterials:async()=>{loaded++;await gate;},
    build:async snapshot=>snapshot,download:async()=>{downloads++;}});
  const first=run(); progress.reviews[5].text='稍后修改';
  assert.deepEqual(await run(),{skipped:true}); release();
  const result=await first; assert.equal(result.reviews[5].text,'点击时');
  assert.equal(progress.reviews[5].text,'稍后修改');assert.equal(downloads,1);assert.equal(loaded,1);
  let attempts=0;
  const retry=createBundleExporter({capture:()=>progress,loadMaterials:async()=>{if(!attempts++)throw new Error('材料超时');},
    build:async snapshot=>snapshot,download:async()=>{downloads++;}});
  await assert.rejects(retry(),/超时/);assert.equal(downloads,1);
  await retry();assert.equal(downloads,2);
});

test('all ten member segments export only assigned text/tables while retaining the full original-part JSON',async()=>{
  const cases=[[1,1,148,5,158],[2,2,169,259,427],[3,3,149,528,676],[4,4,175,777,951],
    [5,1,100,159,258],[5,2,33,428,460],[6,2,67,461,527],[6,3,66,677,742],[7,3,34,743,776],[7,4,100,952,1051]];
  for(const [member,part,count,start,end]of cases){
    const input=fixture(part),before=JSON.stringify(input);
    const bundle=await buildCollationBundle({...input,member});
    const out=unzip(bundle);
    assert.equal(bundle.manifest.pageNumbers.length,count);
    assert.equal(bundle.manifest.pageNumbers[0],start);
    assert.equal(bundle.manifest.pageNumbers.at(-1),end);
    assert.equal(out.checks.length,count);
    assert.deepEqual(JSON.parse(out[`第${part}份-初筛进度备份.json`]),input.progress);
    assert.equal(bundle.manifest.assignment.member,member);
    assert.equal(bundle.manifest.assignment.backupScope,'entire-original-part');
    assert.match(out['交付说明.txt'],/全部个人记录/);
    assert.equal(JSON.stringify(input),before);
  }
});

test('moved-page drafts and original metric baselines survive in a retained-segment backup',async()=>{
  const input=fixture(1);
  input.progress.reviews[200]={collation:{text:'移交段个人原稿□',metricBaseline:{version:1,text:'原比较底稿',label:'历史'},edits:[{before:'甲',after:'乙'}]}};
  const bundle=await buildCollationBundle({...input,member:1}),out=unzip(bundle);
  assert.ok(!out.checks.some(r=>r['原PDF物理页']==='200'));
  assert.doesNotMatch(out['第1份-逐页校勘.txt'],/移交段个人原稿/);
  assert.deepEqual(JSON.parse(out['第1份-初筛进度备份.json']).reviews[200],input.progress.reviews[200]);
});

test('scoped export still rejects incomplete original sources and invalid cross-part assignments',async()=>{
  const input=fixture(1);
  await assert.rejects(buildCollationBundle({...input,member:1,pages:input.pages.filter(p=>p.page!==200)}));
  await assert.rejects(buildCollationBundle({...input,member:6}));
  await assert.rejects(buildCollationBundle({...input,member:''}));
});

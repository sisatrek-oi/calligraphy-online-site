import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assignments, segmentHasPage } from '../src/team-assignments.js';
import { captureMemberTask, buildMemberTaskBundle, mergeMemberBackup } from '../src/member-task-export.js';

const ranges=[[1,258],[259,527],[528,776],[777,1052]];
function fixture(member) {
  const a=assignments.find(a=>a.id===member), current=a.segments[0].part;
  const values=new Map(), pagesByPart={};
  for (let part=1;part<=4;part++) {
    const [start,end]=ranges[part-1];
    pagesByPart[part]=Array.from({length:end-start+1},(_,i)=>({page:start+i,local:i+1,ocr:'[001] 原始底稿'}));
    const reviews={};
    for(let page=start;page<=end;page++)reviews[page]={question:`疑点${page}`,collation:{text:`[001] 个人稿${page}□`,
      verified:true,checks:{typos:true},verifiedBy:'原校验人',metricBaseline:{version:1,text:`底稿${page}`,label:'历史'},
      edits:[{line:'001',charStart:1,charEnd:1,before:'甲',after:'乙'}]}};
    values.set(`shulun-screening-v1-part-${part}`,JSON.stringify({version:1,part,person:'本人',reviews,lastPage:start}));
  }
  const storage={getItem:key=>values.get(key)??null};
  const currentProgress=JSON.parse(storage.getItem(`shulun-screening-v1-part-${current}`));
  return {a,values,storage,currentProgress,pagesByPart};
}
function unzip(bundle){
  const r=spawnSync('python3',['-c',`
import sys,zipfile,io,json,hashlib
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 m=json.loads(z.read('本人任务清单.json'));out=[]
 for segment in m['segments']:
  raw=z.read(segment['name']);assert hashlib.sha256(raw).hexdigest()==segment['sha256']
  with zipfile.ZipFile(io.BytesIO(raw)) as inner:
   assert inner.testzip() is None
   manifest=json.loads(inner.read('文件清单.json'))
   for f in manifest['files']:
    b=inner.read(f['name']);assert len(b)==f['bytes'];assert hashlib.sha256(b).hexdigest()==f['sha256']
   out.append({'manifest':manifest,'backup':json.loads(inner.read(f"第{segment['part']}份-初筛进度备份.json")),
    'text':inner.read(f"第{segment['part']}份-逐页校勘.txt").decode('utf-8-sig')})
 print(json.dumps({'manifest':m,'parts':out},ensure_ascii=False))
`],{input:bundle.bytes,encoding:'utf8',maxBuffer:10_000_000});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}

test('all seven members export only their assigned text, tables and JSON, with all assigned segments in one ZIP',async()=>{
  for(const a of assignments){
    const f=fixture(a.id),before=JSON.stringify([...f.values]);
    const snapshot=captureMemberTask({...f,member:a.id});
    const result=unzip(await buildMemberTaskBundle({...snapshot,pagesByPart:f.pagesByPart}));
    assert.equal(result.parts.length,a.segments.length);
    assert.equal(result.manifest.pageNumbers.length,[148,169,149,125,133,133,134][a.id-1]);
    for(const part of result.parts){
      const s=a.segments.find(s=>s.part===part.backup.part);
      assert.equal(part.manifest.assignment.backupScope,'member-segment');
      assert.ok(Object.keys(part.backup.reviews).every(n=>segmentHasPage(s,+n)));
      assert.deepEqual(Object.keys(part.backup.reviews).map(Number),part.manifest.pageNumbers);
      for(const [n,r]of Object.entries(part.backup.reviews))assert.deepEqual(r,JSON.parse(f.values.get(`shulun-screening-v1-part-${s.part}`)).reviews[n]);
      for(const p of f.pagesByPart[s.part])if(!segmentHasPage(s,p.page))assert.ok(!part.text.includes(`个人稿${p.page}□`));
    }
    assert.equal(JSON.stringify([...f.values]),before);
  }
});

test('capture freezes current unsaved edits and other segment progress before loading, without writes',()=>{
  const f=fixture(5);f.currentProgress.reviews[159].collation.text='点击时未保存';
  const snapshot=captureMemberTask({...f,member:5,unsaved:true,saveConflict:true});
  f.currentProgress.reviews[159].collation.text='稍后修改';f.values.set('shulun-screening-v1-part-2','broken later');
  assert.equal(snapshot.snapshots[0].progress.reviews[159].collation.text,'点击时未保存');
  assert.equal(snapshot.snapshots[1].progress.reviews[428].collation.text,'[001] 个人稿428□');
  assert.equal(snapshot.snapshots[0].unsaved,true);assert.equal(snapshot.snapshots[1].unsaved,false);
});

test('an unstarted other segment is included; corrupted storage and missing materials block the whole export',async()=>{
  const f=fixture(5);f.values.delete('shulun-screening-v1-part-2');
  const snapshot=captureMemberTask({...f,member:5});
  const bundle=unzip(await buildMemberTaskBundle({...snapshot,pagesByPart:f.pagesByPart}));
  assert.deepEqual(bundle.parts[1].backup.reviews,{});assert.equal(bundle.parts[1].manifest.pageNumbers.length,33);
  await assert.rejects(buildMemberTaskBundle({...snapshot,pagesByPart:{1:f.pagesByPart[1]}}),/不完整/);
  f.values.set('shulun-screening-v1-part-2','{broken');assert.throws(()=>captureMemberTask({...f,member:5}),/无法读取/);
  f.values.set('shulun-screening-v1-part-2',JSON.stringify({version:1,part:3,reviews:{}}));
  assert.throws(()=>captureMemberTask({...f,member:5}),/无法读取/);
});

test('scoped JSON restores only included records while preserving all other local drafts and baselines',async()=>{
  const f=fixture(1), snapshot=captureMemberTask({...f,member:1});
  const {backup}=unzip(await buildMemberTaskBundle({...snapshot,pagesByPart:f.pagesByPart})).parts[0];
  const before=JSON.stringify(f.currentProgress),kept=f.currentProgress.reviews[200];
  backup.reviews[13].collation.text='包内本人稿';
  const merged=mergeMemberBackup(backup,f.currentProgress);
  assert.throws(()=>mergeMemberBackup(backup,f.currentProgress,5),/不属于/);
  assert.deepEqual(merged.reviews[200],kept);assert.equal(merged.reviews[13].collation.text,'包内本人稿');
  assert.equal(JSON.stringify(f.currentProgress),before);
  backup.reviews[200]={collation:{text:'不得越界'}};assert.throws(()=>mergeMemberBackup(backup,f.currentProgress),/越界/);
});

test('a malformed or incomplete member scope is rejected rather than falling back to full-book export',async()=>{
  const f=fixture(5),snapshot=captureMemberTask({...f,member:5});
  await assert.rejects(buildMemberTaskBundle({...snapshot,snapshots:snapshot.snapshots.slice(0,1),pagesByPart:f.pagesByPart}),/不完整/);
  assert.throws(()=>captureMemberTask({...f,member:6}),/不属于/);
  assert.throws(()=>mergeMemberBackup({version:1,part:1,reviews:{},exportScope:{type:'member-segment',member:1,part:1,start:5,end:158}},f.currentProgress),/越界/);
});

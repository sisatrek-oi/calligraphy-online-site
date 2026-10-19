import test from 'node:test';
import assert from 'node:assert/strict';
import {addAnnotation,annotationView,completeAnnotations,rebaseAnnotations,removeAnnotation,restoreAnnotation,relocateAnnotation,validateAnnotations} from '../src/theory-annotations.js';
import {validateProgress} from '../src/delivery-core.js';
import {annotationFiles} from '../src/theory-annotation-export.js';
import {buildAnnotationBundle} from '../src/theory-annotation-export.js';
import {spawnSync} from 'node:child_process';
const at='2026-10-19T06:00:00.000Z',text='序言。书者心画也。附记。书者心画也。';
const mark=(s=text,start=3,end=9)=>addAnnotation(undefined,s,start,end,'人工甲',at,'a');

test('human selections are exact, independent, immutable and never keyword-generated',()=>{
  assert.deepEqual(annotationView(undefined,text).ranges,[]);
  const data=mark();const before=JSON.stringify(data);
  assert.equal(data.passages[0].quote,'书者心画也。');
  const complete=completeAnnotations(data,text,'人工甲',at);
  assert.equal(complete.completion.kind,'marked');assert.equal(JSON.stringify(data),before);
  const progress={version:1,part:3,reviews:{603:{collation:{text,verified:true,metricBaseline:{text:'旧稿'}},theoryAnnotations:complete}}};
  assert.equal(validateProgress(progress).reviews[603].collation.verified,true);
});
test('edits before a selected occurrence shift it; repeated quotes are never searched to replace it',()=>{
  let data=mark(text,12,18);
  data=rebaseAnnotations(data,text,'新'+text,'人工甲',at);
  assert.equal(data.passages[0].start,13);assert.equal(data.passages[0].quote,'书者心画也。');
  const next='新'+text.slice(0,12)+'字者心画也。';
  const changed=rebaseAnnotations(data,'新'+text,next,'人工甲',at);
  assert.equal(annotationView(changed,next).ranges.length,0);
  assert.equal(changed.passages[0].quote,'书者心画也。');
  assert.equal(changed.passages[0].status,'needs-review');
  assert.throws(()=>completeAnnotations(changed,next,'人工甲'),/重新定位/);
});
test('inserting outside borders is safe, changing inside a mark requires manual relocation',()=>{
  const data=completeAnnotations(mark(),text,'甲',at);
  assert.equal(rebaseAnnotations(data,text,text.slice(0,3)+'甲'+text.slice(3),'甲',at).passages[0].start,4);
  assert.equal(rebaseAnnotations(data,text,text.slice(0,9)+'甲'+text.slice(9),'甲',at).passages[0].end,9);
  const changed=text.slice(0,5)+'新'+text.slice(5),pending=rebaseAnnotations(data,text,changed,'甲',at);
  assert.equal(pending.completion,null);assert.equal(pending.passages[0].status,'needs-review');
  const fixed=relocateAnnotation(pending,changed,'a',3,10,'甲',at);
  assert.equal(fixed.passages[0].quote,'书者新心画也。');
  assert.equal(fixed.events.at(-1).previous.quote,'书者心画也。');
  assert.equal(validateAnnotations(fixed),fixed);
});
test('upstream source changes never silently reuse matching offsets',()=>{
  const data=completeAnnotations(mark(),text,'甲',at),changed=text+'后记';
  assert.equal(annotationView(data,changed).pending.length,1);
  assert.equal(annotationView(data,changed).completed,false);
  const added=addAnnotation(data,changed,18,20,'甲',at,'b');
  assert.equal(added.passages[0].status,'needs-review');
});
test('removed passages and audit history survive; restore after edits is conservative',()=>{
  const data=mark(),removed=removeAnnotation(data,text,'a','乙',at);
  assert.equal(annotationView(removed,text).ranges.length,0);assert.equal(removed.passages[0].quote,data.passages[0].quote);
  const restored=restoreAnnotation(removed,text,'a','乙',at);assert.equal(annotationView(restored,text).ranges.length,1);
  const edited=rebaseAnnotations(removed,text,'新'+text,'甲',at);
  const uncertain=restoreAnnotation(edited,'新'+text,'a','甲',at);
  assert.equal(uncertain.passages[0].status,'needs-review');
  assert.deepEqual(uncertain.events.map(e=>e.action),['add','remove','text-edit','restore']);
});
test('non-BMP characters and overlapping selections cannot corrupt a passage',()=>{
  const source='甲𠮷字。';
  assert.throws(()=>mark(source,1,2),/选中/);
  assert.equal(mark(source,1,3).passages[0].quote,'𠮷');
  const data=mark();assert.throws(()=>addAnnotation(data,text,5,11,'甲',at,'b'),/重叠/);
  assert.throws(()=>mark('   ',0,3),/选中/);
  assert.throws(()=>addAnnotation(undefined,text,3,9,'',at,'b'),/姓名/);
});
test('empty completion is explicit, and later text edits revoke it',()=>{
  assert.equal(annotationView(undefined,text).label,'未确认');
  const data=completeAnnotations(undefined,text,'甲',at);
  assert.equal(annotationView(data,text).label,'已确认无书论');
  assert.equal(annotationView(rebaseAnnotations(data,text,text+'甲','甲',at),text+'甲').completed,false);
});
test('legacy backups pass unchanged; malformed annotation backups are rejected before restore',()=>{
  const legacy={version:1,part:3,reviews:{603:{question:'旧备注',collation:{text,metricBaseline:{text:'旧底稿'}},candidates:[{quote:'旧候选'}]}}};
  assert.deepEqual(validateProgress(structuredClone(legacy)),legacy);
  const bad={...legacy,reviews:{603:{theoryAnnotations:{...mark(),passages:[{...mark().passages[0],quote:'错误'}]}}}};
  assert.throws(()=>validateProgress(bad),/不匹配/);
  assert.throws(()=>validateAnnotations({...mark(),passages:[...mark().passages,...mark().passages]}),/编号/);
});
test('exports preserve full text, escape markup and distinguish untouched from confirmed empty pages',()=>{
  const source='<script>书者𠮷</script>\n=待核',data=addAnnotation(undefined,source,8,12,'=甲',at,'a');
  const pages=[{page:603,ocr:'旧OCR'},{page:604,ocr:'未处理'},{page:605,ocr:'空页'}];
  const reviews={603:{collation:{text:source},theoryAnnotations:data},605:{collation:{text:'空页'},theoryAnnotations:completeAnnotations(undefined,'空页','甲',at)}};
  const files=annotationFiles(pages,reviews,3,'<用户>');
  const html=files.find(f=>f.name.endsWith('html')).content;
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/<mark[^>]*>书者𠮷<\/mark>/u);
  assert.match(files[0].content,/"'=甲"/);assert.match(files[1].content,/未确认/);assert.match(files[1].content,/已确认无书论/);
  assert.deepEqual(annotationFiles(pages,{},3,'甲'),[]);
});
test('ZIP annotation exports respect assignment scope; full JSON retains transferred pages and history',async()=>{
  const pages=Array.from({length:249},(_,i)=>({page:528+i,local:i+1,ocr:text}));
  const progress={version:1,part:3,person:'甲',reviews:{603:{collation:{text,verified:true,checks:{wording:true}},theoryAnnotations:completeAnnotations(mark(),text,'甲',at)},700:{collation:{text:'移交旧草稿'},theoryAnnotations:completeAnnotations(undefined,'移交旧草稿','甲',at)}}};
  const before=JSON.stringify(progress),bundle=await buildAnnotationBundle({progress,pages,member:3,exportedAt:at});
  const out=spawnSync('python3',['-c',`import sys,io,zipfile,json,hashlib
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 m=json.loads(z.read('文件清单.json'))
 for f in m['files']: assert hashlib.sha256(z.read(f['name'])).hexdigest()==f['sha256']
 assert len(z.namelist())==6
 print(json.dumps({'backup':json.loads(z.read('第3份-初筛进度备份.json')),'html':z.read('第3份-原文书论标注.html').decode('utf-8-sig')},ensure_ascii=False))`],{input:bundle.bytes,encoding:'utf8',maxBuffer:3000000});
  assert.equal(out.status,0,out.stderr);const data=JSON.parse(out.stdout);
  assert.deepEqual(data.backup,progress);assert.doesNotMatch(data.html,/原 PDF 第 700 页/);assert.match(data.html,/原 PDF 第 603 页/);
  assert.equal(JSON.stringify(progress),before);
});

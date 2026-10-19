#!/usr/bin/env python3
"""Bounded, resumable offline production; never writes human review records."""
import argparse, base64, concurrent.futures as futures, copy, hashlib, importlib.util
import json, math, os, sys, threading, time, urllib.error, urllib.request
from pathlib import Path
from datetime import datetime, timezone

WORK=Path(__file__).resolve().parents[4]
TASK=Path(__file__).resolve().parents[2]
OCR=WORK/'tasks/2026-10-13-ocr-first100'
sys.path.insert(0,str(OCR))
sys.path.insert(0,str(Path(__file__).parent))
from ocr_review_pipeline import plan_units, complete_candidates, DEFAULT_MODELS
from ocr_review_store import file_sha
from importlib.machinery import SourceFileLoader
review=SourceFileLoader('review_fulltext',str(Path(__file__).with_name('review-fulltext.py'))).load_module()
REVISION='remaining-fulltext-20261019-v1'
PROMPT=review.PROMPT+'\n特别注意：页眉、书名、作者、底端印刷页码也属于完整转写，不能因为不是正文而省略；不得输出解释来替代图中文字。'
def now():return datetime.now(timezone.utc).isoformat()
def read(p):return json.loads(Path(p).read_text())
def write(p,v):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix('.tmp')
    tmp.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');tmp.replace(p)
def digest(v):return hashlib.sha256(v).hexdigest()
def progress(v):print(json.dumps(v,ensure_ascii=False),flush=True)
SMALL=None;MEDIUM=None
def initialize_ocr():
    global SMALL
    from rapidocr import RapidOCR,ModelType
    SMALL=RapidOCR(params={'Global.model_root_dir':str(DEFAULT_MODELS),'Global.log_level':'warning','Rec.model_type':ModelType('small'),'Rec.model_path':str(DEFAULT_MODELS/'PP-OCRv6_rec_small.onnx')})
def medium():
    global MEDIUM
    if MEDIUM is None:
        from rapidocr import RapidOCR,ModelType
        MEDIUM=RapidOCR(params={'Global.model_root_dir':str(DEFAULT_MODELS),'Global.log_level':'warning','Rec.model_type':ModelType('medium'),'Rec.model_path':str(DEFAULT_MODELS/'PP-OCRv6_rec_medium.onnx')})
    return MEDIUM
def prepare_page(row):
    from PIL import Image
    from run_ocr import recognize
    n=row['page'];out=TASK/'batch';target=out/f'machine/{n:04d}.json'
    if target.exists():
        m=read(target)
        if m.get('machineComplete') and m['sourceSha256']==row['sourceSha256']:return n
    image_path=WORK/row['image']
    if file_sha(image_path)!=row['sourceSha256']:raise ValueError('source image changed')
    baseline_path=out/f'baseline/{n:04d}.json'
    if baseline_path.exists():base=read(baseline_path)
    elif row['baselineCache']:base=read(row['baselineCache'])
    else:base=recognize(SMALL,n,row['part'],overlay=False)
    if base['source_sha256']!=row['sourceSha256']:raise ValueError('baseline image mismatch')
    write(baseline_path,base);image=Image.open(image_path).convert('RGB')
    units=plan_units(base,image,[])
    for u in units:
        boxes=u['originalBoxes']+(u['repairBoxes'] or [])
        if not boxes:boxes=[c['box'] for c in base['columns'] if c['column'] in u['columns']]
        box=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        complete_candidates(u,image,SMALL,medium)
        u['evidence']={'box':box}
    machine={'page':n,'part':row['part'],'sourceImage':row['image'],'sourceSha256':row['sourceSha256'],'reviewUnits':units,'machineComplete':True,
        'layoutPending':base['uncovered_ink_pixels']>max(500,base['ink_pixels']*.015),'baselineReused':bool(row['baselineCache'])}
    write(target,machine);progress({'stage':'ocr','page':n,'columns':len(base['columns']),'anomalies':len(units)})
    return n

class Budget:
    def __init__(self,root,scope):
        self.lock=threading.Lock();self.root=root;self.max_calls=scope['maxCalls'];self.max_usd=scope['maxUSDPeakReserved']
        old=[read(p) for p in (root/'requests').glob('*.json')];self.calls=len(old);self.reserved=sum(r['reservedUSDPeak'] for r in old)
    def take(self,reserve):
        with self.lock:
            if self.calls>=self.max_calls or self.reserved+reserve>self.max_usd:raise ValueError('total batch budget reached')
            self.calls+=1;self.reserved+=reserve
    def summary(self):return {'calls':self.calls,'reservedUSDPeak':self.reserved}

def decode_answers(data,ids):
    # Empty text is valid only for an explicitly pending region. Keep its
    # baseline later; never force the model to invent a transcription of a figure.
    checked=copy.deepcopy(data)
    rows=json.loads(checked['choices'][0]['message']['content'])['results']
    for row in rows:
        if row.get('status')=='pending' and row.get('text')=='':row['text']='□'
    checked['choices'][0]['message']['content']=json.dumps({'results':rows},ensure_ascii=False)
    answers=review.answers_for(checked,ids)
    original=json.loads(data['choices'][0]['message']['content'])['results']
    for row in original:answers[row['id']]['text']=row['text']
    return answers

def estimate(usage):
    hit=usage.get('prompt_cache_hit_tokens',0);miss=usage.get('prompt_cache_miss_tokens',usage['prompt_tokens']-hit);out=usage['completion_tokens']
    if any(type(v)is not int or v<0 for v in [hit,miss,out]):raise ValueError('bad usage')
    return (hit*.006+miss*.3+out*1.2)/1e6

def review_page(n,root,budget,key):
    from PIL import Image
    result_path=root/f'pages/{n:04d}.json'
    if result_path.exists():return n
    base=read(root/f'baseline/{n:04d}.json');machine=read(root/f'machine/{n:04d}.json');source=WORK/machine['sourceImage']
    if file_sha(source)!=machine['sourceSha256']:raise ValueError('source changed before upload')
    image=Image.open(source).convert('RGB');units=review.units_for(base,machine)
    if not units:
        units=[{'id':f'p{n:04d}-whole','columns':[1],'baselineText':'□','candidates':[],
            'evidence':{'box':[0,0,image.width,image.height]},'unitType':'whole-page'}]
    prior=sorted((root/'requests').glob(f'{n:04d}-*.json'))
    # Keep existing request bindings byte-identical. Only unseen pages change
    # their positioning preview codec; every recognition crop stays lossless PNG.
    suffix=Path(read(prior[0])['images'][0]['path']).suffix if prior else '.jpg'
    context=root/f'images/{n:04d}-context{suffix}';context.parent.mkdir(exist_ok=True)
    thumbnail=image.copy();thumbnail.thumbnail((1000,1500))
    if suffix=='.jpg':thumbnail.save(context,'JPEG',quality=90,optimize=True)
    else:thumbnail.save(context)
    answers={};records=[]
    for offset in range(0,len(units),3):
        group=units[offset:offset+3];inputs=[];images=[context]
        for u in group:
            # A machine failure has a literal unreadable marker, not a fake blank.
            if not u['baselineText'].strip():u['baselineText']='□'
            box=u['evidence']['box']
            if not (0<=box[0]<box[2]<=image.width and 0<=box[1]<box[3]<=image.height):raise ValueError('crop outside image')
            crop=root/f"images/{u['id']}.png";image.crop(box).save(crop);images.append(crop)
            inputs.append({'id':u['id'],'columns':u['columns'],'baseline':u['baselineText'],
                'candidates':[{'id':c['id'],'text':c['text']} for c in u['candidates'] if c['status']=='ok']})
        prompt=PROMPT+json.dumps(inputs,ensure_ascii=False)
        evidence={'page':n,'ids':[u['id'] for u in group],'sourceSha256':machine['sourceSha256'],'prompt':prompt,
            'images':[{'path':str(p.relative_to(root)),'sha256':file_sha(p)} for p in images],'model':review.MODEL,'endpoint':review.ENDPOINT}
        binding=digest(json.dumps(evidence,sort_keys=True,ensure_ascii=False).encode())
        successful=None
        for attempt in range(3):
            record_path=root/f'requests/{n:04d}-{offset//3:02d}-{attempt}.json'
            if record_path.exists():
                record=read(record_path)
                if record['binding']!=binding:raise ValueError('request inputs changed')
                if record['status']=='ok':successful=(record_path,record);break
                if record['status']=='in_flight':
                    resolution_path=root/'request-resolutions'/record_path.name
                    resolution=read(resolution_path) if resolution_path.exists() else {}
                    if resolution.get('authorizedRetry') is True and resolution.get('requestRecordSha256')==file_sha(record_path) and resolution.get('binding')==binding:
                        continue
                    raise ValueError('interrupted request billing unknown; explicit resolution required')
                if not record.get('retryable',False):raise ValueError('non-retryable prior request')
                continue
            reserve=((len(prompt.encode())+len(images)*1024+1024)*.3+4096*1.2)/1e6
            budget.take(reserve);record={**evidence,'binding':binding,'status':'in_flight','startedAt':now(),'reservedUSDPeak':reserve,'attempt':attempt,'retryPolicy':'max3; retry network/429/5xx/invalid-output; unknown usage reserved; no resend interrupted in_flight'}
            write(record_path,record);clock=time.perf_counter()
            content=[{'type':'text','text':prompt}]+[{'type':'image_url','image_url':{'url':('data:image/jpeg;base64,' if p.suffix=='.jpg' else 'data:image/png;base64,')+base64.b64encode(p.read_bytes()).decode()}} for p in images]
            payload={'model':review.MODEL,'thinking':{'type':'disabled'},'temperature':0,'max_tokens':4096,'response_format':{'type':'json_object'},'messages':[{'role':'user','content':content}]}
            try:
                req=urllib.request.Request(review.ENDPOINT,data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
                with urllib.request.build_opener(review.NoRedirect).open(req,timeout=45) as response:
                    record['rawResponse']=json.load(response);record['httpStatus']=response.status;record['requestId']=response.headers.get('x-request-id')
                data=record['rawResponse'];record.update(usage=data.get('usage',{}),returnedModel=data.get('model'))
                record['estimatedUSDPeak']=estimate(record['usage']);decode_answers(data,record['ids'])
                record.update(status='ok',retryable=False)
            except urllib.error.HTTPError as error:record.update(status='http_error',httpStatus=error.code,errorType=type(error).__name__,retryable=error.code==429 or error.code>=500)
            except Exception as error:record.update(status='failed',errorType=type(error).__name__,retryable=True)
            finally:
                record.update(endedAt=now(),wallSeconds=time.perf_counter()-clock);write(record_path,record)
            if record['status']=='ok':successful=(record_path,record);break
            if not record['retryable']:break
            time.sleep(min(2**attempt,4))
        if successful is None:raise ValueError(f'request failed page {n}, group {offset//3}')
        path,record=successful;answers.update(decode_answers(record['rawResponse'],record['ids']));records.append((path,record))
    rows=[]
    for u in units:
        a=answers[u['id']];text=a['text'] if a['status']=='reviewed' else u['baselineText'];status=a['status'];note=a['note']
        # Avoid quietly publishing large omissions; preserve the original candidate.
        before=''.join(u['baselineText'].split());after=''.join(text.split())
        omitted=len(before)>12 and len(after)<len(before)*.65
        if omitted:status='pending';text=u['baselineText'];note+='；自动长度保护：输出明显缩短，保留small供人工核对。'
        rows.append({'id':u['id'],'columns':u['columns'],'box':u['evidence']['box'],'baseline':u['baselineText'],'text':text,'status':status,'note':note,
            **({'unitType':'whole-page'} if u.get('unitType') else {})})
    page={'page':n,'revision':REVISION,'reviewedAt':max(r['endedAt'] for _,r in records),'model':review.MODEL,'machineModel':'PP-OCRv6 small',
        'sourceSha256':machine['sourceSha256'],'columnCount':sum(len(u['columns']) for u in rows),'reviewedColumnCount':sum(len(u['columns']) for u in rows),
        'detectedColumnCount':len(base['columns']),'humanConfirmed':False,'status':'待人工全文检查','units':rows,
        'text':'\n'.join(f'[{i+1:03d}] {u["text"]}' for i,u in enumerate(rows)),
        'requests':[{'id':p.stem,'sha256':file_sha(p),'seconds':r['wallSeconds'],'estimatedUSDPeak':r['estimatedUSDPeak'],'usage':r['usage'],'unitIds':r['ids']} for p,r in records]}
    write(result_path,page);progress({'stage':'review','page':n,'columns':page['columnCount'],'requests':len(records),'costPeak':sum(r['estimatedUSDPeak'] for _,r in records)})
    return n

def main(args):
    scope=read(TASK/'scope.json');root=TASK/'batch';root.mkdir(exist_ok=True)
    configuration={'scopeSha256':file_sha(TASK/'scope.json'),'scriptSha256':file_sha(__file__),'promptSha256':digest(PROMPT.encode()),
        'weights':{s:file_sha(DEFAULT_MODELS/f'PP-OCRv6_rec_{s}.onnx') for s in ['small','medium']},'endpoint':review.ENDPOINT,'model':review.MODEL,
        'humanRecordsWritten':False,'maxAttemptsPerGroup':3,'requestConcurrency':args.request_workers,'resumeFromConfigurationSha256':args.resume_config,'newPageContextCodec':'JPEG-quality90-preview-only','recognitionCropCodec':'lossless-PNG-source-pixels'}
    manifest=root/'configuration.json'
    if manifest.exists() and read(manifest)!=configuration:
        previous=file_sha(manifest)
        if args.resume_config!=previous:raise ValueError('frozen batch configuration changed; explicit fingerprint required')
        archive=root/'configuration-history'/f'{previous}.json'
        if not archive.exists():write(archive,read(manifest))
    write(manifest,configuration);budget=Budget(root,scope)
    config={}
    for line in (WORK/'tasks/2026-06-03-calligraphy-table-focus/calligraphy-online-site/.env.local').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.split('=',1);config[k.strip()]=v.strip().strip('\"\'')
    if config.get('MODEL_API_URL')!=review.ENDPOINT:raise ValueError('endpoint mismatch')
    key=os.environ.get('DEEPSEEK_API_KEY') or config.get('MODEL_API_KEY')
    if not key:raise ValueError('missing official API key')
    failures=[];review_futures=[];start=time.perf_counter()
    with futures.ProcessPoolExecutor(max_workers=scope['ocrProcesses'],initializer=initialize_ocr) as cpu, futures.ThreadPoolExecutor(max_workers=args.request_workers) as net:
        tasks={cpu.submit(prepare_page,row):row for row in scope['pages']}
        for f in futures.as_completed(tasks):
            row=tasks[f]
            try:n=f.result();review_futures.append(net.submit(review_page,n,root,budget,key))
            except Exception as error:failures.append({'page':row['page'],'stage':'ocr','errorType':type(error).__name__,'error':str(error)[:200]})
            done=list((root/'pages').glob('*.json'))
            write(root/'progress.json',{'ocrFinished':sum(f.done() for f in tasks),'reviewedPages':len(done),'total':len(tasks),**budget.summary(),'failures':failures,'seconds':time.perf_counter()-start,'updatedAt':now()})
        for f in futures.as_completed(review_futures):
            try:f.result()
            except Exception as error:failures.append({'stage':'review','errorType':type(error).__name__,'error':str(error)[:200]})
    pages=[read(p) for p in sorted((root/'pages').glob('*.json'))]
    for part in range(1,5):write(root/f'part-{part}-model-reviewed.json',{'version':1,'part':part,'pages':[p for p in pages if next(r['part'] for r in scope['pages'] if r['page']==p['page'])==part]})
    records=[read(p) for p in (root/'requests').glob('*.json')]
    write(root/'summary.json',{'totalPages':len(scope['pages']),'reviewedPages':len(pages),'failures':failures,'calls':len(records),
        'estimatedUSDPeak':sum(r.get('estimatedUSDPeak',0) for r in records),'unknownBillingRequests':sum('estimatedUSDPeak' not in r for r in records),
        'apiWallSeconds':sum(r.get('wallSeconds',0) for r in records),'elapsedSecondsThisExecution':time.perf_counter()-start,
        'elapsedSecondsFromFirstRequest':(datetime.now(timezone.utc)-min(datetime.fromisoformat(r['startedAt']) for r in records)).total_seconds(),
        'maxUSDPeakIncludingUnknown':sum(r.get('estimatedUSDPeak',r['reservedUSDPeak']) for r in records),**budget.summary()})
    progress(read(root/'summary.json'))
    if failures or len(pages)!=len(scope['pages']):raise SystemExit(2)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--request-workers',type=int,default=8);parser.add_argument('--resume-config')
    args=parser.parse_args()
    if not 1<=args.request_workers<=32:parser.error('request workers must be1..32')
    lock=TASK/'batch.lock';fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:main(args)
    finally:os.close(fd);lock.unlink()

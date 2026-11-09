"""Small-default OCR with targeted geometry candidates and on-demand medium review."""
from pathlib import Path
import argparse, copy, importlib.metadata, json, math, sys, uuid
import numpy as np
from PIL import Image
from ocr_character_map import SCHEMA, recognition_glyphs
from ocr_review_store import atomic_json, atomic_bytes, export_run, file_sha, fingerprint, locked, now, read

WORK=Path(__file__).resolve().parents[2]
DEFAULT_MODELS=WORK/'tasks/2026-10-13-ocr-benchmark-20/models'
POLICY={'version':'small-targeted-review-v2-numeral-crops','lowConfidence':.93,'inkThreshold':160,
        'emptyInkPixels':100,'edgeInkPixels':8,'padding':8,'cutSearch':35,
        'highConfidenceAuditFraction':.02,'highConfidenceThreshold':.97,
        'automaticAdoption':False,'unit':'whole column or explicitly consumed column group'}

def recognize_boxes(engine,image,boxes):
    text=[];scores=[];glyphs=[]
    for index,box in enumerate(boxes,1):
        crop=image.crop(box).rotate(90,expand=True)
        output=engine(crop,use_det=False,use_cls=False,return_word_box=True,return_single_char_box=True)
        text.append(''.join(output.txts or []))
        if output.scores is not None:scores.extend(float(x) for x in output.scores)
        if hasattr(output,'word_results'):
            located,_=recognition_glyphs(output,crop.size,box)
            for g in located:g['piece']=index
            glyphs.extend(located)
    return ''.join(text),scores,glyphs

def trim_blank_margins(image,boxes):
    """Retain every dark pixel; trim only excessive leading/trailing whitespace."""
    ink=np.asarray(image.convert('L'))<POLICY['inkThreshold'];trimmed=[]
    for left,top,right,bottom in boxes:
        rows=np.flatnonzero(ink[top:bottom,left:right].any(axis=1))
        nt,nb=top,bottom
        if len(rows):
            # Do not split internal whitespace: 二/三 contain disconnected strokes.
            if int(rows[0])>2*(right-left):nt=top+int(rows[0])-5
            if bottom-top-1-int(rows[-1])>2*(right-left):nb=top+int(rows[-1])+6
        trimmed.append([left,nt,right,nb])
    return trimmed

def joined_numeral_boxes(columns):
    boxes=[]
    for column in columns:
        previous=None
        for piece in column['pieces']:
            box=list(piece['box'])
            if (previous and previous.get('text','')[-1:] in ['一','二','三']
                    and piece.get('text','')[:1] in ['一','二','三']
                    and boxes[-1][0::2]==box[0::2] and boxes[-1][3]==box[1]):
                boxes[-1][3]=box[3]
            else:boxes.append(box)
            previous=piece
    return boxes

def flags_for(column,image,uid,policy=POLICY):
    flags=[];ink=np.asarray(image.convert('L'))<policy['inkThreshold']
    scores=[float(s) for p in column['pieces'] for s in p.get('scores',[]) if math.isfinite(float(s))]
    if not scores and column['text']:flags.append('识别无有效置信分')
    if scores and min(scores)<policy['lowConfidence']:flags.append('低分待复核（非错误判定）')
    for piece in column['pieces']:
        l,t,r,b=piece['box'];a=ink[t:b,l:r]
        if int(a.sum())>=policy['emptyInkPixels'] and not any('\u3400'<=c<='\u9fff' or '\U00020000'<=c<='\U0003134f' for c in piece['text']):
            flags.append('有墨迹但无汉字输出·可能图示或截字')
        if a.size and max(int(a[:2].sum()),int(a[-2:].sum()),int(a[:,:2].sum()),int(a[:,-2:].sum()))>=policy['edgeInkPixels']:
            flags.append('裁框边界有墨迹')
    if column['box'][2]-column['box'][0]>110:flags.append('宽栏·需核版面')
    boxes=[p['box'] for p in column['pieces']]
    if trim_blank_margins(image,boxes)!=boxes:flags.append('裁片首尾留白过长·需复核数字及短文本')
    if joined_numeral_boxes([column])!=boxes:flags.append('相邻裁片数字疑似拆字·须回图核对')
    # A deterministic exploration sample is retained even at high scores.
    if scores and min(scores)>=policy['highConfidenceThreshold'] and int(fingerprint(uid)[:8],16)/0xffffffff<policy['highConfidenceAuditFraction']:
        flags.append('高分抽查（不代表已发现错误）')
    return sorted(set(flags))

def repaired_boxes(column,columns,image,policy=POLICY):
    left,top,right,bottom=column['box'];w,h=image.size;p=policy['padding']
    # Never merge adjacent projection columns automatically.
    lower=[c['box'][2] for c in columns if c['box'][2]<=left]
    upper=[c['box'][0] for c in columns if c['box'][0]>=right]
    minleft=(max(lower)+left)//2 if lower else 20
    maxright=(right+min(upper))//2 if upper else w-20
    nl,nr=max(minleft,left-p),min(maxright,right+p)
    nt,nb=max(30,top-p),min(h-30,bottom+p)
    a=np.asarray(image.convert('L'))<policy['inkThreshold'];ink=a[:,nl:nr].sum(axis=1)
    points=[nt]
    for part in column['pieces'][:-1]:
        cut=part['box'][3];radius=policy['cutSearch']
        lo,hi=max(points[-1]+1,cut-radius),min(nb-1,cut+radius+1)
        groups=[]
        for y in np.flatnonzero(ink[lo:hi]==0)+lo:
            if not groups or y>groups[-1][-1]+1:groups.append([int(y)])
            else:groups[-1].append(int(y))
        best=min(groups,key=lambda g:(-len(g),abs((g[0]+g[-1])/2-cut),g[0])) if groups else [cut]
        points.append((best[0]+best[-1])//2)
    points.append(nb)
    boxes=[[nl,a,nr,b] for a,b in zip(points[:-1],points[1:])]
    return boxes if all(0<=l<r<=w and 0<=t<b<=h for l,t,r,b in boxes) else [p['box'] for p in column['pieces']]

def validate_plan(entries,baseline,image):
    by_col={c['column']:c for c in baseline['columns']};consumed=set()
    for item in entries:
        cols=item['columns'];boxes=item.get('boxes')
        if item.get('sourceSha256')!=baseline['source_sha256']:raise ValueError('修框计划源图哈希不匹配。')
        if not cols or cols!=sorted(set(cols)) or not set(cols)<=by_col.keys() or consumed.intersection(cols):raise ValueError('修框消费栏无效或重复。')
        if len(cols)>1 and cols!=list(range(min(cols),max(cols)+1)):raise ValueError('只允许显式合并相邻栏。')
        if not item.get('reason','').strip():raise ValueError('显式复核须记录图像依据。')
        if boxes is None:
            consumed.update(cols)
            continue
        if not boxes or any(len(b)!=4 or not all(type(x) is int for x in b) or not(0<=b[0]<b[2]<=image.width and 0<=b[1]<b[3]<=image.height) for b in boxes):raise ValueError('修框坐标无效。')
        if len(boxes)>1 and any(a[3]!=b[1] or a[0]!=b[0] or a[2]!=b[2] for a,b in zip(boxes,boxes[1:])):raise ValueError('修框短段必须连续且无重叠。')
        if not item.get('reason','').strip():raise ValueError('显式修框须记录图像依据。')
        union=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
        if any(not(union[0]<=by_col[c]['box'][0] and union[1]<=by_col[c]['box'][1] and union[2]>=by_col[c]['box'][2] and union[3]>=by_col[c]['box'][3]) for c in cols):
            raise ValueError('显式修框必须覆盖被消费栏的全部原框，避免删除未复核正文。')
        consumed.update(cols)
    return consumed

def plan_units(baseline,image,entries,policy=POLICY):
    consumed=validate_plan(entries,baseline,image);units=[];by_col={c['column']:c for c in baseline['columns']}
    specs=[(x['columns'],x.get('boxes'),[('显式裁框修复：' if x.get('boxes') is not None else '显式medium复核：')+x['reason']]) for x in entries]
    for c in baseline['columns']:
        if c['column'] in consumed:continue
        uid=f'p{baseline["source_page"]:04d}-c{c["column"]:02d}';flags=flags_for(c,image,uid,policy)
        if not flags:continue
        geometric=any('墨迹' in flag for flag in flags)
        boxes=repaired_boxes(c,baseline['columns'],image,policy) if geometric and c['box'][2]-c['box'][0]<=110 else None
        specs.append(([c['column']],boxes,flags))
    for cols,repair,flags in sorted(specs,key=lambda x:x[0][0]):
        group=[by_col[c] for c in cols];boxes=[p['box'] for c in group for p in c['pieces']]
        uid=f'p{baseline["source_page"]:04d}-c'+ '-'.join(f'{c:02d}' for c in cols)
        text='\n'.join(c['text'] for c in group if c['text'])
        units.append(dict(id=uid,columns=cols,flags=flags,baselineText=text,originalBoxes=boxes,
                          repairBoxes=repair if repair!=boxes else None,
                          joinBoxes=joined_numeral_boxes(group) if joined_numeral_boxes(group)!=boxes else None,
                          candidates=[dict(id='baseline_small',status='ok',text=text,scores=[s for c in group for p in c['pieces'] for s in p.get('scores',[])],boxes=boxes,attemptedAt=now(),model='small')]))
    for unit in units:
        unit['candidates'][0]['glyphs']=[g for c in unit['columns'] for g in by_col[c].get('glyphs',[])]
    return units

def complete_candidates(unit,image,small,get_medium,retry_failed=False):
    specs=[('baseline_medium','medium',unit['originalBoxes'])]
    if unit['repairBoxes']:
        specs=[('repaired_small','small',unit['repairBoxes'])]+specs+[('repaired_medium','medium',unit['repairBoxes'])]
    trimmed=trim_blank_margins(image,unit['originalBoxes'])
    if trimmed!=unit['originalBoxes']:
        specs += [('trimmed_small','small',trimmed),('trimmed_medium','medium',trimmed)]
    if unit.get('joinBoxes'):
        specs += [('joined_small','small',unit['joinBoxes']),('joined_medium','medium',unit['joinBoxes'])]
    for cid,model,boxes in specs:
        old=[c for c in unit['candidates'] if c['id']==cid]
        if old and (old[-1]['status']=='ok' or not retry_failed):continue
        attempt=dict(id=cid,model=model,boxes=boxes,attemptedAt=now())
        try:
            text,scores,glyphs=recognize_boxes(small if model=='small' else get_medium(),image,boxes)
            if not text.strip():raise ValueError('候选为空，保留基线并待核图示/噪声或文字。')
            for gi,g in enumerate(glyphs):g.update(id=f'{unit["id"]}-{cid}-g{gi+1:04d}',column=unit['columns'][0])
            attempt.update(status='ok',text=text,scores=scores,glyphs=glyphs)
        except Exception as error:attempt.update(status='failed',error=str(error),text='',scores=[])
        # Keep all prior failures but give each selectable candidate a unique current id.
        if old:
            unit.setdefault('attemptHistory',[]).extend(copy.deepcopy(old))
            unit['candidates']=[c for c in unit['candidates'] if c['id']!=cid]
        unit['candidates'].append(attempt)
    successful=[c['text'] for c in unit['candidates'] if c['status']=='ok']
    unit['agreement']=len(successful)>1 and len(set(successful))==1
    return unit

def run_batch(directory,pages,recognize,parts,models=DEFAULT_MODELS,repair_plan=None,retry_failed=False):
    from rapidocr import RapidOCR,ModelType
    directory=Path(directory).resolve();models=Path(models).resolve();pages=sorted(set(pages))
    if not pages or any(type(p) is not int or not 1<=p<=1052 for p in pages):raise ValueError('页码必须在1—1052。')
    weights={size:models/f'PP-OCRv6_rec_{size}.onnx' for size in ['small','medium']}
    if any(not p.is_file() for p in weights.values()):raise ValueError('需要已下载的small与medium本机权重，不自动联网下载。')
    plan=read(repair_plan) if repair_plan else []
    if not isinstance(plan,list) or any(x.get('page') not in pages for x in plan):raise ValueError('修框计划必须属于本批选定页面。')
    sources=[dict(page=n,path=f'tasks/2026-09-28-shulun-fullbook-screening/images/page-{n-1:03d}.jpg',sha256=file_sha(WORK/f'tasks/2026-09-28-shulun-fullbook-screening/images/page-{n-1:03d}.jpg')) for n in pages]
    config=dict(policy=POLICY,pages=pages,sources=sources,repairPlan=plan,
                characterMapping=dict(schema=SCHEMA,required=True,coordinateUnit='original-image-pixel-edges',textOffsetUnit='UTF-16',directory='character-maps',index='character-map-index.json',humanReviewed=False),
                weights={k:dict(path=str(v),sha256=file_sha(v)) for k,v in weights.items()},
                dependencies={n:importlib.metadata.version(n) for n in ['rapidocr','onnxruntime','numpy','pillow']},
                scripts={n:file_sha(Path(__file__).with_name(n)) for n in ['run_ocr.py','ocr_review_pipeline.py','ocr_review_store.py','ocr_character_map.py']})
    with locked(directory):
        manifest_file=directory/'manifest.json'
        if manifest_file.exists():
            manifest=read(manifest_file)
            if manifest['configurationFingerprint']!=fingerprint(config):raise ValueError('本批参数、代码、模型或源图已变化，请使用新输出目录。')
        else:
            if any(p.name!='.review.lock' for p in directory.iterdir()):raise ValueError('新批次输出目录必须为空，不能覆盖历史材料。')
            manifest=dict(schemaVersion=1,runId=uuid.uuid4().hex,createdAt=now(),workspace=str(WORK),pages=pages,
                          configuration=config,configurationFingerprint=fingerprint(config),networkUpload=False,automaticAdoption=False)
            atomic_json(manifest_file,manifest)
        def make_engine(size):
            return RapidOCR(params={'Global.model_root_dir':str(models),'Global.log_level':'warning',
                'Rec.model_type':ModelType(size),'Rec.model_path':str(weights[size])})
        small=None;medium=None
        def get_medium():
            nonlocal medium
            if medium is None:medium=make_engine('medium')
            return medium
        for source in sources:
            n=source['page'];target=directory/'machine'/f'{n:04d}.json';baseline_path=directory/'baseline'/f'{n:04d}.json'
            if target.exists() and read(target).get('machineComplete') and not retry_failed:continue
            try:
                if baseline_path.exists():baseline=read(baseline_path)
                else:
                    if small is None:small=make_engine('small')
                    part=next(i for i,(a,b) in enumerate([(1,258),(259,527),(528,776),(777,1052)],1) if a<=n<=b)
                    baseline=recognize(small,n,part,overlay=False)
                if baseline.get('source_page')!=n:raise ValueError('逐字映射页身份与批次不一致。')
                if baseline['source_sha256']!=source['sha256']:raise ValueError('识别源图哈希发生变化。')
                if baseline.get('characterMappingSchema')!=SCHEMA or any(not isinstance(c.get('glyphs'),list) for c in baseline['columns']):
                    raise ValueError('新OCR批次必须保留逐字映射元数据；请使用支持字符定位的识别入口。')
                if baseline.get('source_image')!=source['path']:raise ValueError('逐字映射原图路径与批次不一致。')
                image=Image.open(WORK/source['path']).convert('RGB')
                if baseline.get('image_size')!=list(image.size):raise ValueError('逐字映射原图尺寸与批次不一致。')
                if not baseline_path.exists():atomic_json(baseline_path,baseline)
                if target.exists():machine=read(target)
                else:
                    units=plan_units(baseline,image,[x for x in plan if x['page']==n])
                    layout_pending=baseline['uncovered_ink_pixels']>max(500,baseline['ink_pixels']*.015) or (not baseline['columns'] and baseline['ink_pixels']>500)
                    machine=dict(page=n,sourceImage=source['path'],sourceSha256=source['sha256'],baselineFile=str(baseline_path.relative_to(directory)),reviewUnits=units,machineComplete=False,layoutPending=layout_pending)
                    for unit in units:
                        boxes=unit['originalBoxes']+(unit['repairBoxes'] or [])
                        box=[min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]
                        name=f'crops/{unit["id"]}.png';path=directory/name;path.parent.mkdir(exist_ok=True)
                        image.crop(box).save(path);unit['evidence']=dict(path=name,sha256=file_sha(path),box=box)
                    atomic_json(target,machine)
                for unit in machine['reviewUnits']:
                    if small is None:small=make_engine('small')
                    complete_candidates(unit,image,small,get_medium,retry_failed)
                    atomic_json(target,machine)  # Safe resume after each review unit.
                machine['machineComplete']=True
                atomic_json(target,machine)
                print(json.dumps({'page':n,'reviewUnits':len(machine['reviewUnits']),'status':'候选已生成，未自动采纳'},ensure_ascii=False),flush=True)
            except Exception as error:
                atomic_json(directory/'failures'/f'{n:04d}-{uuid.uuid4().hex}.json',dict(page=n,error=str(error),at=now()))
                print(json.dumps({'page':n,'error':str(error)},ensure_ascii=False),flush=True)
        return export_run(directory)

def batch_cli(recognize,parts):
    parser=argparse.ArgumentParser(description='small默认＋定向候选＋大模型待核建议；仅人工确认可采纳。')
    selection=parser.add_mutually_exclusive_group(required=True);selection.add_argument('--pages');selection.add_argument('--all',action='store_true')
    parser.add_argument('--output',type=Path);parser.add_argument('--models',type=Path,default=DEFAULT_MODELS)
    parser.add_argument('--repair-plan',type=Path);parser.add_argument('--retry-failed',action='store_true')
    parser.add_argument('--no-vlm',action='store_true',help='只运行本机OCR，不请求大模型')
    parser.add_argument('--vlm-max-calls',type=int,default=12);parser.add_argument('--vlm-max-usd',type=float,default=.25)
    parser.add_argument('--vlm-retry-failed',action='store_true');args=parser.parse_args()
    pages=[n for p in parts.values() for n in p] if args.all else [int(x) for x in args.pages.split(',')]
    output=args.output or Path(__file__).parent/'runs'/('reviewed-'+uuid.uuid4().hex[:12])
    try:
        result=run_batch(output,pages,recognize,parts,args.models,args.repair_plan,args.retry_failed)
        if not args.no_vlm:
            from ocr_vlm_review import run_suggestions
            result=run_suggestions(output,args.vlm_max_calls,args.vlm_max_usd,args.vlm_retry_failed)
        print(json.dumps({'output':str(output),'counts':result['counts'],'failedPages':result['failedPages'],'vlm':result.get('vlmSummary'),'characterMapping':result.get('characterMapping')},ensure_ascii=False))
        if result['failedPages'] or result['counts']['review_failed']:raise SystemExit(2)
        if any(result.get('vlmSummary',{}).get('counts',{}).get(k,0) for k in ['failed','configuration_missing','stale_input']):raise SystemExit(2)
    except (ValueError,OSError) as error:parser.error(str(error))

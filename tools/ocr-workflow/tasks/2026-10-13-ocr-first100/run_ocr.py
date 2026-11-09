"""Versioned image OCR. Never opens member drafts or rewrites published source data."""
from pathlib import Path
import argparse, csv, hashlib, importlib.metadata, json, re, sys, time
import numpy as np
from PIL import Image, ImageDraw
from rapidocr import RapidOCR
from ocr_character_map import SCHEMA, recognition_glyphs

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent.parent
IMAGES = WORK / 'tasks/2026-09-28-shulun-fullbook-screening/images'
SITE = WORK / 'tasks/2026-06-03-calligraphy-table-focus/calligraphy-online-site'
PARTS = {1: [5,6]+list(range(13,111)), 2:list(range(259,359)),
         3:list(range(528,628)), 4:list(range(777,877))}
STARTS = {1:1,2:259,3:528,4:777}
VERSION = 'rapid-columns-20261013-v1'

def sha(data): return hashlib.sha256(data).hexdigest()
def han(text): return len(re.findall(r'[\u3400-\u9fff\U00020000-\U0003134f]',text))
def dump(path,data):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');temp.replace(path)

def groups(active,gap):
    out=[]
    for p in active:
        if not out or p-out[-1][-1]>gap: out.append([int(p)])
        else: out[-1].append(int(p))
    return out

def recognize(engine,page,part,overlay=False):
    start=time.monotonic(); path=IMAGES/f'page-{page-1:03d}.jpg'
    im=Image.open(path).convert('RGB'); w,h=im.size
    a=np.array(im.convert('L'))<160
    # Keep all text including headings/marginal folios. Only discard scan edges.
    top,bottom=30,h-30
    projection=a[top:bottom].sum(axis=0)
    active=np.flatnonzero(projection>20)
    cols=[(g[0],g[-1]+1) for g in groups(active,14) if g[-1]-g[0]>=3 and g[0]>20 and g[-1]<w-20]
    results=[]; warnings=[]
    for ci,(x1,x2) in enumerate(reversed(cols),1):
        left,right=max(0,x1-5),min(w,x2+5)
        ink=a[:,left:right].sum(axis=1)
        ys=np.flatnonzero(ink[top:bottom]>2)+top
        if not len(ys):continue
        if x2-x1>100: warnings.append(f'wide_column:{ci}:{x2-x1}')
        ctop,cbottom=max(top,int(ys[0])-5),min(bottom,int(ys[-1])+6)
        points=[ctop]
        while cbottom-points[-1]>550:
            lo,hi=points[-1]+385,min(cbottom-100,points[-1]+515)
            score=np.convolve(ink[lo:hi],np.ones(7),mode='same')
            points.append(lo+int(np.argmin(score)))
        points.append(cbottom); pieces=[]
        for y1,y2 in zip(points[:-1],points[1:]):
            if int(a[y1:y2,left:right].sum())<25: continue
            crop=im.crop((left,y1,right,y2)).rotate(90,expand=True)
            out=engine(crop,use_det=False,use_cls=False,return_word_box=True,return_single_char_box=True)
            text=''.join(out.txts or [])
            scores=list(map(float,[] if out.scores is None else out.scores))
            glyphs,geometry_warning=recognition_glyphs(out,crop.size,[left,y1,right,y2])
            for gi,g in enumerate(glyphs):g.update(id=f'p{page:04d}-c{ci:02d}-s{len(pieces)+1:02d}-g{gi+1:04d}',column=ci,piece=len(pieces)+1)
            pieces.append({'box':[left,y1,right,y2],'text':text,'scores':scores,'glyphs':glyphs})
            if geometry_warning:warnings.append(f'{geometry_warning}:{ci}:{y1}')
            if not text: warnings.append(f'empty_piece:{ci}:{y1}')
            elif scores and min(scores)<0.8: warnings.append(f'low_confidence:{ci}:{y1}')
        results.append({'column':ci,'box':[left,ctop,right,cbottom],
                        'pieces':pieces,'text':''.join(p['text'] for p in pieces),
                        'glyphs':[g for p in pieces for g in p['glyphs']]})
    text='\n'.join(c['text'] for c in results if c['text'])
    covered=np.zeros(a.shape,dtype=bool)
    for col in results:
        l,t,r,b=col['box'];covered[t:b,l:r]=True
    core=a[30:-30,30:-30]; missed=(a & ~covered)[30:-30,30:-30]
    record={'version':VERSION,'characterMappingSchema':SCHEMA,'part':part,'source_page':page,'task_ordinal':PARTS[part].index(page)+1 if page in PARTS[part] else page-STARTS[part]+1,
            'source_image':str(path.relative_to(WORK)), 'source_sha256':sha(path.read_bytes()),
            'image_size':[w,h],'columns':results,'text':text,'han_count':han(text),
            'ink_pixels':int(core.sum()),'uncovered_ink_pixels':int(missed.sum()),
            'warnings':warnings,'status':'recognized' if text else 'blank_candidate',
            'seconds':round(time.monotonic()-start,3),'manually_corrected':False}
    if not text and int(core.sum())>500: record['warnings'].append('nonblank_without_text')
    if overlay:
        draw=ImageDraw.Draw(im)
        for c in results:
            draw.rectangle(c['box'],outline='red',width=2)
            draw.text((c['box'][0],max(0,c['box'][1]-15)),str(c['column']),fill='blue')
            for p in c['pieces']:draw.rectangle(p['box'],outline='blue',width=1)
        im.thumbnail((760,1200));im.save(ROOT/'checks'/f'page-{page:04d}.jpg')
    return record

def main():
    # The normal entry now writes versioned runs with targeted review. Preserve
    # the historical v1 runner only behind an explicit reproduction flag.
    if '--legacy' not in sys.argv:
        from ocr_review_pipeline import batch_cli
        return batch_cli(recognize,PARTS)
    sys.argv.remove('--legacy')
    p=argparse.ArgumentParser();p.add_argument('--pages');p.add_argument('--all',action='store_true');args=p.parse_args()
    (ROOT/'pages').mkdir(exist_ok=True);(ROOT/'checks').mkdir(exist_ok=True)
    pages=[n for v in PARTS.values() for n in v] if args.all else [int(x) for x in args.pages.split(',')]
    engine=RapidOCR(params={'Global.log_level':'warning'})
    models=Path(importlib.import_module('rapidocr').__file__).parent/'models'
    manifest={'version':VERSION,'python':sys.version,'dependencies':{k:importlib.metadata.version(k) for k in ['rapidocr','onnxruntime','numpy','pillow']},
              'models':{f.name:sha(f.read_bytes()) for f in models.glob('*.onnx')},
              'parts':PARTS,'source_index_base':0,'remote_image_upload':False,'member_drafts_touched':False,
              'script_sha256':sha(Path(__file__).read_bytes())}
    dump(ROOT/'runtime-manifest.json',manifest)
    for i,n in enumerate(pages,1):
        part=next(k for k,v in PARTS.items() if n in v);dest=ROOT/'pages'/f'{n:04d}.json'
        if dest.exists():
            old=json.loads(dest.read_text())
            if old['version']==VERSION and old['source_sha256']==sha((IMAGES/f'page-{n-1:03d}.jpg').read_bytes()):continue
        record=recognize(engine,n,part,overlay=not args.all or n in [5,13,100,259,358,528,627,777,876])
        dump(dest,record)
        print(json.dumps({'done':i,'total':len(pages),'page':n,'chars':record['han_count'],'warnings':len(record['warnings']),'seconds':record['seconds']}),flush=True)

if __name__=='__main__':main()

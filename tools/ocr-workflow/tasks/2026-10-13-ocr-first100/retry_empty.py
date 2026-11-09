"""Retry empty regions with real ink after trimming whitespace; retain both attempts."""
import sys
if __name__=='__main__' and '--legacy' not in sys.argv:
    raise SystemExit('此脚本会写入历史400页记录。新流程已内置复核，请使用run_ocr.py；确需历史复现时显式加--legacy。')
import json
import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from run_ocr import ROOT,WORK,dump,han

engine=RapidOCR(params={'Global.log_level':'warning'})
audit=[]
for f in sorted((ROOT/'pages').glob('*.json')):
    record=json.loads(f.read_text());changed=False
    for col in record['columns']:
        for piece in col['pieces']:
            if piece['text']:continue
            im=Image.open(WORK/record['source_image']).convert('RGB');l,t,r,b=piece['box']
            crop=im.crop(piece['box']);a=np.array(crop.convert('L'))<160
            if int(a.sum())<200:continue
            ys,xs=np.where(a)
            box=[max(0,int(xs.min())-5),max(0,int(ys.min())-5),min(r-l,int(xs.max())+6),min(b-t,int(ys.max())+6)]
            trimmed=crop.crop(box)
            attempts=[]
            for orientation in [90,0]:
                result=engine(trimmed.rotate(orientation,expand=True),use_det=False,use_cls=False)
                scores=list(map(float,[] if result.scores is None else result.scores))
                attempts.append({'rotation':orientation,'text':''.join(result.txts or []),'scores':scores})
            best=max(attempts,key=lambda x:sum(x['scores'])/max(1,len(x['scores'])))
            entry={'source_page':record['source_page'],'column':col['column'],'box':piece['box'],'trimmed_box':[box[0]+l,box[1]+t,box[2]+l,box[3]+t],'ink_pixels':int(a.sum()),'attempts':attempts,'selected':best}
            audit.append(entry)
            if best['text'] and best['scores'] and min(best['scores'])>=.5:
                piece['initial_result']={'text':piece['text'],'scores':piece['scores']}
                piece['text']=best['text'];piece['scores']=best['scores'];piece['retry']=entry
                record['warnings']=[x for x in record['warnings'] if x!=f'empty_piece:{col["column"]}:{t}']
                record['warnings'].append(f'recovered_empty_piece:{col["column"]}:{t}')
                col['text']=''.join(p['text'] for p in col['pieces']);changed=True
    if changed:
        record['text']='\n'.join(c['text'] for c in record['columns'] if c['text']);record['han_count']=han(record['text'])
        dump(f,record)
dump(ROOT/'empty-retry-audit.json',audit)
print(json.dumps(audit,ensure_ascii=False,indent=2))

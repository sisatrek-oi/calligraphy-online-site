"""Re-recognize a low-confidence recovered tail with its preceding image context."""
import sys
if __name__=='__main__' and '--legacy' not in sys.argv:
    raise SystemExit('此脚本会写入历史400页记录。新流程已内置复核，请使用run_ocr.py；确需历史复现时显式加--legacy。')
import json
from PIL import Image
from rapidocr import RapidOCR
from run_ocr import ROOT,WORK,dump,han
engine=RapidOCR(params={'Global.log_level':'warning'})
audit=[]
for f in sorted((ROOT/'pages').glob('*.json')):
    record=json.loads(f.read_text());changed=False
    for col in record['columns']:
        for i in range(len(col['pieces'])-1,0,-1):
            piece=col['pieces'][i];prev=col['pieces'][i-1]
            if 'retry' not in piece or not piece['scores'] or min(piece['scores'])>=.8:continue
            box=[prev['box'][0],prev['box'][1],piece['box'][2],piece['box'][3]]
            if box[3]-box[1]>700:continue
            im=Image.open(WORK/record['source_image']).convert('RGB')
            result=engine(im.crop(box).rotate(90,expand=True),use_det=False,use_cls=False)
            scores=list(map(float,[] if result.scores is None else result.scores));text=''.join(result.txts or [])
            entry={'source_page':record['source_page'],'column':col['column'],'box':box,'text':text,'scores':scores,'original_pieces':[prev,piece]}
            audit.append(entry)
            if text and scores and min(scores)>=.8:
                col['pieces'][i-1:i+1]=[{'box':box,'text':text,'scores':scores,'context_retry':entry}]
                col['text']=''.join(p['text'] for p in col['pieces']);changed=True
    if changed:
        record['text']='\n'.join(c['text'] for c in record['columns'] if c['text']);record['han_count']=han(record['text']);dump(f,record)
dump(ROOT/'context-retry-audit.json',audit)
print(json.dumps(audit,ensure_ascii=False,indent=2))

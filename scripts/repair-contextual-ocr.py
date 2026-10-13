"""Repair unsafe legacy reference pages from immutable original OCR. Never reads user drafts."""
import json
from pathlib import Path
from contextual_ocr_validate import load_pages
from ocr_integrity import omission_reason,source_hash

root=Path(__file__).resolve().parents[1]
folder=root/'tasks/2026-10-11-ocr-cleaning'
source=folder/'full-book-contextual.jsonl'
records=[json.loads(x) for x in source.read_text().splitlines() if x.strip()]
raw={x['page']:x for x in load_pages([root/f'screening-data/part-{n}-ocr.txt' for n in range(1,5)])}
assert sorted(x['source_page'] for x in records)==list(range(1,1053))
manifest=[]
for item in records:
    n=item['source_page']; original=raw[n]['ocr']
    reason=('confirmed_model_invention' if n==259 else None) or next((r for key in ['conservative','normalized'] if (r:=omission_reason(item[key],original))),None)
    if item.get('repair'):reason=item['repair']['reason']
    if reason:
        item['conservative']=original;item['normalized']=original
        item['repair']={'reason':reason,'action':'restored_original_ocr','source_sha256':source_hash(original),'date':'2026-10-13'}
        item['uncertainties']=[{'text':'本页回退原始 OCR','reason':'旧模型稿存在漏文或无图改写，已停用；需逐字对照扫描图。'}]
        manifest.append({'page':n,**item['repair']})
source.write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in records))
for key in ['conservative','normalized']:
    lines=['《历代书法论文选》历史模型参考稿（未核）','2026-10-13：问题页已回退原始 OCR；本文件不作为默认校勘底稿。','']
    for item in records:
        n=item['source_page'];lines.extend([f'===== 原 PDF 物理页 {n}｜清洗版：{"保守校验" if key=="conservative" else "语义整理"} =====',item[key],''])
    (folder/f'full-book-{key}.txt').write_text('\n'.join(lines))
(folder/'full-book-uncertainties.jsonl').write_text(''.join(json.dumps({'source_page':x['source_page'],'uncertainties':x['uncertainties']},ensure_ascii=False)+'\n' for x in records))
(folder/'repair-manifest-20261013.json').write_text(json.dumps({'original_revision':'bfd81bfb29b19e06e2ecd0915bf3a8912575ee0c','raw_preserved':True,'user_drafts_touched':False,'pages':manifest},ensure_ascii=False,indent=2)+'\n')
print('Restored original OCR:',[x['page'] for x in manifest])

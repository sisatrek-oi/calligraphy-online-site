"""Exact character comparisons, immutable input provenance, and static review reports."""
from pathlib import Path
from collections import Counter
import csv, hashlib, html, importlib.metadata, json, os, re, statistics, unicodedata, zipfile
from opencc import OpenCC
from rapidfuzz.distance import Levenshtein

ROOT=Path(__file__).resolve().parent
WORK=ROOT.parent.parent
SITE=WORK/'tasks/2026-06-03-calligraphy-table-focus/calligraphy-online-site'
OLD=WORK/'tasks/2026-10-13-ocr-repair/canonical-before/screening-data'
OUT=ROOT/'comparison';OUT.mkdir(exist_ok=True)
LABELS={'raw':'旧原始OCR','conservative':'旧保守模型稿（修复前）','normalized':'旧语义模型稿（修复前）'}
CC=OpenCC('t2s')
H=html.escape
def sha(b):return hashlib.sha256(b).hexdigest()
def compact(s):return re.sub(r'\s','',s)
def han(s):return ''.join(c for c in CC.convert(s) if 'CJK' in unicodedata.name(c,'') or c=='〇')
def pct(d,n):return round(d/n*100,2) if n else (0.0 if not d else None)
def fmt(v):return '—' if v is None else f'{v:.2f}%'
def csvwrite(path,rows,fields=None):
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields or list(rows[0]));w.writeheader();w.writerows(rows)
def dump(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')

STYLE='''body{margin:0;background:#f5f4ef;color:#202923;font:17px/1.85 system-ui,"Songti SC",serif}main{max-width:1260px;margin:auto;padding:36px 28px}h1{font-size:32px;line-height:1.3}h2{font-size:24px;margin-top:40px}h3{font-size:19px}a{color:#195c4b}p{max-width:1000px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}th{background:#e8ece7}nav{line-height:2.3}nav a{display:inline-block;margin-right:14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.text{overflow-wrap:anywhere;white-space:pre-wrap;background:white;padding:18px;border:1px solid #ddd;line-height:2.1}.text del{background:#ffe1dd;color:#8b2017;text-decoration:line-through}.text ins{background:#d9f2de;color:#17522c;text-decoration:underline}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.note{color:#515b52;font-size:15px}.page{border-top:2px solid #c4cec6;margin-top:40px}.table-wrap{overflow:auto}small{font-size:13px}.metrics{font-variant-numeric:tabular-nums} @media(max-width:700px){main{padding:20px 14px}.pair{grid-template-columns:1fr}h1{font-size:26px}} @media print{@page{size:A4;margin:15mm}body{background:white;font-size:11pt}main{padding:0}.page{break-before:page}.pair{gap:12px}.text{padding:8px}nav{display:none}h2,h3,summary{break-after:avoid}del,ins{print-color-adjust:exact;-webkit-print-color-adjust:exact}}'''
def doc(title,body):return f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{H(title)}</title><style>{STYLE}</style></head><body><main>{body}</main></body></html>'
def highlights(a,b):
    aa=[];bb=[];ops=Levenshtein.opcodes(a,b)
    assert ''.join(a[o.src_start:o.src_end] for o in ops)==a
    assert ''.join(b[o.dest_start:o.dest_end] for o in ops)==b
    for o in ops:
        x=H(a[o.src_start:o.src_end]);y=H(b[o.dest_start:o.dest_end])
        aa.append(x if o.tag=='equal' else f'<del>{x}</del>')
        bb.append(y if o.tag=='equal' else f'<ins>{y}</ins>')
    return ''.join(aa),''.join(bb)

def main():
    baseline=json.loads((ROOT/'verification.json').read_text())
    allrows=[];oprows=[];records=[];sources=[];repairpages=set();freq={v:Counter() for v in LABELS}
    for part in range(1,5):
        newfile=ROOT/f'part-{part}-ocr.jsonl';newrecords=[json.loads(l) for l in newfile.read_text().splitlines()]
        assert len(newrecords)==100 and len({r['source_page'] for r in newrecords})==100
        rawfile=SITE/f'screening-data/part-{part}-ocr.txt'
        assert sha(rawfile.read_bytes())==baseline['original_ocr_sha256'][str(rawfile.relative_to(WORK))]
        split=re.split(r'^===== 原 PDF 物理页 (\d+)[^\n]*\n',rawfile.read_text(),flags=re.M)
        raw={int(split[i]):split[i+1].strip() for i in range(1,len(split),2)}
        modelpath=OLD/f'part-{part}-contextual.json';models={r['page']:r for r in json.loads(modelpath.read_text())['pages']}
        currentpath=SITE/f'screening-data/part-{part}-contextual.json';current={r['page']:r for r in json.loads(currentpath.read_text())['pages']}
        for f in [newfile,rawfile,modelpath,currentpath]:sources.append({'path':str(f.relative_to(WORK)),'sha256':sha(f.read_bytes())})
        sections=[]
        for nr in newrecords:
            n=nr['source_page'];new=nr['text'];oldtexts={'raw':raw[n],**{v:models[n][v] for v in ['conservative','normalized']}}
            if any(models[n][v]!=current[n][v] for v in ['conservative','normalized']):repairpages.add(n)
            page={'part':part,'source_page':n,'new':new,'old':oldtexts,'metrics':{}}
            pic=WORK/nr['source_image'];assert sha(pic.read_bytes())==nr['source_sha256']
            imgurl=os.path.relpath(pic,OUT)
            section=f'<section class="page" id="p{n}"><h2>原 PDF 物理页 {n}</h2><p class="note">第{part}份 · 本轮第{nr["task_ordinal"]}页 · <a href="{H(imgurl)}">打开原扫描图核对</a> · <a href="#top">返回页码目录</a></p>'
            if n in repairpages:section+='<p class="note">本页旧模型稿后来已修复回退；这里展示修复前留存稿，便于追溯当时结果。</p>'
            for ver,label in LABELS.items():
                old=oldtexts[ver];a=compact(old);b=compact(new);ha=han(old);hb=han(new)
                edits=Levenshtein.editops(a,b);counts=Counter(e.tag for e in edits)
                dist=Levenshtein.distance(a,b);assert dist==len(edits)
                row={'part':part,'source_page':n,'old_version':ver,'old_label':label,
                     'exact_equal':old==new,'exact_with_whitespace_distance':Levenshtein.distance(old,new),
                     'old_compact_chars':len(a),'new_compact_chars':len(b),'compact_distance':dist,
                     'replace':counts['replace'],'delete_from_old':counts['delete'],'insert_in_new':counts['insert'],
                     'compact_difference_pct_old_denominator':pct(dist,len(a)),
                     'old_han_chars_t2s':len(ha),'new_han_chars_t2s':len(hb),'han_distance_t2s':Levenshtein.distance(ha,hb),
                     'han_difference_pct_old_denominator':pct(Levenshtein.distance(ha,hb),len(ha)),
                     'old_whitespace_chars':len(old)-len(a),'new_whitespace_chars':len(new)-len(b),
                     'later_repaired_model_page':n in repairpages and ver!='raw'}
                allrows.append(row);page['metrics'][ver]=row
                # Each record is ONE unit-cost character edit, with 1-based positions.
                for e in edits:
                    x=a[e.src_pos:e.src_pos+1] if e.tag!='insert' else ''
                    y=b[e.dest_pos:e.dest_pos+1] if e.tag!='delete' else ''
                    oprows.append({'part':part,'source_page':n,'old_version':ver,'operation':e.tag,
                                   'old_position_1based':e.src_pos+1,'new_position_1based':e.dest_pos+1,
                                   'old_character':x,'new_character':y,
                                   'old_context':a[max(0,e.src_pos-10):e.src_pos+11],
                                   'new_context':b[max(0,e.dest_pos-10):e.dest_pos+11]})
                    freq[ver][(e.tag,x,y)]+=1
                aa,bb=highlights(a,b)
                section+=f'<details {"open" if ver=="raw" else ""}><summary>{H(label)} → 本轮OCR · 汉字差异 {fmt(row["han_difference_pct_old_denominator"])} · 含标点差异 {fmt(row["compact_difference_pct_old_denominator"])}</summary><p class="note metrics">替换 {counts["replace"]} 字；旧有新无 {counts["delete"]} 字；新有旧无 {counts["insert"]} 字。已去空白，保留实际繁简及标点。高亮只表示差异，不表示谁对谁错。</p><div class="pair"><div><h3>{H(label)}</h3><div class="text">{aa or "（空文本）"}</div></div><div><h3>本轮OCR</h3><div class="text">{bb or "（空文本）"}</div></div></div></details>'
            section+='<details><summary>查看未规范化原文（保留空格与换行）</summary>'
            for key,value in [('本轮OCR',new)]+[(LABELS[k],v) for k,v in oldtexts.items()]:section+=f'<h3>{H(key)}</h3><div class="text">{H(value) or "（空文本）"}</div>'
            section+='</details></section>';sections.append(section);records.append(page)
        nav='<nav aria-label="页码">'+''.join(f'<a href="#p{r["source_page"]}">{r["source_page"]}</a>' for r in newrecords)+'</nav>'
        body=f'<header id="top"><p><a href="index.html">← 比对总览</a></p><h1>第{part}份 · 100页逐字对照</h1><p>红色删除线表示旧版不同字符，绿色下划线表示新版不同字符。每页另有旧保守版、旧语义版及未规范化原文，可展开查看。</p><p class="note">采用精确 Levenshtein 最短编辑对齐；含页边文字及栏序差异。差异率不是识别错误率，插入/删除也不直接等于补对/漏文。</p></header>'+nav+''.join(sections)
        (OUT/f'part-{part}.html').write_text(doc(f'第{part}份100页逐字对照',body))
        csvwrite(OUT/f'第{part}份-逐页比对.csv',[r for r in allrows if r['part']==part])
    assert len(records)==400 and len(allrows)==1200
    aggregates=[]
    for ver in LABELS:
        for part in [0,1,2,3,4]:
            rr=[r for r in allrows if r['old_version']==ver and (not part or r['part']==part)]
            sums={k:sum(r[k] for r in rr) for k in ['old_compact_chars','new_compact_chars','compact_distance','replace','delete_from_old','insert_in_new','old_han_chars_t2s','new_han_chars_t2s','han_distance_t2s','old_whitespace_chars','new_whitespace_chars']}
            aggregates.append({'version':ver,'part':part,'pages':len(rr),**sums,
                               'compact_difference_pct':pct(sums['compact_distance'],sums['old_compact_chars']),
                               'han_difference_pct':pct(sums['han_distance_t2s'],sums['old_han_chars_t2s']),
                               'compact_equal_pages':sum(r['compact_distance']==0 for r in rr),
                               'han_equal_pages':sum(r['han_distance_t2s']==0 for r in rr),
                               'median_page_han_difference_pct':statistics.median(r['han_difference_pct_old_denominator'] for r in rr if r['old_han_chars_t2s'])})
    summary={'date':'2026-10-13','page_count':400,'comparison_count':1200,'aggregates':aggregates,
             'later_repaired_model_pages':sorted(repairpages),'method':'exact Levenshtein; old→new; weighted rates=sum page distances / sum old chars; whitespace-free literal and OpenCC t2s CJK-only reported separately; includes running titles and original reading order',
             'caveat':'版本差异不等于CER；尚无400页逐字金标准。模型待核解释中的汉字仍计入；不同口径距离不能相减归因。',
             'dependencies':{k:importlib.metadata.version(k) for k in ['rapidfuzz','opencc-python-reimplemented']},'sources':sources}
    dump(OUT/'summary.json',summary)
    csvwrite(OUT/'400页-逐页比对.csv',allrows);csvwrite(OUT/'400页-逐字增删替换.csv',oprows)
    csvwrite(OUT/'汇总.csv',aggregates)
    dump(OUT/'高频差异.json',{v:[{'operation':k[0],'old':k[1],'new':k[2],'count':n} for k,n in c.most_common(100)] for v,c in freq.items()})
    (OUT/'400页-全文与统计.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records))
    top=sorted((r for r in allrows if r['old_version']=='raw' and r['old_han_chars_t2s']>=50),key=lambda r:r['han_difference_pct_old_denominator'],reverse=True)[:20]
    dump(OUT/'差异最大20页.json',top)
    print(json.dumps({'aggregates':aggregates,'repaired':sorted(repairpages),'top_raw':[(r['source_page'],r['han_difference_pct_old_denominator']) for r in top]},ensure_ascii=False,indent=2))

if __name__=='__main__':main()

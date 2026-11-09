"""Verify exact page coverage and package the four independent OCR deliveries."""
import sys
if __name__=='__main__' and '--legacy' not in sys.argv:
    raise SystemExit('此脚本只打包历史400页并重写历史说明。新流程已输出JSON/CSV/TXT，请使用review_ocr.py export；历史复现需--legacy。')
import csv,json,re,hashlib,unicodedata,zipfile
from pathlib import Path
from opencc import OpenCC
from run_ocr import ROOT,WORK,SITE,IMAGES,PARTS,STARTS,VERSION,sha,dump,han

def distance(a,b):
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=row
    return prev[-1]

def main():
    expected={n for p in PARTS.values() for n in p}
    found={int(f.stem) for f in (ROOT/'pages').glob('*.json')}
    assert found==expected,{'missing':sorted(expected-found),'extra':sorted(found-expected)}
    rows=[];allrecords=[];oldhash={}
    review=json.loads((ROOT/'visual-review.json').read_text())
    cleared={(x['source_page'],x['column'],x['box'][1]) for x in review['empty_regions_confirmed_scan_noise']}
    for part,pages in PARTS.items():
        oldpath=SITE/f'screening-data/part-{part}-ocr.txt';oldhash[str(oldpath.relative_to(WORK))]=sha(oldpath.read_bytes())
        splits=re.split(r'^===== 原 PDF 物理页 (\d+)[^\n]*\n',oldpath.read_text(),flags=re.M)
        old={int(splits[i]):splits[i+1].strip() for i in range(1,len(splits),2)}
        texts=[f'《历代书法论文选》第{part}份团队任务：前100个有效任务页 OCR 重识别',
               '2026-10-13 | RapidOCR / PP-OCRv6 small | 逐栏短段 | 机器原样输出，未经人工校勘',
               '按原图保留正文、篇题与页边文字；栏序为从右到左，栏内从上到下。空白页保留页码。','']
        records=[]
        for n in pages:
            record=json.loads((ROOT/'pages'/f'{n:04d}.json').read_text())
            assert record['version']==VERSION and record['source_page']==n and record['part']==part
            assert record['source_sha256']==sha((IMAGES/f'page-{n-1:03d}.jpg').read_bytes())
            assert record['text']=='\n'.join(c['text'] for c in record['columns'] if c['text'])
            for c in record['columns']:
                assert c['text']==''.join(p['text'] for p in c['pieces'])
                for piece in c['pieces']:
                    l,t,r,b=piece['box'];w,h=record['image_size'];assert 0<=l<r<=w and 0<=t<b<=h
            oldn=han(old[n]);newn=record['han_count']
            flags=[]
            for warning in record['warnings']:
                match=re.fullmatch(r'empty_piece:(\d+):(\d+)',warning)
                if match and (n,int(match[1]),int(match[2])) in cleared:
                    flags.append(warning.replace('empty_piece:','reviewed_scan_noise:'))
                else:flags.append(warning)
            if oldn>=50 and newn<oldn*0.65:flags.append('shorter_than_old_65pct')
            if record['uncovered_ink_pixels']>max(500,record['ink_pixels']*.015):flags.append('uncovered_ink_review')
            rows.append({'part':part,'task_ordinal':record['task_ordinal'],'source_page':n,
                         'status':record['status'],'old_han_count':oldn,'new_han_count':newn,
                         'columns':len(record['columns']),'uncovered_ink_pixels':record['uncovered_ink_pixels'],
                         'ink_pixels':record['ink_pixels'],'warnings':' | '.join(flags),
                         'source_sha256':record['source_sha256'],'text_sha256':sha(record['text'].encode())})
            texts.extend([f'===== 原 PDF 物理页 {n}｜分册第 {n-STARTS[part]+1} 页｜本轮第 {record["task_ordinal"]} 页 =====',record['text'],''])
            records.append(record)
        (ROOT/f'第{part}份-前100页-重新OCR.txt').write_text('\n'.join(texts))
        (ROOT/f'part-{part}-ocr.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records))
        allrecords.extend(records)
    with (ROOT/'逐页核验.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    cc=OpenCC('t2s')
    def norm(s):return ''.join(c for c in cc.convert(s) if 'CJK' in unicodedata.name(c,'') or c=='〇')
    r259=next(r for r in allrecords if r['source_page']==259)
    refpath=WORK/'tasks/2026-10-13-ocr-repair/experiment/reference-body.txt'
    ref=norm(refpath.read_text());body=norm('\n'.join(c['text'] for c in r259['columns'] if c['box'][0]>180))
    summary={'version':VERSION,'page_count':len(rows),'part_counts':{p:len(v) for p,v in PARTS.items()},
             'blank_candidates':[r['source_page'] for r in allrecords if r['status']=='blank_candidate'],
             'warning_pages':[r['source_page'] for r in rows if r['warnings']],
             'serious_review_pages':[r['source_page'] for r in rows if any(x.startswith(('wide_column','nonblank_without','shorter_than_old','uncovered_ink','empty_piece:')) for x in r['warnings'].split(' | '))],
             'total_han_count':sum(r['new_han_count'] for r in rows),
             'page259_reference_check':{'reference_sha256':sha(refpath.read_bytes()),'reference_chars':len(ref),'candidate_chars':len(body),'han_distance':distance(body,ref),'han_cer_pct':round(distance(body,ref)/len(ref)*100,2),'scope':'正文15栏含夹注，排除左侧篇名页码；沿用上轮助手参考稿，非独立专家金标准'},
             'original_ocr_sha256':oldhash,'member_drafts_touched':False,'published_to_website':False,
             'verification':'exact 400 page coverage, source image hashes, column/piece reconstruction, coordinate bounds'}
    dump(ROOT/'verification.json',summary)
    lines=['# 四个团队任务前100页：OCR 重识别','',
           '完成日期：2026-10-13。共 400 个当前有效任务页，各份 100 页。按扫描图重新运行本机 RapidOCR / PP-OCRv6 small 逐栏短段识别，未用语言模型改写文字。','',
           '| 任务 | 原 PDF 物理页 | 本轮页数 |','|---|---|---:|',
           '| 第1份 | 5、6、13–110 | 100 |','| 第2份 | 259–358 | 100 |',
           '| 第3份 | 528–627 | 100 |','| 第4份 | 777–876 | 100 |','',
           '第1份按平台现行有效任务页计数，已移除的封面、版权及目录页不计入前100页。空白扫描页仍保留页码，不填造正文。','',
           '## 交付文件','']
    for part in PARTS:lines.append(f'- [第{part}份：前100页 TXT](第{part}份-前100页-重新OCR.txt)；[带区域坐标、置信度与来源哈希的 JSONL](part-{part}-ocr.jsonl)。')
    lines.extend(['- [逐页核验清单](逐页核验.csv)、[机器核验结果](verification.json)、[运行环境与模型哈希](runtime-manifest.json)。','',
                  '## 结果与限制','',
                  f'- 已验证400页完整覆盖、每份100页且无重复；原图哈希、区域坐标、逐段与逐栏正文重建一致。识别得到 {summary["total_han_count"]:,} 个汉字（含篇题、页边文字）。',
                  f'- {len(summary["blank_candidates"])} 页无识别文字，已按图像像素检查；具体页码见 verification.json。',
                  f'- {len(summary["warning_pages"])} 页带低置信度、空局部或重试等机器标记，见 CSV；这些提示不等于整页识别失败。',
                  f'- 第259页沿用此前助手转写的529字参考稿，对齐正文15栏后差异为 {summary["page259_reference_check"]["han_distance"]}/529，汉字CER {summary["page259_reference_check"]["han_cer_pct"]}%。该参考不是独立专家金标准，不能外推为400页平均准确率。',
                  '- 抽查了九个样本的正文／篇题／夹注／列表版面，并核对全部13个首次空局部区域：11处为扫描噪点，2处真实文字通过裁图重试补回。小字、异体字、标点仍需逐页人工校对；本次没有宣称人工校勘完成。',
                  '- 原样保留机器输出。阅读顺序为从右到左、栏内从上到下，页边篇名与页码也保留，可能出现在正文前后。空白页只有页头；不向正文插入诊断说明。',
                  '- 旧OCR、网站数据与成员草稿未覆盖。四份TXT是本轮独立候选文件，尚未替换线上团队任务底稿；既有修改率和校验状态未变。','',
                  '## 复现','',
                  '本轮使用上一轮已安装的本机Python环境，实际依赖与模型哈希见 runtime-manifest.json。',
                  '先运行 `run_ocr.py --all`，再运行 `retry_empty.py`、`retry_context.py`，最后运行 `package_results.py`。逐页结果可断点续跑；visual-review.json记录本轮人工查看扫描区域的结论。',
                  '重试仅对返回空文字且仍有明显墨迹的局部裁掉留白，比较旋转与原方向的识别置信度；原尝试和重试结果保留在逐页记录及 empty-retry-audit.json，不手工填字。',''])
    (ROOT/'README.md').write_text('\n'.join(lines))
    with zipfile.ZipFile(ROOT/'四个团队任务-各前100页-重新OCR.zip','w',zipfile.ZIP_DEFLATED) as z:
        files=[ROOT/'README.md',ROOT/'逐页核验.csv',ROOT/'verification.json',ROOT/'runtime-manifest.json',ROOT/'empty-retry-audit.json',ROOT/'context-retry-audit.json',ROOT/'visual-review.json']
        files += list(ROOT.glob('第*份-前100页-重新OCR.txt'))+list(ROOT.glob('part-*-ocr.jsonl'))
        for f in files:z.write(f,f.name)
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':main()

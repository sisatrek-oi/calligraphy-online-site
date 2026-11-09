"""Package a local character-pair reader from a run, without changing the run or source TXT."""
from pathlib import Path
import argparse
import json
import shutil
from ocr_character_map import SCHEMA, build_mapping, text_sha
from ocr_review_store import atomic_json, file_sha


def build(run, output, reviewed_part=None):
    manifest=json.loads((Path(run)/'manifest.json').read_bytes())
    workspace=Path(manifest.get('workspace') or Path(__file__).resolve().parents[2])
    output=Path(output).resolve()
    if output.exists() and any(output.iterdir()):raise ValueError('预览输出须使用新的空目录。')
    index_path=Path(run)/'character-map-index.json'
    if index_path.exists():
        entries=[p for p in json.loads(index_path.read_bytes())['pages'] if p['status']=='available']
        maps=[Path(run)/p['file'] for p in entries]
        for path,entry in zip(maps,entries):
            if file_sha(path)!=entry['sha256']:raise ValueError('逐字映射与批次索引版本不匹配。')
    else:maps=sorted((Path(run)/'character-maps').glob('*.json'))
    if not maps:raise ValueError('本批次尚无逐字映射。旧批次请先运行map_ocr_characters.py。')
    reviewed=json.loads(Path(reviewed_part).read_bytes()) if reviewed_part else None
    if reviewed_part:
        reviewed_input=dict(path=str(Path(reviewed_part).resolve()),sha256=file_sha(reviewed_part))
    output.mkdir(parents=True,exist_ok=True)
    for path in Path(__file__).with_name('character-viewer').glob('*'):
        if path.is_file():shutil.copyfile(path,output/path.name)
    (output/'images').mkdir();(output/'data').mkdir()
    pages=[]
    for path in maps:
        mapping=json.loads(path.read_bytes());page=mapping['page']
        baseline_path=Path(run)/'baseline'/path.name
        if not baseline_path.exists():baseline_path=Path(run)/'geometries'/path.name
        baseline=json.loads(baseline_path.read_bytes())
        source=workspace/mapping['sourceImage']
        if file_sha(source)!=mapping['sourceSha256']:raise ValueError('源图版本与映射不匹配。')
        image_name=f'images/{page:04d}{source.suffix}'
        shutil.copyfile(source,output/image_name)
        source_glyphs=mapping.get('sourceGlyphs',[g for c in baseline['columns'] for g in c.get('glyphs',[])])
        versions=[dict(id='ocr',label='OCR工作稿',mapping=mapping,source=dict(kind='machine',humanReviewed=False))]
        if reviewed:
            human=next((p for p in reviewed['pages'] if p['page']==page and p.get('eligible')),None)
            if human:
                if text_sha(human['text'])!=human['source']['textSha256']:raise ValueError('审核TXT版本不匹配。')
                versions.append(dict(id='reviewed',label='人工审核TXT',mapping=build_mapping(baseline,human['text'],source_glyphs,ignore_line_labels=True),
                                     source=dict(human['source'],input=reviewed_input)))
        for version in versions:
            version['binding']=text_sha(json.dumps(dict(schema=SCHEMA,source=mapping['sourceSha256'],text=version['mapping']['textSha256'],glyphs=source_glyphs),ensure_ascii=False,sort_keys=True))
        data=dict(page=page,title=baseline['columns'][0]['text'] if baseline['columns'] else f'扫描{page}页',image=image_name,
                  imageSize=mapping['imageSize'],sourceSha256=mapping['sourceSha256'],sourceGlyphs=source_glyphs,versions=versions)
        atomic_json(output/'data'/f'{page:04d}.json',data)
        pages.append(dict(page=page,title=data['title'],file=f'data/{page:04d}.json',sha256=file_sha(output/'data'/f'{page:04d}.json')))
    atomic_json(output/'index.json',dict(schema=SCHEMA,pages=pages,localDraftOnly=True))
    return pages


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--reviewed-part',type=Path)
    a=p.parse_args();print(json.dumps(build(a.run,a.output,a.reviewed_part),ensure_ascii=False))

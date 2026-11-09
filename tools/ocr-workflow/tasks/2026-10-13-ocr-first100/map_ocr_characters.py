"""Read-only geometry supplement for old OCR records; output always uses a new directory."""
from pathlib import Path
import argparse
import copy
import json
from ocr_character_map import SCHEMA, build_mapping, recognition_glyphs
from ocr_review_store import atomic_json, file_sha


def supplement(records, output, pages, models, text_dir=None):
    from PIL import Image
    from rapidocr import RapidOCR, ModelType
    workspace=Path(__file__).resolve().parents[2]
    output=Path(output).resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError('补映射须使用新的空目录，不能覆盖旧材料。')
    source_files=[Path(records)/f'{p:04d}.json' for p in sorted(set(pages))]
    inputs={str(p.resolve()):file_sha(p) for p in source_files}
    if text_dir:
        inputs.update({str((Path(text_dir)/f'{p:04d}.txt').resolve()):file_sha(Path(text_dir)/f'{p:04d}.txt') for p in pages})
    weight=Path(models)/'PP-OCRv6_rec_small.onnx'
    model_sha=file_sha(weight)
    output.mkdir(parents=True,exist_ok=True)
    manifest=dict(schema=SCHEMA,inputs=inputs,modelSha256=model_sha,networkUpload=False,
                  scripts={p:file_sha(Path(__file__).with_name(p)) for p in ['map_ocr_characters.py','ocr_character_map.py']},
                  scope='旧OCR裁片只读补映射；几何为机器估计；正文与审核状态不改。')
    atomic_json(output/'manifest.json',manifest)
    engine=RapidOCR(params={'Global.log_level':'warning','Global.model_root_dir':str(weight.parent),
        'Rec.model_type':ModelType.SMALL,'Rec.model_path':str(weight)})
    counts=[]
    for path in source_files:
        original=json.loads(path.read_bytes())
        image_path=workspace/original['source_image']
        if file_sha(image_path)!=original['source_sha256']:
            raise ValueError(f'原图哈希不符：{path}')
        inputs[str(image_path)]=file_sha(image_path)
        baseline=copy.deepcopy(original)
        image=Image.open(image_path).convert('RGB')
        baseline['characterMappingSchema']=SCHEMA
        for column in baseline['columns']:
            glyphs=[]
            for pi,piece in enumerate(column['pieces'],1):
                crop=image.crop(piece['box']).rotate(90,expand=True)
                out=engine(crop,use_det=False,use_cls=False,return_word_box=True,return_single_char_box=True)
                found,warning=recognition_glyphs(out,crop.size,piece['box'])
                for gi,g in enumerate(found):
                    g.update(id=f'p{baseline["source_page"]:04d}-c{column["column"]:02d}-s{pi:02d}-g{gi+1:04d}',column=column['column'],piece=pi)
                piece.update(geometryText=''.join(out.txts or []),glyphs=found,geometryWarning=warning)
                glyphs.extend(found)
            column['glyphs']=glyphs
        page=baseline['source_page']
        text=(Path(text_dir)/f'{page:04d}.txt').read_bytes().decode('utf-8-sig') if text_dir else original['text']
        mapping=build_mapping(baseline,text)
        atomic_json(output/'geometries'/f'{page:04d}.json',baseline)
        atomic_json(output/'character-maps'/f'{page:04d}.json',mapping)
        counts.append(dict(page=page,counts=mapping['counts']))
        print(json.dumps(counts[-1],ensure_ascii=False),flush=True)
    for path,digest in inputs.items():
        if file_sha(path)!=digest:raise ValueError(f'输入在运行中变化：{path}')
    manifest.update(inputs=inputs,pages=counts)
    atomic_json(output/'manifest.json',manifest)
    return counts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--records',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--pages',required=True)
    parser.add_argument('--text-dir',type=Path)
    parser.add_argument('--models',type=Path,default=Path(__file__).resolve().parents[2]/'tasks/2026-10-13-ocr-benchmark-20/models')
    args=parser.parse_args()
    supplement(args.records,args.output,[int(p) for p in args.pages.split(',')],args.models,args.text_dir)

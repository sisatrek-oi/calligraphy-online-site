"""Text-only model output is advisory: source text is never rewritten."""
import hashlib
import re

PIPELINE_VERSION = 2


def source_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def omission_reason(text, source):
    if re.search(r'从略|(?:详见|见)\s*uncertainties|以下.{0,60}(?:残误|仅存疑|省略)', text, re.I):
        return 'model_omitted_text'
    raw = re.sub(r'\s+', '', source)
    value = re.sub(r'\s+', '', re.sub(r'【待核：([^】]*)】', r'\1', text))
    if len(raw) >= 80 and len(value) < len(raw) * .70:
        return 'excessive_text_loss'
    return None


def validate_batch(result, batch):
    if not isinstance(result, dict) or set(result) != {'pages'} or not isinstance(result['pages'], list):
        raise ValueError('模型必须返回 pages 数组')
    sources = {int(p['page']): str(p['ocr']) for p in batch}
    records = {}
    for item in result['pages']:
        if not isinstance(item, dict) or set(item) != {'source_page', 'suggestions'}:
            raise ValueError('模型只能提供候选建议，不能返回替换正文')
        number = item['source_page']
        if type(number) is not int or number not in sources or number in records:
            raise ValueError('模型页码不匹配或重复')
        source = sources[number]
        suggestions = item['suggestions']
        if not isinstance(suggestions, list) or len(suggestions) > 100:
            raise ValueError('候选建议结构不完整')
        checked, intervals = [], []
        for entry in suggestions:
            if not isinstance(entry, dict) or set(entry) != {'before', 'after', 'reason'} or not all(isinstance(v, str) and v.strip() for v in entry.values()):
                raise ValueError('候选建议必须包含 before/after/reason')
            before, after = entry['before'], entry['after']
            if source.count(before) != 1 or before == after or len(re.sub(r'\s', '', before)) > 12 or len(after) > 12:
                raise ValueError('候选必须唯一定位短原文，不得整段改写')
            start, end = source.index(before), source.index(before) + len(before)
            if any(start < b and end > a for a,b in intervals):
                raise ValueError('候选位置重叠')
            intervals.append((start,end))
            checked.append({**entry, 'start':start, 'end':end, 'status':'pending-image-review'})
        records[number] = {'source_page':number, 'pipeline_version':PIPELINE_VERSION,
            'source_sha256':source_hash(source), 'conservative':source, 'normalized':source,
            'suggestions':checked, 'uncertainties':[{'text':x['before'], 'reason':x['reason']} for x in checked]}
    if set(records) != set(sources):
        raise ValueError('模型返回页码不完整')
    return records

"""Read-only binding checks for proposals kept outside immutable OCR candidates."""
from pathlib import Path
import json
from ocr_review_store import read, file_sha, fingerprint

PROPOSAL_LABELS={'suggested':'大模型建议已生成·待人工回图',
    'model_pending':'大模型亦无法确定·待人工回图','failed':'大模型调用或解析失败·待处理',
    'budget_deferred':'预算或调用上限·未复核','configuration_missing':'接口配置不可用·未复核',
    'stale_input':'建议依据变化·须重新生成','not_requested':'未进入大模型复核队列'}

def proposal_hash(value):return fingerprint({k:v for k,v in value.items() if k!='proposalFingerprint'})

def load_suggestions(directory,pages):
    directory=Path(directory);manifest_path=directory/'vlm/manifest.json'
    if not manifest_path.exists():return {}, {'enabled':False,'humanConfirmationRequired':False}
    manifest=read(manifest_path)
    if fingerprint(manifest['settings'])!=manifest['settingsFingerprint']:
        raise ValueError('大模型复核策略清单校验失败。')
    by_id={u['id']:(p,u) for p in pages for u in p['reviewUnits']};proposals={}
    for path in sorted((directory/'vlm/proposals').glob('*.json')):
        value=read(path);uid=value['unitId']
        if uid not in by_id:raise ValueError('大模型建议不属于当前OCR区域。')
        if proposal_hash(value)!=value['proposalFingerprint']:raise ValueError('大模型建议内容校验失败。')
        page,unit=by_id[uid]
        if value.get('requestRecord'):
            record=directory/value['requestRecord']
            if file_sha(record)!=value['requestRecordSha256']:raise ValueError('大模型调用原始记录已变化。')
            data=read(record)
            if data['inputFingerprints'][uid]!=value['unitFingerprint'] or data['settingsFingerprint']!=value['settingsFingerprint']:
                raise ValueError('大模型调用输入指纹不匹配。')
            if fingerprint(data['prompt'])!=data['promptSha256']:raise ValueError('大模型提示词指纹不匹配。')
            for im in data['images']:
                if file_sha(directory/im['path'])!=im['sha256']:raise ValueError('大模型请求图片已变化。')
            if value['status'] in ['suggested','model_pending']:
                try:
                    answer=next(x for x in json.loads(data['rawResponse']['choices'][0]['message']['content'])['results'] if x['id']==uid)
                    expected_status='suggested' if answer['status']=='suggested' else 'model_pending'
                    if data['status']!='ok' or expected_status!=value['status'] or answer['text']!=value['text'] or answer['note']!=value['note']:
                        raise ValueError('建议与模型原始响应不一致。')
                except (KeyError,TypeError,StopIteration):raise ValueError('模型原始响应无法核验。') from None
        elif value['status'] in ['suggested','model_pending']:raise ValueError('可采纳建议缺少模型原始响应。')
        if value.get('sourceCopy'):
            if file_sha(directory/value['sourceCopy']['path'])!=value['sourceCopy']['sha256']:
                raise ValueError('保存的原图副本已变化。')
        if value.get('evidence'):
            if file_sha(directory/value['evidence']['path'])!=value['evidence']['sha256']:
                raise ValueError('大模型复核裁片已变化。')
        stale=(value['unitFingerprint']!=fingerprint(unit) or value['sourceSha256']!=page['sourceSha256']
               or value['settingsFingerprint']!=manifest['settingsFingerprint'])
        if stale:value={**value,'status':'stale_input','canAdopt':False,'staleReason':'候选、源图或策略变化'}
        proposals[uid]=value
    attempts=[read(p) for p in sorted((directory/'vlm/requests').glob('*.json'))]
    totals={key:sum(x.get(key,0) for x in attempts) for key in ['wallSeconds','estimatedUSDPeak','estimatedUSDOffPeak','reservedUSDPeak']}
    totals.update(requests=len(attempts),successfulRequests=sum(x.get('status')=='ok' for x in attempts),
        unresolvedBillingRequests=sum(x.get('status') not in ['ok','invalid_output'] or not x.get('usage') for x in attempts),
        usage={key:sum(x.get('usage',{}).get(key,0) for x in attempts) for key in ['prompt_tokens','completion_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']})
    statuses={s:sum(x['status']==s for x in proposals.values()) for s in PROPOSAL_LABELS if s!='not_requested'}
    return proposals,dict(enabled=True,humanConfirmationRequired=True,provider=manifest['settings']['provider'],
        settingsFingerprint=manifest['settingsFingerprint'],limits=manifest['settings']['limits'],
        counts=statuses,accounting=totals,
        costNote='按记录的公开单价与返回usage估算，非账单实扣；未知计费按预留计入预算，人工成本另计。')

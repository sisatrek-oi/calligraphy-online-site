"""Durable OCR review events and derived exports. Machine candidates are immutable to reviewers."""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import csv, fcntl, hashlib, io, json, os, uuid

LABELS = {'not_flagged':'未触发局部复核·非校勘完成', 'pending':'待回图复核',
          'review_failed':'复核候选失败·待处理', 'unresolved':'已回图·仍待核', 'deferred':'待核·尚未回图',
          'kept':'已核对·保留small', 'changed':'已修改完毕（局部）',
          'unchanged':'已核对·正文未变', 'stale':'复核依据变化·待重新确认'}

def now(): return datetime.now(timezone.utc).isoformat()
def read(path): return json.loads(Path(path).read_text(encoding='utf-8'))
def fingerprint(value): return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def file_sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def atomic_bytes(path, data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temp.open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if temp.exists():temp.unlink()

def atomic_json(path, value): atomic_bytes(path,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())

@contextmanager
def locked(directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    with (directory/'.review.lock').open('a') as f:
        try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('该批次正在运行或写入复核，请稍后重试。') from None
        try: yield
        finally: fcntl.flock(f,fcntl.LOCK_UN)

def events(directory):
    result=[];previous=''
    for path in sorted((Path(directory)/'events').glob('*.json')):
        event=read(path);digest=event.pop('eventHash')
        if event['previousHash']!=previous or fingerprint(event)!=digest:
            raise ValueError('复核历史校验失败，不能继续覆盖。')
        event['eventHash']=digest;previous=digest;result.append(event)
    return result

def unit_state(unit, history, proposal=None):
    event=next((e for e in reversed(history) if e['unitId']==unit['id']),None)
    basis={'machine':unit,'lastEvent':event['eventHash'] if event else ''}
    if proposal:basis['proposal']=fingerprint(proposal)
    revision=fingerprint(basis)
    stale_vlm=event and event['choice']=='vlm' and (not proposal or proposal['status']!='suggested' or event.get('proposalFingerprint')!=proposal['proposalFingerprint'])
    if event and (event['machineFingerprint']!=fingerprint(unit) or stale_vlm):
        return dict(status='stale',revision=revision,event=event,text=unit['baselineText'])
    if event:
        status=('unresolved' if event['imageChecked'] else 'deferred') if event['choice']=='pending' else 'kept' if event['choice']=='baseline_small' else 'changed' if event['text']!=unit['baselineText'] else 'unchanged'
        return dict(status=status,revision=revision,event=event,text=event['text'] if status not in ['unresolved','deferred'] else unit['baselineText'])
    return dict(status='review_failed' if any(c['status']=='failed' for c in unit['candidates']) else 'pending',revision=revision,event=None,text=unit['baselineText'])

def machine_pages(directory): return [read(p) for p in sorted((Path(directory)/'machine').glob('*.json'))]

def validate_current_sources(directory, pages):
    root=Path(read(Path(directory)/'manifest.json')['workspace'])
    for page in pages:
        source=root/page['sourceImage']
        if file_sha(source)!=page['sourceSha256']: raise ValueError(f'源图已变化：{page["page"]}，请新建批次。')

def apply_decisions(directory, decisions):
    directory=Path(directory)
    with locked(directory):
        pages=machine_pages(directory);validate_current_sources(directory,pages)
        from ocr_vlm_store import load_suggestions
        proposals,vlm=load_suggestions(directory,pages)
        units={u['id']:u for p in pages for u in p['reviewUnits']}
        history=events(directory);new=[]
        if not isinstance(decisions,list) or not decisions: raise ValueError('确认单必须为非空数组。')
        if len({d['unitId'] for d in decisions})!=len(decisions): raise ValueError('同一确认单不能重复处理同一区域。')
        # Validate the complete request before writing any event.
        for decision in decisions:
            unit=units.get(decision['unitId'])
            if unit is None: raise ValueError('未找到复核区域。')
            proposal=proposals.get(unit['id']);state=unit_state(unit,history,proposal)
            if decision.get('expectedRevision')!=state['revision']: raise ValueError('复核记录已变化，请重新读取当前revision。')
            person=decision.get('reviewer','').strip();note=decision.get('note','').strip();choice=decision['choice']
            if not person or not note: raise ValueError('请记录复核人和处理依据。')
            if choice!='pending' and vlm.get('humanConfirmationRequired'):
                if decision.get('reviewerType')!='human' or decision.get('humanConfirmed') is not True:
                    raise ValueError('启用大模型建议的批次须由人工回图确认；填写reviewerType=human与humanConfirmed=true，AI不得代签。')
            if choice!='pending' or decision.get('imageChecked') is True:
                evidence=unit['evidence']
                if decision.get('imageChecked') is not True or decision.get('evidence')!=evidence['path']:
                    raise ValueError('确认必须记录已回图及本区域裁片。')
                if file_sha(directory/evidence['path'])!=evidence['sha256']: raise ValueError('复核裁片已变化。')
            if choice!='pending':
                candidate=next((c for c in unit['candidates'] if c['id']==choice and c['status']=='ok'),None)
                if choice=='vlm':
                    if not proposal or proposal['status']!='suggested' or not proposal.get('canAdopt'):
                        raise ValueError('没有可采纳的大模型建议，或依据已经变化。')
                    if decision.get('proposalFingerprint')!=proposal['proposalFingerprint']:
                        raise ValueError('须确认当前大模型建议指纹，不能采纳过期建议。')
                    text=proposal['text']
                elif choice=='custom':
                    text=decision.get('text')
                    if not isinstance(text,str) or not text.strip(): raise ValueError('手工核定正文不能为空。')
                elif candidate: text=candidate['text']
                else: raise ValueError('候选不存在或识别失败，不能采纳。')
            else:text=unit['baselineText']
            new.append(dict(unitId=unit['id'],machineFingerprint=fingerprint(unit),choice=choice,text=text,
                proposalFingerprint=proposal['proposalFingerprint'] if choice=='vlm' else None,
                reviewerType=decision.get('reviewerType','unspecified'),humanConfirmed=decision.get('humanConfirmed') is True,
                reviewer=person,note=note,imageChecked=decision.get('imageChecked') is True,
                evidence=unit['evidence'] if decision.get('imageChecked') is True else None,
                reviewedAt=now(),sourceSha256=next(p['sourceSha256'] for p in pages if unit in p['reviewUnits'])))
        previous=history[-1]['eventHash'] if history else ''
        for event in new:
            event.update(previousHash=previous,eventId=uuid.uuid4().hex)
            event['eventHash']=fingerprint(event);previous=event['eventHash']
            path=directory/'events'/f'{len(history):08d}-{event["eventId"]}.json'
            atomic_json(path,event);history.append(event)
        return export_run(directory)

def csv_cell(value):
    text=str(value if value is not None else '')
    return "'"+text if text.startswith(('=','+','-','@','\t','\r')) else text

def export_run(directory):
    """Caller holds the run lock. Rebuildable from machine pages and the event chain."""
    from ocr_character_map import SCHEMA, characters
    directory=Path(directory);manifest=read(directory/'manifest.json');history=events(directory)
    pages=machine_pages(directory);validate_current_sources(directory,pages)
    from ocr_vlm_store import load_suggestions,PROPOSAL_LABELS
    proposals,vlm=load_suggestions(directory,pages)
    rows=[];effective=[];counts={k:0 for k in LABELS};page_states=[];mapping_pages=[]
    mapping_required=manifest.get('configuration',{}).get('characterMapping',{}).get('required',False)
    for page in pages:
        baseline=read(directory/page['baselineFile']);replacement={};covered=set();page_counts={}
        unit_by_column={c:u for u in page['reviewUnits'] for c in u['columns']}
        for unit in page['reviewUnits']:
            if covered.intersection(unit['columns']):raise ValueError('复核区域消费栏重复。')
            covered.update(unit['columns']);state=unit_state(unit,history,proposals.get(unit['id']));counts[state['status']]+=1
            page_counts[state['status']]=page_counts.get(state['status'],0)+1
            replacement[unit['columns'][0]]=state['text']
            for c in unit['columns'][1:]:replacement[c]=''
        for column in baseline['columns']:
            u=unit_by_column.get(column['column'])
            if u and column['column']!=u['columns'][0]:continue
            if u:
                proposal=proposals.get(u['id']);s=unit_state(u,history,proposal);event=s['event'];status=s['status'];candidates=u['candidates']
                row=dict(region=u['id'],page=page['page'],columns=u['columns'],status=status,statusLabel=LABELS[status],
                    flags=u['flags'],baselineText=u['baselineText'],effectiveText=s['text'],
                    candidates=candidates,agreement=u['agreement'],revision=s['revision'],
                    evidence=u['evidence'],reviewer=event['reviewer'] if event else '',note=event['note'] if event else '',
                    reviewedAt=event['reviewedAt'] if event else '',selected=event['choice'] if event else '',sourceSha256=page['sourceSha256'])
            else:
                proposal=None;event=None
                counts['not_flagged']+=1;page_counts['not_flagged']=page_counts.get('not_flagged',0)+1
                row=dict(region=f'p{page["page"]:04d}-c{column["column"]:02d}',page=page['page'],columns=[column['column']],
                    status='not_flagged',statusLabel=LABELS['not_flagged'],flags=[],baselineText=column['text'],effectiveText=column['text'],candidates=[],agreement=None,revision='',evidence=None,reviewer='',note='',reviewedAt='',selected='',sourceSha256=page['sourceSha256'])
            row.update(sourceImage=page['sourceImage'],vlmProposal=proposal,
                vlmStatus=proposal['status'] if proposal else 'not_requested',
                vlmStatusLabel=PROPOSAL_LABELS[proposal['status']] if proposal else PROPOSAL_LABELS['not_requested'],
                humanStatus='人工已确认' if event and event.get('reviewerType')=='human' and event.get('humanConfirmed') and status in ['changed','kept','unchanged'] else '待人工回图确认' if u else '未触发局部复核·非人工确认')
            rows.append(row)
        text='\n'.join(replacement.get(c['column'],c['text']) for c in baseline['columns'] if replacement.get(c['column'],c['text']))
        if mapping_required and baseline.get('characterMappingSchema')!=SCHEMA:raise ValueError('本批要求逐字映射，但基线元数据缺失，不能导出为完整OCR产物。')
        if baseline.get('characterMappingSchema')==SCHEMA:
            from ocr_character_map import build_mapping
            mapping_sources=[]
            for column in baseline['columns']:
                unit=unit_by_column.get(column['column'])
                if unit and column['column']!=unit['columns'][0]:continue
                group=[c for c in baseline['columns'] if not unit or c['column'] in unit['columns']] if unit else [column]
                glyphs=[g for c in group for g in c.get('glyphs',[])]
                if unit:
                    state=unit_state(unit,history,proposals.get(unit['id']))
                    if state['event'] and state['status'] in ['kept','changed','unchanged']:
                        selected=next((c for c in unit['candidates'] if c['id']==state['event']['choice']),None)
                        if selected and (selected['id']!='baseline_small' or 'glyphs' in selected):
                            glyphs=selected.get('glyphs') or [dict(r,id=f'{unit["id"]}-{selected["id"]}-unlocated-{i:04d}',box=None,quad=None,score=None,column=unit['columns'][0]) for i,r in enumerate(characters(selected['text']))]
                mapping_sources.extend(glyphs)
            mapping=build_mapping(baseline,text,mapping_sources)
            mapping.update(runId=manifest['runId'],lastEvent=history[-1]['eventHash'] if history else '')
            map_path=directory/'character-maps'/f'{page["page"]:04d}.json'
            atomic_json(map_path,mapping)
            mapping_pages.append(dict(page=page['page'],status='available',file=str(map_path.relative_to(directory)),sha256=file_sha(map_path),sourceImage=mapping['sourceImage'],sourceSha256=mapping['sourceSha256'],textSha256=mapping['textSha256'],counts=mapping['counts']))
        else:mapping_pages.append(dict(page=page['page'],status='legacy_without_geometry',file=None))
        unresolved=sum(page_counts.get(k,0) for k in ['pending','review_failed','unresolved','deferred','stale'])
        status='候选生成未完成·保留基线' if not page.get('machineComplete') else '版面覆盖异常·待人工核定位' if page.get('layoutPending') else '局部复核仍待处理·整页未校' if unresolved else '局部复核项已处理·整页未校' if page['reviewUnits'] else '未触发局部复核·整页未校'
        page_states.append(dict(page=page['page'],status=status,counts=page_counts,wholePageProofread=False,layoutPending=page.get('layoutPending',False),machineComplete=page.get('machineComplete',False)))
        effective.append(f'===== 原 PDF 物理页 {page["page"]}｜{status} =====\n{text}\n')
    failed=[]
    for number in manifest['pages']:
        if number not in {p['page'] for p in pages if p.get('machineComplete')}:failed.append(number)
        if number not in {p['page'] for p in pages}:
            page_states.append(dict(page=number,status='small处理或修框计划失败·未生成完整候选',counts={},wholePageProofread=False,layoutPending=True,machineComplete=False))
    mapped_numbers={p['page'] for p in mapping_pages}
    mapping_pages.extend(dict(page=n,status='page_failed',file=None) for n in manifest['pages'] if n not in mapped_numbers)
    mapping_pages.sort(key=lambda x:x['page'])
    mapping_summary=dict(index='character-map-index.json',required=mapping_required,pages=len(mapping_pages),available=sum(p['status']=='available' for p in mapping_pages),legacyWithoutGeometry=sum(p['status']=='legacy_without_geometry' for p in mapping_pages),failed=sum(p['status']=='page_failed' for p in mapping_pages),humanReviewed=False)
    atomic_json(directory/'character-map-index.json',dict(schema='ocr-character-map-index-v1',runId=manifest['runId'],lastEvent=history[-1]['eventHash'] if history else '',coordinateUnit='original-image-pixel-edges',textOffsetUnit='UTF-16',pages=mapping_pages,humanReviewed=False))
    page_states.sort(key=lambda x:x['page'])
    snapshot=dict(schemaVersion=1,runId=manifest['runId'],exportedAt=now(),lastEvent=history[-1]['eventHash'] if history else '',
        configurationFingerprint=manifest.get('configurationFingerprint',''),modelWeights=manifest.get('configuration',{}).get('weights',{}),
        policy=manifest.get('configuration',{}).get('policy',{}),
        vlmSummary=vlm,characterMapping=mapping_summary,
        counts=counts,pageStates=page_states,failedPages=failed,regions=rows,
        scope='本机候选与局部回图处理状态；未触发不等于正确，整页不标已校勘；未确认处仍用small基线。')
    atomic_json(directory/'review-status.json',snapshot)
    if vlm.get('enabled'):atomic_json(directory/'vlm/summary.json',vlm)
    atomic_bytes(directory/'effective-text.txt',('\ufeff'+'\n'.join(effective)).encode())
    fields=['区域ID','PDF物理页','消费栏','处理状态','触发原因','small原文','派生正文','候选（含失败）','候选一致','revision','原图裁片','复核人','依据','复核时间','采纳来源','源图SHA256','原图路径','大模型建议状态','大模型建议','人工状态']
    buffer=io.StringIO();writer=csv.writer(buffer);writer.writerow(fields)
    for r in rows:
        writer.writerow([csv_cell(v) for v in [r['region'],r['page'],json.dumps(r['columns']),r['statusLabel'],'；'.join(r['flags']),r['baselineText'],r['effectiveText'],json.dumps(r['candidates'],ensure_ascii=False),r['agreement'],r['revision'],r['evidence']['path'] if r['evidence'] else '',r['reviewer'],r['note'],r['reviewedAt'],r['selected'],r['sourceSha256'],r['sourceImage'],r['vlmStatusLabel'],json.dumps(r['vlmProposal'],ensure_ascii=False),r['humanStatus']]])
    atomic_bytes(directory/'review-status.csv',('\ufeff'+buffer.getvalue()).encode())
    buffer=io.StringIO();writer=csv.writer(buffer);writer.writerow(['PDF物理页','页处理状态','候选生成完成','版面覆盖待核','整页已校勘','区域状态计数'])
    for p in page_states:writer.writerow([p['page'],p['status'],'是' if p['machineComplete'] else '否','是' if p['layoutPending'] else '否','否',json.dumps(p['counts'],ensure_ascii=False)])
    atomic_bytes(directory/'page-status.csv',('\ufeff'+buffer.getvalue()).encode())
    buffer=io.StringIO();writer=csv.writer(buffer)
    writer.writerow(['区域ID','PDF物理页','原图路径','原图SHA256','回图裁片','OCR候选','small原文','大模型建议状态','建议文本','建议依据','建议指纹','revision','人工状态','人工确认文本','人工复核人','人工依据'])
    for r in rows:
        if not r['evidence'] or r['humanStatus']=='人工已确认':continue
        v=r['vlmProposal'] or {}
        writer.writerow([csv_cell(x) for x in [r['region'],r['page'],r['sourceImage'],r['sourceSha256'],r['evidence']['path'],json.dumps(r['candidates'],ensure_ascii=False),r['baselineText'],r['vlmStatusLabel'],v.get('text',''),v.get('note',''),v.get('proposalFingerprint',''),r['revision'],r['humanStatus'],'','','']])
    atomic_bytes(directory/'human-review-queue.csv',('\ufeff'+buffer.getvalue()).encode())
    return snapshot

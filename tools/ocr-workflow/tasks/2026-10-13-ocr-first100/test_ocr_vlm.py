"""Suggestion-layer boundaries. All transports and human actors here are test doubles."""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image,ImageDraw
import ocr_vlm_review as vlm
from ocr_review_store import atomic_json,read,export_run,file_sha,apply_decisions,events,fingerprint
from ocr_vlm_store import load_suggestions,proposal_hash

class VLMTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.run=self.root/'run';self.run.mkdir()
        image=Image.new('RGB',(240,180),'white');draw=ImageDraw.Draw(image)
        for i in range(3):draw.rectangle((20+50*i,40,30+50*i,80),fill='black')
        self.source=self.root/'source.png';image.save(self.source)
        self.units=[];columns=[]
        for i in range(3):
            uid=f'p0005-c{i+1:02d}';box=[10+50*i,30,40+50*i,130];name=f'crops/{uid}.png'
            (self.run/'crops').mkdir(exist_ok=True);image.crop(box).save(self.run/name)
            col=dict(column=i+1,box=box,text='字',pieces=[dict(box=box,text='字',scores=[.9])]);columns.append(col)
            self.units.append(dict(id=uid,columns=[i+1],flags=['低分待复核'],baselineText='字',originalBoxes=[box],repairBoxes=None,
                candidates=[dict(id='baseline_small',status='ok',text='字'),dict(id='baseline_medium',status='ok',text='另')],agreement=False,
                evidence=dict(path=name,sha256=file_sha(self.run/name),box=box)))
        atomic_json(self.run/'manifest.json',dict(workspace=str(self.root),runId='fake-test-run',pages=[5]))
        atomic_json(self.run/'baseline/0005.json',dict(columns=columns,text='字\n字\n字'))
        self.machine=dict(page=5,sourceImage='source.png',sourceSha256=file_sha(self.source),baselineFile='baseline/0005.json',reviewUnits=self.units,machineComplete=True,layoutPending=False)
        atomic_json(self.run/'machine/0005.json',self.machine);export_run(self.run)
        self.calls=[]
    def tearDown(self):self.temp.cleanup()
    def fake(self,payload,key):
        self.calls.append(payload);assert key=='fake-unit-test-key'
        rows=json.loads(payload['messages'][0]['content'][0]['text'].split('输入数据：\n',1)[1])
        answers=[dict(id=r['id'],status='suggested',text='核字',note='测试桩，非真实看图') for r in rows]
        return dict(model='fake-test-model',choices=[dict(finish_reason='stop',message={'content':json.dumps({'results':answers},ensure_ascii=False)})],usage=dict(prompt_tokens=100,completion_tokens=30,prompt_cache_hit_tokens=0,prompt_cache_miss_tokens=100)),{'httpStatus':200,'requestId':'test-only'}
    def execute(self,send=None,**kwargs):
        with patch.object(vlm,'credentials',return_value='fake-unit-test-key'):
            return vlm.run_suggestions(self.run,send=send or self.fake,**kwargs)
    def decision(self,choice='vlm'):
        row=export_run(self.run)['regions'][0];proposal=row['vlmProposal'] or {}
        return dict(unitId=row['region'],expectedRevision=row['revision'],choice=choice,reviewer='自动测试虚构人员',
            reviewerType='human',humanConfirmed=True,note='测试夹具确认，不是真实人工验收。',imageChecked=True,evidence=row['evidence']['path'],proposalFingerprint=proposal.get('proposalFingerprint'))
    def test_suggestions_never_change_text_or_machine_and_resume_is_free(self):
        protected=[self.run/'machine/0005.json',self.run/'baseline/0005.json',self.run/'effective-text.txt'];before={str(p):file_sha(p) for p in protected}
        result=self.execute();self.assertEqual(len(self.calls),1);self.assertEqual(result['vlmSummary']['counts']['suggested'],3)
        self.assertEqual(before,{str(p):file_sha(p) for p in protected});self.assertEqual(events(self.run),[])
        requests={p.name:file_sha(p) for p in (self.run/'vlm/requests').glob('*.json')};proposals={p.name:file_sha(p) for p in (self.run/'vlm/proposals').glob('*.json')}
        self.execute();self.assertEqual(len(self.calls),1);self.assertEqual(requests,{p.name:file_sha(p) for p in (self.run/'vlm/requests').glob('*.json')});self.assertEqual(proposals,{p.name:file_sha(p) for p in (self.run/'vlm/proposals').glob('*.json')})
        self.assertEqual(result['vlmSummary']['accounting']['usage']['prompt_tokens'],100)
        self.assertTrue(all(r['humanStatus']=='待人工回图确认' for r in result['regions']))
        self.assertFalse(any(x['wholePageProofread'] for x in result['pageStates']))
        self.assertIn('待人工回图确认',(self.run/'human-review-queue.csv').read_text())
    def test_all_changes_require_explicit_human_and_current_proposal(self):
        self.execute()
        for field,bad in [('reviewerType','ai'),('humanConfirmed',False),('proposalFingerprint','stale'),('imageChecked',False)]:
            d=self.decision();d[field]=bad
            with self.assertRaises(ValueError):apply_decisions(self.run,[d])
        d=self.decision('baseline_medium');d['humanConfirmed']=False
        with self.assertRaises(ValueError):apply_decisions(self.run,[d])
        self.assertEqual(events(self.run),[])
        result=apply_decisions(self.run,[self.decision()]);self.assertEqual(result['regions'][0]['effectiveText'],'核字')
        self.assertEqual(result['regions'][0]['humanStatus'],'人工已确认');self.assertEqual(events(self.run)[0]['choice'],'vlm')
        self.assertIn('vlm',events(self.run)[0]['choice']);self.assertFalse(result['pageStates'][0]['wholePageProofread'])
    def test_pending_model_answer_is_not_adoptable(self):
        def pending(payload,key):
            data,http=self.fake(payload,key);answers=json.loads(data['choices'][0]['message']['content'])
            for a in answers['results']:a['status']='pending'
            data['choices'][0]['message']['content']=json.dumps(answers);return data,http
        result=self.execute(pending);self.assertEqual(result['vlmSummary']['counts']['model_pending'],3)
        with self.assertRaises(ValueError):apply_decisions(self.run,[self.decision()])
        self.execute();self.assertEqual(len(self.calls),1)
    def test_invalid_partial_or_truncated_response_is_whole_request_failure(self):
        def partial(payload,key):
            data,http=self.fake(payload,key);answer=json.loads(data['choices'][0]['message']['content']);answer['results'].pop();data['choices'][0]['message']['content']=json.dumps(answer);return data,http
        result=self.execute(partial);self.assertEqual(result['vlmSummary']['counts']['failed'],3)
        self.assertEqual(result['vlmSummary']['accounting']['successfulRequests'],0);self.assertEqual(result['regions'][0]['effectiveText'],'字')
    def test_truncation_rejected(self):
        def truncated(payload,key):
            data,http=self.fake(payload,key);data['choices'][0]['finish_reason']='length';return data,http
        self.assertEqual(self.execute(truncated)['vlmSummary']['counts']['failed'],3)
    def test_transport_failure_requires_explicit_retry_and_preserves_request(self):
        attempts=[]
        def fail(*args):attempts.append(1);raise TimeoutError('test')
        result=self.execute(fail,max_calls=2);self.assertEqual(len(attempts),1);self.assertEqual(result['vlmSummary']['counts']['failed'],3)
        self.execute(fail,max_calls=2);self.assertEqual(len(attempts),1)
        result=self.execute(max_calls=2,retry_failed=True);self.assertEqual(result['vlmSummary']['accounting']['requests'],2)
        self.assertEqual(result['vlmSummary']['counts']['suggested'],3);self.assertEqual(len(list((self.run/'vlm/proposal-history').glob('*.json'))),3)
    def test_unknown_interrupted_request_is_not_resent(self):
        def interrupt(*args):raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):self.execute(interrupt,max_calls=2)
        result=self.execute(max_calls=2);self.assertEqual(len(self.calls),0);self.assertEqual(result['vlmSummary']['counts']['failed'],3)
        self.assertEqual(result['vlmSummary']['accounting']['unresolvedBillingRequests'],1)
    def test_budget_prevents_any_paid_request_and_keeps_baseline(self):
        result=self.execute(max_usd=.000001);self.assertEqual(self.calls,[]);self.assertEqual(result['vlmSummary']['counts']['budget_deferred'],3)
        self.assertEqual(result['regions'][0]['effectiveText'],'字')
    def test_max_calls_is_cumulative_across_resume_and_failed_retries(self):
        def fail(*args):raise TimeoutError()
        self.execute(fail,max_calls=1);self.execute(max_calls=1,retry_failed=True)
        self.assertEqual(len(list((self.run/'vlm/requests').glob('*.json'))),1);self.assertEqual(self.calls,[])
    def test_missing_configuration_does_not_call_or_mark_success(self):
        with patch.object(vlm,'credentials',side_effect=ValueError('缺少配置')):
            result=vlm.run_suggestions(self.run,send=self.fake)
        self.assertEqual(self.calls,[]);self.assertEqual(result['vlmSummary']['counts']['configuration_missing'],3)
    def test_source_or_crop_changes_block_before_network(self):
        self.source.write_bytes(b'changed')
        with self.assertRaises(ValueError):self.execute()
        self.assertFalse(self.calls)
    def test_saved_original_copy_and_request_are_verified(self):
        self.execute();(self.run/'vlm/sources/0005.jpg').write_bytes(b'bad')
        with self.assertRaises(ValueError):export_run(self.run)
    def test_context_image_changes_are_rejected(self):
        self.execute();next((self.run/'vlm/context').glob('*.png')).write_bytes(b'wrong context')
        with self.assertRaises(ValueError):export_run(self.run)
    def test_changed_machine_invalidates_accepted_vlm_and_exports_baseline(self):
        self.execute();apply_decisions(self.run,[self.decision()]);m=read(self.run/'machine/0005.json');m['reviewUnits'][0]['candidates'][-1]['text']='新候选';atomic_json(self.run/'machine/0005.json',m)
        result=export_run(self.run);self.assertEqual(result['regions'][0]['status'],'stale');self.assertEqual(result['regions'][0]['effectiveText'],'字');self.assertEqual(result['regions'][0]['vlmStatus'],'stale_input')
    def test_new_suggestion_does_not_erase_unrelated_human_choice(self):
        self.execute();apply_decisions(self.run,[self.decision('baseline_small')])
        p=self.run/'vlm/proposals/p0005-c01.json';v=read(p);v.update(status='budget_deferred',canAdopt=False);v['proposalFingerprint']=proposal_hash(v);atomic_json(p,v)
        result=export_run(self.run);self.assertEqual(result['regions'][0]['status'],'kept');self.assertEqual(result['regions'][0]['effectiveText'],'字')
    def test_rehashed_tampered_proposal_does_not_match_raw_response(self):
        self.execute();p=self.run/'vlm/proposals/p0005-c01.json';v=read(p);v['text']='篡改';v['proposalFingerprint']=proposal_hash(v);atomic_json(p,v)
        with self.assertRaises(ValueError):export_run(self.run)
    def test_changed_settings_rejected_and_key_is_not_saved(self):
        self.execute()
        with self.assertRaises(ValueError):self.execute(max_calls=20)
        for p in (self.run/'vlm').rglob('*.json'):self.assertNotIn('fake-unit-test-key',p.read_text())
    def test_disagreement_triggers_even_without_existing_anomaly_flags(self):
        u=copy.deepcopy(self.units[0]);u['flags']=[];self.assertEqual(vlm.triggers(u),['候选分歧'])
    def test_high_score_audit_is_not_starved_by_anomalies(self):
        items=[dict(page={'page':5},unit={'id':str(i),'flags':['低分']},reasons=['异常区域']) for i in range(9)]
        audit=dict(page={'page':6},unit={'id':'audit','flags':['高分抽查']},reasons=['高分抽查'])
        groups=vlm.schedule(items+[audit]);self.assertEqual(groups[0][0]['unit']['id'],'audit')
    def test_healthy_high_score_audit_remains_a_candidate_not_correctness(self):
        u=copy.deepcopy(self.units[0]);u['flags']=['高分抽查'];u['candidates']=[u['candidates'][0]]
        self.assertEqual(vlm.triggers(u),['高分抽查'])
    def test_estimate_and_reservation_bound_known_usage(self):
        peak,off=vlm.estimate(dict(prompt_tokens=100,completion_tokens=30));self.assertAlmostEqual(peak,.000066);self.assertAlmostEqual(off,.000033)
        self.assertGreater(vlm.reservation('古籍',4),peak)
    def test_redirects_are_not_followed(self):self.assertIsNone(vlm.NoRedirect().redirect_request(None,None,302,'',{},'https://other.test'))

if __name__=='__main__':unittest.main()

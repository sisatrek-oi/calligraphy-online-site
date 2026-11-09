"""Regression checks for review safety, actual batching, and resumable failures."""
import copy, json, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image, ImageDraw
import ocr_review_pipeline as pipeline
from ocr_review_store import atomic_json, apply_decisions, events, export_run, file_sha, locked

class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.image=Image.new('RGB',(180,160),'white');ImageDraw.Draw(self.image).rectangle([60,65,75,100],fill='black')
        self.source=self.root/'image.png';self.image.save(self.source)
        self.column={'column':1,'box':[50,50,85,120],'text':'字','pieces':[{'box':[50,50,85,120],'text':'字','scores':[.999]}]}
        self.baseline={'source_page':5,'source_sha256':file_sha(self.source),'columns':[copy.deepcopy(self.column)],'text':'字','ink_pixels':500,'uncovered_ink_pixels':0}
    def tearDown(self):self.temp.cleanup()
    def unit(self):
        b=copy.deepcopy(self.baseline);b['columns'][0]['pieces'][0]['scores']=[.6]
        return pipeline.plan_units(b,self.image,[])[0]
    def fixture_store(self):
        run=self.root/'run';run.mkdir();atomic_json(run/'manifest.json',{'workspace':str(self.root),'runId':'test-run','pages':[5]})
        b=copy.deepcopy(self.baseline)
        b['columns']=[{'column':1,'box':[50,50,65,120],'text':'去。','pieces':[]},{'column':2,'box':[65,50,85,120],'text':'X','pieces':[]}];b['text']='去。\nX'
        atomic_json(run/'baseline/0005.json',b)
        evidence=run/'crops/p0005-c01-02.png';evidence.parent.mkdir();self.image.save(evidence)
        u={'id':'p0005-c01-02','columns':[1,2],'baselineText':'去。\nX','flags':['显式修框'],
           'candidates':[{'id':'baseline_small','text':'去。\nX','status':'ok'},{'id':'repaired_small','text':'法。','status':'ok'}],
           'agreement':False,'evidence':{'path':str(evidence.relative_to(run)),'sha256':file_sha(evidence)}}
        m={'page':5,'sourceImage':'image.png','sourceSha256':file_sha(self.source),'baselineFile':'baseline/0005.json','reviewUnits':[u],'machineComplete':True,'layoutPending':False}
        atomic_json(run/'machine/0005.json',m);return run,u
    def decision(self,run,choice='repaired_small'):
        row=export_run(run)['regions'][0]
        return {'unitId':row['region'],'expectedRevision':row['revision'],'choice':choice,'reviewer':'回图复核者',
                'note':'已查看对应源图裁片，合并两栏，不重复输出。','imageChecked':True,'evidence':row['evidence']['path']}
    def test_healthy_column_never_enters_medium_queue(self):
        policy=dict(pipeline.POLICY,highConfidenceAuditFraction=0)
        self.assertEqual(pipeline.plan_units(self.baseline,self.image,[],policy),[])
    def test_low_score_gets_original_medium_without_blanket_crop(self):
        unit=self.unit();self.assertIsNone(unit['repairBoxes'])
        calls=[]
        def engine(im,**flags):calls.append(flags);return SimpleNamespace(txts=['字'],scores=[.999])
        pipeline.complete_candidates(unit,self.image,lambda *_:self.fail('small should not rerun'),lambda:engine)
        self.assertEqual([x['id'] for x in unit['candidates']],['baseline_small','baseline_medium'])
        self.assertTrue(unit['agreement']);self.assertEqual(calls,[{'use_det':False,'use_cls':False,'return_word_box':True,'return_single_char_box':True}])
    def test_geometry_candidates_do_not_cross_neighbor_midpoints(self):
        a={'column':1,'box':[70,40,100,130],'pieces':[{'box':[70,40,100,80]},{'box':[70,80,100,130]}]}
        neighbors=[{'box':[20,40,60,130]},a,{'box':[110,40,140,130]}]
        boxes=pipeline.repaired_boxes(a,neighbors,self.image)
        self.assertGreaterEqual(boxes[0][0],65);self.assertLessEqual(boxes[0][2],105)
        self.assertEqual(boxes[0][3],boxes[1][1])
    def test_manual_plan_rejects_wrong_source_overlap_and_truncation(self):
        entry={'columns':[1],'boxes':[[45,40,95,130]],'sourceSha256':self.baseline['source_sha256'],'reason':'图上截字'}
        self.assertEqual(pipeline.validate_plan([entry],self.baseline,self.image),{1})
        for entries in [[dict(entry,sourceSha256='wrong')],[entry,entry],[dict(entry,boxes=[[60,60,65,90]])]]:
            with self.assertRaises(ValueError):pipeline.validate_plan(entries,self.baseline,self.image)
    def test_force_medium_review_does_not_change_crop(self):
        entry={'columns':[1],'sourceSha256':self.baseline['source_sha256'],'reason':'既有疑字，保持原框'}
        unit=pipeline.plan_units(self.baseline,self.image,[entry])[0]
        self.assertIsNone(unit['repairBoxes'])
        self.assertEqual(unit['originalBoxes'],[p['box'] for p in self.column['pieces']])
    def test_failure_is_recorded_and_retry_keeps_history(self):
        unit=self.unit()
        def fail():raise RuntimeError('medium unavailable')
        pipeline.complete_candidates(unit,self.image,None,fail)
        self.assertEqual(unit['candidates'][-1]['status'],'failed')
        def ok(im,**kw):return SimpleNamespace(txts=['复核字'],scores=[.99])
        pipeline.complete_candidates(unit,self.image,None,lambda:ok,retry_failed=True)
        self.assertEqual(unit['candidates'][-1]['text'],'复核字')
        self.assertEqual(unit['attemptHistory'][0]['error'],'medium unavailable')
    def test_no_adoption_without_image_evidence_even_when_models_agree(self):
        run,u=self.fixture_store();before=export_run(run)
        self.assertEqual(before['regions'][0]['effectiveText'],'去。\nX')
        bad=self.decision(run);bad['imageChecked']=False
        with self.assertRaises(ValueError):apply_decisions(run,[bad])
        self.assertEqual(events(run),[])
    def test_consumed_columns_are_replaced_once_and_machine_is_preserved(self):
        run,u=self.fixture_store();machine=file_sha(run/'machine/0005.json');base=file_sha(run/'baseline/0005.json')
        result=apply_decisions(run,[self.decision(run)])
        text=(run/'effective-text.txt').read_text();self.assertEqual(text.count('法。'),1)
        self.assertNotIn('去。',text);self.assertNotIn('\nX',text)
        self.assertEqual(result['counts']['changed'],1);self.assertFalse(result['pageStates'][0]['wholePageProofread'])
        self.assertEqual(file_sha(run/'machine/0005.json'),machine);self.assertEqual(file_sha(run/'baseline/0005.json'),base)
    def test_stale_revision_and_changed_source_cannot_overwrite_review(self):
        run,u=self.fixture_store();d=self.decision(run);apply_decisions(run,[d])
        with self.assertRaises(ValueError):apply_decisions(run,[d])
        self.source.write_bytes(b'changed')
        with self.assertRaises(ValueError):export_run(run)

    def test_character_export_uses_selected_repaired_candidate_geometry(self):
        run,u=self.fixture_store()
        b=json.loads((run/'baseline/0005.json').read_text())
        b.update(characterMappingSchema='ocr-character-map-v1',source_image='image.png',image_size=[180,160])
        for c in b['columns']:
            c['glyphs']=[dict(id=f'old-{c["column"]}-{i}',text=t,box=[50,50+i*20,65,70+i*20]) for i,t in enumerate(c['text'])]
        atomic_json(run/'baseline/0005.json',b)
        m=json.loads((run/'machine/0005.json').read_text())
        m['reviewUnits'][0]['candidates'][1]['glyphs']=[dict(id=f'new-{i}',text=t,box=[60,40+i*20,85,60+i*20]) for i,t in enumerate('法。')]
        atomic_json(run/'machine/0005.json',m)
        apply_decisions(run,[self.decision(run)])
        result=json.loads((run/'character-maps/0005.json').read_text())
        self.assertEqual(result['text'],'法。')
        self.assertEqual([g['glyphId'] for g in result['characters']],['new-0','new-1'])
        self.assertEqual(result['characters'][0]['box'],[60,40,85,60])
    def test_selected_candidate_without_geometry_never_borrows_baseline_boxes(self):
        run,u=self.fixture_store();b=json.loads((run/'baseline/0005.json').read_text())
        b.update(characterMappingSchema='ocr-character-map-v1',source_image='image.png',image_size=[180,160])
        for c in b['columns']:c['glyphs']=[dict(id=f'old-{c["column"]}-{i}',text=t,box=[50,50+i*20,65,70+i*20]) for i,t in enumerate(c['text'])]
        atomic_json(run/'baseline/0005.json',b)
        m=json.loads((run/'machine/0005.json').read_text());m['reviewUnits'][0]['candidates'][1]['glyphs']=[];atomic_json(run/'machine/0005.json',m)
        apply_decisions(run,[self.decision(run)])
        result=json.loads((run/'character-maps/0005.json').read_text())
        self.assertEqual(result['text'],'法。');self.assertEqual(''.join(g['text'] for g in result['sourceGlyphs']),'法。')
        self.assertTrue(all(g['box'] is None and '-unlocated-' in g['id'] for g in result['sourceGlyphs']))
        self.assertTrue(all(r['box'] is None for r in result['characters']))

    def test_mapping_index_distinguishes_legacy_and_failed_pages(self):
        run,u=self.fixture_store();m=json.loads((run/'manifest.json').read_text());m['pages']=[5,6];atomic_json(run/'manifest.json',m)
        result=export_run(run);index=json.loads((run/'character-map-index.json').read_text())
        self.assertEqual([p['status'] for p in index['pages']],['legacy_without_geometry','page_failed'])
        self.assertEqual(result['characterMapping']['available'],0)
        self.assertFalse(index['humanReviewed'])

    def test_required_mapping_cannot_silently_export_text_only(self):
        run,u=self.fixture_store();m=json.loads((run/'manifest.json').read_text());m['configuration']={'characterMapping':{'required':True}};atomic_json(run/'manifest.json',m)
        with self.assertRaisesRegex(ValueError,'元数据缺失'):export_run(run)

    def test_preview_uses_effective_candidate_pool_and_checks_mapping_version(self):
        from build_character_preview import build
        from ocr_character_map import text_sha
        run,u=self.fixture_store();b=json.loads((run/'baseline/0005.json').read_text())
        b.update(characterMappingSchema='ocr-character-map-v1',source_image='image.png',image_size=[180,160])
        for c in b['columns']:c['glyphs']=[dict(id=f'old-{c["column"]}-{i}',text=t,box=[50,50+i*20,65,70+i*20]) for i,t in enumerate(c['text'])]
        atomic_json(run/'baseline/0005.json',b);m=json.loads((run/'machine/0005.json').read_text());m['reviewUnits'][0]['candidates'][1]['glyphs']=[dict(id=f'new-{i}',text=t,box=[60,40+i*20,85,60+i*20]) for i,t in enumerate('法。')];atomic_json(run/'machine/0005.json',m)
        apply_decisions(run,[self.decision(run)])
        reviewed=self.root/'reviewed.json';atomic_json(reviewed,dict(pages=[dict(page=5,eligible=True,text='法。',source=dict(textSha256=text_sha('法。')))]))
        out=self.root/'preview';build(run,out,reviewed);d=json.loads((out/'data/0005.json').read_text())
        self.assertEqual([g['id'] for g in d['sourceGlyphs']],['new-0','new-1'])
        for v in d['versions']:self.assertEqual([r['glyphId'] for r in v['mapping']['characters']],['new-0','new-1'])
        mapping=run/'character-maps/0005.json';mapping.write_text(mapping.read_text()+' ')
        with self.assertRaisesRegex(ValueError,'索引版本不匹配'):build(run,self.root/'bad-preview')

    def test_pending_is_not_marked_correct_and_reopening_keeps_prior_event(self):
        run,u=self.fixture_store();apply_decisions(run,[self.decision(run)])
        pending=self.decision(run,'pending');pending.update(note='另一个字形未能确定，保留待核。')
        result=apply_decisions(run,[pending])
        self.assertEqual(len(events(run)),2);self.assertEqual(result['counts']['unresolved'],1)
        self.assertEqual(result['regions'][0]['effectiveText'],'去。\nX')
    def test_pending_without_image_check_never_claims_image_was_checked(self):
        run,u=self.fixture_store();d=self.decision(run,'pending');d.update(imageChecked=False,evidence='')
        result=apply_decisions(run,[d]);self.assertEqual(result['counts']['deferred'],1)
        d=self.decision(run,'pending');d['evidence']='wrong.png'
        with self.assertRaises(ValueError):apply_decisions(run,[d])
    def test_missing_page_is_visible_in_page_export(self):
        run,u=self.fixture_store();m=json.loads((run/'manifest.json').read_text());m['pages']=[5,6];atomic_json(run/'manifest.json',m)
        result=export_run(run);self.assertEqual(result['failedPages'],[6]);self.assertEqual(len(result['pageStates']),2)
        self.assertIn('失败',(run/'page-status.csv').read_text())
    def test_machine_retry_invalidates_previous_adoption(self):
        run,u=self.fixture_store();apply_decisions(run,[self.decision(run)])
        m=json.loads((run/'machine/0005.json').read_text());m['reviewUnits'][0]['agreement']=True;atomic_json(run/'machine/0005.json',m)
        result=export_run(run);self.assertEqual(result['counts']['stale'],1)
        self.assertEqual(result['regions'][0]['effectiveText'],'去。\nX')
    def test_corrupt_event_chain_and_parallel_write_are_rejected(self):
        run,u=self.fixture_store();d=self.decision(run)
        with locked(run):
            with self.assertRaises(ValueError):apply_decisions(run,[d])
        apply_decisions(run,[d]);p=next((run/'events').glob('*.json'));event=json.loads(p.read_text());event['text']='tampered';atomic_json(p,event)
        with self.assertRaises(ValueError):export_run(run)
    def test_csv_formula_is_escaped_but_json_history_is_exact(self):
        run,u=self.fixture_store();d=self.decision(run);d['note']='=HYPERLINK("test")';apply_decisions(run,[d])
        self.assertIn("'=HYPERLINK",(run/'review-status.csv').read_text())
        self.assertEqual(events(run)[0]['note'],d['note'])
    def test_real_batch_entry_resume_and_normal_medium_laziness(self):
        import rapidocr
        root=self.root/'work';source=root/'tasks/2026-09-28-shulun-fullbook-screening/images/page-004.jpg';source.parent.mkdir(parents=True);self.image.save(source)
        models=root/'models';models.mkdir()
        for size in ['small','medium']:(models/f'PP-OCRv6_rec_{size}.onnx').write_bytes(size.encode())
        baseline=copy.deepcopy(self.baseline);baseline.update(source_sha256=file_sha(source),source_image=str(source.relative_to(root)),image_size=list(self.image.size),characterMappingSchema='ocr-character-map-v1')
        baseline['columns'][0]['glyphs']=[dict(id='fixture-g1',text='字',box=[60,65,76,101])]
        def recognize(*a,**k):return copy.deepcopy(baseline)
        created=[]
        def factory(params):created.append(params['Rec.model_type']);return lambda *a,**k:SimpleNamespace(txts=['字'],scores=[.99])
        run=root/'run'
        with patch.object(pipeline,'WORK',root),patch.object(rapidocr,'RapidOCR',factory),patch.dict(pipeline.POLICY,highConfidenceAuditFraction=0):
            result=pipeline.run_batch(run,[5],recognize,{1:[5]},models)
            self.assertEqual(len(created),1);self.assertFalse(result['failedPages']);self.assertEqual(result['counts']['not_flagged'],1)
            self.assertTrue(json.loads((run/'manifest.json').read_text())['configuration']['characterMapping']['required'])
            self.assertEqual(result['characterMapping']['available'],1)
            index=json.loads((run/'character-map-index.json').read_text());self.assertEqual(index['pages'][0]['sha256'],file_sha(run/index['pages'][0]['file']))
            first=file_sha(run/'baseline/0005.json');created.clear()
            pipeline.run_batch(run,[5],lambda *a,**k:self.fail('must resume'),{1:[5]},models)
            self.assertEqual(created,[]);self.assertEqual(file_sha(run/'baseline/0005.json'),first)
            bad=copy.deepcopy(baseline);bad.pop('characterMappingSchema')
            rejected=pipeline.run_batch(root/'missing-mapping',[5],lambda *a,**k:bad,{1:[5]},models)
            self.assertEqual(rejected['failedPages'],[5]);self.assertFalse((root/'missing-mapping/baseline/0005.json').exists())
            self.assertEqual(json.loads((root/'missing-mapping/character-map-index.json').read_text())['pages'][0]['status'],'page_failed')
            with self.assertRaises(ValueError):pipeline.run_batch(self.root,[5],recognize,{1:[5]},models)
    def test_batch_recovers_after_interruption_between_units(self):
        import rapidocr
        root=self.root/'work';source=root/'tasks/2026-09-28-shulun-fullbook-screening/images/page-004.jpg';source.parent.mkdir(parents=True);self.image.save(source)
        models=root/'models';models.mkdir()
        for size in ['small','medium']:(models/f'PP-OCRv6_rec_{size}.onnx').write_bytes(size.encode())
        baseline=copy.deepcopy(self.baseline);baseline['columns'][0]['pieces'][0]['scores']=[.6];baseline['source_sha256']=file_sha(source)
        baseline.update(source_image=str(source.relative_to(root)),image_size=list(self.image.size),characterMappingSchema='ocr-character-map-v1')
        baseline['columns'][0]['glyphs']=[dict(id='fixture-g1',text='字',box=[60,65,76,101])]
        factory=lambda params:lambda *a,**k:SimpleNamespace(txts=['字'],scores=[.99])
        run=root/'run'
        with patch.object(pipeline,'WORK',root),patch.object(rapidocr,'RapidOCR',factory):
            with patch.object(pipeline,'complete_candidates',side_effect=KeyboardInterrupt):
                with self.assertRaises(KeyboardInterrupt):pipeline.run_batch(run,[5],lambda *a,**k:copy.deepcopy(baseline),{1:[5]},models)
            self.assertFalse(json.loads((run/'machine/0005.json').read_text())['machineComplete'])
            result=pipeline.run_batch(run,[5],lambda *a,**k:self.fail('must retain baseline'),{1:[5]},models)
            self.assertFalse(result['failedPages']);self.assertEqual(result['counts']['pending'],1)

if __name__=='__main__':unittest.main()

import unittest
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path
import sys,json,os
sys.path.insert(0,str(Path(__file__).parent))
import contextual_ocr_validate as runner
from ocr_integrity import validate_batch,omission_reason

class OcrIntegrityTests(unittest.TestCase):
    def test_suggestions_never_change_source(self):
        source='半及字数元，其余原文不动。'
        r=validate_batch({'pages':[{'source_page':259,'suggestions':[{'before':'半及','after':'卞壶','reason':'猜测'}]}]},[{'page':259,'ocr':source}])[259]
        self.assertEqual(r['normalized'],source)
        self.assertEqual(r['conservative'],source)
        self.assertEqual(r['suggestions'][0]['status'],'pending-image-review')
    def test_invalid_output_rejected(self):
        batch=[{'page':259,'ocr':'羊欣字敬元'}]
        for payload in [
            {'pages':[{'source_page':259,'normalized':'从略','conservative':'卞壶字望之','uncertainties':[]}]},
            {'pages':[{'source_page':259,'suggestions':[]},{'source_page':259,'suggestions':[]}]},
            {'pages':[]},
            {'pages':[{'source_page':259,'suggestions':[{'before':'不存在','after':'某','reason':'猜测'}]}]},
        ]:
            with self.assertRaises(ValueError):validate_batch(payload,batch)
    def test_omission_detected(self):
        for value in ['（语义版从略，关键候选见 uncertainties）','以下书家传授姓名，残误甚多','羊欣']:
            self.assertIsNotNone(omission_reason(value,'原文'*200))
        self.assertIsNone(omission_reason('',''))
    def test_failed_last_response_is_not_written(self):
        with TemporaryDirectory() as tmp:
            src=Path(tmp)/'source.txt';out=Path(tmp)/'out.jsonl'
            src.write_text('===== 原 PDF 物理页 259｜分册第 1 页 =====\n羊欣字敬元\n')
            args=['runner','--source',str(src),'--output',str(out),'--retries','2','--sleep','0']
            with patch.object(sys,'argv',args),patch.dict(os.environ,{'MODEL_API_URL':'https://invalid.invalid','MODEL_API_KEY':'test','MODEL_NAME':'test'}),patch.object(runner,'request_model',return_value={'pages':[]}),patch.object(runner.time,'sleep'):
                self.assertEqual(runner.main(),1)
            self.assertEqual(out.read_text(),'')
    def test_legacy_resume_refused(self):
        with TemporaryDirectory() as tmp:
            out=Path(tmp)/'out.jsonl';out.write_text(json.dumps({'source_page':259,'normalized':'旧结果'})+'\n')
            with self.assertRaises(ValueError):runner.read_done(out,[{'page':259,'ocr':'原文'}])

if __name__=='__main__':unittest.main()

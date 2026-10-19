import importlib.util
import json
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('fulltext_review',Path(__file__).with_name('review-fulltext.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class FullTextReviewTests(unittest.TestCase):
    def test_healthy_columns_are_not_skipped(self):
        base={'source_page':129,'columns':[{'column':1,'text':'甲','box':[1,1,2,2]},{'column':2,'text':'乙','box':[2,2,3,3]}]}
        unit={'id':'p0129-c02','columns':[2],'baselineText':'乙','candidates':[]}
        units=module.units_for(base,{'reviewUnits':[unit]})
        self.assertEqual([u['columns'] for u in units],[[1],[2]])
        self.assertEqual(units[0]['baselineText'],'甲')
    def test_overlapping_columns_fail(self):
        with self.assertRaises(ValueError):module.units_for({'columns':[]},{'reviewUnits':[{'columns':[1]},{'columns':[1]}]})
    def test_response_rejects_missing_duplicate_and_truncated_regions(self):
        row={'id':'a','status':'reviewed','text':'甲','note':'字形可见'}
        def response(rows,finish='stop'):return {'choices':[{'finish_reason':finish,'message':{'content':json.dumps({'results':rows})}}]}
        self.assertEqual(module.answers_for(response([row]),['a'])['a']['text'],'甲')
        for value in [response([]),response([row,row]),response([row],'length'),response([{**row,'note':''}])]:
            with self.assertRaises(ValueError):module.answers_for(value,['a'])
if __name__=='__main__':unittest.main()

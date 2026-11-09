import unittest
from ocr_character_map import align_indices, build_mapping, characters, text_sha, unrotate_quad


class CharacterMapTests(unittest.TestCase):
    def baseline(self,text):
        rows=[dict(id=f'g{i}',text=c,box=[10,i*20,30,(i+1)*20],quad=None,score=.9,column=1,piece=1) for i,c in enumerate(text)]
        return dict(source_page=13,source_image='test.jpg',source_sha256='sha',image_size=[100,100],text=text,columns=[dict(column=1,text=text,glyphs=rows)])

    def test_inverse_pil_rotation_and_offset(self):
        self.assertEqual(unrotate_quad([[0,0],[40,0],[40,20],[0,20]],[100,200,120,300]),[[120,200],[120,240],[100,240],[100,200]])

    def test_utf16_and_exact_raw_line_endings(self):
        text='甲𠮷\r\n乙'
        rows=list(characters(text))
        self.assertEqual([(r['start'],r['end']) for r in rows],[(0,1),(1,3),(3,4),(4,5),(5,6)])
        result=build_mapping(self.baseline('甲𠮷乙'),text)
        self.assertEqual(result['text'],text)
        self.assertEqual(result['textSha256'],text_sha(text))
        self.assertEqual(result['characters'][-1]['glyphId'],'g2')

    def test_insertion_does_not_shift_following_glyphs(self):
        m=build_mapping(self.baseline('甲乙丙'),'甲新乙丙')['characters']
        self.assertEqual([r['glyphId'] for r in m],['g0',None,'g1','g2'])
        self.assertIsNone(m[1]['box'])

    def test_deletion_retains_unmatched_source_glyph(self):
        m=build_mapping(self.baseline('甲乙丙'),'甲丙')
        self.assertEqual([r['glyphId'] for r in m['characters']],['g0','g2'])
        self.assertEqual(m['unmatchedGlyphs'][0]['id'],'g1')

    def test_same_length_substitution_retains_location_and_label(self):
        m=build_mapping(self.baseline('甲乙丙'),'甲丁丙')['characters'][1]
        self.assertEqual(m['glyphId'],'g1')
        self.assertEqual(m['status'],'substituted')
        self.assertEqual(m['ocrText'],'乙')

    def test_repeated_character_ambiguity_is_not_invented(self):
        m=build_mapping(self.baseline('甲甲乙'),'甲乙')['characters']
        self.assertIsNone(m[0]['box'])
        self.assertEqual(m[0]['status'],'ambiguous')
        self.assertEqual(m[1]['glyphId'],'g2')

    def test_repeated_insertion_is_ambiguous(self):
        self.assertEqual(align_indices('甲乙','甲甲乙'),[(None,'ambiguous'),(None,'ambiguous'),(1,'equal')])

    def test_new_punctuation_has_no_fake_box(self):
        m=build_mapping(self.baseline('甲乙'),'甲，乙')['characters']
        self.assertEqual(m[1]['status'],'inserted')
        self.assertIsNone(m[1]['box'])
        self.assertEqual(m[2]['glyphId'],'g1')

    def test_spacing_is_preserved_without_a_box(self):
        m=build_mapping(self.baseline('甲乙'),'甲 \n乙')['characters']
        self.assertEqual(''.join(r['text'] for r in m),'甲 \n乙')
        self.assertTrue(all(r['box'] is None for r in m[1:3]))

    def test_empty_and_legacy_geometry(self):
        self.assertEqual(build_mapping(self.baseline('甲'),'')['characters'],[])
        b=self.baseline('甲');del b['columns'][0]['glyphs']
        self.assertEqual(build_mapping(b,'甲')['counts'],{'no_geometry':1})
        self.assertEqual(align_indices('','甲'),[(None,'inserted')])

    def test_mapping_is_independently_bound_to_each_text_version(self):
        b=self.baseline('甲乙')
        self.assertNotEqual(build_mapping(b,'甲乙')['textSha256'],build_mapping(b,'甲丙')['textSha256'])
        self.assertEqual(b['text'],'甲乙')

    def test_hidden_machine_labels_keep_original_utf16_coordinates(self):
        m=build_mapping(self.baseline('甲乙'),'[001] 甲\n[002] 乙',ignore_line_labels=True)
        visible=[r for r in m['characters'] if r['status'] not in ['line_label','spacing']]
        self.assertEqual([(r['text'],r['start'],r['glyphId']) for r in visible],[('甲',6,'g0'),('乙',14,'g1')])

    def test_alignment_resource_limit_is_explicit(self):
        self.assertEqual(align_indices('甲'*2100,'乙'*2100)[0],(None,'alignment_limit'))


if __name__=='__main__':unittest.main()

"""Regression for whitespace-sensitive vertical numerals; no model downloads."""
import copy
import unittest
from types import SimpleNamespace
import numpy as np
from PIL import Image, ImageDraw
import ocr_review_pipeline as pipeline


class BlankMarginTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new('RGB', (80, 500), 'white')
        draw = ImageDraw.Draw(self.image)
        # Three separate strokes form one numeral, not three text segments.
        for y in [300, 315, 330]:
            draw.rectangle([25, y, 50, y + 2], fill='black')
        self.boxes = [[20, 30, 60, 350]]

    def test_trim_long_margin_keeps_all_strokes_and_source_coordinates(self):
        boxes = pipeline.trim_blank_margins(self.image, self.boxes)
        self.assertEqual(boxes, [[20, 295, 60, 350]])
        self.assertEqual(self.boxes, [[20, 30, 60, 350]])
        ink = np.asarray(self.image.convert('L')) < 160
        self.assertEqual(int(ink[30:350, 20:60].sum()), int(ink[295:350, 20:60].sum()))

    def test_even_one_dark_pixel_is_preserved(self):
        self.image.putpixel((30, 170), (0, 0, 0))
        self.assertEqual(pipeline.trim_blank_margins(self.image, self.boxes), [[20, 165, 60, 350]])

    def test_short_margins_and_blank_images_unchanged(self):
        boxes = [[20, 280, 60, 350]]
        self.assertEqual(pipeline.trim_blank_margins(self.image, boxes), boxes)
        self.assertEqual(pipeline.trim_blank_margins(Image.new('RGB', self.image.size, 'white'), self.boxes), self.boxes)

    def test_bottom_margin_and_multiple_pieces(self):
        boxes = [[20, 280, 60, 500], [0, 0, 10, 500]]
        self.assertEqual(pipeline.trim_blank_margins(self.image, boxes), [[20, 280, 60, 338], boxes[1]])

    def test_healthy_score_still_flags_geometry_and_adds_separate_candidates(self):
        column = {'column': 1, 'box': self.boxes[0], 'text': '二',
                  'pieces': [{'box': self.boxes[0], 'text': '二', 'scores': [.999]}]}
        baseline = {'source_page': 5, 'source_sha256': 'test', 'columns': [column]}
        units = pipeline.plan_units(baseline, self.image, [], dict(pipeline.POLICY, highConfidenceAuditFraction=0))
        self.assertEqual(len(units), 1)
        unit = units[0]
        old = copy.deepcopy(unit['candidates'][0])
        engine = lambda *a, **kw: SimpleNamespace(txts=['三'], scores=[.999])
        pipeline.complete_candidates(unit, self.image, engine, lambda: engine)
        self.assertEqual(unit['candidates'][0], old)
        self.assertEqual(unit['originalBoxes'], self.boxes)
        self.assertEqual({c['id'] for c in unit['candidates']},
                         {'baseline_small', 'baseline_medium', 'trimmed_small', 'trimmed_medium'})
        self.assertEqual(next(c['boxes'] for c in unit['candidates'] if c['id'] == 'trimmed_small'), [[20, 295, 60, 350]])
        self.assertEqual(unit['baselineText'], '二')
        # Completed candidates are not rerun while resuming a batch.
        pipeline.complete_candidates(unit, self.image, lambda *a, **kw: self.fail('rerun'), lambda: self.fail('rerun'))

    def test_numeral_boundary_merges_contiguous_pieces_but_never_crosses_columns(self):
        def piece(box, text):
            return {'box': box, 'text': text, 'scores': [.999]}
        a = {'column': 1, 'box': [20, 260, 60, 350], 'text': '一二体', 'pieces': [
            piece([20, 260, 60, 310], '一'), piece([20, 310, 60, 350], '二体')]}
        b = {'column': 2, 'box': [65, 260, 75, 350], 'text': '三', 'pieces': [piece([65, 260, 75, 350], '三')]}
        self.assertEqual(pipeline.joined_numeral_boxes([a, b]), [[20, 260, 60, 350], [65, 260, 75, 350]])
        baseline = {'source_page': 27, 'source_sha256': 'test', 'columns': [a]}
        unit = pipeline.plan_units(baseline, self.image, [], dict(pipeline.POLICY, highConfidenceAuditFraction=0))[0]
        engine = lambda *args, **kw: SimpleNamespace(txts=['三体'], scores=[.99])
        pipeline.complete_candidates(unit, self.image, engine, lambda: engine)
        self.assertEqual(unit['baselineText'], '一二体')
        self.assertTrue({'joined_small', 'joined_medium'} <= {c['id'] for c in unit['candidates']})
        self.assertEqual(unit['joinBoxes'], [[20, 260, 60, 350]])

    def test_join_preserves_gaps_and_non_numeral_boundaries(self):
        p = lambda b, t: {'box': b, 'text': t}
        columns = [{'pieces': [p([20, 20, 60, 60], '一'), p([20, 70, 60, 100], '一'),
                               p([20, 100, 60, 160], '家')]}]
        self.assertEqual(pipeline.joined_numeral_boxes(columns), [p['box'] for p in columns[0]['pieces']])


if __name__ == '__main__':
    unittest.main()

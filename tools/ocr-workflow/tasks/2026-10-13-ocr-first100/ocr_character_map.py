"""Version-bound glyph geometry and conservative TXT alignment; never edits source text."""
from array import array
from collections import Counter
import hashlib
import math
import re

SCHEMA = 'ocr-character-map-v1'


def text_sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def characters(text):
    offset = 0
    for char in text:
        end = offset + len(char.encode('utf-16-le')) // 2
        yield dict(text=char, start=offset, end=end)
        offset = end


def unrotate_quad(points, box):
    """Inverse of PIL crop(...).rotate(90, expand=True), in pixel-edge coordinates."""
    left, top, right, _ = box
    return [[round(right - y, 3), round(top + x, 3)] for x, y in points]


def recognition_glyphs(output, crop_size, box):
    import numpy as np
    from rapidocr.cal_rec_boxes.main import CalRecBoxes
    texts = list(output.txts or [])
    text = ''.join(texts)
    if not text:
        return [], None
    if len(texts) != 1 or not output.word_results:
        return [dict(**r, box=None, quad=None, score=None) for r in characters(text)], 'missing_ctc'
    width, height = crop_size
    chars, quads, scores = CalRecBoxes().cal_ocr_word_box(
        text, np.array([[0, 0], [width, 0], [width, height], [0, height]]),
        output.word_results[0], True)
    if ''.join(chars) != text or len(chars) != len(quads):
        return [dict(**r, box=None, quad=None, score=None) for r in characters(text)], 'ctc_text_mismatch'
    # The recognizer provides centres; its boxes are estimates, not pixel-perfect segmentation.
    quads = CalRecBoxes.adjust_box_overlap(quads)
    result = []
    for i, (row, quad) in enumerate(zip(characters(text), quads)):
        page_quad = unrotate_quad(quad, box)
        xs, ys = zip(*page_quad)
        bounds = [max(box[0], math.floor(min(xs))), max(box[1], math.floor(min(ys))),
                  min(box[2], math.ceil(max(xs))), min(box[3], math.ceil(max(ys)))]
        valid = bounds[0] < bounds[2] and bounds[1] < bounds[3]
        score = float(scores[i]) if i < len(scores) else None
        result.append(dict(**row, box=bounds if valid else None,
                           quad=page_quad if valid else None, score=score))
    return result, None


def _distances(source, target):
    rows = [array('I', range(len(target) + 1))]
    for i, char in enumerate(source, 1):
        row = array('I', [i])
        prev = rows[-1]
        for j, other in enumerate(target, 1):
            row.append(min(prev[j] + 1, row[j-1] + 1, prev[j-1] + (char != other)))
        rows.append(row)
    return rows


def align_indices(source, target):
    """Only locate a target character when every optimal edit alignment agrees on its source."""
    if source == target:
        return [(i, 'equal') for i in range(len(target))]
    if (len(source) + 1) * (len(target) + 1) > 4_000_000:
        return [(None, 'alignment_limit') for _ in target]
    forward = _distances(source, target)
    backward = _distances(source[::-1], target[::-1])
    n, m, total = len(source), len(target), forward[-1][-1]
    result = []
    for j in range(m):
        options = set()
        for i in range(n + 1):
            if forward[i][j] + 1 + backward[n-i][m-j-1] == total:
                options.add(None)
            if i < n and forward[i][j] + (source[i] != target[j]) + backward[n-i-1][m-j-1] == total:
                options.add(i)
        index = next(iter(options)) if len(options) == 1 else None
        status = 'equal' if index is not None and source[index] == target[j] else 'substituted' if index is not None else 'inserted' if options == {None} else 'ambiguous'
        result.append((index, status))
    return result


def build_mapping(baseline, text, source_rows=None, ignore_line_labels=False):
    """Map an exact page TXT; blank characters keep UTF-16 ranges without fake image boxes."""
    if source_rows is None:
        source_rows = []
        for column in baseline['columns']:
            if source_rows:
                source_rows.append(dict(text='\n', box=None))
            source_rows.extend(column.get('glyphs') or [dict(text=c, box=None) for c in column['text']])
    source = [r for r in source_rows if not r['text'].isspace()]
    ignored=set()
    if ignore_line_labels:
        for match in re.finditer(r'(?m)^\[\d{3,}\][ \t]?',text):
            start=len(text[:match.start()].encode('utf-16-le'))//2
            ignored.update(range(start,start+len(match.group().encode('utf-16-le'))//2))
    target = [r for r in characters(text) if not r['text'].isspace() and r['start'] not in ignored]
    links = iter(align_indices(''.join(r['text'] for r in source), ''.join(r['text'] for r in target)))
    rows, used = [], set()
    for row in characters(text):
        if row['start'] in ignored:
            rows.append(dict(**row,status='line_label',glyphId=None,box=None,quad=None,score=None))
            continue
        if row['text'].isspace():
            rows.append(dict(**row, status='spacing', glyphId=None, box=None, quad=None, score=None))
            continue
        index, status = next(links)
        glyph = source[index] if index is not None else {}
        bounds = glyph.get('box')
        if index is not None:
            used.add(index)
        if index is not None and not bounds:
            status = 'no_geometry'
        rows.append(dict(**row, status=status, glyphId=glyph.get('id'), box=bounds,
                         quad=glyph.get('quad'), score=glyph.get('score'),
                         ocrText=glyph.get('text'), column=glyph.get('column'), piece=glyph.get('piece')))
    return dict(schema=SCHEMA, page=baseline['source_page'], sourceImage=baseline['source_image'],
                sourceSha256=baseline['source_sha256'], imageSize=baseline.get('image_size'),
                text=text, textSha256=text_sha(text), coordinateUnit='original-image-pixel-edges',
                textOffsetUnit='UTF-16', geometryMethod='CTC centres; estimated glyph boxes',
                humanReviewed=False, ignoredLineLabels=ignore_line_labels, characters=rows,sourceGlyphs=source,
                unmatchedGlyphs=[dict(r, sourceIndex=i) for i, r in enumerate(source) if i not in used],
                counts=dict(Counter(r['status'] for r in rows)))

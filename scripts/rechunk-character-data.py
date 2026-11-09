"""Repackage exact existing gzip bytes into immutable 128 KiB transport pieces."""
from pathlib import Path
import gzip, hashlib, json

site = Path(__file__).resolve().parents[1]
index_path = site / 'proofread/index.json'
index = json.loads(index_path.read_text())
digest = lambda data: hashlib.sha256(data).hexdigest()
count = 0
for entry in index['chapters']:
    transport = entry['transport']
    pieces = []
    for chunk in transport['chunks']:
        data = (site / 'proofread' / chunk['file']).read_bytes()
        assert len(data) == chunk['bytes'] and digest(data) == chunk['sha256']
        pieces.append(data)
    compressed = b''.join(pieces)
    assert len(compressed) == transport['bytes'] and digest(compressed) == transport['sha256']
    raw = gzip.decompress(compressed)
    assert len(raw) == transport['decodedBytes'] and digest(raw) == entry['sha256']
    chunks = []
    for start in range(0, len(compressed), 128 * 1024):
        data = compressed[start:start + 128 * 1024]
        sha = digest(data)
        filename = f'chapters/{sha}.gzpart'
        (site / 'proofread' / filename).write_bytes(data)
        chunks.append(dict(file=filename, bytes=len(data), sha256=sha))
    transport['chunks'] = chunks
    count += len(chunks)
# Keep previous files for readers with a previously cached catalogue.
temporary = index_path.with_suffix('.json.tmp')
temporary.write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')))
temporary.replace(index_path)
print(json.dumps(dict(chapters=len(index['chapters']), chunks=count, maxChunkBytes=128*1024)))

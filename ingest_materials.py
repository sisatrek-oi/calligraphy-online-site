"""Local PDF intake: stream, validate and publish without overwriting sources."""
import hashlib
import uuid
from pathlib import Path

MAX_PDF_BYTES = 512 * 1024 * 1024


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def receive_pdf(service, stream, size, filename):
    from ancient_ingest import IngestError
    if not isinstance(size, int) or size <= 0 or size > MAX_PDF_BYTES:
        raise IngestError('PDF 大小须在 1 字节至 512 MB 之间', 413)
    if (not filename or len(filename) > 180 or '/' in filename or '\\' in filename
            or any(ord(c) < 32 for c in filename) or not filename.lower().endswith('.pdf')):
        raise IngestError('请选择有效的 PDF 文件名')
    staging = service.runtime_root / 'uploads'
    staging.mkdir(parents=True, exist_ok=True)
    temporary = staging / f'{uuid.uuid4().hex}.pdf'
    try:
        remaining = size
        with temporary.open('xb') as handle:
            while remaining:
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    raise IngestError('PDF 上传不完整，请重试')
                handle.write(block)
                remaining -= len(block)
        with temporary.open('rb') as handle:
            if not handle.read(1024).lstrip().startswith(b'%PDF-'):
                raise IngestError('文件内容不是 PDF')
        info = service._pdf_info(temporary)
        if info['pages'] < 1 or info['encrypted']:
            raise IngestError('PDF 无可读页面或已加密，请先解锁')
        digest = fingerprint(temporary)
        with service._lock:
            existing = next((p for p in service._pdf_paths() if service._fingerprint(p) == digest), None)
            if existing:
                return {'pdfId': service._pdf_id(existing), 'duplicate': True, 'sha256': digest}
            # The fingerprint identifies content; a separate directory owns this version's TXT files.
            directory = service.inbox_root / '2026-09-27-shulun-platform-import' / digest
            directory.mkdir(parents=True, exist_ok=True)
            destination = directory / filename
            temporary.replace(destination)
            return {'pdfId': service._pdf_id(destination), 'duplicate': False, 'sha256': digest}
    finally:
        temporary.unlink(missing_ok=True)

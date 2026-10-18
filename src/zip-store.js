// Standard ZIP, uncompressed entries. UTF-8 names and CRC32 are understood by
// system archive tools; no CDN or ZIP library is needed for text-sized exports.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files, at = new Date()) {
  if (!Array.isArray(files) || !files.length || files.length > 65535 || !Number.isFinite(at.getTime())) throw new Error('导出文件清单无效。');
  const names = new Set();
  const entries = files.map(file => {
    if (typeof file.name !== 'string' || !file.name || /[\\/\0]/u.test(file.name) || ['.', '..'].includes(file.name) || names.has(file.name)) throw new Error('导出文件名无效或重复。');
    names.add(file.name);
    const name = encoder.encode(file.name);
    const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    if (!(data instanceof Uint8Array) || name.length > 65535 || data.length > 0xffffffff) throw new Error('导出文件内容或大小无效。');
    return { name, data, crc: crc32(data) };
  });
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0);
  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  if (localSize + centralSize + 22 > 0xffffffff) throw new Error('导出包过大，请先保留进度备份。');
  const bytes = new Uint8Array(localSize + centralSize + 22), view = new DataView(bytes.buffer);
  const year = Math.max(1980, Math.min(2107, at.getUTCFullYear()));
  const date = ((year - 1980) << 9) | ((at.getUTCMonth()+1) << 5) | at.getUTCDate();
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >>> 1);
  const u16 = (offset, value) => view.setUint16(offset, value, true);
  const u32 = (offset, value) => view.setUint32(offset, value, true);
  let offset = 0;
  for (const e of entries) {
    e.offset = offset;
    u32(offset, 0x04034b50); u16(offset+4, 20); u16(offset+6, 0x0800);
    u16(offset+8, 0); u16(offset+10, time); u16(offset+12, date);
    u32(offset+14, e.crc); u32(offset+18, e.data.length); u32(offset+22, e.data.length);
    u16(offset+26, e.name.length); u16(offset+28, 0);
    bytes.set(e.name, offset+30); bytes.set(e.data, offset+30+e.name.length);
    offset += 30 + e.name.length + e.data.length;
  }
  for (const e of entries) {
    u32(offset, 0x02014b50); u16(offset+4, 20); u16(offset+6, 20); u16(offset+8, 0x0800);
    u16(offset+10, 0); u16(offset+12, time); u16(offset+14, date);
    u32(offset+16, e.crc); u32(offset+20, e.data.length); u32(offset+24, e.data.length);
    u16(offset+28, e.name.length); u32(offset+42, e.offset);
    bytes.set(e.name, offset+46); offset += 46 + e.name.length;
  }
  u32(offset, 0x06054b50); u16(offset+8, entries.length); u16(offset+10, entries.length);
  u32(offset+12, centralSize); u32(offset+16, localSize);
  return bytes;
}

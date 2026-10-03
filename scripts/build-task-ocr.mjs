import fs from 'node:fs';
import { isTaskPage, taskPageCount } from '../src/screening-page-policy.js';

// Keep each retained page block byte-for-byte, including its original page labels.
for (const part of [1, 4]) {
  const data = new URL('../screening-data/', import.meta.url);
  const source = fs.readFileSync(new URL(`part-${part}-ocr.txt`, data), 'utf8');
  const index = JSON.parse(fs.readFileSync(new URL(`part-${part}.json`, data), 'utf8'));
  const headings = [...source.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
  if (headings.length !== index.pages.length || headings.some((h, i) => Number(h[1]) !== index.pages[i].page || Number(h[2]) !== index.pages[i].local))
    throw new Error(`Part ${part}: OCR page labels do not match source index`);
  const retained = headings.flatMap((h, i) => isTaskPage(Number(h[1]))
    ? [source.slice(h.index, headings[i + 1]?.index ?? source.length)] : []);
  if (retained.length !== taskPageCount(index.start, index.end)) throw new Error(`Part ${part}: task page count mismatch`);
  fs.writeFileSync(new URL(`part-${part}-task-ocr.txt`, data), source.slice(0, headings[0].index) + retained.join(''));
  console.log(`Part ${part}: ${retained.length} task pages`);
}

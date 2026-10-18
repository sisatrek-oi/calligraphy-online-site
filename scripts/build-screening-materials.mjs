import fs from 'node:fs';
import crypto from 'node:crypto';
import { validCollation, publicationSummary } from '../src/team-collation.js';
import { validTargeted, targetedSummary } from '../src/targeted-ocr.js';
const root = new URL('../screening-data/', import.meta.url);
fs.mkdirSync(new URL('materials/', root), { recursive: true });
for (let part = 1; part <= 4; part++) {
  const read = suffix => fs.readFileSync(new URL(`part-${part}${suffix}`, root), 'utf8').replace(/^\uFEFF/, '');
  const index = JSON.parse(read('.json'));
  const ocr = read('-ocr.txt');
  const headings = [...ocr.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
  const layout = JSON.parse(read('-layout.json'));
  const contextual = JSON.parse(read('-contextual.json'));
  const publishedPath = new URL(`part-${part}-collated.json`, root);
  const published = fs.existsSync(publishedPath) ? JSON.parse(fs.readFileSync(publishedPath, 'utf8')) : null;
  if (published && (published.version !== 1 || published.part !== part || !Array.isArray(published.pages))) throw new Error('Invalid collated source');
  const collated = new Map();
  for (const item of published?.pages || []) {
    if (!validCollation(item, item.page) || collated.has(item.page) || !index.pages.some(p => p.page === item.page)) throw new Error('Invalid collated page');
    collated.set(item.page, item);
  }
  const targetedPath = new URL(`part-${part}-targeted.json`, root);
  const targetedPayload = fs.existsSync(targetedPath) ? JSON.parse(fs.readFileSync(targetedPath, 'utf8')) : null;
  if (targetedPayload && (targetedPayload.version !== 1 || targetedPayload.part !== part || !Array.isArray(targetedPayload.pages))) throw new Error('Invalid targeted source');
  const targeted = new Map();
  for (const item of targetedPayload?.pages || []) {
    // Full-page reviews can supersede a partial draft; retain both audit layers.
    if (!validTargeted(item, item.page) || targeted.has(item.page) || !index.pages.some(p => p.page === item.page)) throw new Error('Invalid targeted page');
    targeted.set(item.page, item);
  }
  if (headings.length !== index.pages.length) throw new Error('OCR page count mismatch');
  const pages = index.pages.map((item, i) => {
    if (+headings[i][1] !== item.page || layout.pages[i].page !== item.page || contextual.pages[i].page !== item.page) throw new Error('Source page mismatch');
    const {conservative, normalized, uncertainties} = contextual.pages[i];
    const raw = ocr.slice(headings[i].index+headings[i][0].length,headings[i+1]?.index??ocr.length).trim();
    if (targeted.has(item.page) && !validTargeted(targeted.get(item.page), item.page, raw)) throw new Error('Targeted base does not match raw OCR');
    return {page:item.page,ocr:raw,layout:layout.pages[i],contextual:{conservative,normalized,uncertainties},...(collated.has(item.page)?{collated:collated.get(item.page)}:{}),...(targeted.has(item.page)?{targeted:targeted.get(item.page)}:{})};
  });
  const materials = {};
  for (let offset = 0; offset < pages.length; offset += 16) {
    const chunk = pages.slice(offset, offset + 16);
    const content = JSON.stringify({version:1,part,pages:chunk})+'\n';
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0,12);
    const name = `materials/part-${part}-${chunk[0].page}-${hash}.json`;
    fs.writeFileSync(new URL(name, root), content);
    for (const item of chunk) materials[item.page] = name;
  }
  const indexPages = index.pages.map(item => ({...item,
    ...(collated.has(item.page)?{publication:publicationSummary(collated.get(item.page))}:{}),
    ...(targeted.has(item.page)?{targetedSummary:targetedSummary(targeted.get(item.page))}:{})}));
  fs.writeFileSync(new URL(`part-${part}-index.json`, root), JSON.stringify({...index,pages:indexPages,materials})+'\n');
}

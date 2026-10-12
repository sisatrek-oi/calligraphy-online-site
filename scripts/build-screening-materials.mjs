import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../screening-data/', import.meta.url);
fs.mkdirSync(new URL('materials/', root), { recursive: true });
for (let part = 1; part <= 4; part++) {
  const read = suffix => fs.readFileSync(new URL(`part-${part}${suffix}`, root), 'utf8').replace(/^\uFEFF/, '');
  const index = JSON.parse(read('.json'));
  const ocr = read('-ocr.txt');
  const headings = [...ocr.matchAll(/^===== 原 PDF 物理页 (\d+)｜分册第 (\d+) 页 =====\r?$/gm)];
  const layout = JSON.parse(read('-layout.json'));
  const contextual = JSON.parse(read('-contextual.json'));
  if (headings.length !== index.pages.length) throw new Error('OCR page count mismatch');
  const pages = index.pages.map((item, i) => {
    if (+headings[i][1] !== item.page || layout.pages[i].page !== item.page || contextual.pages[i].page !== item.page) throw new Error('Source page mismatch');
    const {conservative, normalized, uncertainties} = contextual.pages[i];
    return {page:item.page,ocr:ocr.slice(headings[i].index+headings[i][0].length,headings[i+1]?.index??ocr.length).trim(),layout:layout.pages[i],contextual:{conservative,normalized,uncertainties}};
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
  fs.writeFileSync(new URL(`part-${part}-index.json`, root), JSON.stringify({...index,materials})+'\n');
}

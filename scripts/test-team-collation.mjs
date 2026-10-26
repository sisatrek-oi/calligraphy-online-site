import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { teamRelease, publicationSummary } from '../src/team-collation.js';
import { draftForPage } from '../src/ocr-source-policy.js';
import { createMaterialLoader } from '../src/screening-loader.js';
import { pageMetrics } from '../src/task-metrics.js';
const read = name => fs.readFileSync(new URL(`../screening-data/${name}`, import.meta.url), 'utf8');
const releases = [1, 2].map(part => JSON.parse(read(`part-${part}-collated.json`)));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

test('484 reviewed pages retain source hashes and honest completion labels including newly reviewed 329', () => {
  let completed = 0, changes = 0;
  for (const release of releases) {
    const summary = teamRelease.parts[release.part];
    assert.equal(release.pages.length, summary.pages);
    assert.equal(release.pages.filter(p => p.pending.length).length, summary.pending);
    assert.equal(new Set(release.pages.map(p => p.page)).size, summary.pages);
    for (const page of release.pages) {
      assert.equal(sha(page.memberText), page.memberTextSha256);
      const image = fs.readFileSync(new URL(`../screening-data/scans/page-${String(page.page).padStart(4,'0')}.jpg`, import.meta.url));
      assert.equal(sha(image), page.imageSha256);
      assert.equal(page.status, page.pending.length ? '已修订·待核' : '已修改完毕');
      if (page.pending.length) assert.ok(page.humanSource || /【待核：/.test(page.text));
      else completed++;
      changes += page.corrections.length;
      assert.ok(page.text.length > page.memberText.length * .65);
    }
    const txt = read(`part-${release.part}-collated.txt`);
    const csv = read(`part-${release.part}-collated-status.csv`);
    for (const page of release.pages) {
      assert.ok(txt.includes(page.text));
      assert.ok(csv.includes(`${page.page},${page.status},${page.corrections.length},${page.pending.length},${page.reviewedAt}`));
    }
  }
  assert.equal(completed, 409); assert.equal(changes, 83);
  assert.deepEqual(releases[1].pages.map(p=>p.page), [...Array.from({length:169},(_,i)=>259+i),...Array.from({length:67},(_,i)=>461+i)]);
});

test('published corrections are default only for pages without a personal draft; metrics stay unchanged', () => {
  const collated = releases[1].pages[0];
  const item = {page:259,ocr:'旧OCR',collated};
  assert.equal(draftForPage(item).text, collated.text);
  for (const known of [true,false]) for (const verified of [true,false]) {
    const saved = {text:'[001] 个人校勘',verified,checks:{wording:true},verifiedBy:'成员',verifiedAt:'旧时间',
      edits:[{before:'甲',after:'乙'}],...(known?{metricBaseline:{version:1,text:'旧比较稿',label:'旧底稿'}}:{})};
    const review = {collation:saved}; const before = JSON.stringify(review);
    const metric = pageMetrics({...item,collated:undefined},review);
    assert.equal(draftForPage(item,review),saved);
    assert.deepEqual(pageMetrics(item,review),metric);
    assert.equal(JSON.stringify(review),before);
  }
});

test('source missing glyphs, blank pages and stroke figures remain distinguishable from unresolved readings', () => {
  const pages = new Map(releases.flatMap(r=>r.pages).map(p=>[p.page,p]));
  assert.match(pages.get(39).text,/每作一□/);
  assert.match(pages.get(39).text,/□□□□，如屈折钢钩/);
  assert.equal(pages.get(39).pending.length,0);
  assert.equal(pages.get(34).facsimiles.length,1);
  assert.equal([...pages.get(34).text.matchAll(/〔原图笔画[1-7]〕/g)].length,7);
  for (const n of [16,20,30,36,296,300,308,324,328]) assert.match(pages.get(n).text,/空白页/);
});

test('all active material chunks carry exactly the approved revisions and keep unpublished pages without revisions',async()=>{
  for (let part=1;part<=4;part++) {
    const d = JSON.parse(read(`part-${part}-index.json`));
    const loader = createMaterialLoader(d,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(read(url.replace('./screening-data/','')))})});
    await loader.ensureAll();
    const revised = d.pages.filter(p=>p.collated);
    assert.equal(revised.length,teamRelease.parts[part]?.pages || 0);
    for (const page of revised) assert.deepEqual(page.publication,publicationSummary(page.collated));
    if (part===2) assert.equal(d.pages.find(p=>p.page===329).collated.reviewedBy,'郑雨荻');
  }
});

test('mismatched or missing revision metadata rejects a whole chunk without partial attachment',async()=>{
  const collated = releases[1].pages[0];
  const source = {page:259,ocr:'原文',layout:{text:'原文'},contextual:{conservative:'原文',normalized:'原文',uncertainties:[]}};
  for (const malformed of [undefined,{...collated,status:'已修改完毕',pending:[{before:'字'}]}]) {
    const d = {part:2,pages:[{page:259,publication:publicationSummary(collated)}],materials:{259:'sample.json'}};
    const loader = createMaterialLoader(d,{fetcher:async()=>({ok:true,json:async()=>({version:1,part:2,pages:[{...source,...(malformed?{collated:malformed}:{})}]})})});
    await assert.rejects(loader.ensurePage(259),/不完整/);
    assert.equal(d.pages[0].ocr,undefined);
  }
});

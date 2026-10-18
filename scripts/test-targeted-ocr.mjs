import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { validTargeted, targetedSummary, targetedRelease, applyTargeted, targetedLabel } from '../src/targeted-ocr.js';
import { createMaterialLoader } from '../src/screening-loader.js';
import { draftForPage } from '../src/ocr-source-policy.js';
import { makeDraft } from '../src/collation-core.js';
import { pageMetrics } from '../src/task-metrics.js';
const read = path => fs.readFileSync(new URL(`../screening-data/${path}`, import.meta.url));
const json = path => JSON.parse(read(path));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const payloads = [1,4].map(part => json(`part-${part}-targeted.json`));
const pages = payloads.flatMap(p => p.pages);

test('62 unique image-verified regions retain honest partial-page scope and unchanged text outside approved spans', () => {
  assert.equal(pages.length,22);
  const regions=pages.flatMap(p=>p.regions);
  assert.equal(new Set(regions.map(r=>r.id)).size,62);
  assert.equal(regions.filter(r=>!r.pending).length,61);
  assert.deepEqual(regions.filter(r=>r.pending).map(r=>r.id),['p0828-c07-s03']);
  for (const page of pages) {
    assert.equal(validTargeted(page,page.page,page.baseText),true);
    assert.equal(page.wholePageReviewed,false);
    assert.equal(sha(page.baseText),page.baseTextSha256);
    assert.equal(sha(read(`scans/page-${String(page.page).padStart(4,'0')}.jpg`)),page.imageSha256);
    const original=Array.from(page.baseText), after=Array.from(page.text);
    let a=0,b=0;
    for (const r of [...page.regions].sort((x,y)=>x.publicationStart-y.publicationStart)) {
      const unchanged=original.slice(a,r.publicationStart);
      assert.equal(after.slice(b,b+unchanged.length).join(''),unchanged.join(''));
      b+=unchanged.length;
      assert.equal(after.slice(b,b+Array.from(r.after).length).join(''),r.after);
      b+=Array.from(r.after).length;a=r.publicationEnd;
    }
    assert.equal(after.slice(b).join(''),original.slice(a).join(''));
    for (const r of page.regions) assert.ok(read(`targeted-20261018/crops/${r.id}.png`).length>100);
  }
  for (const release of payloads) {
    const summary=targetedRelease.parts[release.part];
    assert.equal(release.pages.length,summary.pages);
    assert.equal(release.pages.flatMap(p=>p.regions).length,summary.regions);
  }
  assert.match(pages.find(p=>p.page===62).text,/法。$/);
  assert.match(pages.find(p=>p.page===100).text,/上 之\n下。/);
  assert.doesNotMatch(pages.find(p=>p.page===100).text,/下\s*下/);
});

test('published partial layers are default only for untouched pages and never change personal drafts or comparison baselines', async () => {
  for (const part of [1,4]) {
    const index=json(`part-${part}-index.json`);
    const loader=createMaterialLoader(index,{fetcher:async path=>({ok:true,json:async()=>json(path.replace('./screening-data/',''))})});
    await loader.ensureAll();
    const targeted=index.pages.filter(p=>p.targeted);
    assert.equal(targeted.length,targetedRelease.parts[part].pages);
    for (const p of targeted) {
      assert.deepEqual(p.targetedSummary,targetedSummary(p.targeted));
      assert.match(targetedLabel(p),p.collated ? /已纳入团队复核/ : /整页未校/);
      assert.equal(draftForPage(p).text,p.collated ? p.collated.text : makeDraft(p.targeted.text));
      for (const verified of [true,false]) {
        const review={collation:{text:'[001] 个人𢬍稿',verified,checks:{wording:true},verifiedBy:'原成员',verifiedAt:'旧时间',metricBaseline:{version:1,text:'旧比较稿',label:'旧标签'},edits:[{before:'甲',after:'乙'}]}};
        const before=JSON.stringify(review),metric=pageMetrics({...p,targeted:undefined},review);
        assert.equal(draftForPage(p,review),review.collation);
        assert.deepEqual(pageMetrics(p,review),metric);
        assert.equal(JSON.stringify(review),before);
      }
    }
  }
});

test('an omitted, tampered or falsely whole-page approved targeted layer rejects the entire chunk atomically', async () => {
  const good=pages.find(p=>p.page===820);
  for (const bad of [undefined,{...good,wholePageReviewed:true},{...good,text:good.text+'未核改写'}, {...good,baseText:'另一份OCR'}, {...good,regions:[{...good.regions[0],after:undefined}]}]) {
    const index={part:4,pages:[{page:820,targetedSummary:targetedSummary(good)},{page:821}],materials:{820:'bad',821:'bad'}};
    const chunk={version:1,part:4,pages:[{page:820,ocr:good.baseText,layout:{text:'底稿'},contextual:{conservative:'底稿',normalized:'底稿',uncertainties:[]},...(bad?{targeted:bad}:{})},{page:821,ocr:'后页',layout:{text:'后页'},contextual:{conservative:'后页',normalized:'后页',uncertainties:[]}}]};
    const loader=createMaterialLoader(index,{fetcher:async()=>({ok:true,json:async()=>chunk})});
    await assert.rejects(loader.ensurePage(820),/不完整/);
    assert.equal(index.pages[0].ocr,undefined);assert.equal(index.pages[1].ocr,undefined);
  }
  assert.equal(applyTargeted('甲𢬍乙',[{publicationStart:1,publicationEnd:2,publicationBefore:'𢬍',after:'擫'}]),'甲擫乙');
});

test('reference corrections are source-faithful and a remaining uncertain hand radical is visibly pending', () => {
  const fixes=json('targeted-20261018/reference-corrections.json');
  assert.equal(fixes.filter(x=>x.status==='已修改完毕').length,10);
  assert.equal(fixes.filter(x=>x.status!=='已修改完毕').length,1);
  const refs=new Map([1,2].flatMap(n=>json(`part-${n}-collated.json`).pages).map(p=>[p.page,p]));
  for (const f of fixes.filter(x=>x.status==='已修改完毕')) {
    assert.ok(refs.get(f.page).text.includes(f.after));
    assert.ok(refs.get(f.page).corrections.some(c=>c.id===f.id));
  }
  assert.match(refs.get(274).text,/恃乎幼好/);
  assert.match(refs.get(269).text,/史侍御惟则/); // other occurrence is not globally normalized
  assert.match(refs.get(263).text,/东官侍书/);
  assert.match(refs.get(298).text,/钩【待核：原录厌】讦/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createMaterialLoader } from '../src/screening-loader.js';
import { defaultDraftText, draftForPage } from '../src/ocr-source-policy.js';
import { publicationLabel, teamRelease } from '../src/team-collation.js';
import { targetedLabel } from '../src/targeted-ocr.js';

const read = name => fs.readFileSync(new URL(`../screening-data/${name}`, import.meta.url));
const json = name => JSON.parse(read(name));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const release = json('part-4-collated.json');

test('fourth submission publishes only 15 checked pages with immutable member and image evidence', () => {
  assert.deepEqual(release.pages.map(p => p.page), [...Array.from({length:70}, (_,i) => 787+i),...Array.from({length:16}, (_,i) => 952+i)]);
  assert.equal(release.pages.filter(p => !p.pending.length).length, 75);
  assert.equal(release.pages.reduce((n,p) => n+p.pending.length, 0), 12);
  assert.deepEqual(teamRelease.parts[4], {pages:86, complete:75, pending:11});
  for (const p of release.pages) {
    assert.equal(sha(p.memberText), p.memberTextSha256);
    assert.equal(sha(read(`scans/page-${String(p.page).padStart(4,'0')}.jpg`)), p.imageSha256);
    assert.equal(p.status, p.pending.length ? '已修订·待核' : '已修改完毕');
    if(!p.humanSource)assert.equal([...p.text.matchAll(/【待核：/g)].length, p.pending.length);
    assert.ok(read('part-4-collated.txt').toString().includes(p.text));
    assert.ok(read('part-4-collated-status.csv').toString().includes(`${p.page},${p.status},${p.corrections.length},${p.pending.length},${p.reviewedAt}`));
    for (const f of p.facsimiles || []) assert.ok(read(f.src.replace('./screening-data/', '')).length > 100);
  }
});

test('full-page source and status take precedence on overlapping pages, while regional evidence and personal drafts survive', async () => {
  const index = json('part-4-index.json');
  const loader = createMaterialLoader(index, {fetcher:async path => ({ok:true,json:async()=>json(path.replace('./screening-data/',''))})});
  await loader.ensureAll();
  assert.equal(index.pages.filter(p=>p.collated).length, 86);
  assert.deepEqual(index.pages.filter(p=>p.collated && p.targeted).map(p=>p.page), [787,791,800,807,808,810,811,814,820,826,828,831,832,840,848]);
  for (const n of [791,800]) {
    const p = index.pages.find(p=>p.page===n);
    assert.equal(defaultDraftText(p), p.collated.text);
    assert.match(publicationLabel(p), /已修订·待核/);
    assert.doesNotMatch(targetedLabel(p), /整页未校/);
    const saved = {text:'个人稿',verified:false,metricBaseline:{text:'原底稿'}};
    assert.equal(draftForPage(p,{collation:saved}),saved);
    assert.deepEqual(p.collated.previousTargetedRegions,p.targeted.regions.map(r=>r.id));
  }
  assert.equal(index.pages.find(p=>p.page===804).collated.reviewedBy,'帅睿');
  assert.equal(index.pages.find(p=>p.page===828).targeted.regions.filter(r=>r.pending).length,1);
});

test('source omissions, duplicate passages and already-correct member readings are distinguished', () => {
  const pages = new Map(release.pages.map(p=>[p.page,p]));
  assert.match(pages.get(790).text,/晋帖/);
  assert.match(pages.get(795).text,/「尒」字/);
  assert.match(pages.get(797).memberText,/既为中国/);
  assert.match(pages.get(797).text,/既为中国/);
  assert.match(pages.get(800).text,/虑虒尺/);
  assert.match(pages.get(801).text,/闇然浑古/);
  assert.match(pages.get(802).text,/《庾亮德政碑》/);
  assert.equal(pages.get(803).text.split('然无完白笔力').length-1,1);
});


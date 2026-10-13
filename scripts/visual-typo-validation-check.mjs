import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8798';
const output = path.resolve(process.env.OUTPUT_DIR || '../../2026-10-13-typo-validation');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const key = 'shulun-screening-v1-part-2';
const check = (name, value) => { assert.ok(value, name); results.push(name); };
const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const ready = async () => {
  await page.waitForSelector('#collationText');
  await page.waitForFunction(() => document.querySelector('#scanWrap img')?.naturalWidth > 0);
};
const go = async number => {
  await page.goto(`${base}/screening.html?part=2&page=${number}`, { waitUntil:'networkidle' });
  await ready();
  await page.locator('#openTextEditor').click();
};
try {
  await go(259);
  check('exactly one confirmation checkbox', await page.locator('[data-check]').count() === 1);
  await page.locator('#verifyNext').click();
  check('missing name still blocks completion', await page.locator('#person').evaluate(el => el === document.activeElement));
  await page.locator('#person').fill('错字流程隔离测试');
  const text = '甲，乙。□【待核：字】\n甲，乙。□【待核：字】\n[009]';
  await page.locator('#editText').fill(text);
  await page.locator('#verifyNext').click();
  check('unchecked page remains draft', page.url().includes('page=259') && !(await saved()).reviews[259].collation.verified);
  await page.locator('[data-check="wording"]').check();
  await page.locator('#verifyNext').click();
  await page.waitForURL('**page=260'); await ready();
  const first = (await saved()).reviews[259].collation;
  check('single check accepts symbols, numbering, empty column, duplicates and count warning without note', first.verified && first.text === text && Object.keys(first.checks).length === 1);
  check('verification records person and time', first.verifiedBy === '错字流程隔离测试' && !!first.verifiedAt);
  await go(259);
  check('reload preserves verified status', (await saved()).reviews[259].collation.verified && await page.locator('[data-check]').isChecked());
  await page.locator('#validate').click();
  check('advisory issues remain visible after verification', (await page.locator('#validation').innerText()).includes('标记'));
  await page.locator('#closeReviewDrawer').click();
  for (const [selector, file] of [['#exportTxt', 'test.txt'], ['#exportChecks', 'test.csv']]) {
    const download = page.waitForEvent('download');
    await page.locator(selector).click();
    await (await download).saveAs(path.join(output, file));
  }
  const txt = await fs.readFile(path.join(output, 'test.txt'), 'utf8');
  const csv = await fs.readFile(path.join(output, 'test.csv'), 'utf8');
  check('TXT carries current scope, single check and untouched body', txt.includes('本轮错字核对') && txt.includes('[x] 已对照原页核对本页错字') && txt.includes(text));
  check('CSV carries single check and verified state', csv.includes('错字核对') && !csv.includes('跨页核对') && csv.includes('"259","1","已校验"'));
  await page.locator('#openTextEditor').click();
  await page.locator('#editText').fill(text + '丙');
  check('editing invalidates prior confirmation', !(await saved()).reviews[259].collation.verified && !(await page.locator('[data-check]').isChecked()));
  await page.locator('#editText').fill('[001]\n[002]');
  await page.locator('[data-check]').check();
  await page.locator('#verifyNext').click();
  check('empty numbered body remains blocked', page.url().includes('page=259') && (await page.locator('#drawerMessage').innerText()).includes('正文为空'));
  await page.locator('#editText').fill('[001] 【空白页】');
  await page.locator('[data-check]').check();
  await page.locator('#verifyNext').click();
  await page.waitForURL('**page=260'); await ready();
  check('explicit blank scan notation is supported', (await saved()).reviews[259].collation.verified);
  await go(260);
  await page.locator('#editText').fill('书法文字');
  await page.locator('[data-check]').check();
  await page.evaluate(() => {
    window.testOriginalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('shulun-screening')) throw new DOMException('Full','QuotaExceededError'); return window.testOriginalSet.call(this,key,value); };
  });
  await page.locator('#verifyNext').click();
  check('failed persistence does not navigate or save completed state', page.url().includes('page=260') && !(await saved()).reviews[260].collation.verified);
  await page.evaluate(() => { Storage.prototype.setItem = window.testOriginalSet; });
  await page.locator('#retrySave').click();
  check('failed save remains retryable', (await saved()).reviews[260].collation.verified);
  // Import a real-format legacy backup through the UI, including one unfinished page.
  await page.locator('#closeReviewDrawer').click();
  await page.locator('.extra-tools > summary').click();
  page.once('dialog', dialog => dialog.accept());
  const legacy = { version:1,part:2,person:'旧进度测试',lastPage:259,reviews:{
    259:{collation:{text:'[001] 旧稿',checks:{order:true,wording:true,continuity:true},verified:true,verifiedBy:'旧成员',verifiedAt:'2026-10-01',metricBaseline:{version:1,text:'[001] 旧字',label:'旧底稿'}}},
    260:{collation:{text:'[001] 未完稿',checks:{wording:true},verified:false}},
  }};
  await page.locator('#backupFile').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await page.waitForURL('**page=259'); await ready();
  check('legacy backup preserves original completed record and partial draft', JSON.stringify((await saved()).reviews) === JSON.stringify(legacy.reviews));
  check('legacy completion count is correct', (await page.locator('#progress').innerText()).includes('已校验 1 /'));
  await page.locator('#openTextEditor').click();
  for (const [width,height] of [[1440,900],[694,800],[390,667]]) {
    await page.setViewportSize({width,height});
    await page.locator('#editText').focus();
    const box = await page.locator('#verifyNext').boundingBox();
    const checkbox = await page.locator('[data-check]').boundingBox();
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight);
    check(`fixed confirmation and completion visible at ${width}x${height}`, noScroll && box.y >= 0 && box.y+box.height <= height && checkbox.y >= 0 && checkbox.y+checkbox.height <= height);
    await page.screenshot({path:path.join(output,`editor-${width}.png`)});
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({results,errors},null,2));
  console.log(`${results.length} browser assertions passed: ${output}`);
} finally { await browser.close(); }

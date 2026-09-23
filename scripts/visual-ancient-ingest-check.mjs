import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8766";
const outputDir = path.resolve("docs/superpowers/verification/ancient-ingest");
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const viewport of [{ width: 1440, height: 900, name: "desktop" }, { width: 390, height: 844, name: "mobile" }]) {
    const page = await browser.newPage({ viewport });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${viewport.name}: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`${viewport.name}: ${error.message}`));
    await page.goto(`${baseUrl}/index.html?reload=20260922-ancient-ingest-v1#ingest`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector(".ingest-page .ingest-setup", { timeout: 20000 });
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(`${viewport.name}: ingest setup did not render\n${body.slice(0, 1200)}\n${errors.join("\n")}\n${error.message}`);
    }
    const targetOption = await page.locator('[data-ingest-pdf-select] option').evaluateAll((options) => {
      const option = options.find((item) => item.textContent.includes("历代书法论文选"));
      return option?.value || "";
    });
    if (!targetOption) throw new Error(`${viewport.name}: target ancient PDF missing`);
    await page.locator('[data-ingest-pdf-select]').selectOption(targetOption);
    const facts = await page.locator(".ingest-source-facts").innerText();
    if (!facts.includes("1052")) throw new Error(`${viewport.name}: selected PDF metadata missing`);
    if (!facts.includes("55")) throw new Error(`${viewport.name}: reusable TXT metadata missing`);
    const runtime = await page.locator(".ingest-runtime").innerText();
    if (!runtime.includes("本地 OCR 可用")) throw new Error(`${viewport.name}: OCR runtime not ready`);
    const geometry = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyHeight: document.scrollingElement?.scrollHeight || document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      title: document.querySelector(".brand-copy h1")?.textContent,
      ingestTitlePresent: Boolean(document.querySelector(".ingest-title")),
      bands: document.querySelectorAll(".ingest-band").length,
      boxes: [".app-shell", ".ingest-page", ".ingest-form-grid"].map((selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return [selector, rect?.x, rect?.width, rect?.right]; }),
      overflow: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 2).slice(0, 8).map((element) => `${element.tagName}.${element.className}:${Math.round(element.getBoundingClientRect().right)}`),
      workbench: [".ingest-sidebar", ".ingest-scan-pane", ".ingest-editor-pane"].map((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        const style = element ? getComputedStyle(element) : null;
        return { selector, x: rect?.x, y: rect?.y, width: rect?.width, height: rect?.height, display: style?.display, overflowY: style?.overflowY };
      }),
      hasPageNavigation: Boolean(document.querySelector(".ingest-page-nav")),
      contentHeights: [".ingest-scan-canvas", ".ingest-editor-pane > form textarea", ".ingest-editor-pane .ingest-output-list"].map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return { selector, height: rect?.height || 0 };
      }),
      hiddenMobileControls: [".ingest-sidebar .ingest-jobs", ".ingest-sidebar input[name=startPage]", ".ingest-sidebar input[name=endPage]", ".ingest-review", ".ingest-editor-pane > form textarea", ".ingest-editor-pane .ingest-outputs"].filter((selector) => {
        const element = document.querySelector(selector);
        return element && getComputedStyle(element).display === "none";
      }),
    }));
    if (geometry.bodyWidth > geometry.viewportWidth + 2) throw new Error(`${viewport.name}: horizontal overflow ${geometry.bodyWidth}/${geometry.viewportWidth} ${geometry.overflow.join(", ")} ${JSON.stringify(geometry.boxes)}`);
    if (geometry.bodyHeight > geometry.viewportHeight + 2) throw new Error(`${viewport.name}: page scrolls ${geometry.bodyHeight}/${geometry.viewportHeight}`);
    if (geometry.title !== "书论工作区" || geometry.ingestTitlePresent || geometry.bands < 2) throw new Error(`${viewport.name}: ingest surface incomplete or large title returned`);
    if (!geometry.hasPageNavigation) throw new Error(`${viewport.name}: page navigation missing`);
    if (geometry.hiddenMobileControls.length) throw new Error(`${viewport.name}: controls hidden ${geometry.hiddenMobileControls.join(", ")}`);
    if (geometry.contentHeights.some((item) => item.height < 24)) throw new Error(`${viewport.name}: key work area collapsed ${JSON.stringify(geometry.contentHeights)}`);
    if (viewport.name === "desktop") {
      const [sidebar, scan, editor] = geometry.workbench;
      if (!(sidebar.x < scan.x && scan.x < editor.x)) throw new Error(`${viewport.name}: expected three-column order ${JSON.stringify(geometry.workbench)}`);
    } else {
      const [sidebar, scan, editor] = geometry.workbench;
      if (!(sidebar.y < scan.y && scan.y <= editor.y)) throw new Error(`${viewport.name}: expected stacked mobile workbench ${JSON.stringify(geometry.workbench)}`);
    }
    const nextPageButton = page.locator(".ingest-page-step").nth(1);
    if (await nextPageButton.isEnabled()) {
      await nextPageButton.click();
      await page.waitForFunction(() => document.querySelector(".ingest-page-nav-actions strong")?.textContent.includes("155"), null, { timeout: 5000 });
      if (!(await page.locator(".ingest-page-nav-actions strong").innerText()).includes("155")) throw new Error(`${viewport.name}: next-page navigation did not update`);
    }
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}

if (errors.length) throw new Error(errors.join("\n"));
console.log(JSON.stringify({ ok: true, screenshots: outputDir }, null, 2));

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const baseUrl = process.argv[2] || "http://127.0.0.1:8765/index.html#detail";
const outputDir = path.resolve(process.argv[3] || "docs/superpowers/verification/multi-model-consensus");
fs.mkdirSync(outputDir, { recursive: true });

const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "390x844", width: 390, height: 844 }
];

const launchOptions = { headless: true, args: ["--disable-dev-shm-usage"] };
if (process.env.CHROME_EXECUTABLE) launchOptions.executablePath = process.env.CHROME_EXECUTABLE;
const browser = await chromium.launch(launchOptions);

const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.readyState === "complete" && Boolean(document.querySelector(".review-screen")));
    await page.evaluate(({ mobile }) => {
      const row = selectedRow();
      const fields = orderedSchema({ includeHidden: false });
      const values = Object.fromEntries(fields.map((field, index) => [field.id, index === 0 ? "苏轼" : String(fieldValue(row, field.id) || `共识值 ${index + 1}`)]));
      const consensusFields = Object.fromEntries(fields.map((field, index) => {
        const value = values[field.id];
        if (index === 1) return [field.id, { status: "split", value, votes: [value, value, `${value}（异议）`], policy: "standard", verifiedEvidence: 2 }];
        if (index === 2) return [field.id, { status: "blocked", value, votes: [value, "", ""], policy: "strict", verifiedEvidence: 1 }];
        return [field.id, { status: "unanimous", value, votes: [value, value, value], policy: index === 3 ? "strict" : "standard", verifiedEvidence: 3 }];
      }));
      const models = [
        ["primary", "DeepSeek", "deepseek-chat", "deepseek"],
        ["secondary", "GPT", "gpt-5.1", "gpt"],
        ["tertiary", "Qwen", "qwen-max", "qwen"]
      ].map(([id, displayName, model, modelFamily], modelIndex) => ({
        profileId: id,
        status: modelIndex === 2 ? "error" : "success",
        elapsedMs: 820 + modelIndex * 130,
        error: modelIndex === 2 ? "模型服务限流，可单独重试。" : "",
        profile: { id, displayName, model, modelFamily },
        proposal: modelIndex === 2 ? null : {
          fields: values,
          evidence: fields.map((field) => ({ fieldId: field.id, quote: "王羲之善草书", verified: true, location: { page: "154", paragraph: "2" } })),
          reasoning: fields.map((field) => ({ fieldId: field.id, decision: "change", reason: `根据原文逐字核对${field.label}，证据与定位相互印证。`.repeat(3), evidenceQuote: "王羲之善草书", evidenceVerified: true })),
          abstentions: []
        }
      }));
      state.cloud.config = { ...(state.cloud.config || {}), aiEnabled: true, consensusEnabled: true };
      state.modelSettings.policy = { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} };
      state.aiPanelOpen = true;
      state.railCollapsed = true;
      state.detailCollapsed = false;
      state.tableFocus = false;
      state.aiMobilePane = mobile ? "reasoning" : "fields";
      state.aiStatus = "ready";
      state.aiRowId = row.id;
      state.aiWorkspaceId = state.workspaceId;
      state.aiInputSignature = aiInputSignature(row);
      state.aiProposal = window.CalligraphyAiConsensus.normalizeConsensusResponse({
        runId: "visual-consensus-run",
        status: "complete",
        startedAt: "2026-09-20T08:00:00Z",
        completedAt: "2026-09-20T08:00:02Z",
        snapshotVersion: 2,
        decision: "needs_human_review",
        blockers: [fields[1] ? `${fields[1].id}:split` : "model_failure", "model_failure"],
        fields: consensusFields,
        models
      });
      state.aiFieldJudgments = initializeConsensusJudgments(state.aiProposal);
      render();
    }, { mobile: viewport.width <= 760 });
    await page.waitForTimeout(250);
    await page.waitForSelector("#aiEvidencePanel", { state: "visible" });

    const retry = page.locator('[data-ai-retry-profile="primary"]');
    await retry.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await page.mouse.move(1, 1);
    const retryBox = await retry.boundingBox();
    await page.mouse.move(retryBox.x + retryBox.width / 2, retryBox.y + retryBox.height / 2);
    await page.waitForTimeout(300);
    const tooltip = page.locator("#buttonTooltip");
    const tooltipVisible = await tooltip.evaluate((node) => node.classList.contains("visible") && node.getAttribute("aria-hidden") === "false" && node.textContent.trim().length > 0);
    const tooltipText = await tooltip.textContent();
    const tooltipScreenshot = viewport.width === 1440 ? path.join(outputDir, `${viewport.name}-tooltip.png`) : "";
    if (tooltipScreenshot) await page.screenshot({ path: tooltipScreenshot, fullPage: false });
    await retry.focus();
    const focusOutline = await retry.evaluate((node) => {
      const style = getComputedStyle(node);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    await page.mouse.move(1, 1);
    await page.evaluate(() => { document.querySelector(".ai-panel-scroll").scrollTop = 0; });
    await page.waitForTimeout(100);

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node || getComputedStyle(node).display === "none") return null;
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      const overlap = (a, b) => Boolean(a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1);
      const panel = rect("#aiEvidencePanel");
      const main = rect(".workbench-main");
      const detail = rect(".detail-panel");
      const scroll = document.querySelector(".ai-panel-scroll");
      const head = rect(".ai-panel-head");
      const footer = rect(".ai-panel-actions");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentScrollWidth: document.documentElement.scrollWidth,
        panel,
        main,
        detail,
        panelWithinViewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1 && panel.top >= -1 && panel.bottom <= innerHeight + 1),
        panelOverlapsMain: overlap(panel, main),
        panelOverlapsDetail: overlap(panel, detail),
        internalOverflow: Boolean(scroll && scroll.scrollHeight > scroll.clientHeight + 1),
        scrollMetrics: scroll ? { scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, overflowY: getComputedStyle(scroll).overflowY } : null,
        chromeWithinPanel: Boolean(panel && head && footer && head.top >= panel.top - 1 && footer.bottom <= panel.bottom + 1),
        mobileSwitchVisible: Boolean(rect(".ai-mobile-switch"))
      };
    });

    const screenshot = path.join(outputDir, `${viewport.name}-consensus.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    results.push({
      viewport: viewport.name,
      screenshot: path.relative(process.cwd(), screenshot),
      tooltipScreenshot: tooltipScreenshot ? path.relative(process.cwd(), tooltipScreenshot) : "",
      tooltipVisible,
      tooltipText: (tooltipText || "").trim(),
      focusOutline,
      layout,
      consoleErrors,
      pageErrors
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const reportPath = path.join(outputDir, "visual-check.json");
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ reportPath, results }, null, 2));

const failed = results.some((result) =>
  !result.layout.panelWithinViewport
  || result.layout.documentScrollWidth > result.layout.viewport.width + 1
  || !result.layout.internalOverflow
  || !result.layout.chromeWithinPanel
  || !result.tooltipVisible
  || result.focusOutline.style === "none"
  || result.focusOutline.width === "0px"
  || result.consoleErrors.length
  || result.pageErrors.length
  || (result.layout.viewport.width > 760 && (result.layout.panelOverlapsMain || result.layout.panelOverlapsDetail))
);
if (failed) process.exitCode = 1;

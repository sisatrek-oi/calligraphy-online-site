import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const sample = fs.readFileSync(new URL("../data/sample/main.csv", import.meta.url), "utf8");
const sourcePages = Object.fromEntries(fs.readdirSync(new URL("../data/sample/source-pages/", import.meta.url))
  .filter((name) => /^page_\d+\.txt$/.test(name)).map((name) => [
    name, fs.readFileSync(new URL("../data/sample/source-pages/" + name, import.meta.url), "utf8")
  ]));
const csv = (id, quote = "笔势流畅，气韵生动") =>
  "材料ID,书家,原文摘录,页码,原文文件,原文命中\n" + id + ",王羲之," + quote + ",154,page_154.txt,exact";
const file = (name, content) => ({ name, text: async () => content });

function app({ width, disk = new Map(), hostname = "127.0.0.1", search = "" } = {}) {
  const alerts = [];
  const mediaQueries = new Map();
  const matchMedia = width === undefined ? undefined : (query) => {
    const limit = Number(query.match(/max-width:\s*(\d+)px/)[1]);
    const media = { matches: width <= limit, limit, listeners: [], addEventListener(type, listener) {
      if (type === "change") this.listeners.push(listener);
    } };
    mediaQueries.set(query, media);
    return media;
  };
  let failWrites = false;
  const storage = {
    get length() { return disk.size; },
    key: (index) => [...disk.keys()][index] || null,
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites === true || (typeof failWrites === "function" && failWrites(key, value))) throw new Error("QuotaExceededError");
      disk.set(key, String(value));
    },
    removeItem: (key) => disk.delete(key)
  };
  const root = { innerHTML: "" };
  const context = vm.createContext({
    console, URL, crypto: { randomUUID }, location: { hash: "#detail", hostname, search },
    localStorage: storage,
    document: { querySelector: (selector) => selector === "#app" ? root : null, querySelectorAll: () => [] },
    FormData: class { constructor(values) { this.values = values; } get(key) { return this.values[key] ?? null; } },
    setTimeout, clearTimeout, sample, sourcePages, downloads: [], window: {
      addEventListener() {}, setTimeout, matchMedia,
      alert: (message) => alerts.push(message), confirm: () => true
    }
  });
  for (const module of ["schema", "import-workflow", "review-workflow", "export-workflow", "ai-consensus"]) {
    vm.runInContext(fs.readFileSync(new URL("../src/" + module + ".js", import.meta.url), "utf8"), context);
  }
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  vm.runInContext(main.slice(0, main.lastIndexOf("\ninit().catch(")), context);
  vm.runInContext(`
    render = () => {};
    loadSelectedSource = async () => {};
    syncRowChangeToCloud = async () => {};
    downloadBlob = (name, content, type) => downloads.push({ name, content, type });
    state.workspaceId = "test-workspace";
    state.schema = defaultSchema();
    state.manifest = buildManifest([]);
  `, context);
  const run = (code) => vm.runInContext(code, context);
  return {
    run, alerts, disk, root,
    resize: (nextWidth) => {
      for (const media of mediaQueries.values()) {
        const matches = nextWidth <= media.limit;
        if (matches === media.matches) continue;
        media.matches = matches;
        media.listeners.forEach((listener) => listener({ matches }));
      }
    },
    get: (code) => JSON.parse(JSON.stringify(run(code))),
    set: (key, value) => { context[key] = value; },
    failWrites: (value) => { failWrites = value; },
    import: async (files) => {
      context.files = files;
      await run("processFiles(files)");
    }
  };
}

test("responsive docks initialize and cross breakpoints without changing records", () => {
  const desktop = app({ width: 1440 });
  assert.equal(desktop.get("state.railCollapsed"), false);
  assert.equal(desktop.get("state.detailCollapsed"), false);
  const a = app({ width: 694 });
  loadSample(a);
  const rows = a.get("state.rows");
  assert.equal(a.get("state.railCollapsed"), true);
  assert.equal(a.get("state.detailCollapsed"), true);
  a.resize(1024);
  assert.equal(a.get("state.railCollapsed"), true);
  assert.equal(a.get("state.detailCollapsed"), false);
  a.resize(1440);
  assert.equal(a.get("state.railCollapsed"), false);
  a.resize(390);
  assert.equal(a.get("state.railCollapsed"), true);
  assert.equal(a.get("state.detailCollapsed"), true);
  a.run("state.detailMode = 'review'; applyDetailModeDefaults('review')");
  assert.equal(a.get("state.detailCollapsed"), true);
  a.resize(1024);
  a.resize(390);
  assert.equal(a.get("state.detailCollapsed"), false);
  assert.deepEqual(a.get("state.rows"), rows);
});

function loadSample(a) {
  a.run(`
    state.uploadedPages = new Map(Object.entries(sourcePages));
    state.rows = parseCsv(sample).map(makeResult);
    state.originalRows = state.rows.map(cloneRow);
    state.selectedId = state.rows[0].id;
    state.manifest = buildManifest(state.rows);
    saveWorkspace();
  `);
}

test("demo entry gate accepts only the configured credentials", () => {
  const a = app();
  assert.equal(a.get("verifyDemoCredentials('tongji', '123456')"), true);
  assert.equal(a.get("verifyDemoCredentials('tongji', '1234567')"), false);
  assert.equal(a.get("verifyDemoCredentials('2552848@tongji.com', '123456')"), false);
  a.run("state.entryStage = 'signin'; renderEntry()");
  assert.match(a.root.innerHTML, /name="account"/);
  assert.doesNotMatch(a.root.innerHTML, /name="account"[^>]*type="email"/);
});

test("local test sessions open the workspace without storing credentials", () => {
  const local = app();
  assert.equal(local.get("restoreLocalDemoSession()"), true);
  assert.equal(local.get("state.entryStage"), "workspace");
  assert.equal(local.disk.get("calligraphy-local-demo-session-v1"), "active");
  assert.equal(local.disk.has("calligraphy-remembered-email-v1"), false);
  assert.equal([...local.disk.values()].some((value) => value.includes("tongji") || value.includes("123456")), false);

  const loginPreview = app({ search: "?login=1" });
  assert.equal(loginPreview.get("restoreLocalDemoSession()"), false);
  assert.equal(loginPreview.get("state.entryStage"), "welcome");

  const deployed = app({ hostname: "sisatrek-oi.github.io" });
  deployed.disk.set("calligraphy-local-demo-session-v1", "active");
  assert.equal(deployed.get("restoreLocalDemoSession()"), false);
  assert.equal(deployed.get("state.entryStage"), "welcome");
});

test("entry gate exposes a password-free registration route without pretending local signup succeeded", () => {
  const a = app();
  a.run("state.entryStage = 'signin'; renderEntry()");
  assert.doesNotMatch(a.root.innerHTML, /2552848@tongji\.com/);
  assert.match(a.root.innerHTML, /data-entry-register/);
  assert.match(a.root.innerHTML, /邮箱免密注册/);
  a.run("state.entryStage = 'register'; renderEntry()");
  assert.match(a.root.innerHTML, /id="entryRegisterForm"/);
  assert.match(a.root.innerHTML, /发送注册链接/);
  assert.doesNotMatch(a.root.innerHTML, /type="password"/);
  assert.match(a.root.innerHTML, /data-entry-signin/);
});

test("email memory stays off locally and becomes opt-in only for cloud deployment", () => {
  const a = app();
  a.disk.set("calligraphy-remembered-email-v1", "old@example.com");
  a.run("restoreRememberedEmail()");
  assert.equal(a.get("state.entryEmail"), "");
  assert.equal(a.disk.has("calligraphy-remembered-email-v1"), false);

  a.disk.set("calligraphy-remembered-email-v1", "member@example.com");
  a.run("state.cloud.config = {enabled:true, rememberEmail:true}; restoreRememberedEmail(); state.entryStage = 'signin'; renderEntry()");
  assert.equal(a.get("state.entryEmail"), "member@example.com");
  assert.match(a.root.innerHTML, /name="rememberEmail" checked/);
  a.run("persistRememberedEmail('', false)");
  assert.equal(a.disk.has("calligraphy-remembered-email-v1"), false);
});

test("local AI configuration remains available without cloud sync", async () => {
  const a = app();
  a.set("fetch", async (endpoint) => ({
    ok: true,
    json: async () => endpoint === "/api/config"
      ? { enabled: false, aiEnabled: true }
      : { enabled: false }
  }));
  const config = JSON.parse(JSON.stringify(await a.run("loadCloudConfig()")));
  assert.deepEqual(config, { enabled: false, aiEnabled: true });
  assert.equal(await a.run("initCloudRuntime()"), false);
  assert.equal(a.get("state.cloud.config.aiEnabled"), true);
  assert.equal(a.get("state.cloud.mode"), "local");
});

test("local API disabled config is authoritative and does not probe a missing static config", async () => {
  const a = app();
  const requests = [];
  a.set("fetch", async (endpoint) => {
    requests.push(endpoint);
    return { ok: true, json: async () => ({ enabled: false, aiEnabled: false }) };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await a.run("loadCloudConfig()"))), { enabled: false, aiEnabled: false });
  assert.deepEqual(requests, ["/api/config"]);
});

test("project settings separates schema and local model connection without storing the key", async () => {
  const a = app();
  a.set("fetch", async (url) => ({
    ok: url === "/api/model-config",
    status: url === "/api/model-config" ? 200 : 404,
    json: async () => ({
      supported: true,
      configured: true,
      source: "local-file",
      apiUrl: "https://api.example.com/chat",
      model: "model-a",
      keyHint: "1234"
    })
  }));
  await a.run("loadModelConfig()");
  a.run("state.templatePanelExpanded = true; state.settingsTab = 'model'");
  const markup = a.run("templateDetailsModal()");
  assert.match(markup, /data-settings-tab="schema"/);
  assert.match(markup, /data-settings-tab="model"/);
  assert.match(markup, /已保存 · 尾号 1234/);
  assert.doesNotMatch(markup, /local-secret|value="[^"]*1234/);
  assert.equal(a.disk.has("calligraphy-model-config"), false);
});

test("model settings renders three independent profiles and project policy without exposing keys", async () => {
  const a = app();
  a.run("state.templatePanelExpanded = true; state.settingsTab = 'model'; render = () => {};");
  a.set("fetch", async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      supported: true,
      configured: true,
      profiles: [
        { id: "primary", displayName: "DeepSeek", apiUrl: "https://a.test/chat", model: "deepseek-chat", modelFamily: "deepseek", enabled: true, source: "local-file", keyHint: "1111" },
        { id: "secondary", displayName: "GPT", apiUrl: "https://b.test/chat", model: "gpt-5.1", modelFamily: "gpt", enabled: true, source: "local-file", keyHint: "2222" },
        { id: "tertiary", displayName: "Qwen", apiUrl: "https://c.test/chat", model: "qwen-max", modelFamily: "qwen", enabled: true, source: "local-file", keyHint: "3333" }
      ],
      policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} }
    })
  }));
  await a.run("loadModelConfig()");
  const markup = a.run("modelSettingsPanel()");
  assert.match(markup, /data-model-profile="primary"/);
  assert.match(markup, /data-model-profile="secondary"/);
  assert.match(markup, /data-model-profile="tertiary"/);
  assert.match(markup, /A 辅助审核/);
  assert.match(markup, /至少 2 个模型家族/);
  assert.doesNotMatch(markup, /value="[^"]*(1111|2222|3333)/);
  assert.equal(a.get("state.cloud.config.consensusEnabled"), true);
});

test("legacy model response becomes the primary profile and leaves two safe empty slots", () => {
  const a = app();
  a.run(`applyPublicModelConfig({
    supported: true, configured: true, source: "local-file",
    apiUrl: "https://legacy.example.com/chat", model: "legacy-model", keyHint: "1234"
  })`);
  assert.deepEqual(a.get("state.modelSettings.profiles.map(({id, model, configured}) => ({id, model, configured}))"), [
    { id: "primary", model: "legacy-model", configured: true },
    { id: "secondary", model: "", configured: false },
    { id: "tertiary", model: "", configured: false }
  ]);
  assert.equal(a.get("state.cloud.config.aiEnabled"), true);
  assert.equal(a.get("state.cloud.config.consensusEnabled"), false);
  assert.equal(JSON.stringify(a.get("state.modelSettings")).includes("apiKey"), false);
});

test("static deployment disables model persistence without hiding environment AI", async () => {
  const a = app();
  a.set("fetch", async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await a.run("loadModelConfig()");
  assert.equal(a.get("state.modelSettings.supported"), false);
  assert.match(a.run("modelSettingsPanel()"), /当前部署不支持网页配置/);
  assert.match(a.run("modelSettingsPanel()"), /data-model-save disabled/);
});

test("model configuration requests use the local API without persisting the key in workspace data", async () => {
  const a = app();
  const requests = [];
  a.set("requests", requests);
  a.set("fetch", async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.endsWith("/test")
        ? { ok: true, model: "model-b", elapsedMs: 21 }
        : options.method === "DELETE"
          ? { supported: true, configured: false, profiles: [], policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} } }
          : { supported: true, configured: true, profiles: [
              { id: "primary", displayName: "Model B", source: "local-file", apiUrl: "https://api.example.com/chat", model: "model-b", modelFamily: "family-b", enabled: true, configured: true, keyHint: "cret" }
            ], policy: { reviewMode: "auto", defaultConsensus: "strict", fieldOverrides: { author: { policy: "strict" } } } }
    };
  });
  a.set("modelForm", {
    id: "primary",
    displayName: "Model B",
    apiUrl: "https://api.example.com/chat",
    apiKey: "temporary-secret",
    model: "model-b",
    modelFamily: "family-b",
    enabled: "on"
  });
  a.run("state.modelSettings.policy = { reviewMode: 'auto', defaultConsensus: 'strict', fieldOverrides: { author: { policy: 'strict' } } }");
  await a.run("testModelConfig(modelForm)");
  await a.run("saveModelConfig(modelForm)");
  await a.run("deleteModelConfig('primary')");
  assert.deepEqual(requests.map((item) => [item.url, item.options.method]), [
    ["/api/model-config/test", "POST"],
    ["/api/model-config", "PUT"],
    ["/api/model-config?id=primary", "DELETE"]
  ]);
  const testBody = JSON.parse(requests[0].options.body);
  const saveBody = JSON.parse(requests[1].options.body);
  assert.equal(testBody.id, "primary");
  assert.equal(testBody.apiKey, "temporary-secret");
  assert.equal(saveBody.profiles[0].apiKey, "temporary-secret");
  assert.deepEqual(saveBody.policy, { reviewMode: "auto", defaultConsensus: "strict", fieldOverrides: { author: { policy: "strict" } } });
  assert.equal([...a.disk.values()].some((value) => value.includes("temporary-secret")), false);
  assert.equal(JSON.stringify(a.get("workspacePayload()")).includes("temporary-secret"), false);
  assert.equal(JSON.stringify(a.get("state.modelSettings")).includes("temporary-secret"), false);
});

test("project consensus policy saves without adding credentials to the bundle", async () => {
  const a = app();
  const requests = [];
  a.run(`applyPublicModelConfig({ supported: true, profiles: [
    { id: "primary", displayName: "A", apiUrl: "https://a.test/chat", model: "a", modelFamily: "family-a", enabled: true, configured: true, source: "local-file", keyHint: "1111" },
    { id: "secondary", displayName: "B", apiUrl: "https://b.test/chat", model: "b", modelFamily: "family-b", enabled: true, configured: true, source: "local-file", keyHint: "2222" },
    { id: "tertiary", displayName: "C", apiUrl: "https://c.test/chat", model: "c", modelFamily: "family-c", enabled: true, configured: true, source: "local-file", keyHint: "3333" }
  ], policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: { author: { policy: "strict" } } } })`);
  a.set("requests", requests);
  a.set("fetch", async (url, options = {}) => {
    requests.push({ url, options });
    const body = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ supported: true, configured: true, profiles: body.profiles.map((profile) => ({ ...profile, configured: true, source: "local-file" })), policy: body.policy })
    };
  });
  a.set("policyForm", { reviewMode: "auto", defaultConsensus: "strict" });
  assert.equal(await a.run("saveModelPolicy(policyForm)"), true);
  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body.policy, { reviewMode: "auto", defaultConsensus: "strict", fieldOverrides: { author: { policy: "strict" } } });
  assert.equal(body.profiles.length, 3);
  assert.equal(JSON.stringify(body).includes("apiKey"), false);
});

test("field risk overrides reuse schema fields and list only non-default rules", () => {
  const a = app();
  a.run(`applyPublicModelConfig({ supported: true, profiles: [], policy: {
    reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: { author: { policy: "strict" } }
  } })`);
  const markup = a.run("modelSettingsPanel()");
  assert.match(markup, /data-field-override="author"/);
  assert.doesNotMatch(markup, /data-field-override="scriptType"/);
  assert.match(markup, /name="fieldOverrideId"/);
  assert.match(markup, /value="scriptType"/);
  assert.equal(a.run("setModelFieldOverride('scriptType', 'manual')"), true);
  assert.deepEqual(a.get("state.modelSettings.policy.fieldOverrides.scriptType"), { manualOnly: true });
  assert.equal(a.run("setModelFieldOverride('author', 'inherit')"), true);
  assert.equal(a.run("state.modelSettings.policy.fieldOverrides.author"), undefined);
});

test("model settings uses the shared modal and bounded responsive controls", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.settings-tabs\s*\{/);
  assert.match(css, /\.model-profile-table\s*\{/);
  assert.match(css, /\.model-profile-row\s*\{/);
  assert.match(css, /minmax\(0,\s*1fr\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.model-profile-scroll\s*\{/);
});

test("batch selection preserves navigation and reconciles explicit rows", () => {
  const a = app();
  loadSample(a);
  const selectedId = a.get("state.selectedId");
  const firstId = a.get("state.rows[0].id");
  assert.equal(a.run(`toggleBatchSelection("${firstId}", true)`), true);
  assert.equal(a.get("state.selectedId"), selectedId);
  assert.deepEqual(a.get("[...state.batchSelectedIds]"), [firstId]);

  a.run("state.query = 'SD-0014'; setVisibleBatchSelection(true)");
  assert.deepEqual(new Set(a.get("[...state.batchSelectedIds]")), new Set([firstId, "SD-0014"]));
  a.run("state.query = ''; state.rows = state.rows.filter(row => row.id !== state.batchSelectedIds.values().next().value); reconcileBatchSelection()");
  assert.deepEqual(a.get("[...state.batchSelectedIds]"), ["SD-0014"]);
});

test("batch selection column appears only while multi-select mode is active", () => {
  const a = app();
  loadSample(a);
  const normalMarkup = a.run("resultTable(visibleRows().slice(0, 2))");
  assert.doesNotMatch(normalMarkup, /data-batch-select-visible/);
  assert.doesNotMatch(normalMarkup, /data-batch-select=/);

  assert.equal(a.run("setBatchMode(true)"), true);
  const batchMarkup = a.run("resultTable(visibleRows().slice(0, 2))");
  assert.match(batchMarkup, /data-batch-select-visible/);
  assert.equal((batchMarkup.match(/data-batch-select=/g) || []).length, 2);
  assert.match(batchMarkup, /data-row-open/);
  assert.match(batchMarkup, /aria-label="选择当前筛选条目"/);
});

test("multi-select mode has an accessible toolbar toggle and clears selection on exit", () => {
  const a = app();
  loadSample(a);
  assert.match(a.run("tableViewActions()"), /data-batch-mode/);
  assert.match(a.run("tableViewActions()"), /aria-label="进入多选"/);
  a.run("setBatchMode(true); toggleBatchSelection(state.rows[0].id, true)");
  assert.equal(a.get("state.batchMode"), true);
  assert.equal(a.get("state.batchSelectedIds.size"), 1);
  assert.equal(a.run("setBatchMode(false)"), true);
  assert.equal(a.get("state.batchMode"), false);
  assert.equal(a.get("state.batchSelectedIds.size"), 0);
});

test("batch toolbar stays in document flow and scrolls on narrow screens", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const baseRule = css.match(/\.batch-action-bar\s*\{[^}]+\}/s)?.[0] || "";
  assert.match(baseRule, /position:\s*sticky/);
  assert.doesNotMatch(baseRule, /position:\s*fixed/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.batch-action-bar\s*\{[\s\S]*?overflow-x:\s*auto/);
});

test("batch toolbar exposes all selected-row actions with accessible labels", () => {
  const a = app();
  loadSample(a);
  assert.equal(a.run("batchActionBar()"), "");
  a.run("setBatchMode(true); toggleBatchSelection(state.rows[0].id, true)");
  const markup = a.run("batchActionBar()");
  for (const label of ["三模型核验", "批量确认", "批量标记问题", "导出选中条目", "删除选中条目", "清空选择"]) {
    assert.match(markup, new RegExp('aria-label="' + label + '"'));
  }
  assert.match(markup, /已选 1 条/);
});

test("batch confirm changes only selected rows and rolls back failed persistence", () => {
  const a = app();
  loadSample(a);
  a.run("state.rows.forEach(row => { row.reviewed = false; row.reviewedAt = ''; }); state.reviewState.confirmedIds = []");
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.run("batchIds.forEach(id => toggleBatchSelection(id, true))");
  const untouched = a.get("state.rows.slice(2)");
  assert.equal(a.run("batchConfirmSelected()"), true);
  assert.equal(a.get("state.rows.slice(0, 2).every(row => row.reviewed)"), true);
  assert.deepEqual(a.get("state.rows.slice(2)"), untouched);
  assert.equal(a.get("state.rows[0].history.at(-1).type"), "batch-confirm");

  a.run("state.rows.slice(0, 2).forEach(row => { row.reviewed = false; row.reviewedAt = ''; }); state.reviewState.confirmedIds = []");
  const before = reviewSnapshot(a);
  a.failWrites(true);
  assert.equal(a.run("batchConfirmSelected()"), false);
  assert.deepEqual(reviewSnapshot(a), before);
});

test("batch delete moves selected rows to trash and clears their selection", () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.run("batchIds.forEach(id => toggleBatchSelection(id, true))");
  assert.equal(a.run("batchDeleteSelected()"), true);
  assert.equal(a.get("state.rows.some(row => batchIds.includes(row.id))"), false);
  assert.equal(a.get("state.trashRows.filter(row => batchIds.includes(row.id)).length"), 2);
  assert.deepEqual(a.get("[...state.batchSelectedIds]"), []);
  assert.equal(a.get("state.trashRows[0].history.at(-1).type"), "batch-delete");
});

test("batch issue marks only selected rows and rolls back failed persistence", () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.set("issueForm", { problemTag: "manual_review", problemNote: "需核对归属" });
  a.run("batchIds.forEach(id => toggleBatchSelection(id, true))");
  const untouched = a.get("state.rows.slice(2)");
  assert.equal(a.run("batchMarkIssue(issueForm)"), true);
  assert.equal(a.get("state.rows.slice(0, 2).every(row => row.problemTags.includes('manual_review'))"), true);
  assert.equal(a.get("state.rows.slice(0, 2).every(row => row.annotations.at(-1).body === '需核对归属')"), true);
  assert.equal(a.get("state.rows[0].history.at(-1).type"), "batch-issue");
  assert.deepEqual(a.get("state.rows.slice(2)"), untouched);

  a.set("issueForm", { problemTag: "page_issue", problemNote: "页码待核" });
  const before = reviewSnapshot(a);
  a.failWrites(true);
  assert.equal(a.run("batchMarkIssue(issueForm)"), false);
  assert.deepEqual(reviewSnapshot(a), before);
});

test("selected export scope contains only explicitly selected rows", () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.run("batchIds.forEach(id => toggleBatchSelection(id, true)); openExportPanel('selected')");
  assert.equal(a.get("state.exportScope"), "selected");
  assert.deepEqual(a.get("deliveryRows().map(row => row.id)"), ids);
  assert.match(a.run("deliveryModal()"), /value="selected" selected/);
  a.run("downloadWorkingDraft()");
  const exportText = a.get("downloads.at(-1).content");
  assert.equal(ids.every((id) => exportText.includes(id)), true);
  const remainingIds = a.get("state.rows.slice(2).map(row => row.id)");
  assert.equal(remainingIds.some((id) => exportText.includes(id)), false);
});

test("batch AI runs selected rows sequentially and separates approval from review", async () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.run(`
    batchIds.forEach(id => toggleBatchSelection(id, true));
    state.cloud.config = { aiEnabled: true, consensusEnabled: true };
    state.modelSettings.profiles = ['primary','secondary','tertiary'].map(id => ({id, enabled:true, configured:true}));
  `);
  const requests = [];
  let inFlight = 0;
  let maxInFlight = 0;
  a.set("fetch", async (endpoint, options) => {
    const body = JSON.parse(options.body);
    requests.push({ endpoint, body });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 4));
    inFlight -= 1;
    const approve = body.rowId === ids[0];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        runId: "run-" + body.rowId,
        status: "complete",
        decision: approve ? "auto_approve_record" : "needs_human_review",
        blockers: approve ? [] : ["required_field_disagreement"],
        fields: approve ? { author: { status: "unanimous", value: "王羲之", votes: ["王羲之", "王羲之", "王羲之"], policy: "standard", verifiedEvidence: 3 } } : {},
        models: ["primary", "secondary", "tertiary"].map((profileId) => ({ profileId, status: "success", profile: { id: profileId, model: profileId }, proposal: { fields: {}, evidence: [], reasoning: [], abstentions: [] }, elapsedMs: 5 }))
      })
    };
  });
  assert.equal(await a.run("startBatchAiReview()"), true);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(requests.map((item) => item.body.rowId), ids);
  assert.equal(requests.every((item) => item.body.reviewMode === "auto"), true);
  assert.equal(a.get("state.rows.find(row => row.id === batchIds[0]).reviewed"), true);
  assert.equal(a.get("state.rows.find(row => row.id === batchIds[1]).reviewed"), false);
  assert.equal(a.get("state.rows.find(row => row.id === batchIds[1]).problemResolution.status"), "pending_review");
  assert.deepEqual(a.get("({completed:state.batchJob.completed,approved:state.batchJob.approved,review:state.batchJob.review,failed:state.batchJob.failed,running:state.batchJob.running})"), { completed: 2, approved: 1, review: 1, failed: 0, running: false });
});

test("batch AI continues after one request failure and obeys stop requests", async () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 3).map(row => row.id)");
  a.set("batchIds", ids);
  a.run(`
    batchIds.forEach(id => toggleBatchSelection(id, true));
    state.cloud.config = { aiEnabled: true, consensusEnabled: true };
    state.modelSettings.profiles = ['primary','secondary','tertiary'].map(id => ({id, enabled:true, configured:true}));
  `);
  let calls = 0;
  a.set("fetch", async (_endpoint, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    if (calls === 1) return { ok: false, status: 502, json: async () => ({ error: "模型服务超时" }) };
    a.run("stopBatchAiReview()");
    return { ok: true, status: 200, json: async () => ({ runId: "run-" + body.rowId, status: "complete", decision: "needs_human_review", blockers: [], fields: {}, models: [] }) };
  });
  assert.equal(await a.run("startBatchAiReview()"), true);
  assert.equal(calls, 2);
  assert.deepEqual(a.get("({completed:state.batchJob.completed,failed:state.batchJob.failed,stopped:state.batchJob.stopped,running:state.batchJob.running})"), { completed: 2, failed: 1, stopped: true, running: false });
  assert.equal(a.get("state.rows.find(row => row.id === batchIds[0]).problemResolution.status"), "pending_review");
});

test("batch AI keeps actionable row-level reasons for failures and review items", async () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 2).map(row => row.id)");
  a.set("batchIds", ids);
  a.run(`
    setBatchMode(true);
    batchIds.forEach(id => toggleBatchSelection(id, true));
    state.cloud.config = { aiEnabled: true, consensusEnabled: true };
    state.modelSettings.profiles = ['primary','secondary','tertiary'].map(id => ({id, enabled:true, configured:true}));
  `);
  let calls = 0;
  a.set("fetch", async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 504, json: async () => ({ error: "Qwen 请求超时" }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        runId: "run-review",
        status: "complete",
        decision: "needs_human_review",
        blockers: ["author:split"],
        fields: { author: { status: "split", value: "", votes: ["王羲之", "王献之", "王羲之"], reason: "disagreement", blocking: true } },
        models: ["primary", "secondary", "tertiary"].map((profileId) => ({ profileId, status: "success", profile: { id: profileId, displayName: profileId, model: profileId }, proposal: { fields: {}, evidence: [], reasoning: [], abstentions: [] } }))
      })
    };
  });
  assert.equal(await a.run("startBatchAiReview()"), true);
  assert.deepEqual(a.get("state.batchJob.results.map(item => item.category)"), ["failed", "review"]);
  assert.match(a.get("state.batchJob.results[0].reason"), /Qwen 请求超时/);
  assert.deepEqual(a.get("state.batchJob.results[1].details"), ["书家：结果分歧"]);
  const markup = a.run("batchActionBar()");
  assert.match(markup, /需要处理 2 条/);
  assert.match(markup, new RegExp(`data-batch-result-row="${ids[0]}"`));
  assert.match(markup, /Qwen 请求超时/);
  assert.match(markup, /书家：结果分歧/);
});

test("opening a batch result clears hiding filters and focuses its detail", () => {
  const a = app();
  loadSample(a);
  const targetId = a.get("state.rows[1].id");
  a.set("targetId", targetId);
  a.run("state.filter = 'flagged'; state.query = 'not-present'; state.qualityFocus = { fieldId: 'author', mode: 'empty' }; state.detailCollapsed = true");
  assert.equal(a.run("openBatchResult(targetId)"), true);
  assert.equal(a.get("state.filter"), "all");
  assert.equal(a.get("state.query"), "");
  assert.equal(a.get("state.qualityFocus"), null);
  assert.equal(a.get("state.selectedId"), targetId);
  assert.equal(a.get("state.batchReviewRowId"), targetId);
  assert.equal(a.get("state.detailCollapsed"), false);
});

test("batch result opens a full-screen review workspace with source, consensus and model proposals", () => {
  const a = app();
  loadSample(a);
  const targetId = a.get("state.rows[0].id");
  a.set("targetId", targetId);
  a.run(`
    const row = state.rows.find(item => item.id === targetId);
    state.batchJob = {
      results: [{ rowId: targetId, rowLabel: row.author, category: 'review', reason: '三个模型对书体判断有出入。', details: ['书体：结果分歧'] }]
    };
    row.history.push({
      type: 'ai-consensus-assist', at: new Date().toISOString(),
      consensusRun: {
        runId: 'run-fullscreen', snapshotVersion: 1, decision: 'needs_human_review', blockers: ['scriptType:split'],
        fields: {
          author: { status: 'unanimous', value: row.author, votes: [row.author, row.author, row.author], verifiedEvidence: 2, evidenceRequired: true },
          scriptType: { status: 'split', value: row.scriptType, votes: [row.scriptType, '行书', row.scriptType], reason: 'disagreement', blocking: true, evidenceRequired: true }
        },
        models: ['DeepSeek', '千问', 'Kimi'].map((displayName, index) => ({
          profileId: 'model-' + index, status: 'success', elapsedMs: 1200 + index,
          profile: { displayName, model: 'model-' + index, modelFamily: displayName },
          proposal: { fields: { author: row.author, scriptType: row.scriptType }, reasoning: [{ fieldId: 'scriptType', reason: displayName + ' 的书体判断', evidenceQuote: row.quote, evidenceVerified: true }], evidence: [], abstentions: [], answerSources: {} }
        }))
      }
    });
    openBatchResult(targetId);
    state.sourceText = sourcePages[row.sourceFile] || row.quote;
    state.sourceStatus = 'ready';
  `);
  const markup = a.run("batchReviewModal()");
  assert.match(markup, /batch-review-workspace/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /条目与原文/);
  assert.match(markup, /AI 共识/);
  assert.match(markup, /AI 助手方案/);
  assert.match(markup, /书体：结果分歧/);
  assert.match(markup, /DeepSeek/);
  assert.match(markup, /千问/);
  assert.match(markup, /Kimi/);
  assert.match(markup, /data-batch-review-confirm/);
});

test("batch review navigation stays inside actionable results and closes cleanly", () => {
  const a = app();
  loadSample(a);
  const ids = a.get("state.rows.slice(0, 3).map(row => row.id)");
  a.set("batchIds", ids);
  a.run(`
    state.batchJob = { results: [
      { rowId: batchIds[0], category: 'failed', reason: '调用失败', details: [] },
      { rowId: batchIds[1], category: 'approved', reason: '自动判过', details: [] },
      { rowId: batchIds[2], category: 'review', reason: '存在出入', details: [] }
    ] };
    openBatchResult(batchIds[0]);
  `);
  assert.equal(a.run("moveBatchReview(1)"), true);
  assert.equal(a.get("state.batchReviewRowId"), ids[2]);
  assert.equal(a.run("moveBatchReview(1)"), false);
  assert.equal(a.run("closeBatchReview()"), true);
  assert.equal(a.get("state.batchReviewRowId"), "");
});

test("table and review share four summary slots, four toolbar slots and the dock preference", () => {
  const a = app();
  loadSample(a);
  for (const mode of ['table', 'review']) {
    a.set('mode', mode);
    a.run("state.detailMode = mode; state.detailCollapsed = true; applyDetailModeDefaults(mode)");
    assert.equal(a.get('state.detailCollapsed'), true);
    assert.equal((a.run('modeSummaryPanel(visibleRows())').match(/<span>/g) || []).length, 4);
    assert.equal((a.run('tableViewActions()').match(/<button /g) || []).length, 4);
  }
  assert.match(a.run('tableViewActions()'), /data-quality-batch-review/);
  assert.doesNotMatch(a.run('modeSummaryPanel(visibleRows())'), /data-quality-batch-review/);
});

test("master table keeps excerpt, source context and review actions above secondary details", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.detailMode = 'table';
    state.sourceText = sourcePages[selectedRow().sourceFile] || '';
    state.sourceStatus = state.sourceText ? 'ready' : 'missing';
  `);
  const card = a.run("sourceCardContent(selectedRow())");
  assert.ok(card.indexOf("待审摘录") < card.indexOf("原文上下文"));
  assert.ok(card.indexOf("原文上下文") < card.indexOf("review-actions"));
  assert.match(card, /<mark>/);
  const panel = a.run("detailPanel(selectedRow())");
  assert.ok(panel.indexOf("master-evidence-card") < panel.indexOf("detail-card"));
  assert.ok(panel.indexOf("detail-card") < panel.indexOf("research-card"));
});

test("symbol controls expose concise labels to the shared hover tooltip", () => {
  const a = app();
  loadSample(a);
  const markup = [
    a.run("rowActionButtons(selectedRow())"),
    a.run("reviewControls(selectedRow())"),
    a.run("tableViewActions()")
  ].join("");
  for (const label of ["确认并进入下一条", "人工标注为有问题", "修改字段", "上一条", "下一条", "删除条目"]) {
    assert.match(markup, new RegExp(`aria-label=\\"[^\\"]*${label}[^\\"]*\\"`));
  }
  assert.match(a.run("ICON_TOOLTIP_SELECTOR"), /icon-control/);
  assert.match(a.run("ICON_TOOLTIP_SELECTOR"), /icon-action/);
});

test("AI panel stays open while row changes clear the prior proposal and judgments", () => {
  const a = app();
  loadSample(a);
  const secondId = a.get("state.rows.find(row => row.id !== state.selectedId).id");
  a.run(`
    state.aiPanelOpen = true;
    state.aiProposal = { proposal: { fields: { author: "旧建议" } } };
    state.aiFieldJudgments = { author: "accept" };
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
  `);
  a.run(`selectResult("${secondId}")`);
  assert.equal(a.get("state.aiPanelOpen"), true);
  assert.equal(a.get("state.aiProposal"), null);
  assert.deepEqual(a.get("state.aiFieldJudgments"), {});
  assert.equal(a.get("state.aiRowId"), secondId);
  assert.equal(a.get("state.aiStatus"), "idle");
});

test("AI uses one icon entry and one docked evidence panel", () => {
  const a = app();
  loadSample(a);
  const entry = a.run("reviewControls(selectedRow())");
  assert.match(entry, /data-ai-panel-open/);
  assert.match(entry, /aria-controls="aiEvidencePanel"/);
  assert.match(entry, /aria-label="打开 AI 字段理由"/);
  assert.doesNotMatch(a.run("detailPanel(selectedRow())"), /ai-suggestion-card/);
  a.run("state.aiPanelOpen = true");
  const panel = a.run("aiReviewPanel(selectedRow())");
  assert.match(panel, /id="aiEvidencePanel"/);
  assert.match(panel, /class="ai-review-panel/);
  assert.match(panel, /aria-labelledby="aiPanelTitle"/);
  assert.doesNotMatch(panel, /role="dialog"|aria-modal/);
  assert.match(panel, /class="ai-panel-head"/);
  assert.match(panel, /class="ai-panel-scroll"/);
  assert.match(panel, /class="ai-panel-actions"/);
  assert.match(panel, /data-ai-panel-close/);
});

function consensusReadyApp({ decision = "adopt_fields", reviewMode = "assist", blockers = [] } = {}) {
  const a = app();
  loadSample(a);
  a.set("consensusFixture", {
    runId: "run-test",
    status: "complete",
    startedAt: "2026-09-20T00:00:00Z",
    completedAt: "2026-09-20T00:00:01Z",
    snapshotVersion: 1,
    decision,
    blockers,
    fields: {
      author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"], voteCount: 3, validationSource: "model", reason: "accepted" },
      pageNo: { status: "unanimous", value: "161", policy: "standard", verifiedEvidence: 0, votes: [], voteCount: 0, validationSource: "system", reason: "system_verified" }
    },
    models: [
      { profileId: "primary", status: "success", elapsedMs: 20, profile: { id: "primary", displayName: "A", model: "a", modelFamily: "family-a", apiKey: "must-not-survive" }, proposal: { fields: { author: "苏轼" }, answerSources: { author: "repair" }, reasoning: [{ fieldId: "author", decision: "change", reason: "原文直指", evidenceQuote: "苏轼", evidenceVerified: true, apiKey: "must-not-survive" }], evidence: [{ fieldId: "author", quote: "苏轼", verified: true }], abstentions: [] } },
      { profileId: "secondary", status: "success", elapsedMs: 24, profile: { id: "secondary", displayName: "B", model: "b", modelFamily: "family-b" }, proposal: { fields: { author: "苏轼" }, reasoning: [], evidence: [], abstentions: [] } },
      { profileId: "tertiary", status: "success", elapsedMs: 28, profile: { id: "tertiary", displayName: "C", model: "c", modelFamily: "family-c" }, proposal: { fields: { author: "苏轼" }, reasoning: [], evidence: [], abstentions: [] } }
    ]
  });
  a.run(`
    state.modelSettings.policy.reviewMode = ${JSON.stringify(reviewMode)};
    state.modelSettings.policy.defaultConsensus = "standard";
    state.aiPanelOpen = true;
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiInputSignature = aiInputSignature(selectedRow());
    state.aiProposal = window.CalligraphyAiConsensus.normalizeConsensusResponse(consensusFixture);
    state.aiFieldJudgments = initializeConsensusJudgments(state.aiProposal);
  `);
  return a;
}

test("consensus panel keeps the existing aside and collapses individual model details", () => {
  const a = consensusReadyApp();
  const markup = a.run("aiReviewPanel(selectedRow())");
  assert.match(markup, /class="ai-review-panel/);
  assert.match(markup, />已通过</);
  assert.match(markup, />投票 3\/3</);
  assert.match(markup, />程序通过</);
  assert.match(markup, />程序校验</);
  assert.match(markup, />补答</);
  assert.equal((markup.match(/<details class="ai-model-details"/g) || []).length, 3);
  assert.match(markup, /data-ai-retry-profile="primary"/);
  assert.match(markup, /title="仅重试该模型"/);
  assert.doesNotMatch(markup, /modal-backdrop|drawer-backdrop/);
});

test("advisory field disagreement is labeled as reference instead of manual blocking", () => {
  const a = consensusReadyApp();
  a.set("advisoryItem", {
    consensus: { status: "blocked", reason: "disagreement", blocking: false, validationSource: "model" }
  });
  assert.equal(a.run("consensusStatusLabel(advisoryItem)"), "仅供参考");
});

test("consensus generation uses the new endpoint and retry calls only one profile", async () => {
  const a = app();
  loadSample(a);
  const requests = [];
  a.run(`
    state.cloud.config = { enabled: false, aiEnabled: true, consensusEnabled: true };
    state.modelSettings.policy = { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} };
    state.sourceText = sourcePages[selectedRow().sourceFile];
    state.sourceStatus = "ready";
    resetAiForRow(selectedRow());
  `);
  a.set("fetch", async (url, options = {}) => {
    requests.push({ url, options });
    const retry = String(url).includes("/retry/");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        runId: retry ? "run-retry" : JSON.parse(options.body).runId,
        status: "complete",
        snapshotVersion: retry ? 2 : 1,
        decision: "adopt_fields",
        blockers: [],
        fields: { author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"] } },
        models: ["primary", "secondary", "tertiary"].map((id) => ({ profileId: id, status: "success", profile: { id, displayName: id, model: id, modelFamily: id }, proposal: { fields: { author: "苏轼" }, reasoning: [], evidence: [], abstentions: [] } }))
      })
    };
  });
  assert.equal(await a.run("performAiExtraction(state.selectedId)"), true);
  assert.equal(requests[0].url, "./api/ai/consensus");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.reviewMode, "assist");
  assert.equal(body.defaultConsensus, "standard");
  assert.equal(body.schema.find((field) => field.id === "author").validationMode, "model");
  assert.equal(body.schema.find((field) => field.id === "pageNo").validationMode, "system");
  assert.equal(body.schema.find((field) => field.id === "sourceFile").validationMode, "system");
  assert.equal(a.get("state.aiFieldJudgments.author"), "accept");
  const originalModels = a.get("state.aiProposal.models.map(item => item.profileId)");
  assert.equal(await a.run("retryConsensusModel('secondary')"), true);
  assert.match(requests[1].url, /\/api\/ai\/consensus\/[^/]+\/retry\/secondary$/);
  assert.deepEqual(a.get("state.aiProposal.models.map(item => item.profileId)"), originalModels);
  assert.equal(a.get("state.aiProposal.snapshotVersion"), 2);
});

test("Escape closes the AI panel and restores layout state and focus to its new entry", () => {
  const a = app();
  const focus = [];
  const attributes = {};
  const trigger = {
    isConnected: true,
    focus: () => focus.push("trigger"),
    setAttribute: (name, value) => { attributes[name] = value; }
  };
  a.set("document", {
    activeElement: null,
    querySelector: (selector) => selector === "[data-ai-panel-open]" ? trigger : null,
    querySelectorAll: () => []
  });
  a.set("trigger", trigger);
  a.run(`
    state.railCollapsed = true;
    state.detailCollapsed = false;
    state.tableFocus = false;
    state.aiPanelOpen = true;
    state.aiRailWasCollapsed = false;
    state.aiDetailWasCollapsed = true;
    state.aiTableFocusWasActive = true;
    aiPanelTrigger = trigger;
  `);
  let prevented = 0;
  a.set("event", {
    key: "Escape",
    target: null,
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => {}
  });
  a.run("handleWorkbenchShortcut(event)");
  assert.equal(a.get("state.aiPanelOpen"), false);
  assert.equal(a.get("state.railCollapsed"), false);
  assert.equal(a.get("state.detailCollapsed"), true);
  assert.equal(a.get("state.tableFocus"), true);
  assert.equal(prevented, 1);
  assert.deepEqual(focus, ["trigger"]);
  assert.equal(attributes["aria-expanded"], "false");
});

test("AI panel temporarily locks the evidence layout while preserving saved preferences", () => {
  const a = app();
  loadSample(a);
  const trigger = { setAttribute() {} };
  a.set("trigger", trigger);
  a.run(`
    renderDetail = () => {};
    state.railCollapsed = false;
    state.detailCollapsed = true;
    state.tableFocus = true;
    openAiPanel(trigger);
  `);
  assert.equal(a.get("state.railCollapsed"), true);
  assert.equal(a.get("state.detailCollapsed"), false);
  assert.equal(a.get("state.tableFocus"), false);
  assert.equal(a.run("toggleRail()"), false);
  assert.equal(a.run("toggleDetailDock()"), false);
  assert.equal(a.run("toggleTableFocus()"), false);
  assert.equal(a.get("state.railCollapsed"), true);
  assert.equal(a.get("state.detailCollapsed"), false);
  assert.equal(a.get("state.tableFocus"), false);
  assert.equal(a.get("state.aiRailWasCollapsed"), false);
  assert.equal(a.get("state.aiDetailWasCollapsed"), true);
  assert.equal(a.get("state.aiTableFocusWasActive"), true);
});

test("AI keeps original fields expanded across a desktop-to-mobile transition and restores the saved preference", () => {
  const a = app({ width: 1440 });
  loadSample(a);
  a.run(`
    renderDetail = () => {};
    state.detailCollapsed = true;
    openAiPanel(null);
  `);
  assert.equal(a.get("state.detailCollapsed"), false);
  assert.equal(a.get("state.aiDetailWasCollapsed"), true);
  a.resize(390);
  assert.equal(a.get("state.aiPanelOpen"), true);
  assert.equal(a.get("state.detailCollapsed"), false);
  assert.equal(a.get("state.aiDetailWasCollapsed"), true);
  a.run("closeAiPanel({ restoreFocus: false })");
  assert.equal(a.get("state.detailCollapsed"), true);
});

test("AI extraction stays a candidate until a human accepts it", async () => {
  const a = app();
  loadSample(a);
  const before = a.get("fieldValue(selectedRow(), 'author')");
  a.run(`
    state.cloud.config = {enabled:false, aiEnabled:true};
    state.sourceText = sourcePages[selectedRow().sourceFile];
    state.sourceStatus = 'ready';
    resetAiForRow(selectedRow());
  `);
  a.set("fetch", async () => ({
    ok: true,
    json: async () => ({
      proposal: {
        fields: { author: "模型候选书家", unknown: "不得进入前端" },
        evidence: [{ fieldId: "author", quote: "王羲之", verified: true }],
        reasoning: [
          { fieldId: "author", decision: "change", reason: "原文直接出现书家姓名。", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "unknown", decision: "change", reason: "不得进入前端。", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "author", decision: "invalid", reason: "非法决策。", evidenceQuote: "王羲之", evidenceVerified: true }
        ],
        abstentions: []
      },
      meta: { model: "test-model", promptVersion: 7, generatedAt: "2026-09-14T00:00:00Z" }
    })
  }));
  assert.equal(await a.run("performAiExtraction(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before, "generation must not mutate the row");
  assert.equal(a.run("state.aiProposal.proposal.fields.unknown"), undefined);
  assert.equal(a.get("state.aiProposal.proposal.reasoning.length"), 1);
  assert.equal(a.get("state.aiProposal.proposal.reasoning[0].decision"), "change");
  assert.deepEqual(a.get("state.aiFieldJudgments"), {});
  a.run("state.aiPanelOpen = true; setAiFieldJudgment('author', 'accept')");
  assert.match(a.run("aiReviewPanel(selectedRow())"), /保存核验/);
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "模型候选书家");
  assert.equal(a.get("selectedRow().reviewed"), false);
  assert.equal(a.get("selectedRow().modelVersion"), "test-model");
  assert.equal(a.get("selectedRow().history.at(-1).type"), "ai-field-review");
});

test("AI renders every visible schema field with explicit missing-reason fallback", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.aiPanelOpen = true;
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = {
      proposal: {
        fields: { author: "候选书家" },
        evidence: [],
        reasoning: [{ fieldId: "author", decision: "change", reason: "作者证据", evidenceQuote: "王羲之", evidenceVerified: true }],
        abstentions: []
      },
      meta: { model: "test", promptVersion: 1 }
    };
  `);
  const panel = a.run("aiReviewPanel(selectedRow())");
  assert.equal((panel.match(/class="ai-field-review/g) || []).length, a.get("orderedSchema({ includeHidden: false }).length"));
  assert.match(panel, /模型未提供该字段的判断理由。/);
  assert.match(panel, /data-ai-judgment="accept"/);
  assert.match(panel, /data-ai-judgment="reject"/);
  assert.match(panel, /data-ai-judgment="uncertain"/);
});

test("AI apply writes only accepted changed fields and records rejected feedback", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = {
      proposal: {
        fields: { author: "模型书家", scriptType: "模型书体" },
        evidence: [],
        reasoning: [
          { fieldId: "author", decision: "change", reason: "作者证据", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "scriptType", decision: "change", reason: "书体证据", evidenceQuote: "草书", evidenceVerified: false }
        ],
        abstentions: []
      },
      meta: { model: "test-model", promptVersion: 7 }
    };
    state.aiInputSignature = aiInputSignature(selectedRow());
    state.aiFieldJudgments = { author: "accept", scriptType: "reject" };
  `);
  const originalScript = a.get("fieldValue(selectedRow(), 'scriptType')");
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "模型书家");
  assert.equal(a.get("fieldValue(selectedRow(), 'scriptType')"), originalScript);
  assert.equal(a.get("selectedRow().history.at(-1).decisions.scriptType"), "reject");
  assert.equal(a.get("selectedRow().reviewed"), false);
});

test("assist mode adopts unanimous fields but leaves the record unreviewed with a safe audit snapshot", () => {
  const a = consensusReadyApp({ decision: "adopt_fields", reviewMode: "assist" });
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("selectedRow().reviewed"), false);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "苏轼");
  assert.equal(a.get("selectedRow().history.at(-1).type"), "ai-consensus-assist");
  assert.equal(a.get("selectedRow().history.at(-1).consensusRun.runId"), "run-test");
  assert.equal(a.get("selectedRow().history.at(-1).consensusRun.models[0].proposal.answerSources.author"), "repair");
  assert.equal(JSON.stringify(a.get("selectedRow().history.at(-1).consensusRun")).includes("must-not-survive"), false);
});

test("auto mode approves only a server-qualified unanimous record and undo preserves its audit", () => {
  const a = consensusReadyApp({ decision: "auto_approve_record", reviewMode: "auto" });
  const rowId = a.get("state.selectedId");
  assert.equal(a.run("applyConsensusDecision(state.selectedId)"), true);
  assert.equal(a.run(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).reviewed`), true);
  assert.equal(a.run(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).history.at(-1).type`), "ai-consensus-auto-approve");
  assert.equal(a.run("undoLastAction()"), true);
  assert.equal(a.run(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).reviewed`), false);
  assert.deepEqual(a.get(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).history.slice(-2).map(event => event.type)`), ["ai-consensus-auto-approve", "ai-consensus-reverted"]);
  assert.equal(a.run(`Boolean(state.rows.find(item => item.id === ${JSON.stringify(rowId)}).history.find(event => event.type === 'ai-consensus-auto-approve').consensusRun.runId)`), true);
});

test("consensus audit is visible in the existing detail history panel", () => {
  const a = consensusReadyApp({ decision: "auto_approve_record", reviewMode: "auto" });
  assert.equal(a.run("applyConsensusDecision(state.selectedId)"), true);
  const markup = a.run("detailPanel(selectedRow())");
  assert.match(markup, /class="trace-card"/);
  assert.match(markup, /共识自动判过/);
  assert.match(markup, /class="consensus-history-details"/);
  assert.match(markup, /查看判定依据/);
  assert.match(markup, /run-test/);
});

test("auto consensus rolls back the record when workspace persistence fails", () => {
  const a = consensusReadyApp({ decision: "auto_approve_record", reviewMode: "auto" });
  const before = a.get("cloneRow(selectedRow())");
  a.failWrites(true);
  assert.equal(a.run("applyConsensusDecision(state.selectedId)"), false);
  assert.deepEqual(a.get("cloneRow(selectedRow())"), before);
  assert.equal(a.get("state.aiStatus"), "ready");
});

test("auto mode applies a qualified server decision immediately after generation", async () => {
  const a = app();
  loadSample(a);
  const rowId = a.get("state.selectedId");
  a.run(`
    state.cloud.config = { enabled: false, aiEnabled: true, consensusEnabled: true };
    state.modelSettings.policy = { reviewMode: "auto", defaultConsensus: "standard", fieldOverrides: {} };
    state.sourceText = sourcePages[selectedRow().sourceFile];
    state.sourceStatus = "ready";
    resetAiForRow(selectedRow());
  `);
  a.set("fetch", async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
      runId: JSON.parse(options.body).runId,
      status: "complete",
      decision: "auto_approve_record",
      blockers: [],
      fields: { author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"] } },
      models: ["primary", "secondary", "tertiary"].map((id, index) => ({ profileId: id, status: "success", profile: { id, displayName: id, model: id, modelFamily: index ? "family-b" : "family-a" }, proposal: { fields: { author: "苏轼" }, reasoning: [], evidence: [], abstentions: [] } }))
    })
  }));
  assert.equal(await a.run("performAiExtraction(state.selectedId)"), true);
  assert.equal(a.run(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).reviewed`), true);
  assert.equal(a.run(`state.rows.find(item => item.id === ${JSON.stringify(rowId)}).history.at(-1).type`), "ai-consensus-auto-approve");
});

for (const [decisionLabel, reasoning] of [
  ["keep", [{ fieldId: "author", decision: "keep", reason: "保留当前书家。", evidenceQuote: "王羲之", evidenceVerified: true }]],
  ["abstain", [{ fieldId: "author", decision: "abstain", reason: "证据不足，无法判断。", evidenceQuote: "", evidenceVerified: false }]],
  ["missing-reason fallback", []]
]) {
  test(`accepted ${decisionLabel} cannot mutate a differing proposal field`, () => {
    const a = app();
    loadSample(a);
    const before = a.get("fieldValue(selectedRow(), 'author')");
    const draftBefore = a.run("selectedRow().aiDraft?.author");
    a.set("reasoning", reasoning);
    a.run(`
      state.aiStatus = "ready";
      state.aiRowId = state.selectedId;
      state.aiWorkspaceId = state.workspaceId;
      state.aiProposal = {
        proposal: { fields: { author: "不得写入的隐藏值" }, evidence: [], reasoning, abstentions: [] },
        meta: { model: "mismatch-test", promptVersion: 1 }
      };
      state.aiInputSignature = aiInputSignature(selectedRow());
      state.aiFieldJudgments = { author: "accept" };
    `);
    assert.equal(a.get("aiReviewedFields(selectedRow()).find(item => item.field.id === 'author').after"), before);
    assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
    assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before);
    assert.deepEqual(a.get("selectedRow().history.at(-1).changes"), []);
    assert.equal(a.run("selectedRow().aiDraft?.author"), draftBefore);
  });
}

test("uncertain AI fields keep their values and route the row to the problem queue", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = { proposal: { fields: { author: "候选" }, evidence: [], reasoning: [], abstentions: [] }, meta: { model: "test", promptVersion: 1 } };
    state.aiInputSignature = aiInputSignature(selectedRow());
    state.aiFieldJudgments = { author: "uncertain" };
  `);
  const before = a.get("fieldValue(selectedRow(), 'author')");
  assert.equal(a.run("applyAiProposal(state.selectedId)"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before);
  assert.equal(a.get("selectedRow().problemResolution.status"), "pending_review");
  assert.match(a.get("selectedRow().history.at(-1).reason"), /存疑/);
});

test("AI field judgments are exclusive and preserve proposal state", () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; resetAiForRow(selectedRow())");
  assert.equal(a.run("setAiFieldJudgment('author', 'accept')"), true);
  assert.equal(a.get("state.aiFieldJudgments.author"), "accept");
  assert.equal(a.run("setAiFieldJudgment('author', 'reject')"), true);
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "reject" });
  assert.equal(a.run("setAiFieldJudgment('unknown', 'accept')"), false);
});

test("AI accept-all selects only reasoned fields without applying them", () => {
  const a = app();
  loadSample(a);
  const before = a.get("fieldValue(selectedRow(), 'author')");
  a.run(`
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = {
      proposal: {
        fields: { author: "模型书家" },
        evidence: [],
        reasoning: [
          { fieldId: "author", decision: "change", reason: "作者证据", evidenceQuote: "王羲之", evidenceVerified: true },
          { fieldId: "scriptType", decision: "keep", reason: "书体与原文一致", evidenceQuote: "草书", evidenceVerified: true }
        ],
        abstentions: []
      },
      meta: { model: "test", promptVersion: 1 }
    };
    state.aiInputSignature = aiInputSignature(selectedRow());
    state.aiFieldJudgments = { author: "reject" };
  `);
  assert.equal(a.run("acceptAllAiFieldJudgments(selectedRow())"), true);
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "accept", scriptType: "accept" });
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), before);
  assert.match(a.run("aiPanelActions(selectedRow())"), /data-ai-accept-all[^>]*disabled/);
  assert.equal(a.run("acceptAllAiFieldJudgments(selectedRow())"), false);
});

test("AI judgment updates in place without replacing the panel or losing focus and scroll", () => {
  const a = app();
  loadSample(a);
  const scroll = { scrollTop: 173 };
  const acceptAllAction = { disabled: false };
  const clearAction = { disabled: false };
  const applyAction = { disabled: true, textContent: "unchanged" };
  let replacements = 0;
  const panel = {
    querySelector: (selector) => ({
      "[data-ai-accept-all]": acceptAllAction,
      "[data-ai-clear]": clearAction,
      "[data-ai-apply]": applyAction,
      ".ai-panel-scroll": scroll
    })[selector] || null,
    set outerHTML(_value) { replacements += 1; }
  };
  const buttons = ["accept", "reject", "uncertain"].map((judgment) => ({
    dataset: { aiJudgment: judgment, fieldId: "author" },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  const focused = buttons[1];
  a.set("document", {
    activeElement: focused,
    querySelector: (selector) => selector === "#aiEvidencePanel" ? panel : null,
    querySelectorAll: (selector) => selector === "[data-ai-judgment]" ? buttons : []
  });
  a.run(`
    state.aiPanelOpen = true;
    state.aiStatus = "ready";
    state.aiRowId = state.selectedId;
    state.aiWorkspaceId = state.workspaceId;
    state.aiProposal = { proposal: { fields: {}, evidence: [], reasoning: [], abstentions: [] }, meta: { model: "test", promptVersion: 1 } };
    state.aiInputSignature = aiInputSignature(selectedRow());
  `);
  assert.equal(a.run("setAiFieldJudgment('author', 'reject')"), true);
  assert.equal(replacements, 0);
  assert.equal(scroll.scrollTop, 173);
  assert.equal(a.run("document.activeElement === document.querySelectorAll('[data-ai-judgment]')[1]"), true);
  assert.deepEqual(buttons.map((button) => button.attributes["aria-pressed"]), ["false", "true", "false"]);
  assert.match(applyAction.textContent, /保存核验/);
  assert.equal(applyAction.disabled, false);
});

test("mobile AI pane switch changes visibility state without clearing decisions", () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; state.aiFieldJudgments = { author: 'accept' }; setAiMobilePane('reasoning')");
  assert.equal(a.get("state.aiMobilePane"), "reasoning");
  assert.deepEqual(a.get("state.aiFieldJudgments"), { author: "accept" });
});

test("AI responses for a row left during generation are discarded", async () => {
  const a = app();
  loadSample(a);
  const firstId = a.get("state.selectedId");
  const secondId = a.get("state.rows.find(row => row.id !== state.selectedId).id");
  let release;
  a.run(`state.cloud.config = {enabled:false, aiEnabled:true}; state.sourceText = sourcePages[selectedRow().sourceFile]; resetAiForRow(selectedRow())`);
  a.set("fetch", () => new Promise((resolve) => {
    release = () => resolve({ ok: true, json: async () => ({ proposal: { fields: { author: "过期建议" }, evidence: [], abstentions: [] }, meta: { model: "test" } }) });
  }));
  const pending = a.run(`performAiExtraction("${firstId}")`);
  a.run(`state.selectedId = "${secondId}"; resetAiForRow(selectedRow())`);
  release();
  assert.equal(await pending, false);
  assert.equal(a.get("state.aiProposal"), null);
});

test("AI input signature covers row, source, visible fields, and schema inputs", () => {
  const a = app();
  loadSample(a);
  a.run("state.sourceText = sourcePages[selectedRow().sourceFile]");
  const original = a.get("aiInputSignature(selectedRow())");
  for (const mutation of [
    "setFieldValue(selectedRow(), 'author', '同排人工修改')",
    "state.sourceText += '补充原文'",
    "selectedRow().sourceFile = 'other.txt'",
    "selectedRow().pageNo = '999'",
    "schemaField('author').prompt += '补充规则'",
    "schemaField('author').visible = false"
  ]) {
    const b = app();
    loadSample(b);
    b.run("state.sourceText = sourcePages[selectedRow().sourceFile]");
    b.run(mutation);
    assert.notEqual(b.get("aiInputSignature(selectedRow())"), original, mutation);
  }
});

test("editing the same row during AI generation discards the response", async () => {
  const a = app();
  loadSample(a);
  let release;
  a.run("state.aiPanelOpen = true; state.cloud.config = { enabled: false, aiEnabled: true }; state.sourceText = sourcePages[selectedRow().sourceFile]");
  a.set("fetch", () => new Promise((resolve) => {
    release = () => resolve({ ok: true, json: async () => ({
      proposal: { fields: { author: "过期候选" }, evidence: [], reasoning: [{ fieldId: "author", decision: "change", reason: "旧输入", evidenceQuote: "", evidenceVerified: false }], abstentions: [] },
      meta: { model: "test", promptVersion: 1 }
    }) });
  }));
  const pending = a.run("performAiExtraction(state.selectedId)");
  a.run("setFieldValue(selectedRow(), 'author', '生成期间人工修改')");
  release();
  assert.equal(await pending, false);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "生成期间人工修改");
  assert.equal(a.get("state.aiProposal"), null);
  assert.equal(a.get("state.aiStatus"), "idle");
});

test("editing the same row after AI is ready invalidates acceptance before apply", async () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; state.cloud.config = { enabled: false, aiEnabled: true }; state.sourceText = sourcePages[selectedRow().sourceFile]");
  a.set("fetch", async () => ({ ok: true, json: async () => ({
    proposal: { fields: { author: "待失效候选" }, evidence: [], reasoning: [{ fieldId: "author", decision: "change", reason: "旧输入", evidenceQuote: "", evidenceVerified: false }], abstentions: [] },
    meta: { model: "test", promptVersion: 1 }
  }) }));
  assert.equal(await a.run("performAiExtraction(state.selectedId)"), true);
  a.run("setAiFieldJudgment('author', 'accept'); setFieldValue(selectedRow(), 'author', '就绪后人工修改')");
  assert.equal(a.run("applyAiProposal(state.selectedId)"), false);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "就绪后人工修改");
  assert.equal(a.get("state.aiProposal"), null);
  assert.deepEqual(a.get("state.aiFieldJudgments"), {});
  assert.equal(a.get("state.aiPanelOpen"), true);
});

test("same-workspace reload invalidates a ready AI proposal", async () => {
  const a = app();
  loadSample(a);
  a.run("state.aiPanelOpen = true; state.cloud.config = { enabled: false, aiEnabled: true }; state.sourceText = sourcePages[selectedRow().sourceFile]");
  a.set("fetch", async () => ({ ok: true, json: async () => ({
    proposal: { fields: { author: "重载前候选" }, evidence: [], reasoning: [{ fieldId: "author", decision: "change", reason: "旧版本", evidenceQuote: "", evidenceVerified: false }], abstentions: [] },
    meta: { model: "test", promptVersion: 1 }
  }) }));
  assert.equal(await a.run("performAiExtraction(state.selectedId)"), true);
  a.run("setAiFieldJudgment('author', 'accept')");
  const key = a.run("storageKey(state.workspaceId)");
  const newer = JSON.parse(a.disk.get(key));
  newer.rows[0].fields.author = "重载后的人工值";
  newer.rows[0].author = "重载后的人工值";
  newer.savedAt = "2099-01-01T00:00:00.000Z";
  a.disk.set(key, JSON.stringify(newer));
  a.run("state.workspaceConflict = { id: state.workspaceId, deleted: false }");
  assert.equal(a.run("reloadLatestWorkspace()"), true);
  assert.equal(a.get("fieldValue(selectedRow(), 'author')"), "重载后的人工值");
  assert.equal(a.get("state.aiProposal"), null);
  assert.deepEqual(a.get("state.aiFieldJudgments"), {});
  assert.equal(a.get("state.aiPanelOpen"), true);
  assert.equal(a.run("applyAiProposal(state.selectedId)"), false);
});

const reviewSnapshot = (a) => a.get(`({rows:state.rows, trashRows:state.trashRows,
  reviewState:state.reviewState, undoAction:state.undoAction, selectedId:state.selectedId,
  editingId:state.editingId, resolutionRowId:state.resolutionRowId, manifest:state.manifest,
  sourceText:state.sourceText, sourceStatus:state.sourceStatus})`);

function sharedWorkspaces() {
  const a = app();
  loadSample(a);
  const b = app({ disk: a.disk });
  assert.equal(b.run("loadWorkspace()"), true);
  return { a, b, key: a.run("storageKey(state.workspaceId)") };
}

test("a stale tab cannot overwrite a newer confirmation even without a storage event", () => {
  const { a, b, key } = sharedWorkspaces();
  const before = reviewSnapshot(b);
  assert.equal(a.run("confirmRow('SD-0014')"), true);
  const saved = a.disk.get(key);
  b.run("syncRowChangeToCloud = () => downloads.push('cloud')");
  const result = b.run("confirmRow('SD-0017')");
  assert.equal(b.disk.get(key) === saved, true, "newer disk data must remain untouched");
  assert.deepEqual(reviewSnapshot(b), before);
  assert.equal(result, false);
  assert.deepEqual(b.get("downloads"), []);
  assert.equal(b.get("state.workspaceConflict.id"), "test-workspace");
});

test("stale batch, reset, deletion and schema saves cannot replace newer disk data", () => {
  for (const operation of ["batchMarkVisibleReview()", "resetReviewState()", "deleteRow('SD-0017')", "clearWorkspace()", "updateSchemaField('quote', 'label', 'new label')"]) {
    const { a, b, key } = sharedWorkspaces();
    a.run("confirmRow('SD-0014')");
    const saved = a.disk.get(key);
    b.run(operation);
    assert.equal(b.disk.get(key) === saved, true, operation);
  }
});

test("a deleted or externally corrupted workspace cannot be resurrected by a stale page", () => {
  for (const replacement of [null, "invalid-json"]) {
    const { b, key } = sharedWorkspaces();
    if (replacement === null) b.disk.delete(key);
    else b.disk.set(key, replacement);
    assert.equal(b.run("confirmRow('SD-0017')"), false);
    assert.equal(b.disk.get(key) ?? null, replacement);
    assert.equal(b.run("reloadLatestWorkspace()"), false);
    assert.equal(b.get("state.rows.length"), 409);
  }
});

test("conflict recovery reloads the same workspace, not another tab's pointer, and allows retry", () => {
  const { a, b, key } = sharedWorkspaces();
  a.run("confirmRow('SD-0014')");
  b.run("confirmRow('SD-0017')");
  const pointer = a.run("WORKSPACE_POINTER_KEY");
  a.disk.set(pointer, "another-workspace");
  const saved = a.disk.get(key);
  b.run("window.confirm = () => false");
  assert.equal(b.run("reloadLatestWorkspace()"), false);
  assert.equal(b.disk.get(key), saved);
  b.run("window.confirm = () => true");
  assert.equal(b.run("reloadLatestWorkspace()"), true);
  assert.equal(b.get("state.workspaceId"), "test-workspace");
  assert.equal(b.run("state.workspaceConflict"), null);
  assert.equal(b.disk.get(pointer), "another-workspace");
  assert.equal(b.get("state.rows.find(row => row.id === 'SD-0014').reviewed"), true);
  assert.equal(b.run("confirmRow('SD-0017')"), true);
  assert.equal(JSON.parse(b.disk.get(key)).rows.filter(row => row.reviewed).length, 2);
});

test("legacy payloads with unchanged timestamps are still protected and selection-only writes are allowed", () => {
  const { a, b, key } = sharedWorkspaces();
  const payload = JSON.parse(a.disk.get(key));
  payload.rows[0].note = "external change with the same savedAt";
  a.disk.set(key, JSON.stringify(payload));
  assert.equal(b.run("confirmRow('SD-0017')"), false);
  assert.equal(b.run("reloadLatestWorkspace()"), true);
  a.disk.set(key + ":selection", "SD-0014");
  assert.equal(b.run("confirmRow('SD-0017')"), true);
});

test("conflict backups preserve local rows without claiming to save or changing the newer version", () => {
  const { a, b, key } = sharedWorkspaces();
  a.run("confirmRow('SD-0014')");
  const saved = a.disk.get(key);
  b.run("confirmRow('SD-0017'); exportWorkspace()");
  assert.equal(b.disk.get(key), saved);
  assert.equal(b.get("downloads.length"), 1);
  const backup = JSON.parse(b.get("downloads[0].content"));
  assert.equal(backup.rows.filter(row => row.reviewed).length, 0);
});

test("unloaded existing workspaces are not implicitly trusted or overwritten", () => {
  const { a, key } = sharedWorkspaces();
  const fresh = app({disk:a.disk});
  const before = a.disk.get(key);
  assert.equal(fresh.run("saveWorkspace()"), false);
  assert.equal(a.disk.get(key) === before, true);
});

test("a peer save during payload preparation is caught before committing", () => {
  const { a, b, key } = sharedWorkspaces();
  let peerSaved;
  b.set("peerSave", () => {
    a.run("confirmRow('SD-0014')");
    peerSaved = a.disk.get(key);
  });
  b.run("const originalPayload = workspacePayload; workspacePayload = () => { peerSave(); return originalPayload(); }");
  const result = b.run("confirmRow('SD-0017')");
  assert.equal(b.disk.get(key) === peerSaved, true);
  assert.equal(result, false);
});

test("the conflict dialog traps keyboard focus and closing it does not authorize overwriting", () => {
  const { a, b, key } = sharedWorkspaces();
  const focus = [];
  const buttons = Array.from({length:3}, (_, index) => ({
    addEventListener() {}, focus: () => focus.push(index)
  }));
  const original = {isConnected:true, focus:()=>focus.push('original')};
  const host = {innerHTML:'', querySelector(selector) {
    if (selector === '[role="dialog"]') return this.innerHTML ? {} : null;
    if (!this.innerHTML) return null;
    return selector.includes('close') ? buttons[0] : selector.includes('backup') ? buttons[1] : buttons[2];
  }, querySelectorAll:()=>buttons};
  const document = {activeElement:original, querySelector:selector=>selector==='#workspaceConflictHost'?host:null,
    querySelectorAll:()=>[]};
  b.set("document", document);
  a.run("confirmRow('SD-0014')");
  const saved = a.disk.get(key);
  b.run("confirmRow('SD-0017')");
  assert.match(host.innerHTML, /role="dialog"/);
  assert.deepEqual(focus, [0]);
  document.activeElement = buttons[2];
  let prevented = 0;
  host.onkeydown({key:'Tab', preventDefault(){prevented++}});
  document.activeElement = buttons[0];
  host.onkeydown({key:'Tab', shiftKey:true, preventDefault(){prevented++}});
  assert.equal(prevented, 2);
  assert.deepEqual(focus, [0,0,2]);
  host.onkeydown({key:'Escape', preventDefault(){}, stopPropagation(){}});
  assert.equal(host.innerHTML, '');
  assert.equal(focus.at(-1), 'original');
  assert.equal(b.run("confirmRow('SD-0017')"), false);
  assert.equal(b.disk.get(key) === saved, true);
});

test("failed batch marking restores all records, history, selection and undo without rendering", () => {
  const a = app();
  loadSample(a);
  a.run(`confirmRow(state.rows[0].id); state.filter = 'all';
    heldRow = state.rows[0]; render = () => downloads.push('render')`);
  const before = reviewSnapshot(a);
  const disk = [...a.disk];
  a.failWrites(true);
  const result = a.run("batchMarkVisibleReview()");
  assert.deepEqual(reviewSnapshot(a), before);
  assert.equal(result, false);
  assert.deepEqual([...a.disk], disk);
  assert.equal(a.run("heldRow === state.rows[0]"), true);
  assert.deepEqual(a.get("downloads"), []);
  a.failWrites(false);
  assert.equal(a.run("batchMarkVisibleReview()"), true);
  assert.equal(a.get("state.rows.filter(row => row.status === '待复核' && !row.reviewed).length"), 409);
  assert.equal(a.run("state.undoAction"), null);
  assert.deepEqual(a.get("state.reviewState.confirmedIds"), []);
  const saved = a.get("state.rows");
  a.run("loadWorkspace()");
  assert.deepEqual(a.get("state.rows"), saved);
});

test("batch marking touches only the filtered queue and records the actual prior issue", () => {
  const a = app();
  loadSample(a);
  a.run("state.query = 'SD-0014'; state.filter = 'all'; confirmRow('SD-0014')");
  const hidden = a.get("state.rows.filter(row => row.id !== 'SD-0014')");
  const issue = a.get("state.rows.find(row => row.id === 'SD-0014').issue");
  assert.equal(a.run("batchMarkVisibleReview()"), true);
  assert.deepEqual(a.get("state.rows.filter(row => row.id !== 'SD-0014')"), hidden);
  assert.equal(a.get("state.rows.find(row => row.id === 'SD-0014').history.at(-1).changes[0].before"), issue);
});

test("failed reset commit preserves reviewed records, trash, undo and source before retry", () => {
  const a = app();
  loadSample(a);
  a.run(`confirmRow(state.rows[0].id); deleteRow(state.rows[1].id);
    state.sourceText = 'current source'; state.sourceStatus = 'ready';
    render = () => downloads.push('render')`);
  const before = reviewSnapshot(a);
  const originals = a.get("state.originalRows");
  let writes = 0;
  const key = a.run("storageKey(state.workspaceId)");
  a.failWrites((candidate) => candidate === key && ++writes === 2);
  const result = a.run("resetReviewState()");
  assert.equal(writes, 2);
  assert.deepEqual(reviewSnapshot(a), before);
  assert.equal(result, false);
  assert.deepEqual(a.get("downloads"), []);
  assert.deepEqual(JSON.parse(a.disk.get(key)).rows, before.rows);
  a.failWrites(false);
  assert.equal(a.run("resetReviewState()"), true);
  assert.deepEqual(a.get("state.rows"), originals);
  assert.deepEqual(a.get("state.trashRows"), []);
  assert.deepEqual(a.get("state.reviewState"), {confirmedIds:[], deletedIds:[], edits:{}});
  assert.equal(a.run("state.undoAction"), null);
  a.run("loadWorkspace()");
  assert.deepEqual(a.get("state.rows"), originals);
});

test("cancelled bulk operations and an empty batch do not mutate or persist anything", () => {
  const a = app();
  loadSample(a);
  a.run("window.confirm = () => false");
  const before = reviewSnapshot(a);
  const disk = [...a.disk];
  assert.equal(a.run("batchMarkVisibleReview()"), false);
  assert.equal(a.run("resetReviewState()"), false);
  assert.deepEqual(reviewSnapshot(a), before);
  assert.deepEqual([...a.disk], disk);
  a.run("state.query = 'no-such-record-xyz'; window.confirm = () => { throw Error('unexpected confirmation'); }");
  assert.equal(a.run("batchMarkVisibleReview()"), false);
  assert.deepEqual([...a.disk], disk);
});

test("reset preflight failure leaves all review progress unchanged", () => {
  const a = app();
  loadSample(a);
  a.run("confirmRow(state.rows[0].id)");
  const before = reviewSnapshot(a);
  a.failWrites(true);
  assert.equal(a.run("resetReviewState()"), false);
  assert.deepEqual(reviewSnapshot(a), before);
});

test("bulk marking a resolved queue and resetting it cannot leave an actionable hidden selection", () => {
  const a = app();
  loadSample(a);
  a.run("setProblemStatus(state.rows[0].id, 'resolved', 'checked original'); state.filter = 'resolved'");
  assert.equal(a.get("visibleRows().length"), 1);
  assert.equal(a.run("batchMarkVisibleReview()"), true);
  assert.equal(a.get("visibleRows().length"), 0);
  assert.equal(a.run("state.selectedId"), "");
  assert.equal(a.run("selectedRow()"), null);
  assert.equal(a.run("resetReviewState()"), true);
  assert.equal(a.run("state.selectedId"), "");
  assert.equal(a.run("selectedRow()"), null);
});

test("saving the active workspace avoids a redundant pointer write after the data commit", () => {
  const a = app();
  loadSample(a);
  const pointer = a.run("WORKSPACE_POINTER_KEY");
  a.failWrites((key) => key === pointer);
  assert.equal(a.run("confirmRow(state.rows[0].id)"), true);
  assert.equal(JSON.parse(a.disk.get(a.run("storageKey(state.workspaceId)"))).rows[0].reviewed, true);
  assert.deepEqual(a.alerts, []);
});

test("an empty or filtered queue cannot expose or confirm an unrelated row", () => {
  const a = app();
  loadSample(a);
  a.run("state.query = 'no-such-record-xyz'; state.selectedId = ''");
  const before = a.get("state.rows");
  assert.equal(a.run("selectedRow()"), null);
  a.run("confirmAndNext(''); nextResult(); previousResult()");
  assert.deepEqual(a.get("state.rows"), before);
  a.run("state.query = 'SD-0014'; state.selectedId = 'SD-0017'");
  assert.equal(a.get("selectedRow().id"), "SD-0014");
  assert.equal(a.run("selectResult('SD-0017')"), false);
});

test("failed confirmation stays on the current row and never syncs or changes history", () => {
  const a = app();
  loadSample(a);
  a.run("state.selectedId = visibleRows()[0].id; syncRowChangeToCloud = () => downloads.push('sync')");
  const before = a.get("workspacePayload()");
  a.failWrites(true);
  a.run("confirmAndNext(state.selectedId)");
  assert.deepEqual(a.get("state.rows"), before.rows);
  assert.deepEqual(a.get("state.reviewState"), before.reviewState);
  assert.equal(a.get("state.selectedId"), before.selectedId);
  assert.deepEqual(a.get("state.undoAction"), before.undoAction);
  assert.equal(a.get("downloads.length"), 0);
  assert.ok(a.alerts.length);
});

test("stale research response cannot replace another selected record", async () => {
  const a = app();
  loadSample(a);
  a.run("state.selectedId = 'SD-0017'; updateResearchDom = (row) => downloads.push(row?.id)");
  let finish;
  a.set("fetch", () => new Promise((resolve) => { finish = resolve; }));
  const pending = a.run("performResearchSearch('old query', 'SD-0017')");
  a.run("state.selectedId = 'SD-0014'; resetResearchForRow(selectedRow())");
  finish({ ok: true, json: async () => ({ results: [{ title: "old result" }] }) });
  await pending;
  assert.equal(a.get("state.researchStatus"), "idle");
  assert.deepEqual(a.get("state.researchResults"), []);
  assert.deepEqual(a.get("downloads"), ["SD-0017"]);
});

for (const scenario of [
  { name: "flag", action: "toggleFlagRow('A')" },
  { name: "tag", action: "toggleProblemTag('A', 'script_issue')" },
  { name: "problem closure", action: "setProblemStatus('A', 'resolved', 'checked source')" },
  { name: "delete", action: "deleteRow('A')" },
  { name: "restore", setup: "deleteRow('A')", action: "restoreTrashRow('A')" },
  { name: "undo", setup: "confirmRow('A')", action: "undoLastAction()" },
  { name: "edit", setup: "state.editingId = 'A'", action: `saveEdit({
    ...Object.fromEntries(orderedSchema().map((field) => ['field:' + field.id, fieldValue(state.rows[0], field.id)])),
    'field:quote': 'new excerpt', editReason: 'checked original', annotationBody: 'keep this note'
  })` }
]) {
  test("failed " + scenario.name + " restores local state and allows a successful retry", () => {
    const a = app();
    a.set("inputCsv", csv("A") + "\nB,王羲之,另一条摘录,154,page_154.txt,exact");
    a.run("state.rows = parseCsv(inputCsv).map(makeResult); state.selectedId = 'A'; saveWorkspace()");
    if (scenario.setup) a.run(scenario.setup);
    a.run("syncRowChangeToCloud = () => downloads.push('sync')");
    const snapshot = () => a.get("({rows: state.rows, trash: state.trashRows, review: state.reviewState, undo: state.undoAction, selected: state.selectedId, editing: state.editingId})");
    const before = snapshot();
    const diskBefore = [...a.disk.entries()];
    a.failWrites(true);
    assert.equal(a.run(scenario.action), false);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual([...a.disk.entries()], diskBefore);
    assert.equal(a.get("downloads.length"), 0);
    a.failWrites(false);
    assert.equal(a.run(scenario.action), true);
    assert.equal(a.get("downloads.length"), 1);
    assert.notDeepEqual(snapshot(), before);
  });
}

test("50 next-confirm actions persist distinct rows and the next selection", () => {
  const a = app();
  loadSample(a);
  a.run("state.selectedId = visibleRows()[0].id");
  const expected = a.get("visibleRows().slice(0, 51).map(row => row.id)");
  for (let index = 0; index < 50; index++) {
    assert.equal(a.get("state.selectedId"), expected[index]);
    a.run("confirmAndNext(state.selectedId)");
  }
  assert.equal(a.get("state.selectedId"), expected[50]);
  assert.equal(a.get("state.rows.filter(row => row.reviewed).length"), 50);
  a.run("loadWorkspace()");
  assert.equal(a.get("state.selectedId"), expected[50]);
  assert.equal(a.get("state.rows.filter(row => row.reviewed).length"), 50);
  assert.equal(a.get("state.rows.length"), 409);
});

test("finishing the last filtered problem leaves an empty safe queue", () => {
  const a = app();
  a.set("inputCsv", csv("A"));
  a.run("state.rows = parseCsv(inputCsv).map(makeResult); state.filter = 'problem'; state.selectedId = 'A'");
  assert.equal(a.run("setProblemStatus('A', 'resolved', 'checked original')"), true);
  assert.equal(a.get("visibleRows().length"), 0);
  assert.equal(a.run("selectedRow()"), null);
  assert.equal(a.get("state.selectedId"), "");
  assert.doesNotMatch(a.run("detailPanel(selectedRow())"), /data-row-action/);
});

test("shortcuts respect typing, IME, dialogs, redo and held Enter", () => {
  const a = app();
  a.run(`
    confirmAndNext = () => downloads.push('confirm');
    nextResult = () => downloads.push('next');
    previousResult = () => downloads.push('previous');
    undoLastAction = () => downloads.push('undo');
  `);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON"]) {
    a.set("target", { tagName, closest: () => null });
    a.run("handleWorkbenchShortcut({key:'Enter', target, preventDefault(){}})");
  }
  for (const overrides of [
    { isComposing: true }, { repeat: true }, { ctrlKey: true }, { altKey: true },
    { key: "z", metaKey: true, shiftKey: true }
  ]) {
    a.set("event", { key: "Enter", preventDefault() {}, ...overrides });
    a.run("handleWorkbenchShortcut(event)");
  }
  a.run("state.templatePanelExpanded = true; handleWorkbenchShortcut({key:'Enter', preventDefault(){}}); state.templatePanelExpanded = false");
  assert.deepEqual(a.get("downloads"), []);
  a.run(`['j', 'k', 'Enter'].forEach(key => handleWorkbenchShortcut({key, preventDefault(){}}));
    handleWorkbenchShortcut({key:'z', metaKey:true, preventDefault(){}})`);
  assert.deepEqual(a.get("downloads"), ["next", "previous", "confirm", "undo"]);
});

test("research handlers are delegated to the persistent detail panel", () => {
  const a = app();
  const handlers = new Map();
  a.set("document", {
    querySelector: (selector) => selector === ".detail-panel" ? {
      addEventListener: (type, handler) => handlers.set(type, handler)
    } : null,
    querySelectorAll: () => []
  });
  a.run("attachDetailEvents()");
  assert.equal(typeof handlers.get("submit"), "function");
  assert.equal(typeof handlers.get("input"), "function");
  a.run("selectedRow = () => ({id:'A'}); performResearchSearch = (query, id) => downloads.push({query, id})");
  let prevented = false;
  const form = { researchQuery: "new form after row switch" };
  handlers.get("submit")({ target: { closest: () => form }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(a.get("downloads"), [{ query: form.researchQuery, id: "A" }]);
});

test("research empty states are explicit and only safe web links render", () => {
  const a = app();
  a.set("results", [null, {title:"Unsafe", url:"javascript:alert(1)"}, {title:"Broken", url:"not-a-url"}, {title:"<script>title</script>", url:"https://example.org/source", snippet:"<b>context</b>"}]);
  assert.equal(a.get("normalizeResearchResults(results).length"), 1);
  a.run("state.researchRowId = 'A'; state.researchStatus = 'ready'; state.researchResults = []");
  assert.match(a.run("researchCardContent({id:'A'})"), /未取得检索结果/);
  assert.doesNotMatch(a.run("researchCardContent({id:'A'})"), /1 条/);
  a.run("state.researchResults = normalizeResearchResults(results)");
  const html = a.run("researchCardContent({id:'A'})");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:|<script>/);
});

test("source-risk metrics and filters use current evidence without closing historical problems", () => {
  const a = app();
  loadSample(a);
  const before = a.get("state.rows");
  const expected = a.get("state.rows.filter(row => sourceQuality(row).rank < 2).map(row => row.id).sort()");
  assert.ok(expected.length > 0 && expected.length < 409);
  assert.equal(a.get("buildManifest(state.rows).stats.abnormalRows"), expected.length);
  a.run("state.filter = 'abnormal'");
  assert.deepEqual(a.get("visibleRows().map(row => row.id).sort()"), expected);
  assert.deepEqual(a.get("state.rows"), before);
  assert.equal(a.get("state.rows.filter(row => row.problemResolution?.status === 'resolved').length"), 0);
});

async function conflictApp() {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); confirmRow('A')");
  await a.import([file("a.csv", csv("A", "另一条摘录内容"))]);
  a.run("confirmPendingImport()");
  return a;
}

test("conflict decisions preserve reviewed originals and skip only identical decided content", async () => {
  const a = await conflictApp();
  const original = a.get("state.rows[0]");
  assert.equal(a.run("resolveImportIssue(1, 0, 'keep', '原件核对，以已审版为准')"), true);
  assert.deepEqual(a.get("state.rows[0]"), original);
  assert.equal(a.get("state.importReports[1].issues[0].resolution.action"), "keep");
  await a.import([file("a.csv", csv("A", "另一条摘录内容"))]);
  assert.equal(a.get("pendingImportPlan().counts.duplicate"), 1);
  a.run("cancelPendingImport()");
  await a.import([file("a.csv", csv("A", "第三种摘录内容"))]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
});

test("alternative records are pending review, unique and never inherit cloud identity", async () => {
  const a = await conflictApp();
  const original = a.get("state.rows[0]");
  a.run("Object.assign(state.importReports[1].issues[0].row, {cloudId: 'remote-id', reviewed: true})");
  assert.equal(a.run("resolveImportIssue(1, 0, 'add', '独立材料，另行审校')"), true);
  assert.deepEqual(a.get("state.rows[0]"), original);
  assert.equal(a.get("state.rows.length"), 2);
  assert.equal(a.get("state.rows[1].reviewed"), false);
  assert.equal(a.run("state.rows[1].cloudId"), undefined);
  assert.equal(a.get("rowHasProblem(state.rows[1])"), true);
  assert.notEqual(a.get("state.rows[1].importOrigin.key"), a.get("state.rows[0].importOrigin.key"));
  a.run("resolveImportIssue(1, 0, 'add', '重复点击'); resolveImportIssue(1, 0, 'reopen', '复核处理依据'); resolveImportIssue(1, 0, 'add', '确认保留另存条目'); loadWorkspace()");
  assert.equal(a.get("state.rows.length"), 2);
  assert.equal(a.get("state.importReports[1].issues[0].resolutionHistory.length"), 3);
});

test("invalid excerpts can be completed without altering the import evidence", async () => {
  const a = app();
  await a.import([file("invalid.csv", csv("BAD", ""))]);
  a.run("confirmPendingImport()");
  assert.equal(a.run("resolveImportIssue(0, 0, 'add', '补齐摘录')"), false);
  assert.equal(a.run("resolveImportIssue(0, 0, 'add', '据原文补齐', '完整原文摘录')"), true);
  assert.equal(a.get("state.rows[0].quote"), "完整原文摘录");
  assert.equal(a.get("state.importReports[0].issues[0].row.quote"), "");
  assert.equal(a.get("state.rows[0].history.at(-1).changes[0].before"), "");
});

test("source conflicts save distinct originals and survive workspace backup restore", async () => {
  const a = app();
  a.run("state.uploadedPages.set('page_154.txt', '旧版原文')");
  await a.import([file("a.csv", csv("A")), file("page_154.txt", "新版原文笔势流畅，气韵生动")]);
  a.run("confirmPendingImport()");
  assert.equal(a.run("resolveImportIssue(0, 0, 'add', '另一版本，与旧版并存')"), true);
  const name = a.get("state.rows[0].sourceFile");
  assert.match(name, /^page_154__v[a-z0-9-]+\.txt$/);
  assert.equal(a.get("state.uploadedPages.get('page_154.txt')"), "旧版原文");
  assert.equal(a.get("sourceQuality(state.rows[0]).rank"), 3);
  const payload = a.get("workspacePayload()");
  await a.import([file("backup.json", JSON.stringify(payload))]);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.equal(a.get("state.rows[0].sourceFile"), name);
  assert.equal(a.get("state.uploadedPages.get(state.rows[0].sourceFile)"), "新版原文笔势流畅，气韵生动");
});

test("source-only conflicts are actionable and repeated resolution reuses the saved version", async () => {
  const a = app();
  a.run("state.uploadedPages.set('page_154.txt', '旧原文')");
  await a.import([file("page_154.txt", "新原文")]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
  assert.match(a.run("importMappingModal()"), /原文新版本/);
  a.run("confirmPendingImport()");
  assert.equal(a.get("state.importReports[0].issues[0].type"), "source");
  a.run("resolveImportIssue(0, 0, 'add', '保留独立版本'); resolveImportIssue(0, 0, 'reopen', '复查'); resolveImportIssue(0, 0, 'add', '仍保留')");
  assert.equal(a.get("state.uploadedPages.size"), 2);
  await a.import([file("page_154.txt", "新原文")]);
  assert.equal(a.get("pendingImportPlan().sourceIssues.length"), 0);
});

test("failed conflict persistence rolls back rows, sources, reports and audit logs", async () => {
  const a = await conflictApp();
  a.run("state.importReports[1].sourceConflicts = {'page_154.txt': '新原文'}; Object.assign(state.importReports[1].issues[0], {sourceConflict:true, sourceFile:'page_154.txt'})");
  const before = a.get("workspacePayload()");
  a.failWrites(true);
  assert.equal(a.run("resolveImportIssue(1, 0, 'add', '另存版本')"), false);
  const after = a.get("workspacePayload()");
  delete before.exportedAt;
  delete after.exportedAt;
  assert.deepEqual(after, before);
  assert.equal(a.get("state.importReports[1].issues[0].resolution || null"), null);
  a.failWrites(false);
  assert.equal(a.run("resolveImportIssue(1, 0, 'add', '重试')"), true);
});

test("old source reports require original reimport, and deleted alternatives are not resurrected", async () => {
  const a = await conflictApp();
  a.run("Object.assign(state.importReports[1].issues[0], {reason:'同名原文内容不同，保留旧原文'})");
  assert.equal(a.run("resolveImportIssue(1, 0, 'add', '另存')"), false);
  assert.match(a.get("state.conflictMessage"), /重新导入/);
  a.run("state.importReports[1].issues[0].reason = '编号冲突'; resolveImportIssue(1, 0, 'add', '另存'); deleteRow(state.rows[1].id); resolveImportIssue(1, 0, 'reopen', '复查')");
  assert.equal(a.run("resolveImportIssue(1, 0, 'add', '再试')"), false);
  assert.equal(a.get("state.rows.length"), 1);
  assert.equal(a.get("state.trashRows.length"), 1);
});

test("conflict markup escapes incoming text, exposes actions and filters resolved issues", async () => {
  const a = await conflictApp();
  a.run("state.importReports[1].issues[0].row.fields.quote = '<img src=x onerror=alert(1)>'");
  const html = a.run("importConflictModal()");
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes('id="conflictForm"'));
  assert.ok(html.includes('value="keep"'));
  assert.ok(html.includes('value="add"'));
  a.run("resolveImportIssue(1, 0, 'keep', '核对原件')");
  assert.match(a.run("importConflictModal()"), /当前列表已处理完毕/);
  a.run("state.conflictFilter = 'resolved'");
  assert.match(a.run("importConflictModal()"), /重新处理/);
});

test("multiple conflicting rows share one alternative source version without touching old references", async () => {
  const a = app();
  a.run("state.uploadedPages.set('page_154.txt', '旧原文')");
  await a.import([file("a.csv", csv("A")), file("b.csv", csv("B")), file("page_154.txt", "新原文")]);
  a.run("confirmPendingImport(); resolveImportIssue(0, 0, 'add', '版本保留'); resolveImportIssue(0, 1, 'add', '同版另一材料')");
  assert.equal(a.get("state.uploadedPages.size"), 2);
  assert.equal(a.get("state.rows[0].sourceFile"), a.get("state.rows[1].sourceFile"));
  a.run("renderShell('<section>test</section>')");
  assert.match(a.root.innerHTML, /导入冲突处理/);
  assert.match(a.run("workspaceActions()"), /处理导入冲突（0）/);
});

test("reopening the latest decision does not fall back to an older resolved copy", async () => {
  const a = await conflictApp();
  await a.import([file("a.csv", csv("A", "另一条摘录内容"))]);
  a.run("confirmPendingImport(); resolveImportIssue(1, 0, 'keep', '旧决定'); resolveImportIssue(2, 0, 'keep', '新决定'); resolveImportIssue(2, 0, 'reopen', '重新核对')");
  await a.import([file("a.csv", csv("A", "另一条摘录内容"))]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
});

test("409 real rows retain 50 confirmations through append, duplicate import and reload", async () => {
  const a = app();
  loadSample(a);
  assert.equal(a.get("state.rows.length"), 409);
  a.run("state.rows.slice(0, 50).forEach(row => confirmRow(row.id))");
  const confirmed = a.get("state.rows.slice(0,50)");
  await a.import([file("追加.csv", csv("NEW-1"))]);
  assert.equal(a.get("state.rows.length"), 409);
  assert.equal(a.get("pendingImportPlan().counts.added"), 1);
  assert.equal(a.run("confirmPendingImport()"), true);
  assert.equal(a.get("state.rows.length"), 410);
  assert.deepEqual(a.get("state.rows.slice(0,50)"), confirmed);
  assert.equal(a.get("state.workspaceId"), "test-workspace");
  await a.import([file("追加.csv", csv("NEW-1"))]);
  assert.equal(a.get("pendingImportPlan().counts.duplicate"), 1);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.equal(a.get("state.rows.length"), 410);
  assert.deepEqual(a.get("state.rows.slice(0,50)"), confirmed);
});

test("human-edited rows and original draft survive import-update and JSON round trip without appendix", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); state.editingId = 'A'");
  const values = Object.fromEntries(Object.entries(a.get("state.rows[0].fields")).map(([key, value]) => ["field:" + key, value]));
  values["field:quote"] = "人工修订后的摘录";
  a.set("editValues", values);
  a.run("saveEdit(editValues)");
  assert.equal(a.get("state.originalRows[0].quote"), "笔势流畅，气韵生动");
  await a.import([file("a.csv", csv("A", "新的机器摘录"))]);
  a.run("state.pendingImport.mode = 'update'");
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.equal(a.get("state.rows[0].quote"), "人工修订后的摘录");
  const payload = a.get("workspacePayload()");
  await a.import([file("backup.json", JSON.stringify(payload))]);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.equal(a.get("state.rows[0].quote"), "人工修订后的摘录");
  assert.equal(a.get("state.rows[0].edited"), true);
  assert.equal(a.get("state.originalRows[0].quote"), "笔势流畅，气韵生动");
});

test("per-file mapping merges different headers; cancel does not change source pages", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A")), file("b.csv", "id,author,text,page\nB,颜真卿,雄健有力,155"),
    file("page_154.txt", "原文页")]);
  assert.equal(a.get("pendingImportPlan().counts.added"), 2);
  assert.equal(a.get("state.uploadedPages.size"), 0);
  a.run("cancelPendingImport()");
  assert.equal(a.get("state.rows.length"), 0);
  assert.equal(a.get("state.uploadedPages.size"), 0);
  await a.import([file("a.csv", csv("A")), file("b.csv", "id,author,text,page\nB,颜真卿,雄健有力,155")]);
  a.run("confirmPendingImport()");
  assert.deepEqual(a.get("state.rows.map(row => row.quote)"), ["笔势流畅，气韵生动", "雄健有力"]);
});

test("unreviewed rows may update, conflicts and invalid rows remain in report", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport()");
  await a.import([file("a.csv", csv("A", "更新摘录"))]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
  a.run("state.pendingImport.mode = 'update'; confirmPendingImport()");
  assert.equal(a.get("state.rows[0].quote"), "更新摘录");
  assert.equal(a.get("state.rows[0].history.at(-1).type"), "import-update");
  await a.import([file("invalid.csv", csv("BAD", ""))]);
  assert.equal(a.get("pendingImportPlan().counts.invalid"), 1);
  a.run("confirmPendingImport()");
  assert.equal(a.get("state.rows.length"), 1);
  assert.equal(a.get("state.importReports.at(-1).issues.length"), 1);
});

test("source-name conflicts do not silently relink incoming records", async () => {
  const a = app();
  a.run("state.uploadedPages.set('page_154.txt', '原版本')");
  await a.import([file("a.csv", csv("A")), file("page_154.txt", "另一版本")]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
  a.run("confirmPendingImport()");
  assert.equal(a.get("state.rows.length"), 0);
  assert.equal(a.get("state.uploadedPages.get('page_154.txt')"), "原版本");
});

test("problem closure, reopen, deletion, restore and undo remain traceable after reload", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); toggleProblemTag('A', 'source_mismatch')");
  assert.equal(a.get("rowHasProblem(state.rows[0])"), true);
  a.run("setProblemStatus('A', 'pending_review', '已修订'); setProblemStatus('A', 'resolved', '已逐字核对原文')");
  assert.equal(a.get("rowHasProblem(state.rows[0])"), false);
  assert.deepEqual(a.get("state.rows[0].problemTags"), ["source_mismatch"]);
  a.run("undoLastAction()");
  assert.equal(a.get("window.CalligraphyReviewWorkflow.problemStatus(state.rows[0])"), "pending_review");
  a.run("setProblemStatus('A', 'resolved', '核对通过'); loadWorkspace(); deleteRow('A'); loadWorkspace()");
  assert.equal(a.get("state.rows.length"), 0);
  assert.equal(a.get("state.trashRows.length"), 1);
  assert.equal(a.get("reviewLogRows().some(event => event.action === 'delete')"), true);
  await a.import([file("a.csv", csv("A"))]);
  assert.equal(a.get("pendingImportPlan().counts.conflict"), 1);
  a.run("cancelPendingImport(); restoreTrashRow('A'); loadWorkspace()");
  assert.equal(a.get("state.rows.length"), 1);
  assert.equal(a.get("state.trashRows.length"), 0);
  assert.equal(a.get("reviewLogRows().some(event => event.action === 'restore')"), true);
  a.run("setProblemStatus('A', 'open', '重新核对')");
  assert.equal(a.get("rowHasProblem(state.rows[0])"), true);
});

test("new workspace can switch back; failed storage leaves current rows untouched", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport()");
  await a.import([file("b.csv", csv("B"))]);
  a.run("state.pendingImport.mode = 'new'; confirmPendingImport(); switchLocalWorkspace('test-workspace')");
  assert.equal(a.get("state.rows[0].id"), "A");
  await a.import([file("c.csv", csv("C"))]);
  a.failWrites(true);
  assert.equal(a.run("confirmPendingImport()"), false);
  assert.equal(a.get("state.rows.length"), 1);
  assert.ok(a.alerts.some((message) => message.includes("保存失败")));
});

test("import HTML escapes file content and exposes working modal controls", async () => {
  const a = app();
  await a.import([file("<img onerror=alert(1)>.csv", csv("A", "<script>bad</script>"))]);
  const html = a.run("importMappingModal()");
  assert.ok(html.includes('name="importMode"'));
  assert.ok(html.includes('name="importFile"'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<script>bad"));
  assert.ok(!html.includes("\\${"));
});

test("reimporting all 409 real rows is idempotent, including preserved confirmations", async () => {
  const a = app();
  loadSample(a);
  a.run("state.rows.slice(0,50).forEach(row => confirmRow(row.id))");
  await a.import([file("综合总表.csv", sample)]);
  assert.deepEqual(a.get("pendingImportPlan().counts"), { added: 0, duplicate: 409, updated: 0, conflict: 0, invalid: 0 });
  a.run("confirmPendingImport()");
  assert.equal(a.get("state.rows.length"), 409);
  assert.equal(a.get("state.rows.filter(row => row.reviewed).length"), 50);
});

test("evidence requires real source text, has consistent grades and detects partial matches", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport()");
  assert.equal(a.get("sourceQuality(state.rows[0]).label"), "待复核");
  a.run("state.uploadedPages.set('page_154.txt', '原文：笔势流畅，气韵生动。')");
  assert.equal(a.get("sourceQuality(state.rows[0]).label"), "高");
  assert.equal(a.get("sourceQuality(state.rows[0], true).label"), "高");
  a.run("state.uploadedPages.set('page_154.txt', '笔势 流畅，气韵 生动')");
  assert.equal(a.get("sourceQuality(state.rows[0]).label"), "中");
  a.run("state.rows[0].quote = '甲'.repeat(42) + '完全不同的后半段'; state.uploadedPages.set('page_154.txt', '甲'.repeat(42))");
  assert.equal(a.get("sourceQuality(state.rows[0]).label"), "低");
  a.run("state.uploadedPages.set('page_154.txt', '没有任何匹配')");
  assert.equal(a.get("sourceQuality(state.rows[0]).label"), "待复核");
});

test("backup restore retains incomplete entries and export includes problem decisions", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); toggleProblemTag('A','manual_review'); setProblemStatus('A','resolved','人工核验通过')");
  const exported = a.get("exportableRows()[0]");
  assert.equal(exported.problemStatus, "已解决");
  assert.equal(exported.resolutionReason, "人工核验通过");
  const payload = a.get("workspacePayload()");
  payload.rows.push({ id: "EMPTY", fields: { quote: "" }, history: [], reviewed: false });
  await a.import([file("backup.json", JSON.stringify(payload))]);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.equal(a.get("state.rows.length"), 2);
});

test("resolved rows stay out of review when revisiting; field edits reopen them", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); setProblemStatus('A', 'resolved', '人工核验通过'); applyDetailModeDefaults('review')");
  assert.equal(a.get("visibleRows().length"), 0);
  a.run("state.editingId = 'A'");
  const values = Object.fromEntries(Object.entries(a.get("state.rows[0].fields")).map(([key, value]) => ["field:" + key, value]));
  values["field:quote"] = "修订后的证据";
  a.set("values", values);
  a.run("saveEdit(values)");
  assert.equal(a.get("visibleRows().length"), 1);
  assert.equal(a.get("rowProblemStatus(state.rows[0])"), "pending_review");
});

async function releasableApp() {
  const a = app();
  await a.import([file("a.csv", csv("ONLY-A")), file("page_154.txt", "原文：笔势流畅，气韵生动。")]);
  a.run("confirmPendingImport(); confirmRow('ONLY-A')");
  return a;
}

test("formal delivery blocks unreviewed rows and cannot replace real evidence with a resolved flag", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport()");
  assert.equal(a.run("createFormalRelease()"), false);
  a.run("setProblemStatus('A', 'resolved', '人工处理完成')");
  assert.equal(a.run("createFormalRelease()"), false);
  assert.equal(a.get("state.exportVersions.length"), 0);
  assert.equal(a.get("downloads.length"), 0);
  a.run("downloadWorkingDraft()");
  assert.equal(a.get("downloads.length"), 1);
  assert.ok(a.get("downloads[0].name").includes("工作草稿"));
});

test("formal snapshots preserve CSV, source pages and audit history across edits and reload", async () => {
  const a = await releasableApp();
  assert.equal(a.run("createFormalRelease()"), true);
  const snapshot = a.get("state.exportVersions[0]");
  assert.equal(snapshot.rows.length, 1);
  assert.ok(snapshot.auditRows[0].history.some((event) => event.type === "confirm"));
  assert.equal(snapshot.sourcePages["page_154.txt"], "原文：笔势流畅，气韵生动。");
  assert.ok(!snapshot.fields.some((field) => ["gate", "issue", "flagged", "reviewed"].includes(field.key)));
  a.run("setFieldValue(state.rows[0], 'quote', '后续修改'); state.uploadedPages.set('page_154.txt', '新原文'); saveWorkspace(); loadWorkspace()");
  assert.deepEqual(a.get("state.exportVersions[0]"), snapshot);
  a.set("releaseId", snapshot.id);
  a.run("downloadRelease(releaseId)");
  assert.equal(a.get("downloads.at(-1).content"), snapshot.csv);
  a.run("downloadRelease(releaseId, 'json')");
  assert.deepEqual(JSON.parse(a.get("downloads.at(-1).content")), snapshot);
});

test("failed version persistence does not download or retain a successful release", async () => {
  const a = await releasableApp();
  a.failWrites(true);
  assert.equal(a.run("createFormalRelease()"), false);
  assert.equal(a.get("state.exportVersions.length"), 0);
  assert.equal(a.get("downloads.length"), 0);
  assert.ok(a.get("state.exportMessage").includes("未保存"));
});

test("delivery checks exactly the selected scope without silently removing blocked rows", async () => {
  const a = await releasableApp();
  await a.import([file("b.csv", csv("ONLY-B"))]);
  a.run("confirmPendingImport(); state.exportScope = 'all'");
  assert.equal(a.run("createFormalRelease()"), false);
  a.run("state.query = 'ONLY-A'; state.exportScope = 'view'");
  assert.equal(a.run("createFormalRelease()"), true);
  assert.deepEqual(a.get("state.exportVersions[0].rows.map(row => row.id)"), ["ONLY-A"]);
  assert.equal(a.get("state.exportVersions[0].scope"), "view");
  assert.equal(a.get("state.rows.length"), 2);
});

test("release history survives backup restore and starts fresh in a new raw-data workspace", async () => {
  const a = await releasableApp();
  a.run("createFormalRelease(); createFormalRelease()");
  const versions = a.get("state.exportVersions");
  const payload = a.get("workspacePayload()");
  await a.import([file("backup.json", JSON.stringify(payload))]);
  a.run("confirmPendingImport(); loadWorkspace()");
  assert.deepEqual(a.get("state.exportVersions"), versions);
  await a.import([file("new.csv", csv("NEW"))]);
  a.run("state.pendingImport.mode = 'new'; confirmPendingImport()");
  assert.deepEqual(a.get("state.exportVersions"), []);
});

test("CSV preserves commas, quotes and carriage returns; duplicate IDs block formal delivery", () => {
  const a = app();
  const csvText = a.run('window.CalligraphyExportWorkflow.rowsToCsv([{ value: \'a,b"c\\rd\\ne\' }], [{key:"value",label:"摘录"}])');
  assert.equal(csvText, '摘录\n"a,b""c\rd\ne"');
  const result = a.get(`window.CalligraphyExportWorkflow.assessRelease([
    { id: "A", reviewed: true, sourceRank: 3 }, { id: "A", reviewed: true, sourceRank: 3 }
  ])`);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((check) => check.key === "duplicateId").count, 2);
  assert.equal(a.get("window.CalligraphyExportWorkflow.assessRelease([]).ready"), false);
});

test("global material and export navigation are bound on the detail screen", () => {
  const a = app();
  a.run(`
    const handlers = {};
    const toolButtons = ["file", "export"].map((tool) => ({
      dataset: { homeFocus: tool }, addEventListener: (type, callback) => { handlers[tool] = callback; }
    }));
    let importClicks = 0;
    const fileControl = { click: () => importClicks++, addEventListener() {} };
    document.querySelector = (selector) => selector === "#fileInput" ? fileControl : null;
    document.querySelectorAll = (selector) => selector === "[data-home-focus]" ? toolButtons : [];
    state.view = "detail";
    attachGlobalEvents();
    handlers.file(); handlers.export();
  `);
  assert.equal(a.get("importClicks"), 1);
  assert.equal(a.get("state.exportOpen"), true);
});

test("dashboard counts each pending entry once and displays import failures accurately", async () => {
  const a = app();
  await a.import([file("a.csv", csv("A"))]);
  a.run("confirmPendingImport(); setFieldValue(state.rows[0], 'author', ''); state.manifest = buildManifest(state.rows)");
  const html = a.run("dashboardRightColumn()");
  assert.ok(html.includes("待确认（1）"));
  a.run("state.uploadLog = [logEntry('error', 'bad.csv', '文件读取失败', {step:'材料导入'})]");
  const log = a.run("dashboardLogTable()");
  assert.ok(log.includes("文件读取失败"));
  assert.ok(log.includes(">失败</td>"));
  assert.ok(!log.includes(">成功</td>"));
});

test("dashboard readiness reuses release rules and deduplicates overlapping blockers", () => {
  const a = app();
  a.run(`
    state.rows = [{id:'ready'}, {id:'pending'}, {id:'risk'}, {id:'dup'}, {id:'dup'}];
    deliveryFacts = () => [
      {id:'ready', reviewed:true, hasProblem:false, missingRequired:false, sourceRank:3},
      {id:'pending', reviewed:false, hasProblem:false, missingRequired:false, sourceRank:2},
      {id:'risk', reviewed:true, hasProblem:true, missingRequired:true, sourceRank:0},
      {id:'dup', reviewed:true, hasProblem:false, missingRequired:false, sourceRank:3},
      {id:'dup', reviewed:true, hasProblem:false, missingRequired:false, sourceRank:3}
    ];
  `);
  const stats = a.get("dashboardReadiness()");
  assert.equal(stats.readyRows, 1);
  assert.equal(stats.blockedRows, 4);
  assert.equal(stats.unreviewedRows, 1);
  assert.equal(stats.matchedRows, 4);
  assert.equal(stats.openProblems, 1);
  assert.equal(stats.confirmedRows, 4);
  assert.ok(stats.assessment.checks.reduce((sum, item) => sum + item.count, 0) > stats.blockedRows);
  a.run("deliveryFacts = () => []; state.rows = []");
  assert.equal(a.get("dashboardReadiness().readyRows"), 0);
  assert.equal(a.get("dashboardReadiness().assessment.ready"), false);
});

test("dashboard queues target current blockers independently of stale search and export scope", () => {
  const a = app();
  loadSample(a);
  const expected = a.get("dashboardReadiness().assessment.issues.filter(item => item.reasons.includes('unlocated')).map(item => item.id).sort()");
  a.run("state.query = '不存在的检索'; state.filter = 'flagged'; state.exportScope = 'view'; inspectDashboardQueue('unlocated')");
  assert.equal(a.get("state.view"), 'detail');
  assert.equal(a.get("state.detailMode"), 'review');
  assert.equal(a.get("state.query"), '');
  assert.deepEqual(a.get("visibleRows().map(row => row.id).sort()"), expected);
  assert.equal(expected.length, 73);
  a.run("inspectDashboardQueue('ready')");
  assert.equal(a.get("state.detailMode"), 'table');
  assert.equal(a.get("visibleRows().length"), 0);
  assert.equal(a.get("selectedRow()"), null);
  assert.ok(a.run("resultTable([])").includes('暂无可交付条目'));
  assert.ok(a.run("resultTable([])").includes('主表共 409 条'));
  assert.ok(a.run("detailPanel(null)").includes('暂无可交付条目'));
  const home = a.run("dashboardProjectCard()");
  assert.ok(home.includes('交付就绪'));
  assert.ok(home.includes('原文已关联'));
  assert.ok(!home.includes('<dt>已定位</dt>'));
  const html = a.run("dashboardRightColumn()");
  for (const key of ['unreviewed', 'unlocated', 'openProblem']) assert.ok(html.includes('data-dashboard-queue="' + key + '"'));
});

test("dashboard queues update when a blocker changes and all entry buttons are bound", () => {
  const a = app();
  a.run(`
    state.rows = [{id:'A', reviewed:false}, {id:'B', reviewed:false}];
    deliveryFacts = () => state.rows.map(row => ({id:row.id, reviewed:row.reviewed, sourceRank:3, hasProblem:false, missingRequired:false}));
    const handlers = {};
    document.querySelectorAll = selector => selector === '[data-dashboard-queue]'
      ? ['ready', 'unreviewed', 'unlocated', 'openProblem', 'blocked'].map(key => ({
        dataset:{dashboardQueue:key}, addEventListener:(type, handler) => {handlers[key] = handler;}
      })) : [];
    attachGlobalEvents(); handlers.unreviewed();
  `);
  assert.equal(a.get("visibleRows().length"), 2);
  a.run("state.rows[0].reviewed = true");
  assert.deepEqual(a.get("visibleRows().map(row => row.id)"), ['B']);
  a.run("handlers.ready()");
  assert.deepEqual(a.get("visibleRows().map(row => row.id)"), ['A']);
  a.run("handlers.unlocated()");
  assert.equal(a.get("selectedRow()"), null);
  a.run("handlers.openProblem()");
  assert.equal(a.get("visibleRows().length"), 0);
  a.run("handlers.blocked()");
  assert.deepEqual(a.get("visibleRows().map(row => row.id)"), ['B']);
});

test("review focus reports current source matching instead of imported hit labels", () => {
  const a = app();
  loadSample(a);
  a.run("const lowRow = state.rows.find(row => sourceQuality(row).rank < 2); lowRow.hit = 'exact'");
  assert.ok(a.run("reviewFocusCard(lowRow)").includes('定位待核对'));
  assert.ok(!a.run("reviewFocusCard(lowRow)").includes('<span>exact</span>'));
});

test("pilot selects 50 distinct real rows deterministically with source evidence and honest coverage", () => {
  const a = app();
  loadSample(a);
  const before = a.get("state.rows");
  const pilot = a.get("buildReviewPilot()");
  assert.equal(pilot.payload.rows.length, 50);
  assert.equal(new Set(pilot.payload.rows.map(row => row.id)).size, 50);
  assert.deepEqual(a.get("buildReviewPilot().payload.rows"), pilot.payload.rows);
  assert.deepEqual(pilot.coverage.map(group => group.selected), [0, 0, 20, 30]);
  assert.equal(Object.keys(pilot.payload.uploadedPages).length, 33);
  for (const row of pilot.payload.rows) {
    assert.deepEqual(row, before.find(item => item.id === row.id));
    assert.equal(pilot.payload.uploadedPages[row.sourceFile], sourcePages[row.sourceFile]);
  }
  assert.deepEqual(a.get("state.rows"), before);
  assert.equal(pilot.payload.originalRows.length, 50);
  assert.equal(pilot.payload.exportVersions.length, 0);
});

test("pilot covers scarce marked cases without fabricating rows or inheriting cloud identity", () => {
  const a = app();
  loadSample(a);
  a.run(`
    state.rows = state.rows.slice(0, 3);
    setFieldValue(state.rows[0], 'author', '');
    state.rows[1].problemTags = ['duplicate'];
    state.rows[1].cloudId = 'remote-original';
  `);
  const pilot = a.get("buildReviewPilot()");
  assert.equal(pilot.payload.rows.length, 3);
  assert.equal(pilot.coverage[0].selected, 1);
  assert.equal(pilot.coverage[1].selected, 1);
  assert.ok(pilot.payload.rows.every(row => !row.cloudId));
  assert.equal(a.get("state.rows[1].cloudId"), 'remote-original');
  a.run("state.rows = []");
  assert.equal(a.get("buildReviewPilot().payload.rows.length"), 0);
});

test("pilot preview and cancellation never write the current workspace", async () => {
  const a = app();
  loadSample(a);
  const before = [...a.disk];
  const rows = a.get("state.rows");
  assert.equal(await a.run("prepareReviewPilot()"), true);
  assert.equal(a.get("state.pendingImport.mode"), 'new');
  assert.equal(a.get("pendingImportPlan().counts.added"), 50);
  assert.match(a.run("importMappingModal()"), /未覆盖：原工作区无此类条目/);
  a.run("cancelPendingImport()");
  assert.deepEqual([...a.disk], before);
  assert.deepEqual(a.get("state.rows"), rows);
  a.run("cloudReady = () => true");
  assert.equal(await a.run("prepareReviewPilot()"), false);
  assert.deepEqual([...a.disk], before);
});

test("pilot save failure retains the source workspace and import preview for retry", async () => {
  const a = app();
  loadSample(a);
  const id = a.get("state.workspaceId");
  const rows = a.get("state.rows");
  const originalKey = a.run("storageKey(state.workspaceId)");
  await a.run("prepareReviewPilot()");
  a.failWrites(key => key !== originalKey);
  assert.equal(a.run("confirmPendingImport()"), false);
  assert.equal(a.get("state.workspaceId"), id);
  assert.deepEqual(a.get("state.rows"), rows);
  assert.ok(a.get("state.pendingImport"));
  a.failWrites(false);
  assert.equal(a.run("confirmPendingImport()"), true);
  assert.equal(a.get("state.rows.length"), 50);
  assert.notEqual(a.get("state.workspaceId"), id);
});

test("isolated 50-row pilot exercises review, blockers, export and restore without altering its source", async () => {
  const a = app();
  loadSample(a);
  const sourceId = a.get("state.workspaceId");
  const sourceRows = a.get("state.rows");
  a.run("state.qualityFocus = {mode:'delivery', rowIds:['not-in-pilot'], label:'旧队列'}");
  await a.run("prepareReviewPilot()");
  assert.equal(a.run("confirmPendingImport()"), true);
  const pilotId = a.get("state.workspaceId");
  assert.notEqual(pilotId, sourceId);
  assert.equal(a.get("state.originalRows.length"), 50);
  assert.equal(a.get("visibleRows().length"), 50);
  assert.equal(a.get("dashboardReadiness().unreviewedRows"), 50);
  assert.equal(a.get("state.uploadLog.some(item => item.step === '试审抽样')"), true);
  // Simulated decisions exercise application mechanics only, not scholarly correctness.
  a.run(`
    const ids = state.rows.map(row => row.id);
    for (const id of ids) {
      confirmRow(id);
      if (sourceQuality(state.rows.find(row => row.id === id)).rank >= 2)
        setProblemStatus(id, 'resolved', '隔离自动化测试，非人工学术结论');
    }
    loadWorkspace();
  `);
  assert.equal(a.get("dashboardReadiness().unreviewedRows"), 0);
  assert.equal(a.get("dashboardReadiness().readyRows"), 30);
  assert.equal(a.run("createFormalRelease()"), false);
  a.run("inspectDashboardQueue('ready'); state.exportScope = 'view'");
  assert.equal(a.run("createFormalRelease()"), true);
  assert.equal(a.get("state.exportVersions[0].rows.length"), 30);
  const backup = a.get("workspacePayload()");
  await a.import([file('pilot-backup.json', JSON.stringify(backup))]);
  assert.equal(a.run("confirmPendingImport()"), true);
  assert.equal(a.get("state.rows.length"), 50);
  assert.equal(a.get("state.exportVersions[0].rows.length"), 30);
  a.set('sourceId', sourceId);
  a.run("switchLocalWorkspace(sourceId)");
  assert.equal(a.get("state.workspaceId"), sourceId);
  assert.deepEqual(a.get("state.rows"), sourceRows);
});

const app = document.querySelector("#app");
const WORKSPACE_POINTER_KEY = "calligraphy-current-workspace-v2";
const WORKSPACE_STORAGE_PREFIX = "calligraphy-workspace-v2:";
const REMEMBERED_EMAIL_KEY = "calligraphy-remembered-email-v1";
const LOCAL_DEMO_SESSION_KEY = "calligraphy-local-demo-session-v1";
const ICON_TOOLTIP_SELECTOR = [
  "button.icon-control",
  "button.icon-action",
  "button.nav-action",
  "button.icon-only",
  "button.brand-mark-trigger",
  "button.drawer-close",
  "button.rail-collapse-control",
  "button.rail-restore-control",
  "button.flag-action",
  ".review-actions button.secondary-action[aria-label]",
  ".modal-head > button[aria-label]",
  "button[data-review-undo]"
].join(",");
let buttonTooltip = null;
let buttonTooltipTimer = 0;
const workspaceSnapshots = new Map();
let workspaceConflictFocus = null;
let aiPanelTrigger = null;
let entryStageTimer = 0;
const CUSTOM_TEMPLATES_KEY = "calligraphy-custom-schema-templates-v1";
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = 1;
// Local product-demo gate only. Production access must use server-side authentication.
const DEMO_LOGIN = Object.freeze({ account: "tongji", password: "123456" });
const SOURCE_PAGE_PATTERN = /^page_\d+(?:__v[a-z0-9-]+)?\.txt$/i;
const SAMPLE_DATASET = {
  csv: "./data/sample/main.csv",
  pages: Array.from({ length: 55 }, (_, index) => `page_${154 + index}.txt`)
};

const schemaTemplates = [
  {
    id: "calligraphy-style",
    name: "书论风格评价抽取模板",
    description: "适合书论、书法品评、风格术语和原文证据整理。",
    fields: [
      { id: "author", label: "书家", type: "text", prompt: "抽取被评价或被讨论的书家姓名。若原文没有明确书家，留空并在待复核问题中说明。", required: true, evidenceRequired: true, comparisonMode: "exact", visible: true },
      { id: "scriptType", label: "书体", type: "text", prompt: "抽取书体或可能书体，如楷书、草书、隶书等；无法确定时写“未标注”。", required: false, evidenceRequired: true, comparisonMode: "script_type", visible: true },
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录能够支持判断的最小原文片段，优先保留完整评价短语。", required: true, evidenceRequired: true, comparisonMode: "quote", visible: true },
      { id: "pageNo", label: "页码", type: "text", prompt: "记录原文页码或页序，用于回到 page_*.txt。", required: true, evidenceRequired: false, visible: true },
      { id: "sourceFile", label: "原文文件", type: "text", prompt: "记录对应原文文件名，例如 page_191.txt。", required: true, evidenceRequired: false, visible: false },
      { id: "confidence", label: "证据等级", type: "select", prompt: "判断摘录是否足以支持入表，建议使用 高/中/低/待复核；该判断无需另附一层证据。", required: false, evidenceRequired: false, comparisonMode: "confidence", visible: true },
      { id: "gate", label: "门禁", type: "text", prompt: "沿用 checkpoint-* 标签判断门禁；多个标签用分号分隔。", required: false, evidenceRequired: false, comparisonMode: "token_set", visible: true },
      { id: "issue", label: "待复核问题", type: "longtext", prompt: "记录 OCR、页码、归属、解释歧义等需要人工处理的问题。", required: false, evidenceRequired: false, comparisonMode: "advisory", visible: false },
      { id: "note", label: "备注", type: "longtext", prompt: "记录人工判断、补充说明或后续处理建议。", required: false, evidenceRequired: false, comparisonMode: "advisory", visible: false }
    ]
  },
  {
    id: "inscription-note",
    name: "碑帖题跋抽取模板",
    description: "适合题跋作者、作品对象、评价语、时间和出处整理。",
    fields: [
      { id: "author", label: "题跋作者", type: "text", prompt: "抽取题跋、评论或记录的作者。", required: false, evidenceRequired: true, visible: true },
      { id: "workTitle", label: "作品/碑帖", type: "text", prompt: "抽取被题跋或被评价的作品、碑帖、法书名称。", required: true, evidenceRequired: true, visible: true },
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录包含题跋判断或事实信息的原文片段。", required: true, evidenceRequired: true, visible: true },
      { id: "time", label: "时间", type: "text", prompt: "抽取题跋时间、朝代、年号或相对时间。", required: false, evidenceRequired: true, visible: true },
      { id: "pageNo", label: "页码", type: "text", prompt: "记录原文页码。", required: true, evidenceRequired: false, visible: true },
      { id: "sourceFile", label: "原文文件", type: "text", prompt: "记录对应原文文件名。", required: true, evidenceRequired: false, visible: false },
      { id: "issue", label: "待复核问题", type: "longtext", prompt: "记录归属、断句、版本和释读疑问。", required: false, evidenceRequired: false, visible: false }
    ]
  },
  {
    id: "local-gazetteer-person",
    name: "地方志人物资料抽取模板",
    description: "适合从地方志中抽取人物、籍贯、职官、事件和证据。",
    fields: [
      { id: "personName", label: "人物", type: "text", prompt: "抽取人物姓名。", required: true, evidenceRequired: true, visible: true },
      { id: "place", label: "籍贯/地点", type: "text", prompt: "抽取籍贯、活动地或相关地点。", required: false, evidenceRequired: true, visible: true },
      { id: "office", label: "职官/身份", type: "text", prompt: "抽取职官、身份、职业或社会角色。", required: false, evidenceRequired: true, visible: true },
      { id: "event", label: "事件", type: "longtext", prompt: "概括人物相关事件或事迹。", required: false, evidenceRequired: true, visible: true },
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录支持人物信息的原文片段。", required: true, evidenceRequired: true, visible: true },
      { id: "pageNo", label: "页码", type: "text", prompt: "记录原文页码。", required: true, evidenceRequired: false, visible: true },
      { id: "sourceFile", label: "原文文件", type: "text", prompt: "记录对应原文文件名。", required: true, evidenceRequired: false, visible: false }
    ]
  },
  {
    id: "text-coding",
    name: "访谈/文本编码模板",
    description: "适合访谈、田野材料、政策文本和文学批评材料的主题编码。",
    fields: [
      { id: "speaker", label: "说话人/来源", type: "text", prompt: "抽取说话人、材料来源或文本出处。", required: false, evidenceRequired: false, visible: true },
      { id: "theme", label: "主题编码", type: "text", prompt: "为片段归纳一个主题编码。", required: true, evidenceRequired: true, visible: true },
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录支持该编码的原文片段。", required: true, evidenceRequired: true, visible: true },
      { id: "interpretation", label: "解释", type: "longtext", prompt: "说明为什么该片段属于该主题编码。", required: false, evidenceRequired: true, visible: true },
      { id: "issue", label: "待复核问题", type: "longtext", prompt: "记录编码边界、歧义和需要讨论的问题。", required: false, evidenceRequired: false, visible: false }
    ]
  },
  {
    id: "blank",
    name: "空白自定义模板",
    description: "只保留原文摘录和页码，适合从零配置研究字段。",
    fields: [
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录需要分析的原文片段。", required: true, evidenceRequired: true, visible: true },
      { id: "pageNo", label: "页码", type: "text", prompt: "记录原文页码。", required: false, evidenceRequired: false, visible: true },
      { id: "sourceFile", label: "原文文件", type: "text", prompt: "记录对应原文文件名。", required: false, evidenceRequired: false, visible: false },
      { id: "issue", label: "待复核问题", type: "longtext", prompt: "记录需要人工判断的问题。", required: false, evidenceRequired: false, visible: true }
    ]
  }
];

const filters = [
  { id: "all", label: "全部", tone: "All" },
  { id: "main", label: "确定主表", tone: "A" },
  { id: "candidate", label: "优先补入", tone: "B" },
  { id: "matched", label: "已入对照", tone: "C" },
  { id: "excluded", label: "非风格/品级", tone: "D" },
  { id: "review", label: "待校验", tone: "E" },
  { id: "abnormal", label: "命中异常", tone: "!" },
  { id: "invalid", label: "字段待补", tone: "Fix" },
  { id: "flagged", label: "人工标注", tone: "Flag" },
  { id: "problem", label: "问题队列", tone: "Issue" },
  { id: "resolved", label: "已解决", tone: "Done" }
];

const annotationTypes = [
  { id: "page", label: "页码问题" },
  { id: "attribution", label: "归属问题" },
  { id: "quote", label: "摘录不足" },
  { id: "mapping", label: "字段映射问题" },
  { id: "expert", label: "专家判断" },
  { id: "other", label: "其他" }
];

const compactWorkbench = window.matchMedia?.("(max-width: 1160px)");
const narrowWorkbench = window.matchMedia?.("(max-width: 760px)");

const state = {
  manifest: null,
  baseManifest: null,
  rows: [],
  baseRows: [],
  uploadedPages: new Map(),
  uploadLog: [],
  datasetName: "空白隔离工作区",
  workspaceId: "",
  schema: null,
  schemaTemplateId: "calligraphy-style",
  schemaVersion: SCHEMA_VERSION,
  promptVersion: PROMPT_VERSION,
  lastSavedAt: "",
  view: location.hash === "#ingest" ? "ingest" : ["#detail", "#review"].includes(location.hash) ? "detail" : "home",
  detailMode: location.hash === "#review" ? "review" : "table",
  filter: "all",
  activeProblemTagFilter: "all",
  qualityFocus: null,
  query: "",
  selectedId: "",
  sourceText: "",
  sourceStatus: "idle",
  sourceCache: new Map(),
  sourceRequestId: 0,
  reviewState: { confirmedIds: [], deletedIds: [], edits: {} },
  originalRows: [],
  editingId: "",
  pendingImport: null,
  importReports: [],
  conflictsOpen: false,
  conflictFilter: "open",
  conflictSelection: "",
  conflictMessage: "",
  trashRows: [],
  undoAction: null,
  trashOpen: false,
  workspaceListOpen: false,
  exportOpen: false,
  exportScope: "all",
  exportMode: "draft",
  exportVersions: [],
  exportMessage: "",
  resolutionRowId: "",
  saveError: "",
  workspaceConflict: null,
  detailCollapsed: Boolean(narrowWorkbench?.matches),
  filtersCollapsed: false,
  railCollapsed: Boolean(compactWorkbench?.matches),
  tableFocus: false,
  tableHeaderCollapsed: false,
  batchMode: false,
  batchSelectedIds: new Set(),
  batchJob: null,
  batchIssueOpen: false,
  batchReviewRowId: "",
  confidenceSort: "desc",
  templatePanelExpanded: false,
  settingsTab: "schema",
  modelSettings: {
    status: "idle",
    supported: null,
    configured: false,
    profiles: [],
    policy: { reviewMode: "assist", defaultConsensus: "standard", fieldOverrides: {} },
    activeProfileId: "primary",
    busyProfileId: "",
    message: ""
  },
  researchQuery: "",
  researchStatus: "idle",
  researchResults: [],
  researchError: "",
  researchRowId: "",
  researchWorkspaceId: "",
  researchRequestId: 0,
  aiPanelOpen: false,
  aiStatus: "idle",
  aiProposal: null,
  aiError: "",
  aiRowId: "",
  aiWorkspaceId: "",
  aiRequestId: 0,
  aiInputSignature: "",
  aiFieldJudgments: {},
  aiRetryProfileId: "",
  aiRetryError: "",
  aiMobilePane: "fields",
  aiRailWasCollapsed: null,
  aiDetailWasCollapsed: null,
  aiTableFocusWasActive: null,
  cloud: {
    mode: "local",
    status: "disabled",
    message: "",
    config: null,
    store: null,
    user: null,
    team: null,
    project: null,
    workspace: null,
    material: null,
    members: [],
    invites: []
  },
  entryStage: "welcome",
  entryAccount: "",
  entryEmail: "",
  entryRememberEmail: false,
  entryError: "",
  entryNotice: "",
  workspaceEntryMotion: false,
  primaryNavOpen: false,
  motionName: "",
  suppressHashMotion: false
};

function applyRouteFromHash() {
  state.view = location.hash === "#ingest" ? "ingest" : ["#detail", "#review"].includes(location.hash) ? "detail" : "home";
  state.detailMode = location.hash === "#review" ? "review" : "table";
}

function viewKey(view = state.view, detailMode = state.detailMode) {
  if (view === "home") return "home";
  if (view === "ingest") return "ingest";
  return detailMode === "review" ? "review" : "table";
}

function setViewMotion(nextView, nextDetailMode = state.detailMode) {
  state.motionName = "";
}

function applyDetailModeDefaults(nextDetailMode) {
  if (nextDetailMode === "review") {
    state.filter = "problem";
    state.tableFocus = false;
  } else if (nextDetailMode === "table" && ["problem", "review"].includes(state.filter)) {
    state.filter = "all";
  }
}

function navigateToView(nextView, nextDetailMode = state.detailMode) {
  setViewMotion(nextView, nextDetailMode);
  state.view = nextView;
  state.detailMode = nextDetailMode;
  if (nextView === "detail") applyDetailModeDefaults(nextDetailMode);
  const nextHash = state.view === "ingest" ? "#ingest" : state.view === "detail" ? (state.detailMode === "review" ? "#review" : "#detail") : "#home";
  state.suppressHashMotion = location.hash !== nextHash;
  location.hash = nextHash;
}

function newWorkspaceId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function ensureWorkspaceId() {
  if (!state.workspaceId) state.workspaceId = newWorkspaceId();
  return state.workspaceId;
}

function storageKey(id = ensureWorkspaceId()) {
  return `${WORKSPACE_STORAGE_PREFIX}${id}`;
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clip(value = "", length = 96) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function cloneRow(row) {
  return JSON.parse(JSON.stringify(row));
}

function cloneSchema(fields) {
  return fields.map((field, index) => ({
    id: field.id || `field_${index + 1}`,
    label: field.label || field.id || `字段 ${index + 1}`,
    type: field.type || "text",
    prompt: field.prompt || "",
    required: Boolean(field.required),
    evidenceRequired: Boolean(field.evidenceRequired),
    visible: field.visible !== false,
    order: Number.isFinite(field.order) ? field.order : index + 1
  }));
}

function loadCustomTemplates() {
  try {
    const payload = JSON.parse(localStorage.getItem(CUSTOM_TEMPLATES_KEY) || "[]");
    if (!Array.isArray(payload)) return [];
    return payload
      .filter((template) => template?.id && template?.name && Array.isArray(template.fields))
      .map((template) => ({ ...template, custom: true, fields: cloneSchema(template.fields) }));
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates) {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates.map((template) => ({
    ...template,
    custom: true,
    fields: cloneSchema(template.fields)
  }))));
}

function allSchemaTemplates() {
  return [...schemaTemplates, ...loadCustomTemplates()];
}

function templateById(id) {
  return allSchemaTemplates().find((template) => template.id === id) || schemaTemplates[0];
}

function defaultSchema(templateId = "calligraphy-style") {
  const template = templateById(templateId);
  return cloneSchema(template.fields);
}

function ensureSchema() {
  if (!Array.isArray(state.schema) || !state.schema.length) {
    state.schema = defaultSchema(state.schemaTemplateId);
  }
  return state.schema;
}

function orderedSchema(options = {}) {
  const includeHidden = options.includeHidden ?? true;
  return ensureSchema()
    .filter((field) => includeHidden || field.visible !== false)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function schemaField(id) {
  return ensureSchema().find((field) => field.id === id);
}

function fieldValue(row, fieldId) {
  if (!row) return "";
  if (row.fields && Object.prototype.hasOwnProperty.call(row.fields, fieldId)) return row.fields[fieldId] ?? "";
  return row[fieldId] ?? "";
}

function setFieldValue(row, fieldId, value) {
  if (!row.fields) row.fields = {};
  row.fields[fieldId] = value;
  row[fieldId] = value;
}

function syncLegacyFields(row) {
  row.problemTags = normalizeProblemTags(row);
  row.author = fieldValue(row, "author");
  row.scriptType = fieldValue(row, "scriptType");
  row.quote = fieldValue(row, "quote");
  row.pageNo = fieldValue(row, "pageNo");
  row.sourceFile = normalizePageFile(fieldValue(row, "sourceFile") || row.pageNo);
  row.hit = fieldValue(row, "hit") || row.hit || "";
  row.confidence = fieldValue(row, "confidence");
  row.gate = fieldValue(row, "gate");
  row.issue = fieldValue(row, "issue");
  row.note = fieldValue(row, "note");
  if (row.sourceFile) setFieldValue(row, "sourceFile", row.sourceFile);
  return row;
}

function rowDraftFromFields(fields) {
  return { ...fields };
}

function normalizeHistory(row) {
  if (Array.isArray(row.history)) return row.history;
  return [];
}

function normalizeAnnotations(row) {
  if (Array.isArray(row.annotations)) return row.annotations;
  return [];
}

function annotationLabel(type) {
  return annotationTypes.find((item) => item.id === type)?.label || type || "其他";
}

function createInitialHistory(row, importedAt = new Date().toISOString()) {
  return [
    {
      id: `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: "ai-draft",
      actor: "AI/导入",
      at: importedAt,
      reason: "上传 CSV/JSON 的原始值作为 AI 初稿。",
      schemaVersion: row.schemaVersion || state.schemaVersion,
      promptVersion: row.promptVersion || state.promptVersion,
      modelVersion: row.modelVersion || "csv-import",
      changes: Object.entries(row.aiDraft || {}).map(([fieldId, value]) => ({ fieldId, before: "", after: value }))
    }
  ];
}

function addHistory(row, event) {
  row.history = normalizeHistory(row);
  row.history.push({
    id: `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    schemaVersion: state.schemaVersion,
    promptVersion: state.promptVersion,
    modelVersion: row.modelVersion || "csv-import",
    ...event
  });
}

function reviewDefaults() {
  return { confirmedIds: [], deletedIds: [], edits: {} };
}

function canPersistReview() {
  return Boolean(state.workspaceId);
}

function saveReviewState() {
  if (canPersistReview()) saveWorkspace();
}

function workspacePayload() {
  return {
    type: "calligraphy-workspace",
    version: 2,
    workspaceId: state.workspaceId,
    datasetName: state.datasetName,
    exportedAt: new Date().toISOString(),
    schema: ensureSchema(),
    schemaTemplateId: state.schemaTemplateId,
    customTemplates: loadCustomTemplates(),
    schemaVersion: state.schemaVersion,
    promptVersion: state.promptVersion,
    rows: state.rows,
    originalRows: state.originalRows,
    trashRows: state.trashRows,
    importReports: state.importReports,
    exportVersions: state.exportVersions,
    undoAction: state.undoAction,
    selectedId: state.selectedId,
    uploadedPages: Object.fromEntries(state.uploadedPages),
    uploadLog: state.uploadLog,
    reviewState: state.reviewState
  };
}

function workspaceIsCurrent(id) {
  const expected = workspaceSnapshots.get(id) ?? null;
  const current = localStorage.getItem(storageKey(id));
  if (current === expected) return true;
  state.workspaceConflict = { id, deleted: current === null };
  state.saveError = "其他页面已更新或移除当前工作区，本次操作未保存。";
  updateWorkspaceConflictDom();
  return false;
}

function workspaceConflictModal() {
  if (!state.workspaceConflict) return "";
  return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="工作区版本冲突">
    <section class="edit-modal workflow-modal">
      <div class="modal-head"><h2>工作区${state.workspaceConflict.deleted ? "已移除" : "已更新"}</h2><button type="button" data-workspace-conflict-close aria-label="关闭版本冲突" title="关闭">×</button></div>
      <p role="alert">其他页面已更改这份工作区，本次操作未保存。</p>
      <p>载入最新数据会放弃本页未保存的修改。备份不包含尚未提交的表单输入。</p>
      <div class="modal-actions"><button type="button" data-workspace-conflict-backup>导出本页备份</button><button type="button" data-workspace-conflict-reload ${state.workspaceConflict.deleted ? "disabled" : ""}>载入最新数据</button></div>
    </section>
  </div>`;
}

function updateWorkspaceConflictDom() {
  const host = document.querySelector("#workspaceConflictHost");
  if (!host) return;
  if (state.workspaceConflict && !host.querySelector('[role="dialog"]')) workspaceConflictFocus = document.activeElement;
  host.innerHTML = workspaceConflictModal();
  host.querySelector("[data-workspace-conflict-close]")?.addEventListener("click", () => {
    state.workspaceConflict = null;
    updateWorkspaceConflictDom();
  });
  host.querySelector("[data-workspace-conflict-backup]")?.addEventListener("click", exportWorkspace);
  host.querySelector("[data-workspace-conflict-reload]")?.addEventListener("click", reloadLatestWorkspace);
  host.onkeydown = (event) => {
    if (!state.workspaceConflict) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      state.workspaceConflict = null;
      updateWorkspaceConflictDom();
    } else if (event.key === "Tab") {
      const buttons = [...host.querySelectorAll("button:not(:disabled)")];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
  };
  if (state.workspaceConflict) host.querySelector("[data-workspace-conflict-close]")?.focus();
  else {
    if (workspaceConflictFocus?.isConnected) workspaceConflictFocus.focus({ preventScroll: true });
    workspaceConflictFocus = null;
  }
}

function reloadLatestWorkspace() {
  const id = state.workspaceConflict?.id;
  if (!id || id !== state.workspaceId) return false;
  if (!window.confirm("载入最新数据将放弃本页未保存的修改（含表单输入）。继续？")) return false;
  const before = { ...state };
  if (!loadWorkspace(id)) {
    Object.assign(state, before);
    window.alert("最新工作区无法读取，已保留本页数据。请先导出本页备份。");
    return false;
  }
  state.editingId = "";
  state.resolutionRowId = "";
  state.pendingImport = null;
  state.conflictsOpen = false;
  state.exportOpen = false;
  state.trashOpen = false;
  state.workspaceListOpen = false;
  state.templatePanelExpanded = false;
  state.sourceRequestId += 1;
  state.selectedId = selectedRow()?.id || "";
  resetResearchForRow(selectedRow());
  render();
  loadSelectedSource();
  return true;
}

function saveWorkspace() {
  const id = ensureWorkspaceId();
  const savedAt = new Date().toISOString();
  try {
    if (!workspaceIsCurrent(id)) return false;
    const pointerChanged = localStorage.getItem(WORKSPACE_POINTER_KEY) !== id;
    const serialized = JSON.stringify({ ...workspacePayload(), savedAt });
    // Serialization may take time; recheck the snapshot immediately before writing.
    if (!workspaceIsCurrent(id)) return false;
    localStorage.setItem(storageKey(id), serialized);
    if (pointerChanged) localStorage.setItem(WORKSPACE_POINTER_KEY, id);
    workspaceSnapshots.set(id, serialized);
    state.lastSavedAt = savedAt;
    state.saveError = "";
    state.workspaceConflict = null;
    return true;
  } catch {
    state.saveError = "保存失败，请导出工作区备份后再刷新。";
    window.alert(state.saveError);
    return false;
  }
}

function cloudReady() {
  return state.cloud.status === "ready" && state.cloud.store && state.cloud.workspace;
}

function cloudLabel() {
  if (state.cloud.status === "ready") return state.cloud.user?.email || "云端已连接";
  if (state.cloud.status === "signed-out") return "云端未登录";
  if (state.cloud.status === "error") return "云端异常";
  return "本地用户";
}

function topUserControl() {
  const label = cloudLabel();
  if (state.cloud.status === "ready") {
    return `<button type="button" class="top-user cloud-ready" data-cloud-sync title="${escapeHtml(state.cloud.message || "同步当前工作区")}">${escapeHtml(label)} · 同步</button>`;
  }
  if (state.cloud.status === "signed-out") {
    return `<button type="button" class="top-user cloud-muted" data-cloud-login title="已配置云端，点击登录">${escapeHtml(label)}</button>`;
  }
  if (state.cloud.status === "error") {
    return `<span class="top-user cloud-error" title="${escapeHtml(state.cloud.message || "云端连接异常")}">${escapeHtml(label)}</span>`;
  }
  return `<span class="top-user">${escapeHtml(label)}</span>`;
}

function updateTopUserDom() {
  const node = document.querySelector(".top-user");
  if (!node) return;
  node.outerHTML = topUserControl();
  attachCloudControls();
}

function cloudStatusPanel() {
  const rows = [
    ["状态", state.cloud.message || cloudLabel()],
    ["团队", state.cloud.team?.name || "-"],
    ["项目", state.cloud.project?.name || "-"],
    ["工作区", state.cloud.workspace?.name || "-"],
    ["成员", state.cloud.members?.length ? `${state.cloud.members.length} 人` : "-"]
  ];
  const actions = [];
  if (state.cloud.status === "signed-out") {
    actions.push(`<button type="button" data-cloud-login>登录</button>`);
  }
  if (state.cloud.status === "ready") {
    actions.push(`<button type="button" data-cloud-sync>同步</button>`);
    actions.push(`<button type="button" data-cloud-invite>邀请</button>`);
  }
  if (state.cloud.config) {
    actions.push(`<button type="button" data-cloud-refresh>刷新</button>`);
  }
  return `
    <section class="dash-panel cloud-panel">
      <div class="dash-panel-head"><h2>云端协作</h2><span>${escapeHtml(cloudLabel())}</span></div>
      <dl>
        ${rows.map((row) => `<div><dt>${escapeHtml(row[0])}</dt><dd>${escapeHtml(row[1])}</dd></div>`).join("")}
      </dl>
      <div class="cloud-actions">
        ${actions.length ? actions.join("") : `<button type="button" disabled>本地模式</button>`}
      </div>
    </section>
  `;
}

async function loadCloudConfig() {
  const endpoints = ["/api/config", "./cloud-config.json"];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) continue;
      const config = await response.json();
      if (endpoint === "/api/config" && config && typeof config === "object" && ("enabled" in config || "aiEnabled" in config)) return config;
      if (config?.enabled || config?.aiEnabled) return config;
    } catch {
      // Keep local static previews usable when the deployment API is unavailable.
    }
  }
  return null;
}

async function ensureCloudContext() {
  const store = state.cloud.store;
  const config = state.cloud.config || {};
  let teams = await store.listTeams();
  if (!teams.length) {
    const invites = await store.listMyInvites();
    const teamId = invites.length
      ? await store.acceptInvite(invites[0].id, "")
      : await store.createTeam(config.defaultTeamName || "书论研究团队", "");
    teams = await store.listTeams();
    state.cloud.team = teams.find((team) => team.id === teamId) || teams[0] || null;
  } else {
    state.cloud.team = teams[0];
  }
  if (!state.cloud.team) throw new Error("没有可用团队");

  let projects = await store.listProjects(state.cloud.team.id);
  if (!projects.length) {
    state.cloud.project = await store.createProject(
      state.cloud.team.id,
      config.defaultProjectName || "书论整理项目",
      "书论材料整理、主表审校与回检协作。"
    );
  } else {
    state.cloud.project = projects[0];
  }

  let workspaces = await store.listWorkspaces(state.cloud.project.id);
  if (!workspaces.length) {
    state.cloud.workspace = await store.createWorkspace(state.cloud.team.id, state.cloud.project.id, {
      name: config.defaultWorkspaceName || state.datasetName || "书论统一主表",
      schemaTemplateId: state.schemaTemplateId,
      schemaVersion: state.schemaVersion,
      promptVersion: state.promptVersion
    });
  } else {
    state.cloud.workspace = workspaces[0];
  }
  state.cloud.members = await store.listTeamMembers(state.cloud.team.id);
  state.cloud.invites = await store.listMyInvites();
}

async function initCloudRuntime() {
  const config = await loadCloudConfig();
  if (!config) {
    state.cloud = { ...state.cloud, mode: "local", status: "disabled", message: "未配置云端" };
    return false;
  }
  state.cloud = { ...state.cloud, config };
  if (!config.enabled) {
    state.cloud = { ...state.cloud, mode: "local", status: "disabled", message: "本地模式" };
    return false;
  }
  try {
    const client = window.CalligraphyCloud.createSupabaseClient(config);
    const store = window.CalligraphyCloud.createCloudStore(client);
    state.cloud = { ...state.cloud, mode: "cloud", status: "connecting", config, store, message: "正在连接云端" };
    const user = await store.currentUser();
    if (!user) {
      state.cloud = { ...state.cloud, status: "signed-out", user: null, message: "需要登录后同步" };
      return false;
    }
    state.cloud.user = user;
    await ensureCloudContext();
    state.cloud.status = "ready";
    state.cloud.message = "云端隔离已启用";
    return true;
  } catch (error) {
    state.cloud = { ...state.cloud, mode: "local", status: "error", message: error?.message || "云端初始化失败" };
    return false;
  }
}

function cloudReviewRowPayload(row) {
  const quality = sourceQuality(row, false);
  return {
    team_id: state.cloud.team.id,
    project_id: state.cloud.project.id,
    workspace_id: state.cloud.workspace.id,
    material_id: state.cloud.material?.id || null,
    external_row_id: row.id,
    row_number: row.rowNumber || null,
    appendix: row.appendix || "",
    bucket: row.bucket || "review",
    triage_status: row.triageStatus || row.status || "",
    review_status: row.deleted ? "deleted" : row.reviewed ? "confirmed" : row.edited ? "edited" : row.flagged ? "flagged" : "pending",
    flagged: Boolean(row.flagged),
    abnormal: Boolean(row.abnormal),
    fields: {
      ...(row.fields || {}), problemTags: normalizeProblemTags(row),
      _workflow: {
        problemResolution: row.problemResolution || null,
        importOrigin: row.importOrigin || null,
        history: normalizeHistory(row),
        edited: Boolean(row.edited)
      }
    },
    quality: { rank: quality.rank, tone: quality.tone, label: quality.label, match: quality.match, method: "source-text-v1" },
    source_file: row.sourceFile || "",
    page_no: row.pageNo || "",
    quote: row.quote || fieldValue(row, "quote") || "",
    created_by: state.cloud.user.id
  };
}

function cloudMaterialPayload() {
  return {
    team_id: state.cloud.team.id,
    project_id: state.cloud.project.id,
    workspace_id: state.cloud.workspace.id,
    name: state.datasetName || "书论工作区导入",
    material_type: "workspace",
    row_count: state.rows.length
  };
}

function cloudSourcePagePayload(sourceFile, body) {
  return {
    team_id: state.cloud.team.id,
    project_id: state.cloud.project.id,
    workspace_id: state.cloud.workspace.id,
    material_id: state.cloud.material?.id || null,
    source_file: sourceFile,
    page_no: (sourceFile.match(/\d+/) || [""])[0],
    body,
    created_by: state.cloud.user.id
  };
}

function cloudAnnotationPayload(annotation, row) {
  return {
    team_id: state.cloud.team.id,
    project_id: state.cloud.project.id,
    workspace_id: state.cloud.workspace.id,
    row_id: row.cloudId,
    external_annotation_id: annotation.id || null,
    annotation_type: annotation.type || "other",
    field_id: annotation.fieldId || null,
    body: annotation.body || "",
    created_by: state.cloud.user.id
  };
}

async function ensureCloudMaterial() {
  if (!cloudReady() || state.cloud.material) return state.cloud.material;
  state.cloud.material = await state.cloud.store.createMaterial(cloudMaterialPayload());
  return state.cloud.material;
}

function appRowFromCloudRow(record) {
  const row = makeResult({
    id: record.external_row_id || record.id,
    rowNumber: record.row_number || "",
    appendix: record.appendix || "",
    appendixCode: appendixCode(record.appendix || ""),
    bucket: record.bucket || "review",
    status: record.triage_status || "",
    triageStatus: record.triage_status || "",
    fields: record.fields || {},
    quote: record.quote || record.fields?.quote || "",
    pageNo: record.page_no || record.fields?.pageNo || "",
    sourceFile: record.source_file || record.fields?.sourceFile || "",
    confidence: record.quality?.label || record.fields?.confidence || "",
    abnormal: Boolean(record.abnormal),
    flagged: Boolean(record.flagged) || record.review_status === "flagged",
    reviewed: record.review_status === "confirmed",
    edited: record.review_status === "edited" || Boolean(record.fields?._workflow?.edited),
    problemTags: record.fields?.problemTags || [],
    problemResolution: record.fields?._workflow?.problemResolution || null,
    importOrigin: record.fields?._workflow?.importOrigin || null,
    history: record.fields?._workflow?.history || [],
    deleted: record.review_status === "deleted"
  });
  row.cloudId = record.id;
  return row;
}

async function loadCloudWorkspaceData() {
  if (!cloudReady()) return false;
  const [rows, pages] = await Promise.all([
    state.cloud.store.loadReviewRows(state.cloud.workspace.id),
    state.cloud.store.loadSourcePages(state.cloud.workspace.id)
  ]);
  if (!rows.length) return false;
  const loadedRows = rows.map(appRowFromCloudRow);
  state.rows = loadedRows.filter((row) => !row.deleted);
  state.trashRows = loadedRows.filter((row) => row.deleted);
  state.undoAction = null;
  state.originalRows = state.rows.map(cloneRow);
  state.uploadedPages = new Map(pages.map((page) => [page.source_file, page.body || ""]));
  if (state.workspaceId !== state.cloud.workspace.id) resetBatchUiState();
  state.workspaceId = state.cloud.workspace.id;
  try {
    const localSnapshot = localStorage.getItem(storageKey());
    workspaceSnapshots.set(state.workspaceId, localSnapshot);
    state.exportVersions = JSON.parse(localSnapshot || "{}").exportVersions || [];
  } catch {
    state.exportVersions = [];
  }
  state.datasetName = state.cloud.workspace.name || state.datasetName;
  state.schemaTemplateId = state.cloud.workspace.schema_template_id || state.schemaTemplateId;
  state.schemaVersion = state.cloud.workspace.schema_version || SCHEMA_VERSION;
  state.promptVersion = state.cloud.workspace.prompt_version || PROMPT_VERSION;
  state.schema = defaultSchema(state.schemaTemplateId);
  state.reviewState = reviewDefaults();
  state.manifest = buildManifest(state.rows);
  state.selectedId = state.rows[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  state.sourceCache = new Map();
  state.uploadLog = [logEntry("success", "云端工作区", `已载入 ${state.rows.length} 条云端审校数据。`, { rows: state.rows.length, step: "云端载入" })];
  return true;
}

async function syncWorkspaceToCloud() {
  if (!cloudReady()) return false;
  state.cloud.message = "正在同步云端";
  updateTopUserDom();
  await ensureCloudMaterial();
  const pages = [...state.uploadedPages.entries()].map(([sourceFile, body]) => cloudSourcePagePayload(sourceFile, body));
  await state.cloud.store.upsertSourcePages(pages);
  const syncedRows = await state.cloud.store.upsertReviewRows([...state.rows, ...state.trashRows].map(cloudReviewRowPayload));
  const idByExternalId = new Map(syncedRows.map((row) => [row.external_row_id, row.id]));
  [...state.rows, ...state.trashRows].forEach((row) => {
    if (idByExternalId.has(row.id)) row.cloudId = idByExternalId.get(row.id);
  });
  const annotations = state.rows.flatMap((row) => normalizeAnnotations(row)
    .filter((annotation) => annotation.body && row.cloudId)
    .map((annotation) => cloudAnnotationPayload(annotation, row)));
  await state.cloud.store.upsertAnnotations(annotations);
  state.cloud.message = `已同步 ${syncedRows.length} 条`;
  updateTopUserDom();
  return true;
}

async function syncRowChangeToCloud(row, eventType, reason, changes = []) {
  if (!cloudReady() || !row) return;
  try {
    await ensureCloudMaterial();
    const payload = cloudReviewRowPayload(row);
    if (row.cloudId) delete payload.created_by;
    const synced = row.cloudId
      ? await state.cloud.store.saveReviewRow(row.cloudId, payload)
      : (await state.cloud.store.upsertReviewRows([payload]))[0];
    row.cloudId = synced?.id || row.cloudId;
    if (row.cloudId) {
      await state.cloud.store.addReviewEvent({
        team_id: state.cloud.team.id,
        project_id: state.cloud.project.id,
        workspace_id: state.cloud.workspace.id,
        row_id: row.cloudId,
        event_type: eventType,
        reason,
        changes
      });
      const annotations = normalizeAnnotations(row)
        .filter((annotation) => annotation.body)
        .map((annotation) => cloudAnnotationPayload(annotation, row));
      await state.cloud.store.upsertAnnotations(annotations);
    }
    state.cloud.message = "云端已同步";
    updateTopUserDom();
  } catch (error) {
    state.cloud.status = "error";
    state.cloud.message = error?.message || "云端同步失败";
    updateTopUserDom();
  }
}

async function handleCloudSync() {
  try {
    await syncWorkspaceToCloud();
  } catch (error) {
    state.cloud.status = "error";
    state.cloud.message = error?.message || "云端同步失败";
    updateTopUserDom();
  }
}

async function handleCloudLogin() {
  const email = window.prompt("输入团队账号邮箱：", "");
  if (!email?.trim() || !state.cloud.store) return;
  try {
    await state.cloud.store.signInWithEmail(email.trim());
    state.cloud.message = "登录链接已发送";
    updateTopUserDom();
    window.alert("登录链接已发送到邮箱。登录完成后刷新页面。");
  } catch (error) {
    state.cloud.status = "error";
    state.cloud.message = error?.message || "登录失败";
    updateTopUserDom();
  }
}

async function handleCloudInvite() {
  if (!cloudReady()) return;
  const email = window.prompt("输入协作者邮箱：", "");
  if (!email?.trim()) return;
  const role = window.prompt("角色：owner/admin/editor/reviewer/viewer", "reviewer") || "reviewer";
  if (!["owner", "admin", "editor", "reviewer", "viewer"].includes(role)) {
    window.alert("角色只能是 owner/admin/editor/reviewer/viewer。");
    return;
  }
  try {
    await state.cloud.store.inviteMember(state.cloud.team.id, email.trim(), role);
    state.cloud.members = await state.cloud.store.listTeamMembers(state.cloud.team.id);
    state.cloud.invites = await state.cloud.store.listMyInvites();
    state.cloud.message = `已邀请 ${email.trim()}`;
    render();
    if (state.view === "detail") loadSelectedSource();
  } catch (error) {
    state.cloud.status = "error";
    state.cloud.message = error?.message || "邀请失败";
    updateTopUserDom();
  }
}

async function handleCloudRefresh() {
  await initCloudRuntime();
  const workspaceReloaded = await loadCloudWorkspaceData();
  if (workspaceReloaded) resetAiForRow(selectedRow());
  render();
  if (state.view === "detail") loadSelectedSource();
}

function attachCloudControls() {
  document.querySelectorAll("[data-cloud-sync]").forEach((button) => {
    button.addEventListener("click", handleCloudSync);
  });
  document.querySelectorAll("[data-cloud-login]").forEach((button) => {
    button.addEventListener("click", handleCloudLogin);
  });
  document.querySelectorAll("[data-cloud-refresh]").forEach((button) => {
    button.addEventListener("click", handleCloudRefresh);
  });
  document.querySelectorAll("[data-cloud-invite]").forEach((button) => {
    button.addEventListener("click", handleCloudInvite);
  });
}

function loadWorkspace(id = localStorage.getItem(WORKSPACE_POINTER_KEY)) {
  if (!id) return false;
  try {
    const serialized = localStorage.getItem(storageKey(id));
    const payload = JSON.parse(serialized || "null");
    if (!payload || !Array.isArray(payload.rows)) return false;
    if (state.workspaceId !== id) resetBatchUiState();
    state.workspaceId = id;
    state.datasetName = payload.datasetName || "本地隔离工作区";
    state.schemaTemplateId = payload.schemaTemplateId || state.schemaTemplateId || "calligraphy-style";
    if (Array.isArray(payload.customTemplates)) {
      const mergedTemplates = [...loadCustomTemplates(), ...payload.customTemplates].reduce((acc, template) => {
        acc.set(template.id, { ...template, custom: true, fields: cloneSchema(template.fields || []) });
        return acc;
      }, new Map());
      saveCustomTemplates([...mergedTemplates.values()]);
    }
    state.schema = cloneSchema(payload.schema?.length ? payload.schema : defaultSchema(state.schemaTemplateId));
    state.schemaVersion = payload.schemaVersion || SCHEMA_VERSION;
    state.promptVersion = payload.promptVersion || PROMPT_VERSION;
    state.uploadedPages = new Map(Object.entries(payload.uploadedPages || {}));
    state.uploadLog = payload.uploadLog || [];
    state.importReports = payload.importReports || [];
    state.exportVersions = Array.isArray(payload.exportVersions) ? payload.exportVersions : [];
    state.trashRows = (payload.trashRows || []).map(makeResult);
    state.undoAction = payload.undoAction || null;
    state.reviewState = { ...reviewDefaults(), ...(payload.reviewState || {}) };
    state.originalRows = (payload.originalRows?.length ? payload.originalRows : payload.rows).map(cloneRow);
    state.rows = payload.rows.filter((row) => !row.deleted).map(makeResult);
    payload.rows.filter((row) => row.deleted).forEach((row) => {
      if (!state.trashRows.some((item) => item.id === row.id)) state.trashRows.push(makeResult(row));
    });
    state.baseRows = [];
    state.baseManifest = null;
    state.sourceCache = new Map();
    state.sourceText = "";
    state.sourceStatus = "idle";
    state.manifest = buildManifest(state.rows);
    const selection = localStorage.getItem(storageKey(id) + ":selection") || payload.selectedId;
    state.selectedId = state.rows.some((row) => row.id === selection) ? selection : state.rows[0]?.id || "";
    state.lastSavedAt = payload.savedAt || "";
    workspaceSnapshots.set(id, serialized);
    state.workspaceConflict = null;
    state.saveError = "";
    resetAiForRow(selectedRow());
    return true;
  } catch {
    return false;
  }
}

function clearWorkspace() {
  const id = state.workspaceId || localStorage.getItem(WORKSPACE_POINTER_KEY);
  if (id && !workspaceIsCurrent(id)) return false;
  if (id) {
    localStorage.removeItem(storageKey(id));
    workspaceSnapshots.set(id, null);
  }
  if (localStorage.getItem(WORKSPACE_POINTER_KEY) === id) localStorage.removeItem(WORKSPACE_POINTER_KEY);
  localStorage.removeItem("calligraphy-review-state-v1");
  resetBatchUiState();
  state.workspaceId = newWorkspaceId();
  state.datasetName = "空白隔离工作区";
  state.schemaTemplateId = "calligraphy-style";
  state.schema = defaultSchema(state.schemaTemplateId);
  state.schemaVersion = SCHEMA_VERSION;
  state.promptVersion = PROMPT_VERSION;
  state.uploadedPages = new Map();
  state.uploadLog = [];
  state.importReports = [];
  state.exportVersions = [];
  state.trashRows = [];
  state.undoAction = null;
  state.reviewState = reviewDefaults();
  state.originalRows = [];
  state.rows = [];
  state.baseRows = [];
  state.sourceCache = new Map();
  state.sourceText = "";
  state.sourceStatus = "idle";
  state.selectedId = "";
  state.filter = "all";
  state.query = "";
  state.manifest = buildManifest([]);
  return saveWorkspace();
}

function editableSnapshot(row) {
  return {
    fields: { ...(row.fields || {}) },
    history: normalizeHistory(row),
    annotations: normalizeAnnotations(row),
    aiDraft: { ...(row.aiDraft || {}) },
    status: row.status,
    author: row.author,
    scriptType: row.scriptType,
    quote: row.quote,
    pageNo: row.pageNo,
    sourceFile: row.sourceFile,
    hit: row.hit,
    confidence: row.confidence,
    gate: row.gate,
    issue: row.issue,
    note: row.note,
    reviewed: Boolean(row.reviewed),
    edited: Boolean(row.edited),
    abnormal: Boolean(row.abnormal),
    flagged: Boolean(row.flagged),
    problemTags: normalizeProblemTags(row),
    problemResolution: row.problemResolution || null
  };
}

function applyReviewState(rows) {
  const confirmed = new Set(state.reviewState.confirmedIds || []);
  const deleted = new Set(state.reviewState.deletedIds || []);
  const edits = state.reviewState.edits || {};
  return rows
    .filter((row) => !deleted.has(row.id))
    .map((row) => ({
      ...cloneRow(row),
      ...(edits[row.id] || {}),
      reviewed: confirmed.has(row.id) || Boolean(edits[row.id]?.reviewed)
    }));
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] ?? "";
    });
    row.__rowNumber = index + 2;
    return row;
  });
}

const importSystemFields = [
  { id: "id", label: "材料ID", target: "材料ID", aliases: ["材料ID", "id", "ID", "编号", "record_id"] },
  { id: "appendix", label: "附表/分类", target: "附表", aliases: ["附表", "分类", "bucket", "appendix"] },
  { id: "status", label: "状态", target: "二轮状态", aliases: ["二轮状态", "状态", "status", "review_status"] },
  { id: "hit", label: "原文命中", target: "原文命中", aliases: ["原文命中", "hit", "match", "命中"] }
];

function csvHeaders(rows) {
  if (!rows.length) return [];
  return [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !key.startsWith("__"))))];
}

function normalizeHeader(value = "") {
  return String(value).trim().toLowerCase().replace(/[\s/_-]+/g, "");
}

function fieldAliases(field) {
  const aliases = [field.label, field.id];
  const known = {
    author: ["书家", "作者", "人物", "artist", "author"],
    scriptType: ["书体", "书体/可能书体", "字体", "script"],
    quote: ["quote", "摘录", "原文", "原文摘录", "片段", "text"],
    pageNo: ["page_no", "页码", "页序", "page"],
    sourceFile: ["source_file", "原文文件", "文件", "page_file"],
    confidence: ["证据等级", "置信度", "confidence"],
    gate: ["门禁", "进入主表建议", "gate"],
    issue: ["问题/隐患", "待复核问题", "问题", "issue"],
    note: ["备注", "note"]
  };
  return [...aliases, ...(known[field.id] || [])];
}

function guessHeader(headers, aliases) {
  const normalized = headers.map((header) => ({ header, key: normalizeHeader(header) }));
  for (const alias of aliases) {
    const exact = normalized.find((item) => item.key === normalizeHeader(alias));
    if (exact) return exact.header;
  }
  for (const alias of aliases) {
    const needle = normalizeHeader(alias);
    const partial = normalized.find((item) => item.key.includes(needle) || needle.includes(item.key));
    if (partial) return partial.header;
  }
  return "";
}

function guessCsvMapping(rows) {
  const headers = csvHeaders(rows);
  const system = Object.fromEntries(importSystemFields.map((field) => [field.id, guessHeader(headers, field.aliases)]));
  const fields = Object.fromEntries(orderedSchema().map((field) => [field.id, guessHeader(headers, fieldAliases(field))]));
  return { system, fields };
}

function createPendingCsvImport(name, rows, files = []) {
  state.pendingImport = {
    type: "csv",
    name,
    rows,
    headers: csvHeaders(rows),
    files,
    mapping: guessCsvMapping(rows)
  };
}

function logEntry(type, name, message, extra = {}) {
  return {
    type,
    name,
    title: name,
    message,
    at: new Date().toISOString(),
    ...extra
  };
}

function isKnownResultCsv(name, rows) {
  if (!rows.length) return false;
  const headers = csvHeaders(rows);
  const required = ["材料ID", "书家", "quote", "page_no", "source_file"];
  return isResultTable(rows)
    || required.every((header) => headers.includes(header))
    || /综合总表|待人工复核|复核清单/.test(name);
}

function shouldUseCsvAsPrimary(name, currentRows) {
  if (!currentRows) return true;
  return /综合总表|主表/.test(name);
}

function appendixCode(appendix = "") {
  const match = String(appendix).match(/附表([A-Z])/i);
  return match ? match[1].toUpperCase() : "X";
}

function classifyBucket(row) {
  const code = appendixCode(row["附表"] || row.appendix);
  if (code === "A") return "main";
  if (code === "B") return "candidate";
  if (code === "C") return "matched";
  if (code === "D") return "excluded";
  if (code === "E") return "review";
  return "other";
}

function normalizePageFile(value = "") {
  const file = String(value).split(/[\\/]/).filter(Boolean).pop();
  if (SOURCE_PAGE_PATTERN.test(file)) return file;
  const page = String(value).match(/\d{2,4}/)?.[0];
  return page ? `page_${page}.txt` : "";
}

function hasAbnormal(row) {
  const hit = row["原文命中"] ?? row.hit ?? fieldValue(row, "hit") ?? "";
  const quote = row.quote ?? fieldValue(row, "quote") ?? row["quote"] ?? "";
  const pageNo = row.pageNo ?? fieldValue(row, "pageNo") ?? row["page_no"] ?? "";
  const sourceFile = row.sourceFile ?? fieldValue(row, "sourceFile") ?? row["source_file"] ?? "";
  return !quote || !pageNo || !sourceFile || !["exact", "compact"].includes(hit);
}

function makeResult(row, index) {
  const importedAt = new Date().toISOString();
  if (row.id && (row.fields || Object.prototype.hasOwnProperty.call(row, "appendix"))) {
    const fields = {
      ...(row.fields || {}),
      author: row.author || row.fields?.author || "",
      scriptType: row.scriptType || row.fields?.scriptType || "",
      quote: row.quote || row.fields?.quote || "",
      pageNo: row.pageNo || row.fields?.pageNo || "",
      sourceFile: normalizePageFile(row.sourceFile || row.fields?.sourceFile || row.pageNo),
      confidence: row.confidence || row.fields?.confidence || "",
      gate: row.gate || row.fields?.gate || "",
      issue: row.issue || row.fields?.issue || "",
      note: row.note || row.fields?.note || ""
    };
    const result = {
      ...row,
      fields,
      aiDraft: row.aiDraft || rowDraftFromFields(fields),
      history: normalizeHistory(row).length ? normalizeHistory(row) : createInitialHistory({ ...row, fields, aiDraft: row.aiDraft || rowDraftFromFields(fields) }, importedAt),
      annotations: normalizeAnnotations(row),
      schemaVersion: row.schemaVersion || state.schemaVersion,
      promptVersion: row.promptVersion || state.promptVersion,
      modelVersion: row.modelVersion || "csv-import",
      bucket: row.bucket || classifyBucket(row),
      appendixCode: row.appendixCode || appendixCode(row.appendix),
      abnormal: row.abnormal ?? hasAbnormal(row),
      reviewed: Boolean(row.reviewed),
      edited: Boolean(row.edited),
      flagged: Boolean(row.flagged),
      problemTags: normalizeProblemTags(row)
    };
    return syncLegacyFields(result);
  }

  const sourceFile = normalizePageFile(row["source_file"] || row["page_no"]);
  const id = row["材料ID"] || `UPLOAD-${String(index + 1).padStart(4, "0")}`;
  const fields = {
    author: row["书家"] || "",
    scriptType: row["书体/可能书体"] || row["书体"] || "",
    quote: row["quote"] || row["摘录"] || row["原文"] || row["原文摘录"] || "",
    pageNo: row["page_no"] || row["页码"] || "",
    sourceFile: sourceFile || normalizePageFile(row["source_file"] || row["原文文件"] || row["页码"]),
    hit: row["原文命中"] || row["命中"] || "",
    confidence: row["证据等级"] || row["置信度"] || "",
    gate: row["门禁"] || row["进入主表建议"] || "",
    issue: row["问题/隐患"] || row["待复核问题"] || "",
    note: row["备注"] || ""
  };
  orderedSchema().forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(fields, field.id)) {
      fields[field.id] = row[field.label] || row[field.id] || "";
    }
  });
  const triageStatus = row["第三轮状态"] || row["二轮状态"] || "";
  const manualAdvice = row["第三轮人工操作建议"] || row["进入主表建议"] || "";
  const issueReason = row["第三轮问题归因"] || row["问题/隐患"] || "";
  const handlingNote = row["第三轮处理说明"] || row["备注"] || "";
  const result = {
    id,
    rowNumber: row.__rowNumber || index + 2,
    appendix: row["附表"] || "",
    appendixCode: appendixCode(row["附表"]),
    bucket: classifyBucket(row),
    status: triageStatus,
    triageStatus,
    manualAdvice,
    issueReason,
    handlingNote,
    sourceData: row["来源数据"] || "",
    fields,
    aiDraft: rowDraftFromFields(fields),
    history: [],
    annotations: [],
    schemaVersion: state.schemaVersion,
    promptVersion: state.promptVersion,
    modelVersion: "csv-import",
    action: row["第二轮动作"] || "",
    recommendation: manualAdvice,
    originalRecord: row["对应原高置信记录"] || "",
    abnormal: hasAbnormal(row),
    reviewed: false,
    edited: false,
    flagged: false,
    problemTags: normalizeProblemTags(row)
  };
  result.history = createInitialHistory(result, importedAt);
  return syncLegacyFields(result);
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "未标注";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function rowValidation(row) {
  const missingRequired = orderedSchema().filter((field) => field.required && !String(fieldValue(row, field.id) || "").trim());
  const hasEvidenceAnchor = Boolean(String(fieldValue(row, "quote") || row.quote || "").trim())
    && Boolean(String(fieldValue(row, "pageNo") || row.pageNo || fieldValue(row, "sourceFile") || row.sourceFile || "").trim());
  const missingEvidence = orderedSchema().filter((field) => {
    if (!field.evidenceRequired) return false;
    const value = String(fieldValue(row, field.id) || "").trim();
    return value && !hasEvidenceAnchor;
  });
  const history = normalizeHistory(row);
  const lastEdit = history.findLastIndex((event) => event.type === "human-edit");
  const lastConfirm = history.findLastIndex((event) => ["confirm", "problem-resolved"].includes(event.type));
  const lastUndo = history.findLastIndex((event) => event.type === "undo");
  const confirmedThenChanged = Boolean(row.reviewed && lastEdit > Math.max(lastConfirm, lastUndo));
  const issues = [
    ...missingRequired.map((field) => ({ type: "required", field, label: `${field.label}缺失` })),
    ...missingEvidence.map((field) => ({ type: "evidence", field, label: `${field.label}缺证据定位` })),
    ...(confirmedThenChanged ? [{ type: "changed", field: null, label: "确认后有修改" }] : [])
  ];
  const level = missingRequired.length ? "risk" : missingEvidence.length || confirmedThenChanged ? "warn" : "ok";
  return {
    ok: issues.length === 0,
    level,
    missingRequired,
    missingEvidence,
    confirmedThenChanged,
    issues
  };
}

function fieldQualityStats() {
  const rows = state.rows || [];
  return orderedSchema().map((field) => {
    let filled = 0;
    let missingRequired = 0;
    let missingEvidence = 0;
    rows.forEach((row) => {
      const value = String(fieldValue(row, field.id) || "").trim();
      const validation = rowValidation(row);
      if (value) filled += 1;
      if (validation.missingRequired.some((item) => item.id === field.id)) missingRequired += 1;
      if (validation.missingEvidence.some((item) => item.id === field.id)) missingEvidence += 1;
    });
    const fillRate = rows.length ? Math.round((filled / rows.length) * 100) : 0;
    const risk = missingRequired ? "risk" : missingEvidence ? "warn" : fillRate < 60 ? "low" : "ok";
    return {
      field,
      filled,
      empty: Math.max(0, rows.length - filled),
      missingRequired,
      missingEvidence,
      fillRate,
      risk
    };
  });
}

function buildManifest(rows, source = state.baseManifest, options = {}) {
  const validations = rows.map(rowValidation);
  const stats = {
    total: rows.length,
    sourcePages: state.uploadedPages.size,
    linkedRows: rows.filter((row) => Boolean(cachedSourceText(row.sourceFile))).length,
    exactHits: rows.filter((row) => sourceQuality(row).match === "exact").length,
    reviewRows: rows.filter((row) => row.bucket === "review").length,
    abnormalRows: rows.filter(sourceNeedsReview).length,
    invalidRows: validations.filter((validation) => !validation.ok).length,
    missingRequiredRows: validations.filter((validation) => validation.missingRequired.length).length,
    missingEvidenceRows: validations.filter((validation) => validation.missingEvidence.length).length,
    changedAfterConfirmRows: validations.filter((validation) => validation.confirmedThenChanged).length,
    confirmedRows: rows.filter((row) => row.reviewed).length,
    editedRows: rows.filter((row) => row.edited).length,
    flaggedRows: rows.filter((row) => row.flagged).length,
    appendix: countBy(rows, "appendix"),
    hit: countBy(rows, "hit"),
    bucket: countBy(rows, "bucket")
  };
  return {
    ...(source || {}),
    title: "书论成果线上工作台",
    description: "上传文件后，系统会在当前浏览器内解析并生成隔离工作区；不读取、不展示、不上传后端文件。",
    stats,
    downloads: []
  };
}

function rowText(row) {
  return [
    row.id,
    row.appendix,
    row.status,
    ...(row.problemTags || []).map((tag) => window.CalligraphySchema?.tagLabel?.(tag) || tag),
    ...orderedSchema().map((field) => fieldValue(row, field.id)),
    row.hit,
    row.reviewed ? "已确认" : "",
    row.edited ? "已修改" : "",
    row.flagged ? "人工标注 有问题" : "",
  ].join(" ");
}

function normalizeProblemTags(row) {
  const tags = Array.isArray(row.problemTags) ? row.problemTags : [];
  return window.CalligraphyReviewWorkflow?.uniqueTags?.(tags) || [...new Set(tags.filter(Boolean))];
}

function rowHasProblem(row) {
  if (row.deleted || row.problemResolution?.status === "resolved") return false;
  if (window.CalligraphyReviewWorkflow?.hasProblem) return window.CalligraphyReviewWorkflow.hasProblem(row)
    || !rowValidation(row).ok || sourceQuality(row).rank === 0;
  return Boolean(row.flagged || normalizeProblemTags(row).length || row.confidence === "待复核");
}

function rowProblemStatus(row) {
  const status = window.CalligraphyReviewWorkflow.problemStatus(row);
  return status === "none" && rowHasProblem(row) ? "open" : status;
}

function rowMatchesQualityFocus(row) {
  if (!state.qualityFocus) return true;
  if (state.qualityFocus.mode === "delivery") return state.qualityFocus.rowIds.includes(row.id);
  if (state.qualityFocus.mode === "triage") {
    return String(row.triageStatus || row.status || "") === String(state.qualityFocus.value || "");
  }
  const { fieldId, mode } = state.qualityFocus;
  const value = String(fieldValue(row, fieldId) || "").trim();
  const validation = rowValidation(row);
  if (mode === "empty") return !value;
  if (mode === "evidence") return validation.missingEvidence.some((field) => field.id === fieldId);
  if (mode === "required") return validation.missingRequired.some((field) => field.id === fieldId);
  if (mode === "issue") {
    return !value
      || validation.missingEvidence.some((field) => field.id === fieldId)
      || validation.missingRequired.some((field) => field.id === fieldId);
  }
  return true;
}

function visibleRows() {
  const query = state.query.trim().toLowerCase();
  const dashboardIds = state.qualityFocus?.mode === "dashboard"
    ? new Set(dashboardQueueIds(state.qualityFocus.key)) : null;
  const rows = state.rows.filter((row) => {
    const filterPass = state.filter === "all"
      || (state.filter === "abnormal"
        ? sourceNeedsReview(row)
        : state.filter === "invalid"
          ? !rowValidation(row).ok
          : state.filter === "flagged"
            ? row.flagged
            : state.filter === "problem"
              ? rowHasProblem(row)
              : state.filter === "resolved"
                ? row.problemResolution?.status === "resolved"
              : row.bucket === state.filter);
    const focusPass = dashboardIds ? dashboardIds.has(row.id) : rowMatchesQualityFocus(row);
    const queryPass = !query || rowText(row).toLowerCase().includes(query);
    return filterPass && focusPass && queryPass;
  });
  return sortRowsByConfidence(rows);
}

function batchSelectedRows() {
  return state.rows.filter((row) => state.batchSelectedIds.has(row.id));
}

function resetBatchUiState() {
  if (state.batchJob?.running) state.batchJob.stopRequested = true;
  state.batchMode = false;
  state.batchSelectedIds = new Set();
  state.batchJob = null;
  state.batchIssueOpen = false;
  state.batchReviewRowId = "";
}

function setBatchMode(enabled) {
  const next = Boolean(enabled);
  if (!next && state.batchJob?.running) return false;
  state.batchMode = next;
  if (!next) {
    state.batchSelectedIds = new Set();
    state.batchJob = null;
    state.batchIssueOpen = false;
    state.batchReviewRowId = "";
  }
  return true;
}

function reconcileBatchSelection() {
  const existing = new Set(state.rows.map((row) => row.id));
  state.batchSelectedIds = new Set([...state.batchSelectedIds].filter((id) => existing.has(id)));
  return state.batchSelectedIds.size;
}

function toggleBatchSelection(rowId, checked) {
  if (!state.rows.some((row) => row.id === rowId)) return false;
  const next = new Set(state.batchSelectedIds);
  if (checked) next.add(rowId);
  else next.delete(rowId);
  state.batchSelectedIds = next;
  return true;
}

function setVisibleBatchSelection(checked) {
  const next = new Set(state.batchSelectedIds);
  visibleRows().forEach((row) => {
    if (checked) next.add(row.id);
    else next.delete(row.id);
  });
  state.batchSelectedIds = next;
  return state.batchSelectedIds.size;
}

function visibleBatchSelectionState(rows = visibleRows()) {
  const selected = rows.filter((row) => state.batchSelectedIds.has(row.id)).length;
  return {
    selected,
    all: Boolean(rows.length) && selected === rows.length,
    mixed: selected > 0 && selected < rows.length,
  };
}

function selectedRow() {
  const rows = visibleRows();
  return rows.find((row) => row.id === state.selectedId) || rows[0] || null;
}

function selectedRowIndex(rows = visibleRows()) {
  const current = selectedRow();
  if (!current) return -1;
  return rows.findIndex((row) => row.id === current.id);
}

function moveSelection(step = 1) {
  const rows = visibleRows();
  if (!rows.length) return;
  const currentIndex = selectedRowIndex(rows);
  const fallback = step > 0 ? 0 : rows.length - 1;
  const nextIndex = currentIndex < 0
    ? fallback
    : Math.min(Math.max(currentIndex + step, 0), rows.length - 1);
  selectResult(rows[nextIndex].id);
}

function nextResult() {
  moveSelection(1);
}

function previousResult() {
  moveSelection(-1);
}

function metricCards() {
  const stats = state.manifest.stats;
  const items = [
    { value: stats.total, label: "成果行", note: state.datasetName },
    { value: stats.exactHits, label: "精确命中", note: "quote 可直接回源" },
    { value: stats.invalidRows, label: "字段待补", note: "缺必填/证据定位" },
    { value: stats.sourcePages, label: "原文页", note: "静态或上传 page 文本" }
  ];
  return items.map((item) => `
    <article class="metric-card">
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.label)}</span>
      <p>${escapeHtml(item.note)}</p>
    </article>
  `).join("");
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function hasWorkspaceData() {
  return Boolean(state.rows.length || state.uploadLog.length || state.uploadedPages.size);
}

function uniqueSourceCount() {
  return new Set(state.rows.map((row) => row.sourceFile).filter(Boolean)).size;
}

function formatLocalTime(value) {
  if (!value) return "未保存";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function percentage(part, total) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 10000) / 100}%`;
}

function projectDashboardStats() {
  const stats = state.manifest.stats;
  return {
    materials: stats.sourcePages || uniqueSourceCount(),
    imported: new Set(state.rows.map((row) => row.importFileName || row.sourceData).filter(Boolean)).size || (stats.total ? 1 : 0),
    chunks: stats.total,
    located: stats.linkedRows,
    exactHits: stats.exactHits,
    tableRows: stats.total,
    reviewRows: stats.invalidRows,
    abnormalRows: stats.abnormalRows,
    confirmedRows: stats.confirmedRows,
    editedRows: stats.editedRows,
    missingRequiredRows: stats.missingRequiredRows,
    missingEvidenceRows: stats.missingEvidenceRows,
    ...dashboardReadiness()
  };
}

function dashboardReadiness() {
  const facts = deliveryFacts(state.rows);
  const assessment = window.CalligraphyExportWorkflow.assessRelease(facts);
  return {
    assessment,
    readyRows: assessment.total - assessment.blocked,
    blockedRows: assessment.blocked,
    unreviewedRows: facts.filter((row) => !row.reviewed).length,
    confirmedRows: facts.filter((row) => row.reviewed).length,
    matchedRows: facts.filter((row) => row.sourceRank >= 2).length,
    openProblems: facts.filter((row) => row.hasProblem).length
  };
}

function dashboardQueueIds(key) {
  const { assessment } = dashboardReadiness();
  if (key === "ready") {
    const blocked = new Set(assessment.issues.map((item) => item.id));
    return state.rows.filter((row) => !blocked.has(row.id)).map((row) => row.id);
  }
  return assessment.issues.filter((item) => key === "blocked" || item.reasons.includes(key)).map((item) => item.id);
}

function inspectDashboardQueue(key) {
  const labels = { ready: "可交付条目", blocked: "交付阻塞条目" };
  const label = labels[key] || window.CalligraphyExportWorkflow.releaseChecks.find((item) => item.key === key)?.label;
  if (!label) return;
  navigateToView("detail", key === "ready" ? "table" : "review");
  state.filter = "all";
  state.query = "";
  state.qualityFocus = { mode: "dashboard", key, label };
  state.selectedId = visibleRows()[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function dashboardWorkflow() {
  const stats = projectDashboardStats();
  const hasData = hasWorkspaceData();
  const importDone = hasData;
  const tableDone = stats.tableRows > 0;
  const locateDone = tableDone && stats.matchedRows === stats.tableRows;
  const reviewDone = tableDone && !stats.openProblems;
  const steps = [
    { index: 1, title: "材料导入", note: "导入 CSV/JSON/page 文本，建立本地材料库", status: importDone ? "已完成" : "待导入", value: stats.imported, unit: "份", detail: importDone ? "已有本地材料" : "等待文件", done: importDone, focus: "file" },
    { index: 2, title: "整理条目", note: "读取已有整理结果", status: tableDone ? "已入表" : "待导入", value: stats.chunks, unit: "条", detail: tableDone ? "来自导入材料" : "等待数据", done: tableDone, view: "detail", detailMode: "table" },
    { index: 3, title: "原文定位", note: "比对摘录与原文上下文", status: locateDone ? "已匹配" : tableDone ? "待核对" : "待导入", value: stats.matchedRows, unit: "条", detail: "摘录完整匹配", done: locateDone, queue: "unlocated" },
    { index: 4, title: "统一主表", note: "结构化入表，形成可检索主表", status: tableDone ? "进行中" : "待入表", value: stats.tableRows, unit: "条", detail: tableDone ? "当前可用" : "等待导入", done: tableDone, view: "detail", detailMode: "table" },
    { index: 5, title: "回检修订", note: "处理问题并记录复核结论", status: reviewDone ? "问题已清" : stats.openProblems ? "待处理" : "待检查", value: stats.openProblems, unit: "条", detail: stats.openProblems ? "未关闭的问题条目" : "暂无待处理问题", done: reviewDone, queue: "openProblem" },
    { index: 6, title: "成果导出", note: "检查成果并保存导出版本", status: state.exportVersions.length ? "已有版本" : tableDone ? "可导出草稿" : "待处理", value: state.exportVersions.length, unit: "版", detail: state.exportVersions.length ? "已保存正式成果" : "尚无正式成果", done: state.exportVersions.length > 0, focus: "export" }
  ];
  return `
    <section class="dash-panel workflow-panel">
      <div class="dash-panel-head">
        <h2>工作流程</h2>
        <span>当前工作区</span>
      </div>
      <div class="workflow-list">
        ${steps.map((step) => `
        <article class="workflow-row">
          <div class="step-index">${step.index}</div>
          <div class="step-main"><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.note)}</span></div>
          <div class="step-status ${step.done ? "done" : "pending"}"><i></i>${escapeHtml(step.status)}</div>
          <div class="step-count"><strong>${formatCount(step.value)} <em>${escapeHtml(step.unit)}</em></strong><span>${escapeHtml(step.detail)}</span></div>
          <button type="button" class="icon-control" ${step.queue ? `data-dashboard-queue="${step.queue}"` : ""} ${step.view ? `data-view="${step.view}"` : ""} ${step.detailMode ? `data-detail-mode="${step.detailMode}"` : ""} ${step.focus ? `data-home-focus="${step.focus}"` : ""} aria-label="进入${escapeHtml(step.title)}" title="进入${escapeHtml(step.title)}">›</button>
          <span class="step-more">⌄</span>
        </article>
        `).join("")}
      </div>
    </section>
  `;
}

function dashboardProjectCard() {
  const stats = projectDashboardStats();
  const progress = stats.tableRows ? Math.floor((stats.readyRows / stats.tableRows) * 100) : 0;
  const workspaceShortId = ensureWorkspaceId().slice(0, 8);
  const recentItems = state.uploadLog.slice(-4).reverse();
  return `
    <section class="dash-card current-project">
      <div class="side-card-head"><h2>当前项目</h2><button type="button" class="icon-control" data-workspace-list aria-label="切换工作区" title="切换工作区">⇄</button></div>
      <div class="project-title-row"><h3>${escapeHtml(state.datasetName || "空白隔离工作区")}</h3><span>${hasWorkspaceData() ? "进行中" : "待导入"}</span></div>
      <dl class="project-meta">
        <div><dt>工作区</dt><dd>${escapeHtml(workspaceShortId)}</dd></div>
        <div><dt>保存时间</dt><dd>${escapeHtml(formatLocalTime(state.lastSavedAt))}</dd></div>
        <div><dt>处理方式</dt><dd>浏览器本地隔离</dd></div>
        <div><dt>字段模板</dt><dd>${escapeHtml(templateById(state.schemaTemplateId)?.name || "书论字段模板")}</dd></div>
        <div><dt>项目描述</dt><dd>${escapeHtml(hasWorkspaceData() ? "当前数据来自本地导入文件，可继续定位、回检、修订与导出。" : "还没有导入材料。请先导入 CSV/JSON 或工作区 JSON。")}</dd></div>
      </dl>
      <div class="progress-block">
        <div><strong>交付就绪</strong><span>当前主表</span></div>
        <b>${progress}%</b><i><span style="width:${progress}%"></span></i>
        <p>可交付 ${formatCount(stats.readyRows)} 条 / 共 ${formatCount(stats.tableRows)} 条</p>
      </div>
      <div class="data-overview">
        <h3>数据概览</h3>
        <dl>
          <div><dt>原文页</dt><dd>${formatCount(stats.materials)} 页</dd></div>
          <div><dt>导入文件</dt><dd>${formatCount(stats.imported)} 份</dd></div>
          <div><dt>原文已关联</dt><dd>${formatCount(stats.located)} 条</dd></div>
          <div><dt>摘录已匹配</dt><dd>${formatCount(stats.matchedRows)} 条</dd></div>
          <div><dt>人工已确认</dt><dd>${formatCount(stats.confirmedRows)} 条</dd></div>
          <div><dt>问题未关闭</dt><dd>${formatCount(stats.openProblems)} 条</dd></div>
        </dl>
      </div>
      <div class="quick-actions">
        <h3>快捷操作</h3>
        <div>
          <button type="button" data-home-focus="file">材料导入</button>
          <button type="button" data-home-focus="schema">字段模板</button>
          <button type="button" data-view="detail" data-detail-mode="table">原文定位</button>
          <button type="button" data-view="detail" data-detail-mode="table">打开统一主表</button>
          <button type="button" data-view="detail" data-detail-mode="review">回检队列</button>
          <button type="button" data-home-focus="export" ${state.rows.length || state.exportVersions.length ? "" : "disabled"}>成果导出</button>
        </div>
      </div>
    </section>
    <section class="dash-card recent-visits">
      <h2>最近导入</h2>
      ${recentItems.length ? `
        <ol>
          ${recentItems.map((item) => `<li><span>${escapeHtml(item.name || item.type || "导入文件")}</span><time>${escapeHtml(formatLocalTime(item.at || item.time))}</time></li>`).join("")}
        </ol>
      ` : `<p class="dash-empty">暂无导入记录</p>`}
    </section>
  `;
}

function dashboardLogTable() {
  const logs = state.uploadLog.slice(-8).reverse().map((item) => [
    formatLocalTime(item.at || item.time),
    item.step || "材料导入",
    item.name || item.message || "导入本地文件",
    "本地用户",
    item.error || item.type === "error" ? "失败" : item.type === "warn" ? "待处理" : "成功",
    item.message || item.detail || (item.rows ? `${formatCount(item.rows)} 行` : item.count ? `${formatCount(item.count)} 条` : "-")
  ]);
  return `
    <section class="dash-panel log-panel">
      <div class="dash-panel-head"><h2>流程日志</h2><div class="log-filters"><button type="button" disabled>全部步骤⌄</button><button type="button" disabled>全部状态⌄</button></div><button type="button" class="icon-control" disabled aria-label="更多日志" title="更多日志">…</button></div>
      ${logs.length ? `
        <table class="log-table">
          <thead><tr><th>时间</th><th>步骤</th><th>操作</th><th>操作人</th><th>状态</th><th>详情</th></tr></thead>
          <tbody>${logs.map((log) => `<tr>${log.map((cell, index) => `<td class="${index === 4 && cell === "成功" ? "success" : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      ` : `<div class="dash-empty-panel"><strong>暂无流程日志</strong><span>导入文件、回检或导出后会在这里记录。</span></div>`}
    </section>
  `;
}

function dashboardRightColumn() {
  const stats = projectDashboardStats();
  const count = (key) => stats.assessment.checks.find((item) => item.key === key)?.count || 0;
  const queue = [
    ["待人工确认", stats.unreviewedRows, "审校状态", "unreviewed"],
    ["定位待核对", count("unlocated"), "原文比对", "unlocated"],
    ["问题未关闭", stats.openProblems, "问题记录", "openProblem"]
  ];
  const risks = stats.assessment.checks.filter((item) => item.count);
  const quality = [
    ["原文关联率", percentage(stats.located, stats.tableRows)],
    ["精确命中率", percentage(stats.exactHits, stats.tableRows)],
    ["审校确认率", percentage(stats.confirmedRows, stats.tableRows)],
    ["字段完整率", percentage(Math.max(0, stats.tableRows - stats.missingRequiredRows), stats.tableRows)]
  ];
  const activity = state.uploadLog.slice(-3).reverse().map((item) => [item.message || item.name || "导入本地文件", formatLocalTime(item.at || item.time)]);
  return `
    ${cloudStatusPanel()}
    <section class="dash-panel queue-panel-home">
      <div class="dash-panel-head"><h2>当前队列</h2><button type="button" class="icon-control" data-dashboard-queue="blocked" aria-label="查看待办" title="查看待办">›</button></div>
      <div class="queue-tabs"><button type="button" data-dashboard-queue="ready">可交付（${formatCount(stats.readyRows)}）</button><button type="button" data-dashboard-queue="unreviewed">待确认（${formatCount(stats.unreviewedRows)}）</button><button type="button" data-dashboard-queue="blocked" title="按条目去重，包含未确认及其他阻塞原因">阻塞（${formatCount(stats.blockedRows)}）</button></div>
      <table class="queue-table"><thead><tr><th>任务类型</th><th>数量</th><th>依据</th><th>操作</th></tr></thead><tbody>${queue.map((row) => `<tr><td>${escapeHtml(row[0])}</td><td>${formatCount(row[1])}</td><td>${escapeHtml(row[2])}</td><td><button type="button" class="icon-control" data-dashboard-queue="${row[3]}" ${row[1] ? "" : "disabled"} aria-label="处理${escapeHtml(row[0])}" title="处理${escapeHtml(row[0])}">›</button></td></tr>`).join("")}</tbody></table>
    </section>
    <section class="dash-panel side-list risk-list"><div class="dash-panel-head"><h2 title="同一条目可能有多项阻塞原因，各项数量不可相加">交付阻塞原因</h2><button type="button" class="icon-control" data-home-focus="export" aria-label="检查成果" title="检查成果">›</button></div>${risks.length ? `<ul>${risks.map((item, index) => `<li><span><i>${index + 1}</i>${escapeHtml(item.label)}</span><button type="button" data-dashboard-queue="${item.key}" aria-label="查看${escapeHtml(item.label)}">${formatCount(item.count)} 条</button></li>`).join("")}</ul>` : `<p class="dash-empty">${stats.tableRows ? "当前主表无交付阻塞" : "尚无条目可检查"}</p>`}</section>
    <section class="dash-panel side-list quality-list"><div class="dash-panel-head"><h2>数据质量</h2><button type="button" class="icon-control" data-quality-export ${stats.tableRows ? "" : "disabled"} aria-label="查看报告" title="查看报告">›</button></div><ul>${quality.map((item) => `<li><span>${escapeHtml(item[0])}</span><b>${escapeHtml(item[1])}</b></li>`).join("")}</ul></section>
    <section class="dash-panel side-list activity-list"><div class="dash-panel-head"><h2>操作动态</h2><button type="button" class="icon-control" disabled aria-label="查看全部" title="查看全部">›</button></div>${activity.length ? `<ul>${activity.map((item) => `<li><span>${escapeHtml(item[0])}</span><b>${escapeHtml(item[1])}</b></li>`).join("")}</ul>` : `<p class="dash-empty">暂无操作动态</p>`}</section>
  `;
}

function dashboardImportSink() {
  return `<label class="hidden-import-sink"><input id="fileInput" type="file" multiple accept=".csv,.json,.txt,.xlsx,application/json,text/csv,text/plain" /></label>`;
}

function railMetrics() {
  const stats = state.manifest.stats;
  const items = [
    { value: stats.total, label: "成果行" },
    { value: stats.exactHits, label: "精确命中" },
    { value: stats.invalidRows, label: "字段待补" },
    { value: stats.sourcePages, label: "原文页" }
  ];
  return items.map((item) => `
    <div class="rail-metric">
      <strong>${escapeHtml(item.value)}</strong>
      <span>${escapeHtml(item.label)}</span>
    </div>
  `).join("");
}

function uploadLog() {
  if (!state.uploadLog.length) {
    return `
      <div class="upload-log empty">
        <strong>等待文件</strong>
        <p>支持上传 CSV/JSON 结果表、导出的工作区 JSON，也可以同时上传 page_*.txt 原文页。所有内容只保存在当前浏览器。</p>
      </div>
    `;
  }
  return `
    <div class="upload-log">
      ${state.uploadLog.map((item) => `
        <article class="${item.type}">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function workspaceStatus() {
  const saved = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleString("zh-CN") : "尚未保存";
  return `
    <div class="workspace-status">
      <span>工作区 <strong>${escapeHtml(state.workspaceId.slice(0, 8) || "local")}</strong></span>
      <span>${escapeHtml(saved)}</span>
    </div>
  `;
}

function workspaceActions() {
  return `
    <div class="workspace-actions">
      <button type="button" data-workspace-export>导出工作区</button>
      <button type="button" data-main-table-export ${state.rows.length || state.exportVersions.length ? "" : "disabled"}>成果导出</button>
      <button type="button" data-problem-export ${state.rows.length ? "" : "disabled"}>导出问题条目</button>
      <button type="button" data-review-log-export ${state.rows.length || state.trashRows.length ? "" : "disabled"}>导出审校日志</button>
      <button type="button" data-import-report-export ${state.importReports.length ? "" : "disabled"}>导出导入报告</button>
      <button type="button" data-import-conflicts ${state.importReports.some((report) => report.issues?.length) ? "" : "disabled"}>处理导入冲突（${importIssueEntries().filter((entry) => !entry.issue.resolution).length}）</button>
      <button type="button" data-quality-export ${state.rows.length ? "" : "disabled"}>导出字段质量</button>
      <button type="button" data-template-download>下载 CSV 模板</button>
      <button type="button" data-workspace-reset>清空本地工作区</button>
    </div>
  `;
}

function templatePanel() {
  const current = templateById(state.schemaTemplateId);
  const visibleCount = orderedSchema({ includeHidden: false }).length;
  const totalCount = orderedSchema().length;
  return `
    <section class="schema-panel">
      <div class="schema-summary">
        <div>
          <p class="kicker">Schema Studio</p>
          <h3>字段模板</h3>
          <p>${escapeHtml(current.description)}</p>
        </div>
        <div class="schema-summary-meta">
          <strong>${escapeHtml(current.custom ? "我的模板" : "内置模板")}</strong>
          <span>${visibleCount} / ${totalCount} 字段显示</span>
          <button type="button" data-template-panel-open>展开详情</button>
        </div>
      </div>
    </section>
  `;
}

function templateEditorContent() {
  const current = templateById(state.schemaTemplateId);
  const templates = allSchemaTemplates();
  return `
    <div class="schema-panel-body">
      <label class="schema-select">
        <span>研究任务模板</span>
        <select data-template-select>
          ${templates.map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === state.schemaTemplateId ? "selected" : ""}>${template.custom ? "我的｜" : "内置｜"}${escapeHtml(template.name)}</option>`).join("")}
        </select>
      </label>
      <div class="schema-tools">
        <button type="button" data-schema-add>添加字段</button>
        <button type="button" data-template-save>保存为我的模板</button>
        <button type="button" data-template-copy>复制当前模板</button>
        ${current.custom ? `<button type="button" class="danger" data-template-delete>删除我的模板</button>` : ""}
        <button type="button" data-schema-reset>恢复模板默认字段</button>
      </div>
      <div class="field-list">
        ${orderedSchema().map((field) => `
          <details class="field-config ${field.visible ? "" : "muted"}">
            <summary class="field-config-head">
            <strong>${escapeHtml(field.label)}</strong>
            <span>${escapeHtml(field.id)} · ${escapeHtml(field.type)} · ${field.visible ? "表格显示" : "已隐藏"}</span>
            </summary>
            <div class="field-config-body">
              <div class="field-toolbar">
                <button type="button" data-schema-move="${escapeHtml(field.id)}" data-schema-direction="up">上移</button>
                <button type="button" data-schema-move="${escapeHtml(field.id)}" data-schema-direction="down">下移</button>
                <button type="button" class="danger" data-schema-delete="${escapeHtml(field.id)}">删除</button>
              </div>
              <label>字段名<input data-schema-field="${escapeHtml(field.id)}" data-schema-prop="label" value="${escapeHtml(field.label)}" /></label>
              <label>字段类型
                <select data-schema-field="${escapeHtml(field.id)}" data-schema-prop="type">
                  ${["text", "longtext", "select", "number", "date"].map((type) => `<option value="${type}" ${field.type === type ? "selected" : ""}>${type}</option>`).join("")}
                </select>
              </label>
              <label>抽取 prompt<textarea data-schema-field="${escapeHtml(field.id)}" data-schema-prop="prompt" rows="3">${escapeHtml(field.prompt || "")}</textarea></label>
              <div class="field-switches">
                <label><input type="checkbox" data-schema-field="${escapeHtml(field.id)}" data-schema-prop="required" ${field.required ? "checked" : ""} /> 必填</label>
                <label><input type="checkbox" data-schema-field="${escapeHtml(field.id)}" data-schema-prop="evidenceRequired" ${field.evidenceRequired ? "checked" : ""} /> 需证据</label>
                <label><input type="checkbox" data-schema-field="${escapeHtml(field.id)}" data-schema-prop="visible" ${field.visible ? "checked" : ""} /> 表格显示</label>
              </div>
            </div>
          </details>
        `).join("")}
      </div>
    </div>
  `;
}

function modelSettingsSourceLabel(source) {
  if (source === "local-file") return "本地配置";
  if (source === "environment") return "环境变量";
  return "未配置";
}

const MODEL_PROFILE_IDS = ["primary", "secondary", "tertiary"];
const MODEL_PROFILE_LABELS = { primary: "模型 A", secondary: "模型 B", tertiary: "模型 C" };

function emptyModelProfile(id) {
  return {
    id,
    displayName: "",
    apiUrl: "",
    model: "",
    modelFamily: "",
    enabled: true,
    configured: false,
    source: "none",
    keyHint: "",
    lastTestedAt: "",
    latencyMs: 0,
    health: "unknown"
  };
}

function normalizePublicModelProfile(value, id, fallback = {}) {
  const profile = value && typeof value === "object" ? value : {};
  const apiUrl = String(profile.apiUrl || "");
  const model = String(profile.model || "");
  const source = ["local-file", "environment"].includes(profile.source)
    ? profile.source
    : (["local-file", "environment"].includes(fallback.source) ? fallback.source : "none");
  const configured = typeof profile.configured === "boolean"
    ? profile.configured
    : Boolean(apiUrl && model && (source !== "none" || fallback.configured));
  return {
    id,
    displayName: String(profile.displayName || "").slice(0, 80),
    apiUrl,
    model,
    modelFamily: String(profile.modelFamily || "").slice(0, 80),
    enabled: profile.enabled !== false,
    configured,
    source,
    keyHint: String(profile.keyHint || "").slice(-4),
    lastTestedAt: String(profile.lastTestedAt || ""),
    latencyMs: Number(profile.latencyMs) || 0,
    health: String(profile.health || "unknown")
  };
}

function normalizeModelPolicy(value) {
  const policy = value && typeof value === "object" ? value : {};
  const reviewMode = ["assist", "auto"].includes(policy.reviewMode) ? policy.reviewMode : "assist";
  const defaultConsensus = ["loose", "standard", "strict"].includes(policy.defaultConsensus)
    ? policy.defaultConsensus
    : "standard";
  const fieldOverrides = policy.fieldOverrides && typeof policy.fieldOverrides === "object" && !Array.isArray(policy.fieldOverrides)
    ? Object.fromEntries(Object.entries(policy.fieldOverrides).filter(([, item]) => item && typeof item === "object"))
    : {};
  return { reviewMode, defaultConsensus, fieldOverrides };
}

function modelSettingsOverallSource() {
  const configured = state.modelSettings.profiles.filter((profile) => profile.configured);
  if (configured.some((profile) => profile.source === "local-file")) return "local-file";
  if (configured.some((profile) => profile.source === "environment")) return "environment";
  return "none";
}

function modelProfileDisplayName(profile) {
  return profile.displayName || MODEL_PROFILE_LABELS[profile.id] || profile.id;
}

function modelProfileEndpoint(profile) {
  if (!profile.apiUrl) return { host: "未设置", path: "" };
  try {
    const parsed = new URL(profile.apiUrl);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch (_error) {
    return { host: profile.apiUrl, path: "" };
  }
}

function modelProfileStatus(profile) {
  if (!profile.configured) return "待配置";
  if (!profile.enabled) return "已停用";
  if (profile.health === "error") return "连接异常";
  if (profile.health === "ok") return "连接正常";
  return "已启用";
}

function modelProfileForm(profile, supported) {
  const busy = state.modelSettings.busyProfileId === profile.id;
  const disabled = !supported || busy;
  const keyPlaceholder = profile.source === "local-file" ? "留空则沿用已保存密钥" : "请输入 API Key";
  return `
    <form class="model-profile-form" data-model-profile-form data-model-profile="${escapeHtml(profile.id)}">
      <input type="hidden" name="id" value="${escapeHtml(profile.id)}" />
      <div class="model-settings-grid">
        <label>显示名称
          <input name="displayName" autocomplete="off" value="${escapeHtml(profile.displayName)}" placeholder="${escapeHtml(MODEL_PROFILE_LABELS[profile.id])}" ${disabled ? "disabled" : ""} />
        </label>
        <label>模型家族
          <input name="modelFamily" required autocomplete="off" spellcheck="false" value="${escapeHtml(profile.modelFamily)}" placeholder="deepseek / gpt / qwen" ${disabled ? "disabled" : ""} />
        </label>
        <label class="wide">接口地址
          <input name="apiUrl" type="url" required autocomplete="url" spellcheck="false" value="${escapeHtml(profile.apiUrl)}" placeholder="https://api.example.com/v1/chat/completions" ${disabled ? "disabled" : ""} />
        </label>
        <label>API Key
          <input name="apiKey" type="password" autocomplete="off" spellcheck="false" value="" placeholder="${escapeHtml(keyPlaceholder)}" ${disabled ? "disabled" : ""} />
        </label>
        <label>模型名
          <input name="model" required autocomplete="off" spellcheck="false" value="${escapeHtml(profile.model)}" placeholder="deepseek-chat" ${disabled ? "disabled" : ""} />
        </label>
      </div>
      <div class="model-profile-form-foot">
        <label class="model-profile-enabled"><input name="enabled" type="checkbox" ${profile.enabled ? "checked" : ""} ${disabled ? "disabled" : ""} /> 启用此槽位</label>
        <span>${profile.keyHint ? `已保存 · 尾号 ${escapeHtml(profile.keyHint)}` : "密钥未回显"}</span>
        <div class="model-settings-actions">
          <button type="button" data-model-test="${escapeHtml(profile.id)}" data-model-action-profile="${escapeHtml(profile.id)}" aria-label="测试 ${escapeHtml(modelProfileDisplayName(profile))} 连接" title="测试连接" ${disabled ? "disabled" : ""}>测试连接</button>
          <button type="submit" data-model-save ${disabled ? "disabled" : ""} data-model-action-profile="${escapeHtml(profile.id)}">保存槽位</button>
          <button type="button" data-model-cancel="${escapeHtml(profile.id)}" ${busy ? "disabled" : ""}>收起</button>
        </div>
      </div>
    </form>
  `;
}

function modelProfileRow(profile, supported) {
  const endpoint = modelProfileEndpoint(profile);
  const busy = state.modelSettings.busyProfileId === profile.id;
  const editing = state.modelSettings.activeProfileId === profile.id;
  const canDelete = supported && !busy && profile.source === "local-file";
  return `
    <article class="model-profile-row ${editing ? "editing" : ""}" data-model-profile="${escapeHtml(profile.id)}" role="row">
      <div class="model-profile-summary">
        <strong class="model-profile-name">${escapeHtml(modelProfileDisplayName(profile))}</strong>
        <span class="model-profile-endpoint" title="${escapeHtml(profile.apiUrl || "未设置接口")}"><b>${escapeHtml(endpoint.host)}</b><i>${escapeHtml(endpoint.path)}</i></span>
        <span class="model-profile-model">${escapeHtml(profile.model || "未设置模型")}</span>
        <span class="model-profile-family">${escapeHtml(profile.modelFamily || "未指定家族")}</span>
        <span class="model-profile-status ${profile.enabled && profile.configured ? "ready" : ""}">${escapeHtml(modelProfileStatus(profile))}</span>
        <span class="model-profile-actions">
          <button type="button" data-model-test="${escapeHtml(profile.id)}" data-model-action-profile="${escapeHtml(profile.id)}" aria-label="测试 ${escapeHtml(modelProfileDisplayName(profile))} 连接" title="测试连接" ${supported && profile.configured && !busy ? "" : "disabled"}>↯</button>
          <button type="button" data-model-edit="${escapeHtml(profile.id)}" aria-label="编辑 ${escapeHtml(modelProfileDisplayName(profile))}" title="编辑模型" ${supported && !busy ? "" : "disabled"}>✎</button>
          <button type="button" class="danger" data-model-delete="${escapeHtml(profile.id)}" data-model-action-profile="${escapeHtml(profile.id)}" aria-label="删除 ${escapeHtml(modelProfileDisplayName(profile))}" title="删除槽位" ${canDelete ? "" : "disabled"}>×</button>
        </span>
      </div>
      ${editing ? modelProfileForm(profile, supported) : ""}
    </article>
  `;
}

function setModelFieldOverride(fieldId, mode) {
  if (!schemaField(fieldId) || !["inherit", "loose", "standard", "strict", "manual"].includes(mode)) return false;
  const fieldOverrides = { ...(state.modelSettings.policy.fieldOverrides || {}) };
  if (mode === "inherit") delete fieldOverrides[fieldId];
  else if (mode === "manual") fieldOverrides[fieldId] = { manualOnly: true };
  else fieldOverrides[fieldId] = { policy: mode };
  state.modelSettings.policy = { ...state.modelSettings.policy, fieldOverrides };
  return true;
}

function modelFieldOverridesMarkup() {
  const entries = Object.entries(state.modelSettings.policy.fieldOverrides || {});
  const list = !entries.length
    ? `<p class="model-policy-empty">暂无字段风险覆盖；所有字段沿用项目默认档位。</p>`
    : `<div class="model-field-overrides">${entries.map(([fieldId, override]) => {
    const field = schemaField(fieldId);
    const label = field?.label || fieldId;
    const policy = override.manualOnly ? "必须人工确认" : ({ loose: "宽松", standard: "标准", strict: "严格" }[override.policy] || "沿用默认");
    return `<span data-field-override="${escapeHtml(fieldId)}"><strong>${escapeHtml(label)}</strong><i>${escapeHtml(policy)}</i><button type="button" data-model-override-remove="${escapeHtml(fieldId)}" aria-label="移除 ${escapeHtml(label)} 的风险覆盖" title="恢复默认策略">×</button></span>`;
  }).join("")}</div>`;
  const fields = orderedSchema();
  return `${list}
    <details class="model-policy-override-editor">
      <summary>编辑字段覆盖</summary>
      <div>
        <label>字段
          <select name="fieldOverrideId">
            ${fields.map((field) => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)} · ${escapeHtml(field.id)}</option>`).join("")}
          </select>
        </label>
        <label>字段策略
          <select name="fieldOverrideMode">
            <option value="inherit">沿用项目默认</option>
            <option value="loose">宽松</option>
            <option value="standard">标准</option>
            <option value="strict">严格</option>
            <option value="manual">必须人工确认</option>
          </select>
        </label>
        <button type="button" data-field-override-apply>应用覆盖</button>
      </div>
    </details>`;
}

function modelSettingsPanel() {
  const settings = state.modelSettings;
  const supported = settings.supported !== false;
  const profiles = MODEL_PROFILE_IDS.map((id) => settings.profiles.find((profile) => profile.id === id) || emptyModelProfile(id));
  const readyCount = profiles.filter((profile) => profile.configured && profile.enabled).length;
  const sourceLabel = modelSettingsSourceLabel(modelSettingsOverallSource());
  const message = settings.supported === false
    ? "当前部署不支持网页配置，请使用服务端环境变量。"
    : settings.message || (settings.configured ? `${readyCount} / 3 个模型可用 · ${sourceLabel}` : "逐个配置并测试三个模型槽位。");
  return `
    <section class="model-settings-panel" aria-label="模型连接">
      <div class="model-settings-heading">
        <div>
          <p class="kicker">Model Connection</p>
          <h3>多模型连接</h3>
        </div>
        <span class="model-config-state ${readyCount === 3 ? "ready" : ""}">${escapeHtml(`${readyCount} / 3 已启用`)}</span>
      </div>
      <div class="model-profile-scroll">
        <div class="model-profile-table" role="table" aria-label="三个模型配置槽位">
          <div class="model-profile-table-head" role="row">
            <span>名称</span><span>接口</span><span>模型</span><span class="model-profile-family">家族</span><span>状态</span><span>操作</span>
          </div>
          ${profiles.map((profile) => modelProfileRow(profile, supported)).join("")}
        </div>
      </div>
      <p class="model-settings-message ${settings.status === "error" ? "error" : ""}" data-model-message data-status="${escapeHtml(settings.status)}" aria-live="polite">${escapeHtml(message.trim())}</p>
      <form class="model-review-policy" id="modelPolicyForm">
        <div class="model-policy-heading">
          <div><p class="kicker">Consensus Policy</p><h4>项目共识策略</h4></div>
          <button type="submit" data-model-policy-save ${supported ? "" : "disabled"}>保存策略</button>
        </div>
        <div class="model-policy-controls">
          <label>项目审核模式
            <select name="reviewMode" ${supported ? "" : "disabled"}>
              <option value="assist" ${settings.policy.reviewMode === "assist" ? "selected" : ""}>A 辅助审核</option>
              <option value="auto" ${settings.policy.reviewMode === "auto" ? "selected" : ""}>B 自动审核</option>
            </select>
          </label>
          <label>默认共识档位
            <select name="defaultConsensus" ${supported ? "" : "disabled"}>
              <option value="loose" ${settings.policy.defaultConsensus === "loose" ? "selected" : ""}>宽松</option>
              <option value="standard" ${settings.policy.defaultConsensus === "standard" ? "selected" : ""}>标准</option>
              <option value="strict" ${settings.policy.defaultConsensus === "strict" ? "selected" : ""}>严格</option>
            </select>
          </label>
          <span class="model-family-lock" aria-label="自动审核固定要求至少两个模型家族">🔒 至少 2 个模型家族</span>
        </div>
        <div class="model-policy-overrides"><strong>字段风险覆盖</strong>${modelFieldOverridesMarkup()}</div>
      </form>
    </section>
  `;
}

function applyPublicModelConfig(payload, message = "") {
  const fallback = {
    configured: Boolean(payload?.configured),
    source: ["local-file", "environment"].includes(payload?.source) ? payload.source : "none"
  };
  const incoming = Array.isArray(payload?.profiles)
    ? payload.profiles
    : (payload?.apiUrl || payload?.model ? [{
        id: "primary",
        displayName: payload?.displayName || payload?.model,
        apiUrl: payload?.apiUrl,
        model: payload?.model,
        modelFamily: payload?.modelFamily,
        enabled: true,
        configured: payload?.configured,
        source: payload?.source,
        keyHint: payload?.keyHint,
        lastTestedAt: payload?.lastTestedAt,
        latencyMs: payload?.latencyMs,
        health: payload?.health
      }] : []);
  const profiles = MODEL_PROFILE_IDS.map((id) => {
    const profile = incoming.find((item) => item?.id === id);
    return profile ? normalizePublicModelProfile(profile, id, fallback) : emptyModelProfile(id);
  });
  const configured = profiles.some((profile) => profile.configured);
  const aiEnabled = profiles.some((profile) => profile.configured && profile.enabled);
  const consensusEnabled = profiles.every((profile) => profile.configured && profile.enabled);
  state.modelSettings = {
    ...state.modelSettings,
    status: "ready",
    supported: payload?.supported !== false,
    configured,
    profiles,
    policy: normalizeModelPolicy(payload?.policy),
    busyProfileId: "",
    message
  };
  state.cloud.config = { ...(state.cloud.config || { enabled: false }), aiEnabled, consensusEnabled };
}

function rerenderModelSettings() {
  render();
  if (state.view === "detail") loadSelectedSource();
}

function setModelSettingsMessage(status, message, profileId = "") {
  state.modelSettings.status = status;
  state.modelSettings.message = message;
  state.modelSettings.busyProfileId = ["testing", "saving", "deleting"].includes(status) ? profileId : "";
  const node = document.querySelector("[data-model-message]");
  if (node) {
    node.textContent = message;
    node.dataset.status = status;
    node.classList.toggle("error", status === "error");
  }
  document.querySelectorAll("[data-model-action-profile]").forEach((button) => {
    if (button.dataset.modelActionProfile === profileId) button.disabled = Boolean(state.modelSettings.busyProfileId);
  });
}

async function modelConfigResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `模型配置服务返回 ${response.status}`);
  return payload;
}

async function loadModelConfig() {
  state.modelSettings.status = "loading";
  state.modelSettings.message = "正在读取模型配置...";
  try {
    const response = await fetch("/api/model-config", { cache: "no-store" });
    if ([404, 405].includes(response.status)) {
      state.modelSettings = {
        ...state.modelSettings,
        status: "unsupported",
        supported: false,
        message: "当前部署不支持网页配置，请使用服务端环境变量。"
      };
    } else {
      applyPublicModelConfig(await modelConfigResponse(response));
    }
  } catch (error) {
    state.modelSettings = {
      ...state.modelSettings,
      status: "error",
      supported: state.modelSettings.supported,
      message: error?.message || "模型配置读取失败"
    };
  }
  rerenderModelSettings();
  return state.modelSettings.supported !== false;
}

function modelConfigPayload(form, profileId = "") {
  if (!form) {
    const profile = state.modelSettings.profiles.find((item) => item.id === profileId);
    return profile ? { ...publicModelProfilePayload(profile), apiKey: "" } : null;
  }
  const data = new FormData(form);
  return {
    id: String(data.get("id") || profileId || state.modelSettings.activeProfileId || "primary").trim(),
    displayName: String(data.get("displayName") || "").trim(),
    apiUrl: String(data.get("apiUrl") || "").trim(),
    apiKey: String(data.get("apiKey") || "").trim(),
    model: String(data.get("model") || "").trim(),
    modelFamily: String(data.get("modelFamily") || "").trim(),
    enabled: data.get("enabled") !== null
  };
}

function publicModelProfilePayload(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    apiUrl: profile.apiUrl,
    model: profile.model,
    modelFamily: profile.modelFamily,
    enabled: profile.enabled !== false
  };
}

function modelConfigBundle(changedProfile = null, policy = state.modelSettings.policy) {
  const baseProfiles = MODEL_PROFILE_IDS.map((id) => state.modelSettings.profiles.find((profile) => profile.id === id) || emptyModelProfile(id));
  const profiles = baseProfiles.map((profile) => profile.id === changedProfile?.id
    ? { ...publicModelProfilePayload(profile), ...changedProfile }
    : publicModelProfilePayload(profile));
  const selected = profiles.filter((profile) => profile.id === changedProfile?.id || profile.apiUrl || profile.model);
  return { version: 2, profiles: selected, policy: normalizeModelPolicy(policy) };
}

async function testModelConfig(form, profileId = "") {
  if (state.modelSettings.supported === false) return false;
  const payload = modelConfigPayload(form, profileId);
  if (!payload) return false;
  setModelSettingsMessage("testing", `正在测试 ${payload.displayName || MODEL_PROFILE_LABELS[payload.id] || payload.id}...`, payload.id);
  try {
    const response = await fetch("/api/model-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await modelConfigResponse(response);
    setModelSettingsMessage("success", `连接成功 · ${String(result.model || payload.model)} · ${Number(result.elapsedMs) || 0} ms`, payload.id);
    return true;
  } catch (error) {
    setModelSettingsMessage("error", error?.message || "模型连接测试失败", payload.id);
    return false;
  }
}

async function saveModelConfig(form) {
  if (!form || state.modelSettings.supported === false) return false;
  const payload = modelConfigPayload(form);
  setModelSettingsMessage("saving", `正在保存 ${payload.displayName || MODEL_PROFILE_LABELS[payload.id] || payload.id}...`, payload.id);
  try {
    const response = await fetch("/api/model-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modelConfigBundle(payload))
    });
    applyPublicModelConfig(await modelConfigResponse(response), "模型槽位已保存。");
    const keyInput = form.querySelector?.("[name='apiKey']");
    if (keyInput) keyInput.value = "";
    rerenderModelSettings();
    return true;
  } catch (error) {
    setModelSettingsMessage("error", error?.message || "模型配置保存失败", payload.id);
    return false;
  }
}

async function saveModelPolicy(form) {
  if (state.modelSettings.supported === false) return false;
  const data = form ? new FormData(form) : null;
  const policy = normalizeModelPolicy({
    ...state.modelSettings.policy,
    reviewMode: data?.get("reviewMode") || state.modelSettings.policy.reviewMode,
    defaultConsensus: data?.get("defaultConsensus") || state.modelSettings.policy.defaultConsensus
  });
  setModelSettingsMessage("saving", "正在保存项目共识策略...", "policy");
  try {
    const response = await fetch("/api/model-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modelConfigBundle(null, policy))
    });
    applyPublicModelConfig(await modelConfigResponse(response), "项目共识策略已保存。");
    rerenderModelSettings();
    return true;
  } catch (error) {
    setModelSettingsMessage("error", error?.message || "项目共识策略保存失败", "policy");
    return false;
  }
}

async function deleteModelConfig(profileId = state.modelSettings.activeProfileId) {
  const profile = state.modelSettings.profiles.find((item) => item.id === profileId);
  if (profile?.source !== "local-file" || !window.confirm(`删除「${modelProfileDisplayName(profile)}」槽位的本地配置？`)) return false;
  setModelSettingsMessage("deleting", `正在删除 ${modelProfileDisplayName(profile)}...`, profileId);
  try {
    const response = await fetch(`/api/model-config?id=${encodeURIComponent(profileId)}`, { method: "DELETE" });
    applyPublicModelConfig(await modelConfigResponse(response), "模型槽位已删除。");
    rerenderModelSettings();
    return true;
  } catch (error) {
    setModelSettingsMessage("error", error?.message || "模型配置删除失败", profileId);
    return false;
  }
}

function templateDetailsModal() {
  if (!state.templatePanelExpanded) return "";
  const current = templateById(state.schemaTemplateId);
  const visibleCount = orderedSchema({ includeHidden: false }).length;
  const totalCount = orderedSchema().length;
  const modelTab = state.settingsTab === "model";
  return `
    <div class="modal-backdrop template-backdrop" role="dialog" aria-modal="true" aria-label="项目设置">
      <section class="edit-modal template-modal">
        <div class="modal-head template-modal-head">
          <div>
            <h2>项目设置</h2>
            <p>${escapeHtml(modelTab ? "配置本地模型连接；密钥不会写入浏览器或工作区数据。" : current.description)}</p>
            <p>${escapeHtml(modelTab ? modelSettingsSourceLabel(modelSettingsOverallSource()) : `${current.custom ? "我的模板" : "内置模板"} · ${visibleCount} / ${totalCount} 字段显示`)}</p>
          </div>
          <button type="button" data-template-panel-close aria-label="关闭项目设置" title="关闭">×</button>
        </div>
        <div class="settings-tabs" role="tablist" aria-label="项目设置">
          <button type="button" role="tab" data-settings-tab="schema" aria-selected="${String(!modelTab)}">字段模板</button>
          <button type="button" role="tab" data-settings-tab="model" aria-selected="${String(modelTab)}">模型连接</button>
        </div>
        <div class="template-modal-body">
          ${modelTab ? modelSettingsPanel() : templateEditorContent()}
        </div>
      </section>
    </div>
  `;
}

function filterChips(rows) {
  const counts = Object.fromEntries(filters.map((filter) => [filter.id, 0]));
  rows.forEach((row) => {
    counts.all += 1;
    counts[row.bucket] = (counts[row.bucket] || 0) + 1;
    if (sourceNeedsReview(row)) counts.abnormal += 1;
    if (!rowValidation(row).ok) counts.invalid += 1;
    if (row.flagged) counts.flagged += 1;
    if (rowHasProblem(row)) counts.problem += 1;
    if (row.problemResolution?.status === "resolved") counts.resolved += 1;
  });
  return filters.map((filter) => `
    <button class="${state.filter === filter.id ? "active" : ""}" type="button" data-filter="${filter.id}">
      <span>${escapeHtml(filter.label)}</span>
      <small>${escapeHtml(filter.tone)} · ${counts[filter.id] || 0}</small>
    </button>
  `).join("");
}

function fieldQualityPanel() {
  const stats = fieldQualityStats();
  if (!stats.length) {
    return `<div class="empty-inline"><strong>暂无字段</strong><p>先选择或创建字段模板。</p></div>`;
  }
  return `
    <div class="field-quality-list">
      ${stats.map((item) => `
        <article class="${item.risk}">
          <div class="quality-head">
            <strong>${escapeHtml(item.field.label)}</strong>
            <span>${item.fillRate}%</span>
          </div>
          <div class="quality-bar"><i style="width:${item.fillRate}%"></i></div>
          <p>已填 ${item.filled} · 空 ${item.empty} · 缺必填 ${item.missingRequired} · 缺证据 ${item.missingEvidence}</p>
          <div class="quality-actions">
            <button type="button" data-quality-focus="${escapeHtml(item.field.id)}" data-quality-mode="empty" ${item.empty ? "" : "disabled"}>空值</button>
            <button type="button" data-quality-focus="${escapeHtml(item.field.id)}" data-quality-mode="evidence" ${item.missingEvidence ? "" : "disabled"}>缺证据</button>
            <button type="button" data-quality-focus="${escapeHtml(item.field.id)}" data-quality-mode="issue" ${item.empty || item.missingEvidence || item.missingRequired ? "" : "disabled"}>问题</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

const sourceQualityCache = new Map();

function sourceQuality(row) {
  const text = cachedSourceText(row.sourceFile)
    || (state.selectedId === row.id && state.sourceStatus === "ready" ? state.sourceText : "") || "";
  const quote = String(row.quote || "").trim();
  const signature = JSON.stringify([row.sourceFile, row.pageNo, quote]);
  const cached = sourceQualityCache.get(row.id);
  if (cached?.text === text && cached.signature === signature) return cached.quality;
  const factors = [
    { ok: Boolean(text), label: text ? "原文已读取" : row.sourceFile ? "仅有文件名，未读取原文" : "缺原文页" },
    { ok: Boolean(row.pageNo), label: row.pageNo ? "页码已记录" : "缺页码" }
  ];
  let rank = 0;
  let match = "unverified";
  if (text && quote.length >= 4) {
    const direct = text.indexOf(quote);
    const compactText = text.replace(/\s+/g, "");
    const compactQuote = quote.replace(/\s+/g, "");
    if (direct >= 0) {
      const unique = text.indexOf(quote, direct + 1) < 0;
      rank = unique && row.pageNo ? 3 : 2;
      match = "exact";
      factors.push({ ok: true, label: unique ? "完整摘录逐字命中" : "完整摘录多处命中" });
    } else if (compactQuote.length >= 4 && compactText.includes(compactQuote)) {
      rank = 2;
      match = "compact";
      factors.push({ ok: true, label: "去除空白后完整命中" });
    } else if (findApproxRange(text, quote)) {
      rank = 1;
      match = "partial";
      factors.push({ ok: false, label: "仅部分片段命中" });
    } else {
      match = "miss";
      factors.push({ ok: false, label: "摘录未在原文中定位" });
    }
  } else {
    factors.push({ ok: false, label: quote.length < 4 ? "摘录不足，待人工核对" : "尚未比对原文" });
  }
  const tone = ["risk", "low", "medium", "high"][rank];
  const label = ["待复核", "低", "中", "高"][rank];
  const quality = { rank, tone, label, factors, match };
  if (sourceQualityCache.size > 5000) sourceQualityCache.clear();
  sourceQualityCache.set(row.id, { text, signature, quality });
  return quality;
}

function confidencePill(row) {
  const quality = sourceQuality(row, false);
  return `<span class="confidence-chip ${quality.tone}" title="原文定位等级，不代表学术结论的准确率">${quality.label}</span>`;
}

function sourceNeedsReview(row) {
  return sourceQuality(row).rank < 2;
}

function confidenceSortLabel() {
  return state.confidenceSort === "desc" ? "高等级优先" : "低等级优先";
}

function sortRowsByConfidence(rows) {
  const direction = state.confidenceSort === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, quality: sourceQuality(row, false) }))
    .sort((a, b) => {
      const scoreDiff = (a.quality.rank - b.quality.rank) * direction;
      if (scoreDiff) return scoreDiff;
      return a.index - b.index;
    })
    .map((item) => item.row);
}

function validationBadge(row) {
  const validation = rowValidation(row);
  if (validation.ok) return `<span class="validation-badge ok">字段 OK</span>`;
  const label = validation.missingRequired.length
    ? `缺必填 ${validation.missingRequired.length}`
    : validation.missingEvidence.length
      ? `缺证据 ${validation.missingEvidence.length}`
      : "需复核";
  return `<span class="validation-badge ${validation.level}">${escapeHtml(label)}</span>`;
}

function reviewLabel(row) {
  if (row.problemResolution?.status === "resolved") return { label: "已解决", tone: "confirmed" };
  if (row.problemResolution?.status === "pending_review") return { label: "待复核", tone: "edited" };
  if (row.reviewed) return { label: "已确认", tone: "confirmed" };
  if (row.edited) return { label: "已修改", tone: "edited" };
  return { label: "未确认", tone: "pending" };
}

function reviewBadge(row) {
  const review = reviewLabel(row);
  return `<span class="review-badge ${review.tone}">${review.label}</span>`;
}

function rowActionButtons(row) {
  return `
    <div class="row-actions ${row.reviewed ? "is-reviewed" : ""} ${row.flagged ? "is-flagged" : ""}" aria-label="审校操作">
      <button type="button" class="review-action icon-action confirm" data-row-action="confirm-next" data-row-id="${escapeHtml(row.id)}" aria-pressed="${row.reviewed ? "true" : "false"}" aria-label="${row.reviewed ? "已确认，进入下一条" : "确认并进入下一条"}" title="${row.reviewed ? "已确认，进入下一条" : "确认并进入下一条"}">
        <span class="action-mark" aria-hidden="true">✓</span>
      </button>
      <button type="button" class="review-action icon-action flag" data-row-action="flag" data-row-id="${escapeHtml(row.id)}" aria-pressed="${row.flagged ? "true" : "false"}" aria-label="${row.flagged ? "取消人工标注" : "人工标注为有问题"}" title="${row.flagged ? "取消人工标注" : "人工标注为有问题"}">
        <span class="action-mark" aria-hidden="true">!</span>
      </button>
      <button type="button" class="review-action icon-action edit" data-row-action="edit" data-row-id="${escapeHtml(row.id)}" aria-label="修改字段" title="修改字段">
        <span class="action-mark" aria-hidden="true">改</span>
      </button>
      <button type="button" class="review-action icon-action danger" data-row-action="delete" data-row-id="${escapeHtml(row.id)}" aria-label="移除 ${escapeHtml(row.id)}" title="移除">
        <span class="action-mark" aria-hidden="true">×</span>
      </button>
    </div>
  `;
}

function reviewCell(row) {
  return `
    <div class="review-cell-inner">
      ${reviewBadge(row)}
      ${rowActionButtons(row)}
    </div>
  `;
}

function visibleTableFields() {
  if (state.detailMode === "review") {
    const preferred = ["issue", "quote", "pageNo", "sourceFile", "author", "scriptType"]
      .map((id) => schemaField(id))
      .filter(Boolean);
    return preferred.length ? preferred.slice(0, 6) : orderedSchema().slice(0, 6);
  }
  const fields = orderedSchema({ includeHidden: false });
  return fields.length ? fields.slice(0, 6) : orderedSchema().slice(0, 6);
}

function fieldColumnClass(field) {
  return `field-col field-${String(field?.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
}

function resultTable(rows) {
  if (!rows.length) {
    const readyQueue = state.qualityFocus?.mode === "dashboard" && state.qualityFocus.key === "ready";
    return `
      <div class="empty-state">
        <strong>${readyQueue ? "暂无可交付条目" : "没有匹配结果"}</strong>
        <p>${readyQueue ? `当前筛选 0 条 · 主表共 ${formatCount(state.rows.length)} 条` : "调整筛选或搜索词后再查看。"}</p>
      </div>
    `;
  }

  const tableFields = visibleTableFields();
  const selection = visibleBatchSelectionState(rows);
  const selectionLocked = Boolean(state.batchJob?.running);
  const batchMode = Boolean(state.batchMode);
  return `
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            ${batchMode ? `<th class="batch-select-col"><input type="checkbox" data-batch-select-visible aria-label="选择当前筛选条目" aria-checked="${selection.mixed ? "mixed" : String(selection.all)}" ${selection.all ? "checked" : ""} ${selectionLocked ? "disabled" : ""} /></th>` : ""}
            <th class="review-col">审校</th>
            <th>字段</th>
            <th>等级</th>
            <th>附表</th>
            ${tableFields.map((field) => `<th class="${fieldColumnClass(field)} ${field.type === "longtext" ? "longtext-col" : ""}">${escapeHtml(field.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => {
            const quality = sourceQuality(row, false);
            return `
            <tr class="${row.id === state.selectedId ? "selected" : ""} ${state.batchSelectedIds.has(row.id) ? "batch-selected" : ""} ${sourceNeedsReview(row) ? "abnormal" : ""} ${row.flagged ? "flagged" : ""} ${!rowValidation(row).ok ? "invalid" : ""} confidence-row confidence-${quality.tone}" data-row-id="${escapeHtml(row.id)}" style="--row-delay:${Math.min(index, 22) * 18}ms">
              ${batchMode ? `<td class="batch-select-col"><input type="checkbox" data-batch-select="${escapeHtml(row.id)}" aria-label="选择 ${escapeHtml(row.id)}" ${state.batchSelectedIds.has(row.id) ? "checked" : ""} ${selectionLocked ? "disabled" : ""} /><button type="button" class="row-open-control" data-row-open data-row-id="${escapeHtml(row.id)}" aria-label="查看 ${escapeHtml(row.id)}" title="查看条目">›</button></td>` : ""}
              <td class="review-cell">${reviewCell(row)}</td>
              <td>${validationBadge(row)}</td>
              <td>${confidencePill(row)}</td>
              <td><span class="appendix">${escapeHtml(row.appendixCode)}</span>${escapeHtml(row.status)}</td>
              ${tableFields.map((field, fieldIndex) => {
                const value = fieldValue(row, field.id);
                const isLongText = field.type === "longtext";
                const cell = isLongText ? clip(value, 72) : value;
                const rawContent = fieldIndex === 0
                  ? `<strong>${escapeHtml(cell || "未标注")}</strong><small>${escapeHtml(row.id)}</small>`
                  : escapeHtml(cell || "未标注");
                const content = isLongText ? `<span class="longtext-clip">${rawContent}</span>` : rawContent;
                return `<td class="${fieldColumnClass(field)} ${isLongText ? "longtext-cell" : ""}" title="${escapeHtml(value)}">${content}</td>`;
              }).join("")}
            </tr>
          `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function findApproxRange(content, needle) {
  const query = String(needle || "").trim();
  if (query.length < 2) return null;
  const direct = content.indexOf(query);
  if (direct >= 0) return [direct, direct + query.length];

  const compactQuery = query.replace(/\s+/g, "");
  if (compactQuery.length < 6) return null;

  let compactContent = "";
  const map = [];
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (!/\s/.test(char)) {
      compactContent += char;
      map.push(index);
    }
  }

  const fragments = [
    compactQuery,
    compactQuery.slice(0, Math.min(42, compactQuery.length)),
    compactQuery.slice(Math.max(0, compactQuery.length - 42))
  ].filter((fragment, index, list) => fragment.length >= 6 && list.indexOf(fragment) === index);

  for (const fragment of fragments) {
    const found = compactContent.indexOf(fragment);
    if (found >= 0) return [map[found], map[found + fragment.length - 1] + 1];
  }
  return null;
}

function highlightedSource(row) {
  if (state.sourceStatus === "loading") return "<p class='source-placeholder'>正在读取原文页...</p>";
  if (state.sourceStatus === "missing") return "<p class='source-placeholder'>这一行没有可访问的原文页。</p>";
  if (state.sourceStatus === "error") return "<p class='source-placeholder'>原文页读取失败。请同时上传对应 page_*.txt，或检查 source_file/page_no。</p>";
  if (!state.sourceText) return "<p class='source-placeholder'>选择一行结果查看原文。</p>";

  const range = findApproxRange(state.sourceText, row?.quote);
  if (!range) return `<pre>${escapeHtml(state.sourceText)}</pre>`;
  const [start, end] = range;
  const margin = 60;
  const contextStart = Math.max(0, start - margin);
  const contextEnd = Math.min(state.sourceText.length, end + margin);
  const prefix = contextStart > 0 ? "..." : "";
  const suffix = contextEnd < state.sourceText.length ? "..." : "";
  return `
    <pre>${escapeHtml(prefix + state.sourceText.slice(contextStart, start))}<mark>${escapeHtml(state.sourceText.slice(start, end))}</mark>${escapeHtml(state.sourceText.slice(end, contextEnd) + suffix)}</pre>
  `;
}

function detailCardContent(row) {
  const titleField = schemaField("author") || orderedSchema({ includeHidden: false })[0];
  const title = titleField ? fieldValue(row, titleField.id) : row.author;
  const quote = fieldValue(row, "quote") || row.quote;
  const reviewMode = state.detailMode === "review";
  return `
      <p class="kicker">Source Trace</p>
      <div class="detail-title-row">
        <h2>${escapeHtml(title || "未标注条目")}</h2>
        ${reviewBadge(row)}
      </div>
      <div class="detail-meta">
        <span>${escapeHtml(row.appendix || "未标注")}</span>
        <span>${escapeHtml(row.pageNo || "无页码")}</span>
        <span>${escapeHtml(row.sourceFile || "无原文文件")}</span>
      </div>
      ${reviewMode ? `<blockquote>${escapeHtml(quote || "无摘录")}</blockquote>${reviewControls(row)}` : ""}
      <dl>
        ${orderedSchema().map((field) => `
          <dt>${escapeHtml(field.label)}</dt>
          <dd>
            ${escapeHtml(fieldValue(row, field.id) || "未标注")}
            ${field.evidenceRequired ? "<small>需证据</small>" : ""}
          </dd>
        `).join("")}
        <dt>第三轮状态</dt><dd>${escapeHtml(row.triageStatus || row.status || "未标注")}</dd>
        <dt>操作建议</dt><dd>${escapeHtml(row.manualAdvice || row.recommendation || "未标注")}</dd>
        <dt>问题归因</dt><dd>${escapeHtml(row.issueReason || "未标注")}</dd>
        <dt>处理说明</dt><dd>${escapeHtml(row.handlingNote || "未标注")}</dd>
        <dt>命中</dt><dd>${escapeHtml(row.hit || "none")}</dd>
      </dl>
  `;
}

function reviewControls(row) {
  return `
    <div class="review-actions">
      <button type="button" class="nav-action" data-row-action="previous" data-row-id="${escapeHtml(row.id)}" aria-label="上一条" title="上一条">‹</button>
      <button type="button" class="primary-action" data-row-action="confirm-next" data-row-id="${escapeHtml(row.id)}" aria-label="${row.reviewed ? "已确认并进入下一条" : "确认并进入下一条"}" title="${row.reviewed ? "已确认并进入下一条" : "确认并进入下一条"}">
        <span aria-hidden="true">✓</span>
        <strong>${row.reviewed ? "下一条" : "确认并下一条"}</strong>
      </button>
      <button type="button" class="nav-action" data-row-action="next" data-row-id="${escapeHtml(row.id)}" aria-label="下一条" title="下一条">›</button>
      <button type="button" class="flag-action ${row.flagged ? "active" : ""}" data-row-action="flag" data-row-id="${escapeHtml(row.id)}" aria-pressed="${row.flagged ? "true" : "false"}" aria-label="${row.flagged ? "取消人工标注" : "人工标注为有问题"}" title="${row.flagged ? "取消人工标注" : "人工标注为有问题"}">!</button>
      <button type="button" class="icon-control ai-panel-trigger" data-ai-panel-open aria-expanded="${String(state.aiPanelOpen)}" aria-controls="aiEvidencePanel" aria-label="打开 AI 字段理由" title="打开 AI 字段理由">✦</button>
      <button type="button" class="secondary-action" data-row-action="edit" data-row-id="${escapeHtml(row.id)}" aria-label="修改字段" title="修改字段">改</button>
      <button type="button" class="danger icon-only" data-row-action="delete" data-row-id="${escapeHtml(row.id)}" aria-label="删除条目" title="删除条目">×</button>
    </div>
    ${problemTagControls(row)}
    ${problemStatusControls(row)}
  `;
}

function reviewFocusCard(row) {
  const quote = fieldValue(row, "quote") || row.quote;
  const issue = row.issueReason || fieldValue(row, "issue") || row.triageStatus || row.status || "待人工判断";
  const advice = row.manualAdvice || row.recommendation || "核对原文、页码、摘录和字段后确认。";
  const quality = sourceQuality(row, false);
  return `
    <section class="review-focus-card ${quality.tone}">
      <div class="review-focus-head">
        <div>
          <span>审核焦点</span>
          <h2>${escapeHtml(issue)}</h2>
        </div>
        ${confidencePill(row)}
      </div>
      <p class="review-focus-advice">${escapeHtml(advice)}</p>
      <blockquote>${escapeHtml(quote || "无摘录")}</blockquote>
      <div class="review-focus-meta">
        <span>${escapeHtml(row.sourceFile || "无原文文件")}</span>
        <span>${escapeHtml(row.pageNo || "无页码")}</span>
        <span>${quality.rank >= 2 ? "摘录已匹配" : "定位待核对"}</span>
      </div>
    </section>
  `;
}

function problemTagControls(row) {
  const tags = window.CalligraphySchema?.problemTags || [];
  if (!tags.length) return "";
  const current = normalizeProblemTags(row);
  return `
    <div class="problem-tags" aria-label="问题标签">
      ${tags.map((tag) => `
        <button type="button" class="${current.includes(tag.key) ? "active" : ""}" data-problem-tag="${escapeHtml(tag.key)}" data-row-id="${escapeHtml(row.id)}" title="${escapeHtml(tag.label)}">
          ${escapeHtml(tag.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function historyEventLabel(type) {
  return {
    "ai-draft": "AI 初稿",
    confirm: "人工确认",
    "ai-consensus-assist": "共识辅助",
    "ai-consensus-auto-approve": "共识自动判过",
    "ai-consensus-reverted": "已撤销共识判过",
    undo: "撤销"
  }[type] || "人工修订";
}

function consensusHistoryDetails(event) {
  const snapshot = event.consensusRun;
  if (!snapshot || typeof snapshot !== "object") return "";
  const fields = Object.entries(snapshot.fields || {});
  return `<details class="consensus-history-details">
    <summary>查看判定依据</summary>
    <div class="consensus-history-meta"><span>run ${escapeHtml(snapshot.runId || "-")}</span><span>快照 v${escapeHtml(snapshot.snapshotVersion || 1)}</span><span>${escapeHtml(snapshot.decision || "needs_human_review")}</span></div>
    ${snapshot.blockers?.length ? `<ul>${snapshot.blockers.map((item) => `<li>${escapeHtml(consensusBlockerLabel(item))}</li>`).join("")}</ul>` : ""}
    <dl>${fields.map(([fieldId, result]) => `<dt>${escapeHtml(schemaField(fieldId)?.label || fieldId)}</dt><dd>${escapeHtml(result.status || "blocked")} · ${escapeHtml(result.value || "空")} · ${escapeHtml(consensusEvidenceLabel(schemaField(fieldId), result))}</dd>`).join("")}</dl>
    <p>${(snapshot.models || []).map((item) => `${item.profile?.displayName || item.profileId || "模型"}：${item.status === "success" ? `${item.elapsedMs || 0} ms` : item.error || "失败"}`).map(escapeHtml).join(" · ")}</p>
  </details>`;
}

function historyPanel(row) {
  const history = normalizeHistory(row).slice().reverse();
  if (!history.length) {
    return `
      <section class="trace-card">
        <p class="kicker">Revision Trace</p>
        <h2>暂无回溯记录</h2>
      </section>
    `;
  }
  return `
    <section class="trace-card">
      <p class="kicker">Revision Trace</p>
      <h2>AI 初稿与人工修改</h2>
      <div class="trace-list">
        ${history.map((event) => `
          <article>
            <div class="trace-event-head">
              <strong>${escapeHtml(historyEventLabel(event.type))}</strong>
              <span>${escapeHtml(new Date(event.at).toLocaleString("zh-CN"))}</span>
            </div>
            <p>${escapeHtml(event.reason || "未填写说明")}</p>
            <small>actor: ${escapeHtml(event.actor || "human")} · prompt v${escapeHtml(event.promptVersion || state.promptVersion)} · model ${escapeHtml(event.modelVersion || "csv-import")}</small>
            ${(event.changes || []).length ? `
              <dl>
                ${(event.changes || []).map((change) => {
                  const field = schemaField(change.fieldId);
                  return `
                    <dt>${escapeHtml(field?.label || change.fieldId)}</dt>
                    <dd><b>原</b>${escapeHtml(clip(change.before, 48) || "空")} <b>新</b>${escapeHtml(clip(change.after, 48) || "空")}</dd>
                  `;
                }).join("")}
              </dl>
            ` : ""}
            ${consensusHistoryDetails(event)}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function detailCard(row) {
  return `
    <section class="detail-card">
      ${detailCardContent(row)}
    </section>
  `;
}

function validationPanel(row) {
  const validation = rowValidation(row);
  return `
    <section class="validation-card ${validation.level}">
      <div class="validation-head">
        <div>
          <p class="kicker">Field Audit</p>
          <h2>${validation.ok ? "字段完整" : "字段待补"}</h2>
        </div>
        ${validationBadge(row)}
      </div>
      ${validation.ok ? `
        <p>当前条目满足模板的必填字段和证据定位要求。</p>
      ` : `
        <ul>
          ${validation.issues.map((issue) => `<li>${escapeHtml(issue.label)}</li>`).join("")}
        </ul>
      `}
    </section>
  `;
}

function annotationPanel(row) {
  const annotations = normalizeAnnotations(row).slice().reverse();
  return `
    <section class="annotation-card">
      <div class="annotation-head">
        <div>
          <p class="kicker">Review Notes</p>
          <h2>结构化批注</h2>
        </div>
        <span>${annotations.length}</span>
      </div>
      ${annotations.length ? `
        <div class="annotation-list">
          ${annotations.map((annotation) => `
            <article>
              <div>
                <strong>${escapeHtml(annotationLabel(annotation.type))}</strong>
                <span>${escapeHtml(annotation.fieldLabel || annotation.fieldId || "整条记录")}</span>
              </div>
              <p>${escapeHtml(annotation.body || "")}</p>
              <small>${escapeHtml(new Date(annotation.at).toLocaleString("zh-CN"))}</small>
            </article>
          `).join("")}
        </div>
      ` : `<p class="annotation-empty">还没有人工批注。可在“修改字段”里添加。</p>`}
    </section>
  `;
}

function sourceCardContent(row) {
  const quality = sourceQuality(row, true);
  const quote = fieldValue(row, "quote") || row.quote;
  if (state.detailMode === "table") {
    const author = fieldValue(row, "author") || row.author || "未标注书家";
    const scriptType = fieldValue(row, "scriptType") || row.scriptType;
    return `
      <div class="master-evidence-head">
        <div>
          <span class="master-evidence-label">待审摘录</span>
          <h2>${escapeHtml(author)}${scriptType ? ` · ${escapeHtml(scriptType)}` : ""}</h2>
        </div>
        <div class="master-evidence-status">
          ${reviewBadge(row)}
          ${confidencePill(row)}
        </div>
      </div>
      <blockquote class="master-evidence-quote">${escapeHtml(quote || "无摘录")}</blockquote>
      <div class="master-evidence-meta">
        <span>${escapeHtml(row.sourceFile || "未关联原文")}</span>
        <span>${escapeHtml(row.pageNo || "无页码")}</span>
        <span>${quality.rank >= 2 ? "摘录已匹配" : "定位待核对"}</span>
      </div>
      <div class="master-source-label">
        <strong>原文上下文</strong>
        <span>${quality.rank >= 2 ? "高亮处为摘录位置" : "请核对摘录与原文"}</span>
      </div>
      <div class="master-source-context">${highlightedSource(row)}</div>
      <div class="master-evidence-factors">
        ${quality.factors.map((factor) => `<span class="${factor.ok ? "ok" : "warn"}">${escapeHtml(factor.label)}</span>`).join("")}
      </div>
      ${reviewControls(row)}
    `;
  }
  return `
      <div class="source-head">
        <div>
          <p class="kicker">Original Page</p>
          <h2>${escapeHtml(row.sourceFile || "未关联原文")}</h2>
        </div>
        <span>${sourceNeedsReview(row) ? "需复核" : "已定位"}</span>
      </div>
      <div class="confidence-panel ${quality.tone}">
        <div class="confidence-head">
          <strong>证据等级</strong>
          <span>${quality.label}</span>
        </div>
        <p class="confidence-rule">依据实际原文比对，仅表示定位可靠性。</p>
        <div class="confidence-factors">
          ${quality.factors.map((factor) => `<span class="${factor.ok ? "ok" : "warn"}">${escapeHtml(factor.label)}</span>`).join("")}
        </div>
      </div>
      ${highlightedSource(row)}
  `;
}

function sourceCard(row) {
  return `
    <section class="source-card ${state.detailMode === "table" ? "master-evidence-card" : ""}" aria-live="polite">
      ${sourceCardContent(row)}
    </section>
  `;
}

function defaultResearchQuery(row) {
  if (!row) return "";
  const titleField = schemaField("author") || orderedSchema({ includeHidden: false })[0];
  const author = titleField ? fieldValue(row, titleField.id) : row.author;
  const scriptType = fieldValue(row, "scriptType") || row.scriptType;
  const quote = fieldValue(row, "quote") || row.quote;
  return [author, scriptType, clip(quote, 22), "书论 书法"].filter(Boolean).join(" ");
}

function activeResearchQuery(row) {
  return state.researchRowId === row?.id ? state.researchQuery : defaultResearchQuery(row);
}

function fallbackSearchUrl(query) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

function researchCardContent(row) {
  const query = activeResearchQuery(row);
  const belongsToRow = state.researchRowId === row?.id;
  const status = belongsToRow ? state.researchStatus : "idle";
  const results = belongsToRow ? state.researchResults : [];
  const error = belongsToRow ? state.researchError : "";
  return `
    <div class="research-head">
      <div>
        <p class="kicker">Web Search</p>
        <h2>资料检索</h2>
      </div>
      <span>${status === "loading" ? "检索中" : results.length ? `${results.length} 条` : status === "ready" ? "未取得结果" : status === "error" ? "检索失败" : "待检索"}</span>
    </div>
    <form class="research-form" data-research-form>
      <input name="researchQuery" value="${escapeHtml(query)}" placeholder="输入书家、摘录、版本线索..." autocomplete="off" />
      <button type="submit" class="icon-control" aria-label="检索资料" title="检索资料">${status === "loading" ? "..." : "⌕"}</button>
    </form>
    <div class="research-presets">
      <button type="button" data-research-preset="author">书家</button>
      <button type="button" data-research-preset="quote">摘录</button>
      <button type="button" data-research-preset="balanced">综合</button>
    </div>
    <div class="research-results" aria-live="polite">
      ${status === "loading" ? `<p class="research-empty">正在联网检索...</p>` : ""}
      ${status === "error" ? `
        <div class="research-empty">
          <strong>检索暂不可用</strong>
          <span>${escapeHtml(error || "本地搜索代理没有返回结果。")}</span>
          <a href="${fallbackSearchUrl(query)}" target="_blank" rel="noreferrer">打开搜索页</a>
        </div>
      ` : ""}
      ${status === "idle" ? `<p class="research-empty">待检索</p>` : ""}
      ${status === "ready" && !results.length ? `<div class="research-empty"><strong>未取得检索结果</strong><a href="${fallbackSearchUrl(query)}" target="_blank" rel="noreferrer">打开搜索页</a></div>` : ""}
      ${results.map((item) => `
        <article class="research-result">
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
          <p>${escapeHtml(item.snippet || "无摘要")}</p>
          <small>${escapeHtml(item.url)}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function researchCard(row) {
  return `
    <section class="research-card">
      ${researchCardContent(row)}
    </section>
  `;
}

function resetAiForRow(row) {
  state.aiRequestId += 1;
  state.aiWorkspaceId = state.workspaceId;
  state.aiRowId = row?.id || "";
  state.aiStatus = "idle";
  state.aiProposal = null;
  state.aiError = "";
  state.aiInputSignature = "";
  state.aiFieldJudgments = {};
  state.aiRetryProfileId = "";
  state.aiRetryError = "";
  state.aiMobilePane = "fields";
}

function aiSourceForRow(row) {
  if (!row?.sourceFile) return "";
  if (row.id === state.selectedId && state.sourceText) return state.sourceText;
  return cachedSourceText(row.sourceFile) || "";
}

function aiInputSignature(row) {
  if (!row) return "";
  const schema = orderedSchema();
  return JSON.stringify({
    workspaceId: state.workspaceId,
    rowId: row.id,
    sourceText: aiSourceForRow(row),
    sourceFile: String(row.sourceFile || ""),
    pageNo: String(row.pageNo || ""),
    schemaTemplateId: state.schemaTemplateId,
    schemaVersion: state.schemaVersion,
    promptVersion: state.promptVersion,
    currentFields: Object.fromEntries(schema.map((field) => [field.id, String(fieldValue(row, field.id) || "")])),
    schema: schema.map(({ id, label, type, prompt, required, evidenceRequired, comparisonMode, visible, order }) => ({
      id, label, type, prompt, required, evidenceRequired, comparisonMode, visible, order
    }))
  });
}

function invalidateAiCandidate(row = selectedRow()) {
  const belongsToRow = row && state.aiRowId === row.id && state.aiWorkspaceId === state.workspaceId;
  if (!belongsToRow || !state.aiInputSignature || state.aiInputSignature === aiInputSignature(row)) return false;
  resetAiForRow(row);
  return true;
}

function isConsensusProposal(proposal = state.aiProposal) {
  return Boolean(proposal && typeof proposal.fields === "object" && Array.isArray(proposal.models) && proposal.runId);
}

function consensusRequestPayload(row, sourceText, options = {}) {
  return {
    runId: `run-${Date.now()}-${state.workspaceId}-${row.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80),
    workspaceId: state.workspaceId,
    rowId: row.id,
    sourceText,
    sourceFile: row.sourceFile,
    pageNo: row.pageNo,
    promptVersion: state.promptVersion,
    reviewMode: options.reviewMode || state.modelSettings.policy.reviewMode,
    defaultConsensus: state.modelSettings.policy.defaultConsensus,
    fieldOverrides: state.modelSettings.policy.fieldOverrides || {},
    aliases: state.modelSettings.policy.aliases || {},
    currentFields: Object.fromEntries(orderedSchema().map((field) => [field.id, String(fieldValue(row, field.id) || "")])),
    schema: orderedSchema().map(({ id, label, prompt, required, evidenceRequired, comparisonMode }) => ({
      id, label, prompt, required, evidenceRequired, comparisonMode,
      validationMode: ["pageNo", "sourceFile"].includes(id) ? "system" : "model"
    }))
  };
}

async function requestConsensusForRow(row, sourceText, options = {}) {
  const response = await fetch("./api/ai/consensus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(consensusRequestPayload(row, sourceText, options)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `模型服务返回 ${response.status}`);
  return window.CalligraphyAiConsensus.normalizeConsensusResponse(payload);
}

function initializeConsensusJudgments(consensus) {
  if (state.modelSettings.policy.reviewMode !== "assist") return {};
  return Object.fromEntries(window.CalligraphyAiConsensus.adoptableFieldIds(consensus)
    .filter((fieldId) => schemaField(fieldId)?.visible !== false)
    .map((fieldId) => [fieldId, "accept"]));
}

function aiPanelActionState(row) {
  const { status, proposal } = aiPresentation(row);
  const fields = proposal ? aiReviewedFields(row) : [];
  const decided = fields.filter((item) => item.judgment).length;
  const accepted = fields.filter((item) => item.judgment === "accept").length;
  const pending = Math.max(0, fields.length - decided);
  const reasonedFields = fields.filter((item) => !item.reasoning.missing && (!isConsensusProposal(proposal) || item.consensus?.status === "unanimous"));
  const autoQualified = isConsensusProposal(proposal)
    && proposal.decision === "auto_approve_record"
    && state.modelSettings.policy.reviewMode === "auto";
  return {
    canAcceptAll: status === "ready" && reasonedFields.some((item) => item.judgment !== "accept"),
    canClear: status !== "idle" || Boolean(proposal),
    canApply: status === "ready" && (autoQualified || decided > 0),
    applyLabel: autoQualified ? "执行自动判过" : pending ? `保存核验（待处理 ${pending}）` : `保存核验（认可 ${accepted}）`
  };
}

function updateAiPanelActionsDom(row = selectedRow()) {
  const panel = document.querySelector("#aiEvidencePanel");
  if (!panel) return false;
  const { canAcceptAll, canClear, canApply, applyLabel } = aiPanelActionState(row);
  const acceptAll = panel.querySelector("[data-ai-accept-all]");
  const clear = panel.querySelector("[data-ai-clear]");
  const apply = panel.querySelector("[data-ai-apply]");
  if (acceptAll) acceptAll.disabled = !canAcceptAll;
  if (clear) clear.disabled = !canClear;
  if (apply) {
    apply.disabled = !canApply;
    apply.textContent = applyLabel;
  }
  return Boolean(acceptAll || clear || apply);
}

function updateAiFieldJudgmentsDom(fieldIds) {
  const panel = document.querySelector("#aiEvidencePanel");
  if (!panel) return false;
  const allowed = new Set(fieldIds);
  const buttons = [...document.querySelectorAll("[data-ai-judgment]")]
    .filter((button) => allowed.has(button.dataset.fieldId));
  buttons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.aiJudgment === state.aiFieldJudgments[button.dataset.fieldId]));
  });
  const actionsUpdated = updateAiPanelActionsDom(selectedRow());
  return Boolean(buttons.length || actionsUpdated);
}

function updateAiFieldJudgmentDom(fieldId) {
  return updateAiFieldJudgmentsDom([fieldId]);
}

function setAiFieldJudgment(fieldId, judgment) {
  const allowedFields = new Set(orderedSchema().map((field) => field.id));
  const allowedJudgments = new Set(["accept", "reject", "uncertain"]);
  if (!allowedFields.has(fieldId) || !allowedJudgments.has(judgment)) return false;
  state.aiFieldJudgments = { ...state.aiFieldJudgments, [fieldId]: judgment };
  updateAiFieldJudgmentDom(fieldId);
  return true;
}

function acceptAllAiFieldJudgments(row = selectedRow()) {
  const belongsToCandidate = row
    && state.aiStatus === "ready"
    && state.aiProposal
    && state.aiRowId === row.id
    && state.aiWorkspaceId === state.workspaceId
    && state.aiInputSignature
    && state.aiInputSignature === aiInputSignature(row);
  if (!belongsToCandidate) return false;
  const eligible = aiReviewedFields(row).filter((item) => !item.reasoning.missing && (!isConsensusProposal() || item.consensus?.status === "unanimous"));
  if (!eligible.length || eligible.every((item) => state.aiFieldJudgments[item.field.id] === "accept")) return false;
  state.aiFieldJudgments = {
    ...state.aiFieldJudgments,
    ...Object.fromEntries(eligible.map((item) => [item.field.id, "accept"]))
  };
  updateAiFieldJudgmentsDom(eligible.map((item) => item.field.id));
  return true;
}

function aiReviewedFields(row) {
  if (isConsensusProposal()) return consensusReviewedFields(row);
  const proposals = state.aiProposal?.proposal?.fields || {};
  const reasoningByField = new Map((state.aiProposal?.proposal?.reasoning || []).map((item) => [item.fieldId, item]));
  return orderedSchema({ includeHidden: false }).map((field) => {
    const reasoning = reasoningByField.get(field.id) || {
      fieldId: field.id,
      decision: "abstain",
      reason: "模型未提供该字段的判断理由。",
      evidenceQuote: "",
      evidenceVerified: false,
      missing: true
    };
    const before = String(fieldValue(row, field.id) || "");
    const proposedAfter = Object.prototype.hasOwnProperty.call(proposals, field.id) ? String(proposals[field.id] || "") : before;
    const after = reasoning.decision === "change" ? proposedAfter : before;
    return { field, before, after, reasoning, judgment: state.aiFieldJudgments[field.id] || "" };
  });
}

function consensusReviewedFields(row) {
  const fields = state.aiProposal?.fields || {};
  return orderedSchema({ includeHidden: false }).map((field) => {
    const consensus = fields[field.id] || { status: "blocked", value: "", votes: [], verifiedEvidence: 0, policy: "standard" };
    const before = String(fieldValue(row, field.id) || "");
    const after = String(consensus.value || before);
    const voteCount = Math.max(0, ...Object.values((consensus.votes || []).reduce((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {})));
    const reasoning = {
      fieldId: field.id,
      decision: consensus.status === "unanimous" ? (before === after ? "keep" : "change") : "abstain",
      reason: consensus.status === "unanimous"
        ? `三个模型在${consensus.policy || "standard"}策略下形成一致结论。`
        : consensus.status === "split" ? "模型结果存在分歧，不能自动采纳。" : "该字段未通过共识规则。",
      evidenceQuote: "",
      evidenceVerified: Number(consensus.verifiedEvidence) > 0,
      missing: false
    };
    return { field, before, after, reasoning, judgment: state.aiFieldJudgments[field.id] || "", consensus, voteCount };
  });
}

function aiPresentation(row) {
  const configured = Boolean(state.cloud.config?.aiEnabled);
  const belongsToRow = state.aiRowId === row?.id && state.aiWorkspaceId === state.workspaceId;
  const status = belongsToRow ? state.aiStatus : "idle";
  const proposal = belongsToRow ? state.aiProposal : null;
  const error = belongsToRow ? state.aiError : "";
  const reviewedFields = proposal ? aiReviewedFields(row) : [];
  const evidence = Array.isArray(proposal?.proposal?.evidence) ? proposal.proposal.evidence : [];
  const abstentions = Array.isArray(proposal?.proposal?.abstentions) ? proposal.proposal.abstentions : [];
  const sourceReady = Boolean(aiSourceForRow(row));
  const statusLabel = !configured ? "未配置" : status === "loading" ? "生成中" : status === "ready" ? (isConsensusProposal(proposal) ? "共识待核" : "待核验") : status === "applied" ? "已保存" : status === "error" ? "失败" : "就绪";
  return { configured, status, proposal, error, reviewedFields, evidence, abstentions, sourceReady, statusLabel };
}

function aiFieldReviewCard(item) {
  const { field, before, after, reasoning, judgment } = item;
  const evidenceState = reasoning.evidenceQuote ? (reasoning.evidenceVerified ? "证据充分" : "需人工判断") : "无证据";
  const evidenceClass = reasoning.evidenceQuote && reasoning.evidenceVerified ? "verified" : reasoning.evidenceQuote ? "unverified" : "missing";
  const suggestion = reasoning.decision === "keep" ? "建议保留" : reasoning.decision === "change" ? (after || "空") : "模型弃答";
  const labels = { accept: "认可", reject: "驳回", uncertain: "存疑" };
  const symbols = { accept: "✓", reject: "×", uncertain: "?" };
  return `
    <article class="ai-field-review">
      <div class="ai-field-head"><strong>${escapeHtml(field.label)}</strong><span class="${evidenceClass}">${evidenceState}</span></div>
      <dl class="ai-field-values">
        <dt>当前</dt><dd>${escapeHtml(before || "空")}</dd>
        <dt>建议</dt><dd>${escapeHtml(suggestion)}</dd>
      </dl>
      <p class="ai-field-reason"><strong>判断理由</strong>${escapeHtml(reasoning.reason)}</p>
      <p class="ai-field-evidence"><strong>原文证据</strong><span class="${evidenceClass}">${reasoning.evidenceQuote ? (reasoning.evidenceVerified ? "原文命中" : "待人工核对") : "未提供"}</span>${reasoning.evidenceQuote ? `<q>${escapeHtml(reasoning.evidenceQuote)}</q>` : "未提供原文证据"}</p>
      <div class="ai-judgment" role="group" aria-label="${escapeHtml(field.label)}人工裁定">
        ${["accept", "reject", "uncertain"].map((value) => `<button type="button" data-ai-judgment="${value}" data-field-id="${escapeHtml(field.id)}" aria-pressed="${String(judgment === value)}" aria-label="${labels[value]}${escapeHtml(field.label)}建议" title="${labels[value]}${escapeHtml(field.label)}建议">${symbols[value]}</button>`).join("")}
      </div>
    </article>
  `;
}

function consensusStatusLabel(item) {
  if (item.consensus.validationSource === "system") {
    return item.consensus.status === "unanimous" ? "程序通过" : "程序异常";
  }
  if (item.consensus.status === "unanimous") return "已通过";
  if (item.consensus.blocking === false) return "仅供参考";
  if (item.consensus.status === "split") return "有分歧";
  return {
    abstention: "有弃答",
    insufficient_evidence: "证据不足",
    model_count: "结果不全",
    missing_value: "无有效值",
    disagreement: "有分歧"
  }[item.consensus.reason] || "未通过";
}

function consensusPolicyLabel(policy) {
  return { loose: "宽松", standard: "标准", strict: "严格" }[policy] || "标准";
}

function consensusEvidenceLabel(field, consensus) {
  const required = consensus?.evidenceRequired ?? Boolean(field?.evidenceRequired);
  const verified = Number(consensus?.verifiedEvidence) || 0;
  if (!required) return "证据非必需";
  if (consensus?.policy === "strict") return `证据 ${verified}/3`;
  if (verified > 0) return "证据已核验";
  if (consensus?.policy === "loose") return "证据可选";
  return "证据未核验";
}

function consensusBlockerLabel(blocker, fields = state.aiProposal?.fields || {}) {
  const value = String(blocker || "");
  const labels = {
    model_count: "未获得三个完整模型结果",
    model_failure: "至少一个模型请求失败",
    model_family_diversity: "模型家族不足两个"
  };
  if (labels[value]) return labels[value];
  const [fieldId, reason] = value.split(":");
  const fieldLabel = schemaField(fieldId)?.label || fieldId;
  const fieldResult = fields[fieldId] || {};
  const blockedReason = {
    abstention: `有 ${Number(fieldResult.abstentionCount) || 1} 个模型弃答`,
    insufficient_evidence: "未找到可核验的原文证据",
    model_count: "模型结果不完整",
    missing_value: "没有有效建议",
    disagreement: "模型结果分歧",
    system_mismatch: "系统记录不一致",
    rule_failure: "未通过规则"
  }[fieldResult.reason] || "未通过规则";
  const reasonLabel = { manual_only: "必须人工确认", split: "结果分歧", blocked: blockedReason }[reason] || reason || "已阻断";
  return `${fieldLabel}：${reasonLabel}`;
}

function consensusFieldCard(item) {
  const { field, before, after, judgment, consensus } = item;
  const labels = { accept: "采纳", reject: "驳回", uncertain: "存疑" };
  const symbols = { accept: "✓", reject: "×", uncertain: "?" };
  const statusClass = consensus.status === "unanimous" ? "unanimous" : consensus.status === "split" ? "split" : "blocked";
  return `
    <article class="ai-consensus-field ${statusClass}">
      <div class="ai-field-head">
        <strong>${escapeHtml(field.label)}</strong>
        <span class="ai-consensus-vote ${statusClass}">${consensusStatusLabel(item)}</span>
      </div>
      <dl class="ai-field-values">
        <dt>当前</dt><dd>${escapeHtml(before || "空")}</dd>
        <dt>建议</dt><dd>${escapeHtml(after || "空")}</dd>
      </dl>
      <div class="ai-consensus-field-meta">
        ${consensus.validationSource === "system" ? `<span>程序校验</span>` : `
          <span>投票 ${Number(consensus.voteCount) || item.voteCount || 0}/3</span>
          ${Number(consensus.abstentionCount) ? `<span>弃答 ${Number(consensus.abstentionCount)}/3</span>` : ""}
          <span>${escapeHtml(consensusEvidenceLabel(field, consensus))}</span>
          <span>${consensusPolicyLabel(consensus.policy)}策略</span>
        `}
      </div>
      <div class="ai-judgment" role="group" aria-label="${escapeHtml(field.label)}人工裁定">
        ${["accept", "reject", "uncertain"].map((value) => `<button type="button" data-ai-judgment="${value}" data-field-id="${escapeHtml(field.id)}" aria-pressed="${String(judgment === value)}" aria-label="${labels[value]}${escapeHtml(field.label)}建议" title="${labels[value]}${escapeHtml(field.label)}建议" ${value === "accept" && consensus.status !== "unanimous" ? "disabled" : ""}>${symbols[value]}</button>`).join("")}
      </div>
    </article>
  `;
}

function modelReasoningMarkup(model) {
  if (model.status !== "success" || !model.proposal) {
    return `<p class="ai-model-error">${escapeHtml(model.error || "模型返回异常")}</p>`;
  }
  const evidenceByField = new Map((Array.isArray(model.proposal.evidence) ? model.proposal.evidence : [])
    .map((item) => [item.fieldId, item]));
  const reasoning = Array.isArray(model.proposal.reasoning) ? model.proposal.reasoning : [];
  const answerSources = model.proposal.answerSources && typeof model.proposal.answerSources === "object"
    ? model.proposal.answerSources : {};
  if (!reasoning.length) return `<p class="ai-model-empty">模型未提供字段理由。</p>`;
  return `<div class="ai-model-reasoning">${reasoning.map((item) => {
    const evidence = evidenceByField.get(item.fieldId) || {};
    const quote = item.evidenceQuote || evidence.quote || "";
    const verified = Boolean(item.evidenceVerified || evidence.verified);
    const location = evidence.location && typeof evidence.location === "object"
      ? Object.values(evidence.location).filter(Boolean).join(" · ") : "";
    const repairLabel = answerSources[item.fieldId] === "repair" ? `<small class="ai-repair-label">补答</small>` : "";
    return `<article><strong>${escapeHtml(schemaField(item.fieldId)?.label || item.fieldId)}</strong>${repairLabel}<p>${escapeHtml(item.reason || "未提供理由")}</p>${quote ? `<blockquote>${escapeHtml(quote)}</blockquote><small class="${verified ? "verified" : "unverified"}">${verified ? "原文命中" : "未命中"}${location ? ` · ${escapeHtml(location)}` : ""}</small>` : `<small class="missing">未提供证据</small>`}</article>`;
  }).join("")}</div>`;
}

function consensusModelDetails(consensus) {
  return `<section class="ai-model-list" aria-label="三模型详情">${consensus.models.map((model) => {
    const retrying = state.aiRetryProfileId === model.profileId;
    return `<details class="ai-model-details">
      <summary>
        <span><strong>${escapeHtml(model.profile.displayName || model.profileId)}</strong><small>${escapeHtml(model.profile.model || "未记录模型")} · ${escapeHtml(model.profile.modelFamily || "未知家族")}</small></span>
        <span class="ai-model-summary-status ${model.status}">${model.status === "success" ? `${model.elapsedMs || 0} ms` : "失败"}</span>
        <button type="button" class="icon-control" data-ai-retry-profile="${escapeHtml(model.profileId)}" ${retrying ? "disabled" : ""} aria-label="重试${escapeHtml(model.profile.displayName || model.profileId)}" title="仅重试该模型">${retrying ? "…" : "↻"}</button>
      </summary>
      ${modelReasoningMarkup(model)}
    </details>`;
  }).join("")}</section>`;
}

function consensusSuggestionContent(row, proposal, reviewedFields) {
  const successful = proposal.models.filter((item) => item.status === "success").length;
  const manual = reviewedFields.filter((item) => item.consensus.blocking !== false && item.consensus.status !== "unanimous").length;
  const mode = state.modelSettings.policy.reviewMode === "auto" ? "B 自动审核" : "A 辅助审核";
  return `
    <div class="ai-consensus-summary">
      <div><span>审核模式</span><strong>${mode}</strong></div>
      <div><span>共识档位</span><strong>${consensusPolicyLabel(state.modelSettings.policy.defaultConsensus)}</strong></div>
      <div><span>在线模型</span><strong>${successful}/3</strong></div>
      <div><span>需人工</span><strong>${manual}</strong></div>
    </div>
    <div class="ai-run-meta"><span>run ${escapeHtml(proposal.runId)}</span><span>快照 v${escapeHtml(proposal.snapshotVersion || 1)}</span></div>
    <div class="ai-consensus-fields">${reviewedFields.map(consensusFieldCard).join("")}</div>
    ${proposal.blockers.length ? `<section class="ai-consensus-blockers"><strong>判定阻断</strong><ul>${proposal.blockers.map((item) => `<li>${escapeHtml(consensusBlockerLabel(item, proposal.fields))}</li>`).join("")}</ul></section>` : `<p class="ai-consensus-pass">所有字段已满足当前共识规则。</p>`}
    ${state.aiRetryError ? `<p class="ai-retry-error" role="alert">${escapeHtml(state.aiRetryError)}</p>` : ""}
    ${consensusModelDetails(proposal)}
  `;
}

function aiSuggestionContent(row) {
  const { configured, status, proposal, error, reviewedFields, abstentions, sourceReady } = aiPresentation(row);
  return `
    <section class="ai-suggestion-content ${status}" aria-live="polite" aria-busy="${String(status === "loading")}">
      ${status === "ready" && proposal ? `
        ${isConsensusProposal(proposal) ? consensusSuggestionContent(row, proposal, reviewedFields) : `
          <div class="ai-run-meta"><span>${escapeHtml(proposal.meta?.model || "未记录模型")}</span><span>提示词 v${escapeHtml(proposal.meta?.promptVersion || state.promptVersion)}</span></div>
          <div class="ai-field-list">${reviewedFields.map(aiFieldReviewCard).join("")}</div>
          ${abstentions.length ? `<details class="ai-abstentions"><summary>弃答 ${abstentions.length} 项</summary><ul>${abstentions.map((item) => `<li><strong>${escapeHtml(schemaField(item.fieldId)?.label || item.fieldId)}</strong>${escapeHtml(item.reason)}</li>`).join("")}</ul></details>` : ""}
        `}
      ` : !configured ? `
        <div class="ai-empty"><p>模型服务尚未配置，人工审校功能不受影响。</p></div>
      ` : status === "loading" ? `
        <div class="ai-empty"><p>正在依据当前原文和字段规则生成候选。</p></div>
      ` : status === "error" ? `
        <div class="ai-empty error"><p>${escapeHtml(error || "模型调用失败")}</p></div>
      ` : status === "applied" ? `
        <div class="ai-empty success"><p>${isConsensusProposal(proposal) && proposal.decision === "auto_approve_record" ? "共识结果已自动判过，可从历史中查看依据并撤销。" : "建议已作为人工采纳记录写入，本条仍需确认。"}</p></div>
      ` : `
        <div class="ai-empty"><p>${sourceReady ? "基于当前原文生成结构化候选，不会自动覆盖主表。" : state.sourceStatus === "loading" ? "正在读取原文..." : "当前条目没有可供模型分析的原文。"}</p></div>
      `}
    </section>
  `;
}

function aiPanelActions(row) {
  const { canAcceptAll, canClear, canApply, applyLabel } = aiPanelActionState(row);
  return `
    <button type="button" class="icon-control" data-ai-accept-all ${canAcceptAll ? "" : "disabled"} aria-label="认可全部 AI 建议" title="认可全部 AI 建议">✓✓</button>
    <button type="button" data-ai-clear ${canClear ? "" : "disabled"}>清除</button>
    <button type="button" data-ai-apply ${canApply ? "" : "disabled"}>${applyLabel}</button>
  `;
}

function aiReviewPanel(row) {
  if (!state.aiPanelOpen || !row) return "";
  const { configured, status, sourceReady, statusLabel } = aiPresentation(row);
  const title = `${fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目"} · ${row.id}`;
  const canGenerate = configured && sourceReady && status !== "loading";
  const consensusEnabled = Boolean(state.cloud.config?.consensusEnabled);
  const generateLabel = status === "idle"
    ? (consensusEnabled ? "生成三模型共识" : "生成 AI 理由")
    : (consensusEnabled ? "重新生成三模型共识" : "重新生成 AI 理由");
  return `
    <aside id="aiEvidencePanel" class="ai-review-panel ${status}" aria-labelledby="aiPanelTitle" data-row-id="${escapeHtml(row.id)}">
      <header class="ai-panel-head">
        <div><p class="kicker">AI Evidence</p><h2 id="aiPanelTitle" tabindex="-1">${escapeHtml(title)}</h2></div>
        <span class="ai-panel-status">${escapeHtml(statusLabel)}</span>
        <button type="button" class="icon-control" data-ai-generate ${canGenerate ? "" : "disabled"} aria-label="${generateLabel}" title="${generateLabel}">${status === "idle" ? "✦" : "↻"}</button>
        <button type="button" class="icon-control" data-ai-panel-close aria-label="关闭 AI 字段理由" title="关闭 AI 字段理由">×</button>
      </header>
      <div class="ai-panel-scroll">${aiSuggestionContent(row)}</div>
      <footer class="ai-panel-actions">${aiPanelActions(row)}</footer>
    </aside>
  `;
}

function renderAiPanel(row = selectedRow(), { focus = false } = {}) {
  const panel = document.querySelector("#aiEvidencePanel");
  const markup = aiReviewPanel(row);
  if (!markup) {
    panel?.remove();
    return;
  }
  if (panel) panel.outerHTML = markup;
  else document.querySelector(".review-screen")?.insertAdjacentHTML("beforeend", markup);
  if (focus) document.querySelector("#aiPanelTitle")?.focus({ preventScroll: true });
}

function openAiPanel(trigger) {
  const row = selectedRow();
  if (!row) return false;
  if (state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId) resetAiForRow(row);
  aiPanelTrigger = trigger || document.activeElement || null;
  if (!state.aiPanelOpen) {
    state.aiRailWasCollapsed = state.railCollapsed;
    state.aiDetailWasCollapsed = state.detailCollapsed;
    state.aiTableFocusWasActive = state.tableFocus;
  }
  state.aiPanelOpen = true;
  state.railCollapsed = true;
  state.detailCollapsed = false;
  state.tableFocus = false;
  aiPanelTrigger?.setAttribute?.("aria-expanded", "true");
  renderDetail();
  document.querySelector("#aiPanelTitle")?.focus({ preventScroll: true });
  return true;
}

function closeAiPanel({ restoreFocus = true } = {}) {
  if (!state.aiPanelOpen) return false;
  state.aiPanelOpen = false;
  if (state.aiRailWasCollapsed !== null) state.railCollapsed = state.aiRailWasCollapsed;
  if (state.aiDetailWasCollapsed !== null) state.detailCollapsed = state.aiDetailWasCollapsed;
  if (state.aiTableFocusWasActive !== null) state.tableFocus = state.aiTableFocusWasActive;
  state.aiRailWasCollapsed = null;
  state.aiDetailWasCollapsed = null;
  state.aiTableFocusWasActive = null;
  aiPanelTrigger = null;
  renderDetail();
  const trigger = document.querySelector("[data-ai-panel-open]");
  trigger?.setAttribute?.("aria-expanded", "false");
  if (restoreFocus) trigger?.focus({ preventScroll: true });
  return true;
}

function updateAiDom(row = selectedRow()) {
  invalidateAiCandidate(row);
  if (!state.aiPanelOpen) return;
  renderAiPanel(row);
}

function setAiMobilePane(pane) {
  if (!state.aiPanelOpen || !["fields", "reasoning"].includes(pane)) return false;
  state.aiMobilePane = pane;
  render();
  return true;
}

function normalizedAiResponse(payload) {
  const fields = payload?.proposal?.fields && typeof payload.proposal.fields === "object" ? payload.proposal.fields : {};
  const allowed = new Set(orderedSchema().map((field) => field.id));
  const decisions = new Set(["keep", "change", "abstain"]);
  const reasoning = Array.isArray(payload?.proposal?.reasoning)
    ? payload.proposal.reasoning.flatMap((item) => {
        const fieldId = String(item?.fieldId || "");
        const decision = String(item?.decision || "");
        const reason = String(item?.reason || "").trim().slice(0, 800);
        const evidenceQuote = String(item?.evidenceQuote || "").trim().slice(0, 500);
        if (!allowed.has(fieldId) || !decisions.has(decision) || !reason) return [];
        return [{ fieldId, decision, reason, evidenceQuote, evidenceVerified: Boolean(item?.evidenceVerified) }];
      }).slice(0, 30)
    : [];
  return {
    proposal: {
      fields: Object.fromEntries(Object.entries(fields).filter(([fieldId, value]) => allowed.has(fieldId) && typeof value === "string")),
      evidence: Array.isArray(payload?.proposal?.evidence) ? payload.proposal.evidence.filter((item) => allowed.has(item?.fieldId)).slice(0, 60) : [],
      reasoning,
      abstentions: Array.isArray(payload?.proposal?.abstentions) ? payload.proposal.abstentions.filter((item) => allowed.has(item?.fieldId)).slice(0, 30) : []
    },
    meta: {
      model: String(payload?.meta?.model || "unrecorded"),
      promptVersion: Number(payload?.meta?.promptVersion) || state.promptVersion,
      generatedAt: String(payload?.meta?.generatedAt || new Date().toISOString())
    }
  };
}

async function performAiExtraction(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || !state.cloud.config?.aiEnabled) return false;
  const sourceText = aiSourceForRow(row);
  if (!sourceText) {
    state.aiStatus = "error";
    state.aiError = "当前条目没有可用原文";
    updateAiDom(row);
    return false;
  }
  const requestId = state.aiRequestId + 1;
  const workspaceId = state.workspaceId;
  const inputSignature = aiInputSignature(row);
  state.aiRequestId = requestId;
  state.aiWorkspaceId = workspaceId;
  state.aiRowId = row.id;
  state.aiStatus = "loading";
  state.aiProposal = null;
  state.aiError = "";
  state.aiInputSignature = inputSignature;
  state.aiFieldJudgments = {};
  state.aiRetryProfileId = "";
  state.aiRetryError = "";
  updateAiDom(row);
  const isCurrent = () => requestId === state.aiRequestId
    && workspaceId === state.workspaceId
    && state.aiWorkspaceId === workspaceId
    && state.selectedId === row.id
    && state.aiInputSignature === inputSignature
    && aiInputSignature(row) === inputSignature;
  const discardChangedInputs = () => {
    if (requestId !== state.aiRequestId || workspaceId !== state.workspaceId || state.selectedId !== row.id || state.aiInputSignature !== inputSignature) return;
    if (aiInputSignature(row) !== inputSignature) {
      resetAiForRow(row);
      updateAiDom(row);
    }
  };
  try {
    const consensusEnabled = Boolean(state.cloud.config?.consensusEnabled);
    const requestPayload = consensusEnabled ? null : {
      workspaceId: state.workspaceId,
      rowId: row.id,
      sourceText,
      sourceFile: row.sourceFile,
      pageNo: row.pageNo,
      promptVersion: state.promptVersion,
      currentFields: Object.fromEntries(orderedSchema().map((field) => [field.id, String(fieldValue(row, field.id) || "")])),
      schema: orderedSchema().map(({ id, label, prompt, required, evidenceRequired }) => ({
        id, label, prompt, required, evidenceRequired,
        validationMode: ["pageNo", "sourceFile"].includes(id) ? "system" : "model"
      }))
    };
    let payload;
    if (consensusEnabled) {
      payload = await requestConsensusForRow(row, sourceText);
    } else {
      const response = await fetch("./api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `模型服务返回 ${response.status}`);
    }
    if (!isCurrent()) {
      discardChangedInputs();
      return false;
    }
    state.aiProposal = consensusEnabled ? payload : normalizedAiResponse(payload);
    state.aiFieldJudgments = consensusEnabled ? initializeConsensusJudgments(state.aiProposal) : {};
    state.aiStatus = "ready";
    if (consensusEnabled && state.aiProposal.decision === "auto_approve_record" && state.modelSettings.policy.reviewMode === "auto") {
      return applyConsensusDecision(row.id);
    }
    updateAiDom(row);
    return true;
  } catch (error) {
    if (!isCurrent()) {
      discardChangedInputs();
      return false;
    }
    state.aiStatus = "error";
    state.aiError = error?.message || "模型调用失败";
    updateAiDom(row);
    return false;
  }
}

async function retryConsensusModel(profileId, row = selectedRow()) {
  if (!row || !isConsensusProposal() || state.aiStatus !== "ready" || state.aiRetryProfileId) return false;
  if (state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId || state.aiInputSignature !== aiInputSignature(row)) return false;
  if (!state.aiProposal.models.some((item) => item.profileId === profileId)) return false;
  const runId = state.aiProposal.runId;
  const requestId = state.aiRequestId;
  const signature = state.aiInputSignature;
  state.aiRetryProfileId = profileId;
  state.aiRetryError = "";
  updateAiDom(row);
  try {
    const response = await fetch(`./api/ai/consensus/${encodeURIComponent(runId)}/retry/${encodeURIComponent(profileId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `模型服务返回 ${response.status}`);
    if (requestId !== state.aiRequestId || state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId || signature !== state.aiInputSignature || signature !== aiInputSignature(row)) return false;
    state.aiProposal = window.CalligraphyAiConsensus.normalizeConsensusResponse(payload);
    state.aiFieldJudgments = initializeConsensusJudgments(state.aiProposal);
    state.aiRetryProfileId = "";
    state.aiRetryError = "";
    if (state.aiProposal.decision === "auto_approve_record" && state.modelSettings.policy.reviewMode === "auto") {
      return applyConsensusDecision(row.id);
    }
    updateAiDom(row);
    return true;
  } catch (error) {
    if (requestId !== state.aiRequestId || state.aiRowId !== row.id || signature !== state.aiInputSignature) return false;
    state.aiRetryProfileId = "";
    state.aiRetryError = error?.message || "单模型重试失败";
    updateAiDom(row);
    return false;
  }
}

function clearAiProposal(row = selectedRow()) {
  if (!row) return;
  resetAiForRow(row);
  updateAiDom(row);
}

function applyUnanimousConsensusFields(row, consensus, acceptedFieldIds = null) {
  const accepted = acceptedFieldIds ? new Set(acceptedFieldIds) : null;
  const changes = [];
  for (const [fieldId, result] of Object.entries(consensus?.fields || {})) {
    if (result.status !== "unanimous" || !schemaField(fieldId) || (accepted && !accepted.has(fieldId))) continue;
    const before = String(fieldValue(row, fieldId) || "");
    const after = String(result.value || "");
    if (before === after) continue;
    setFieldValue(row, fieldId, after);
    changes.push({ fieldId, before, after });
  }
  syncLegacyFields(row);
  return changes;
}

function consensusAuditSnapshot(consensus) {
  const fields = Object.fromEntries(Object.entries(consensus?.fields || {})
    .filter(([fieldId]) => Boolean(schemaField(fieldId)))
    .map(([fieldId, result]) => [fieldId, {
      status: result.status,
      value: result.value,
      policy: result.policy,
      verifiedEvidence: Number(result.verifiedEvidence) || 0,
      evidenceRequired: Boolean(result.evidenceRequired ?? schemaField(fieldId)?.evidenceRequired),
      votes: [...(result.votes || [])],
      voteCount: Number(result.voteCount) || 0,
      abstentionCount: Number(result.abstentionCount) || 0,
      reason: result.reason || "",
      validationSource: result.validationSource || "model"
    }]));
  const models = (consensus?.models || []).map((item) => ({
    profileId: item.profileId,
    status: item.status,
    error: item.error || "",
    elapsedMs: Number(item.elapsedMs) || 0,
    profile: {
      id: item.profile?.id || "",
      displayName: item.profile?.displayName || "",
      model: item.profile?.model || "",
      modelFamily: item.profile?.modelFamily || ""
    },
    proposal: item.proposal ? {
      fields: Object.fromEntries(Object.entries(item.proposal.fields || {}).filter(([fieldId]) => Boolean(schemaField(fieldId)))),
      reasoning: Array.isArray(item.proposal.reasoning) ? item.proposal.reasoning : [],
      evidence: Array.isArray(item.proposal.evidence) ? item.proposal.evidence : [],
      abstentions: Array.isArray(item.proposal.abstentions) ? item.proposal.abstentions : [],
      answerSources: Object.fromEntries(Object.entries(item.proposal.answerSources || {})
        .filter(([fieldId, source]) => Boolean(schemaField(fieldId)) && ["direct", "repair"].includes(source)))
    } : null
  }));
  return {
    runId: consensus?.runId || "",
    snapshotVersion: Number(consensus?.snapshotVersion) || 1,
    startedAt: consensus?.startedAt || "",
    completedAt: consensus?.completedAt || "",
    decision: consensus?.decision || "needs_human_review",
    blockers: [...(consensus?.blockers || [])],
    fields,
    models
  };
}

function consensusModelVersion(consensus) {
  return (consensus?.models || []).map((item) => item.profile?.model).filter(Boolean).join(" + ") || "multi-model-consensus";
}

function applyConsensusAssist(row) {
  const reviewedFields = consensusReviewedFields(row);
  const decisions = Object.fromEntries(reviewedFields.filter((item) => item.judgment).map((item) => [item.field.id, item.judgment]));
  if (!Object.keys(decisions).length) return false;
  const acceptedIds = reviewedFields
    .filter((item) => item.judgment === "accept" && item.consensus.status === "unanimous")
    .map((item) => item.field.id);
  const uncertain = reviewedFields.filter((item) => item.judgment === "uncertain");
  const rejected = reviewedFields.filter((item) => item.judgment === "reject");
  const checkpoint = rememberUndo(row, "核验三模型共识");
  const acceptedChanges = applyUnanimousConsensusFields(row, state.aiProposal, acceptedIds);
  row.aiDraft = { ...(row.aiDraft || {}), ...Object.fromEntries(acceptedChanges.map((change) => [change.fieldId, change.after])) };
  row.modelVersion = consensusModelVersion(state.aiProposal);
  row.promptVersion = state.promptVersion;
  row.edited = row.edited || acceptedChanges.length > 0;
  row.reviewed = false;
  delete row.reviewedAt;
  if (uncertain.length || state.aiProposal.blockers.length) {
    row.problemResolution = {
      status: "pending_review",
      at: new Date().toISOString(),
      reason: uncertain.length ? `共识字段存疑：${uncertain.map((item) => item.field.label).join("、")}` : "共识运行存在阻断项，待人工复核。"
    };
  } else if (acceptedChanges.length && row.problemResolution?.status === "resolved") {
    row.problemResolution = { status: "pending_review", at: new Date().toISOString(), reason: "采纳三模型共识后待人工确认。" };
  }
  addHistory(row, {
    type: "ai-consensus-assist",
    actor: "human",
    reason: `人工核验三模型共识：采纳 ${acceptedChanges.length} 项，驳回 ${rejected.length} 项，存疑 ${uncertain.length} 项。`,
    consensusRun: consensusAuditSnapshot(state.aiProposal),
    decisions,
    changes: acceptedChanges
  });
  state.aiStatus = "applied";
  if (!finishReviewChange(row, "ai-consensus-assist", "人工核验三模型共识。", acceptedChanges, checkpoint)) {
    state.aiStatus = "ready";
    return false;
  }
  return true;
}

function applyConsensusDecision(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || state.aiStatus !== "ready" || state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId || !isConsensusProposal()) return false;
  if (!state.aiInputSignature || state.aiInputSignature !== aiInputSignature(row)) return false;
  if (state.aiProposal.decision !== "auto_approve_record" || state.modelSettings.policy.reviewMode !== "auto") return false;
  const checkpoint = rememberUndo(row, "AI 自动判过");
  const changes = applyUnanimousConsensusFields(row, state.aiProposal);
  row.aiDraft = { ...(row.aiDraft || {}), ...Object.fromEntries(changes.map((change) => [change.fieldId, change.after])) };
  row.modelVersion = consensusModelVersion(state.aiProposal);
  row.promptVersion = state.promptVersion;
  row.edited = row.edited || changes.length > 0;
  row.reviewed = true;
  row.reviewedAt = new Date().toISOString();
  row.problemResolution = { status: "resolved", at: row.reviewedAt, reason: "三模型共识自动判过。" };
  addHistory(row, {
    type: "ai-consensus-auto-approve",
    actor: "system",
    reason: "三模型共识自动判过。",
    consensusRun: consensusAuditSnapshot(state.aiProposal),
    changes
  });
  state.aiStatus = "applied";
  if (!finishReviewChange(row, "ai-consensus-auto-approve", "三模型共识自动判过。", changes, checkpoint)) {
    state.aiStatus = "ready";
    return false;
  }
  return true;
}

function applyAiProposal(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || state.aiStatus !== "ready" || state.aiRowId !== row.id || state.aiWorkspaceId !== state.workspaceId || !state.aiProposal) return false;
  if (!state.aiInputSignature || state.aiInputSignature !== aiInputSignature(row)) {
    resetAiForRow(row);
    updateAiDom(row);
    return false;
  }
  if (isConsensusProposal()) {
    if (state.aiProposal.decision === "auto_approve_record" && state.modelSettings.policy.reviewMode === "auto") return applyConsensusDecision(rowId);
    return applyConsensusAssist(row);
  }
  const reviewedFields = aiReviewedFields(row);
  const acceptedChanges = reviewedFields
    .filter((item) => item.judgment === "accept" && item.reasoning.decision === "change" && item.before !== item.after)
    .map(({ field, before, after }) => ({ fieldId: field.id, before, after }));
  const decisions = Object.fromEntries(reviewedFields
    .filter((item) => item.judgment)
    .map((item) => [item.field.id, item.judgment]));
  const uncertain = reviewedFields.filter((item) => item.judgment === "uncertain");
  const rejected = reviewedFields.filter((item) => item.judgment === "reject");
  if (!Object.keys(decisions).length) return false;
  const checkpoint = rememberUndo(row, "核验 AI 字段建议");
  acceptedChanges.forEach((change) => setFieldValue(row, change.fieldId, change.after));
  row.aiDraft = {
    ...(row.aiDraft || {}),
    ...Object.fromEntries(acceptedChanges.map((change) => [change.fieldId, change.after]))
  };
  row.modelVersion = state.aiProposal.meta.model;
  row.promptVersion = state.aiProposal.meta.promptVersion;
  row.edited = true;
  row.reviewed = false;
  if (uncertain.length) {
    row.problemResolution = {
      status: "pending_review",
      at: new Date().toISOString(),
      reason: `AI 字段存疑：${uncertain.map((item) => item.field.label).join("、")}`
    };
  } else if (acceptedChanges.length && row.problemResolution?.status === "resolved") {
    row.problemResolution = { status: "pending_review", at: new Date().toISOString(), reason: "采纳 AI 建议后待人工复核。" };
  }
  syncLegacyFields(row);
  addHistory(row, {
    type: "ai-field-review",
    actor: "human",
    reason: `人工核验 AI 字段建议：认可 ${acceptedChanges.length} 项，驳回 ${rejected.length} 项，存疑 ${uncertain.length} 项。`,
    promptVersion: state.aiProposal.meta.promptVersion,
    modelVersion: state.aiProposal.meta.model,
    evidence: state.aiProposal.proposal.evidence,
    reasoning: state.aiProposal.proposal.reasoning,
    decisions,
    changes: acceptedChanges
  });
  state.aiStatus = "applied";
  if (!finishReviewChange(row, "ai-field-review", "人工核验 AI 字段建议。", acceptedChanges, checkpoint)) {
    state.aiStatus = "ready";
    return false;
  }
  return true;
}

function resultsControlPanel(rows) {
  return `
    <div class="controls ${state.filtersCollapsed ? "collapsed" : ""}">
      <div class="controls-head">
        <div>
          <span>筛选标签</span>
          <small>${escapeHtml(filters.find((item) => item.id === state.filter)?.label || "全部")} · ${rows.length} 条</small>
        </div>
        <button type="button" class="icon-control" data-filter-toggle aria-expanded="${String(!state.filtersCollapsed)}" aria-label="${state.filtersCollapsed ? "展开筛选" : "收起筛选"}" title="${state.filtersCollapsed ? "展开筛选" : "收起筛选"}">${state.filtersCollapsed ? "⌄" : "⌃"}</button>
      </div>
      <div class="collapsible-filters">
        ${qualityFocusBar(rows)}
        <div class="filter-row">${filterChips(state.rows)}</div>
      </div>
      <label class="search-box">
        <span>搜索</span>
        <input id="searchInput" value="${escapeHtml(state.query)}" placeholder="书家、书体、摘录、页码..." />
      </label>
    </div>
  `;
}

function problemTagCounts() {
  const counts = Object.fromEntries((window.CalligraphySchema?.problemTags || []).map((tag) => [tag.key, 0]));
  state.rows.forEach((row) => {
    normalizeProblemTags(row).forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}

function modeSummaryPanel(rows) {
  const stats = state.manifest.stats;
  if (state.detailMode !== "review") {
    const items = [
      ["全量行", state.rows.length],
      ["当前视图", rows.length],
      ["字段待补", stats.invalidRows],
      ["精确命中", stats.exactHits],
    ];
    return `
      <div class="mode-summary table-summary" aria-label="统一主表摘要">
        ${items.map(([label, value]) => `<span><b>${escapeHtml(value)}</b>${escapeHtml(label)}</span>`).join("")}
      </div>
    `;
  }

  const issueItems = [
    ["当前队列", rows.length],
    ["人工标注", state.rows.filter((row) => row.flagged).length],
    ["命中异常", state.rows.filter(sourceNeedsReview).length],
    ["字段待补", state.manifest.stats.invalidRows],
  ];
  return `
    <div class="mode-summary review-summary" aria-label="回检修订摘要">
      ${issueItems.map(([label, value]) => `<span><b>${escapeHtml(value)}</b>${escapeHtml(label)}</span>`).join("")}
    </div>
  `;
}

function tableViewActions() {
  const batchModeLabel = state.batchJob?.running ? "批量任务运行中" : state.batchMode ? "退出多选" : "进入多选";
  const batchModeButton = `<button type="button" class="icon-control ${state.batchMode ? "active" : ""}" data-batch-mode aria-pressed="${String(state.batchMode)}" aria-label="${batchModeLabel}" title="${batchModeLabel}" ${state.batchJob?.running ? "disabled" : ""}>☑</button>`;
  if (state.detailMode === "review") {
    return `
      <div class="table-view-actions review-view-actions" aria-label="回检视图控制">
        <button type="button" class="active icon-control" data-confidence-sort aria-pressed="true" aria-label="${confidenceSortLabel()}" title="${confidenceSortLabel()}">${state.confidenceSort === "desc" ? "⇣" : "⇡"}</button>
        ${batchModeButton}
        <button type="button" data-quality-batch-review title="将当前筛选条目标记为待复核" ${visibleRows().length ? "" : "disabled"}>批量复核</button>
        <button type="button" data-problem-export ${state.rows.length ? "" : "disabled"}>导出问题</button>
      </div>
    `;
  }
  const focusLabel = state.aiPanelOpen ? "AI 字段理由打开时保持并排审校" : state.tableFocus ? "退出表格专注" : "进入表格专注";
  return `
    <div class="table-view-actions" aria-label="表格视图控制">
      <button type="button" class="active icon-control" data-confidence-sort aria-pressed="true" aria-label="${confidenceSortLabel()}" title="${confidenceSortLabel()}">${state.confidenceSort === "desc" ? "⇣" : "⇡"}</button>
      ${batchModeButton}
      <button type="button" class="icon-control ${state.tableFocus ? "active" : ""}" data-table-focus aria-pressed="${String(state.tableFocus)}" aria-label="${focusLabel}" title="${focusLabel}" ${state.aiPanelOpen ? "disabled" : ""}>⛶</button>
      <button type="button" class="icon-control ${state.tableHeaderCollapsed ? "active" : ""}" data-table-head-toggle aria-pressed="${String(state.tableHeaderCollapsed)}" aria-label="${state.tableHeaderCollapsed ? "显示表头" : "收起表头"}" title="${state.tableHeaderCollapsed ? "显示表头" : "收起表头"}">▤</button>
    </div>
  `;
}

function batchActionBar() {
  if (!state.batchMode) return "";
  const rows = batchSelectedRows();
  const job = state.batchJob;
  if (!rows.length && !job) return "";
  if (job) {
    const actionable = (job.results || []).filter((item) => item.category !== "approved");
    const currentRow = state.rows.find((row) => row.id === job.currentId);
    return `
      <section class="batch-action-bar batch-job-bar ${job.running ? "is-running" : "is-complete"}" aria-live="polite" aria-label="批量处理进度">
        <div class="batch-job-summary">
          <strong>${job.running ? "处理中" : job.stopped ? "已停止" : "处理完成"} ${job.completed} / ${job.total}</strong>
          <span>通过 ${job.approved}</span><span>待复核 ${job.review}</span><span>失败 ${job.failed}</span>
          ${job.running
            ? '<button type="button" class="icon-control danger" data-batch-stop aria-label="停止剩余任务" title="停止剩余任务">■</button>'
            : '<button type="button" class="icon-control" data-batch-job-close aria-label="关闭处理结果" title="关闭处理结果">×</button>'}
        </div>
        ${job.running && job.currentId ? `<p class="batch-current-row">正在核验 ${escapeHtml(job.currentId)}${currentRow ? ` · ${escapeHtml(fieldValue(currentRow, "author") || "未标注")}` : ""}</p>` : ""}
        ${actionable.length ? `
          <details class="batch-result-details" open>
            <summary>需要处理 ${actionable.length} 条</summary>
            <div class="batch-result-list">
              ${actionable.map((item) => `
                <button type="button" class="batch-result-item ${escapeHtml(item.category)}" data-batch-result-row="${escapeHtml(item.rowId)}" aria-label="查看 ${escapeHtml(item.rowId)} 的${item.category === "failed" ? "失败" : "待复核"}原因">
                  <span class="batch-result-title"><i>${item.category === "failed" ? "失败" : "待复核"}</i><strong>${escapeHtml(item.rowId)}</strong>${item.rowLabel ? `<em>${escapeHtml(item.rowLabel)}</em>` : ""}</span>
                  <span class="batch-result-reason">${escapeHtml(item.reason)}</span>
                  ${item.details?.length ? `<span class="batch-result-details-text">${item.details.map(escapeHtml).join(" · ")}</span>` : ""}
                  <span class="batch-result-open">查看条目 ›</span>
                </button>`).join("")}
            </div>
          </details>` : (!job.running ? '<p class="batch-result-pass">本批次没有需要人工处理的条目。</p>' : "")}
      </section>`;
  }
  return `
    <section class="batch-action-bar" aria-label="批量处理">
      <strong>已选 ${rows.length} 条</strong>
      <div class="batch-action-buttons">
        <button type="button" class="icon-control" data-batch-ai aria-label="三模型核验" title="三模型核验">AI</button>
        <button type="button" class="icon-control" data-batch-confirm aria-label="批量确认" title="批量确认">✓</button>
        <button type="button" class="icon-control" data-batch-issue aria-label="批量标记问题" title="批量标记问题">!</button>
        <button type="button" class="icon-control" data-batch-export aria-label="导出选中条目" title="导出选中条目">⇩</button>
        <button type="button" class="icon-control danger" data-batch-delete aria-label="删除选中条目" title="删除选中条目">×</button>
        <button type="button" class="icon-control" data-batch-clear aria-label="清空选择" title="清空选择">⊘</button>
      </div>
    </section>`;
}

function detailPanel(row) {
  const dockLabel = state.detailMode === "review" ? "处理面板" : "条目详情";
  const detailToggleLabel = state.aiPanelOpen ? "AI 字段理由打开时保持条目详情展开" : state.detailCollapsed ? "展开条目详情" : "收起条目详情";
  if (!row) {
    const readyQueue = state.qualityFocus?.mode === "dashboard" && state.qualityFocus.key === "ready";
    const emptyTitle = readyQueue ? "暂无可交付条目" : state.detailMode === "review" ? "暂无待处理条目" : "暂无数据";
    return `
      <aside class="detail-panel ${state.detailCollapsed ? "collapsed" : ""}" data-dock-mode="${escapeHtml(state.detailMode)}">
        <div class="dock-grip"></div>
        <div class="detail-dock-head">
          <div>
            <p class="kicker">${escapeHtml(dockLabel)}</p>
            <h2>${emptyTitle}</h2>
          </div>
          <button type="button" class="icon-control" data-detail-toggle aria-expanded="${String(!state.detailCollapsed)}" aria-label="${detailToggleLabel}" title="${detailToggleLabel}" ${state.aiPanelOpen ? "disabled" : ""}>${state.detailCollapsed ? "‹" : "›"}</button>
        </div>
        <div class="detail-dock-body"><div class="empty-state"><strong>${emptyTitle}</strong></div></div>
      </aside>
    `;
  }

  return `
    <aside class="detail-panel ${state.detailCollapsed ? "collapsed" : ""}" data-dock-mode="${escapeHtml(state.detailMode)}" data-selected-id="${escapeHtml(row.id)}">
      <div class="dock-grip"></div>
      <div class="detail-dock-head">
        <div>
          <p class="kicker">${escapeHtml(dockLabel)}</p>
          <h2>${escapeHtml(fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目")} · ${escapeHtml(row.id)}</h2>
        </div>
        <button type="button" class="icon-control" data-detail-toggle aria-expanded="${String(!state.detailCollapsed)}" aria-label="${detailToggleLabel}" title="${detailToggleLabel}" ${state.aiPanelOpen ? "disabled" : ""}>${state.detailCollapsed ? "‹" : "›"}</button>
      </div>
      <div class="detail-dock-body">
        ${state.detailMode === "review" ? `
          ${reviewFocusCard(row)}
          ${sourceCard(row)}
          ${detailCard(row)}
          ${historyPanel(row)}
          ${researchCard(row)}
        ` : `
          ${sourceCard(row)}
          ${detailCard(row)}
          ${historyPanel(row)}
          ${researchCard(row)}
        `}
      </div>
    </aside>
  `;
}

function updateSelectedRowDom() {
  document.querySelectorAll("tbody tr[data-row-id]").forEach((row) => {
    row.classList.toggle("selected", row.dataset.rowId === state.selectedId);
  });
}

function triggerWorkbenchMotion(name, duration = 520) {
  const screen = document.querySelector(".review-screen");
  if (!screen) return;
  screen.classList.remove(name);
  void screen.offsetWidth;
  screen.classList.add(name);
  window.setTimeout(() => screen.classList.remove(name), duration);
}

function updateDetailDom(row) {
  const panel = document.querySelector(".detail-panel");
  if (!panel) {
    render();
    return;
  }
  if (!row) {
    if (panel.dataset.selectedId) render();
    return;
  }

  const detail = panel.querySelector(".detail-card");
  const focus = panel.querySelector(".review-focus-card");
  const research = panel.querySelector(".research-card");
  const source = panel.querySelector(".source-card");
  const trace = panel.querySelector(".trace-card");
  if (!detail || !research || !source || !trace) {
    render();
    return;
  }

  const dockTitle = panel.querySelector(".detail-dock-head h2");
  panel.dataset.selectedId = row.id;
  if (dockTitle) dockTitle.textContent = `${fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目"} · ${row.id}`;
  if (focus) focus.outerHTML = reviewFocusCard(row);
  detail.innerHTML = detailCardContent(row);
  research.innerHTML = researchCardContent(row);
  source.innerHTML = sourceCardContent(row);
  trace.outerHTML = historyPanel(row);
  updateAiDom(row);
}

function updateResearchDom(row = selectedRow()) {
  const card = document.querySelector(".research-card");
  if (!card || !row) {
    updateDetailDom(row);
    return;
  }
  card.innerHTML = researchCardContent(row);
}

function researchPresetQuery(row, preset) {
  const author = fieldValue(row, "author") || row.author;
  const scriptType = fieldValue(row, "scriptType") || row.scriptType;
  const quote = fieldValue(row, "quote") || row.quote;
  if (preset === "author") return [author, scriptType, "书论 书法"].filter(Boolean).join(" ");
  if (preset === "quote") return [clip(quote, 32), "书论"].filter(Boolean).join(" ");
  return defaultResearchQuery(row);
}

async function performResearchSearch(query, rowId = state.selectedId) {
  const trimmed = String(query || "").trim();
  if (!trimmed || selectedRow()?.id !== rowId) return;
  const workspaceId = state.workspaceId;
  const requestId = state.researchRequestId + 1;
  const isCurrent = () => requestId === state.researchRequestId
    && workspaceId === state.workspaceId && selectedRow()?.id === rowId && state.view === "detail";
  state.researchRequestId = requestId;
  state.researchRowId = rowId;
  state.researchQuery = trimmed;
  state.researchStatus = "loading";
  state.researchError = "";
  state.researchResults = [];
  updateResearchDom(state.rows.find((row) => row.id === rowId));

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
    const payload = await response.json();
    if (!isCurrent()) return;
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    state.researchResults = normalizeResearchResults(payload.results);
    state.researchStatus = "ready";
    state.researchError = "";
  } catch (error) {
    if (!isCurrent()) return;
    state.researchResults = [];
    state.researchStatus = "error";
    state.researchError = error?.message || "search failed";
  }
  updateResearchDom(state.rows.find((row) => row.id === rowId));
}

function normalizeResearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results.flatMap((item) => {
    if (!item || typeof item.title !== "string" || !item.title.trim()) return [];
    try {
      const url = new URL(item.url);
      if (!["http:", "https:"].includes(url.protocol)) return [];
      return [{ title: item.title, url: url.href, snippet: String(item.snippet || "") }];
    } catch {
      return [];
    }
  }).slice(0, 8);
}

function resetResearchForRow(row) {
  state.researchRequestId += 1;
  state.researchWorkspaceId = state.workspaceId;
  state.researchRowId = row?.id || "";
  state.researchQuery = defaultResearchQuery(row);
  state.researchStatus = "idle";
  state.researchResults = [];
  state.researchError = "";
}

function updateSourceDom(row) {
  if (!row) return;
  const card = document.querySelector(".source-card");
  if (!card) {
    updateDetailDom(row);
    return;
  }
  card.innerHTML = sourceCardContent(row);
  updateAiDom(row);
}

function cachedSourceText(sourceFile) {
  if (state.uploadedPages.has(sourceFile)) return state.uploadedPages.get(sourceFile);
  if (state.sourceCache.has(sourceFile)) return state.sourceCache.get(sourceFile);
  return null;
}

function selectResult(rowId) {
  if (!rowId || !visibleRows().some((row) => row.id === rowId)) return false;
  if (rowId === state.selectedId) {
    setDetailDock(false);
    return;
  }
  state.selectedId = rowId;
  try {
    localStorage.setItem(storageKey() + ":selection", rowId);
  } catch {
    state.saveError = "当前位置未保存";
  }
  setDetailDock(false);
  const requestId = state.sourceRequestId + 1;
  state.sourceRequestId = requestId;
  updateSelectedRowDom();
  const row = selectedRow();
  resetResearchForRow(row);
  resetAiForRow(row);

  if (!row?.sourceFile) {
    state.sourceText = "";
    state.sourceStatus = "missing";
  } else {
    const cached = cachedSourceText(row.sourceFile);
    state.sourceText = cached || "";
    state.sourceStatus = cached ? "ready" : "loading";
  }

  updateDetailDom(row);
  const detailBody = document.querySelector(".detail-dock-body");
  if (detailBody) detailBody.scrollTop = 0;
  revealSelectedRow();
  if (row?.sourceFile && state.sourceStatus === "loading") {
    loadSelectedSource({ loadingRendered: true, requestId });
  }
}

function revealSelectedRow() {
  const shell = document.querySelector(".table-shell");
  const row = [...document.querySelectorAll("tbody tr[data-row-id]")].find((item) => item.dataset.rowId === state.selectedId);
  if (!shell || !row) return;
  const bounds = shell.getBoundingClientRect();
  const item = row.getBoundingClientRect();
  const headerHeight = shell.querySelector("thead")?.getBoundingClientRect().height || 0;
  if (item.top < bounds.top + headerHeight) shell.scrollTop -= bounds.top + headerHeight - item.top;
  else if (item.bottom > bounds.bottom) shell.scrollTop += item.bottom - bounds.bottom;
}

function reviewChangeCheckpoint(rows = []) {
  return {
    rowSnapshots: (Array.isArray(rows) ? rows : [rows]).map((row) => ({ row, before: cloneRow(row) })),
    rows: [...state.rows], trashRows: [...state.trashRows],
    reviewState: JSON.parse(JSON.stringify(state.reviewState)), undoAction: state.undoAction,
    manifest: state.manifest, selectedId: state.selectedId, editingId: state.editingId,
    batchSelectedIds: new Set(state.batchSelectedIds), batchIssueOpen: state.batchIssueOpen,
    resolutionRowId: state.resolutionRowId, queueIds: visibleRows().map((item) => item.id)
  };
}

function restoreReviewCheckpoint(checkpoint) {
  // Preserve original objects as well as membership: callers may still hold them.
  checkpoint.rowSnapshots.forEach(({ row, before }) => {
    Object.keys(row).forEach((key) => delete row[key]);
    Object.assign(row, before);
  });
  for (const key of ["rows", "trashRows", "reviewState", "undoAction", "manifest", "selectedId", "editingId", "resolutionRowId"]) {
    state[key] = checkpoint[key];
  }
  state.batchSelectedIds = new Set(checkpoint.batchSelectedIds || []);
  state.batchIssueOpen = Boolean(checkpoint.batchIssueOpen);
}

function finishBatchChange(rows, checkpoint, type, reason) {
  state.manifest = buildManifest(state.rows);
  reconcileBatchSelection();
  if (!state.rows.some((row) => row.id === state.selectedId)) state.selectedId = visibleRows()[0]?.id || "";
  if (!saveWorkspace()) {
    restoreReviewCheckpoint(checkpoint);
    return false;
  }
  state.sourceText = "";
  state.sourceStatus = "idle";
  rows.forEach((row) => syncRowChangeToCloud(row, type, reason, []));
  render();
  loadSelectedSource();
  return true;
}

function batchConfirmSelected() {
  const rows = batchSelectedRows();
  if (!rows.length) return false;
  const checkpoint = reviewChangeCheckpoint(rows);
  const at = new Date().toISOString();
  rows.forEach((row) => {
    row.reviewed = true;
    row.reviewedAt = at;
    addHistory(row, { type: "batch-confirm", actor: "human", reason: "批量人工确认当前条目。", changes: [] });
    state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
    state.reviewState.confirmedIds.push(row.id);
    state.reviewState.edits[row.id] = editableSnapshot(row);
  });
  state.undoAction = null;
  return finishBatchChange(rows, checkpoint, "batch-confirm", "批量人工确认当前条目。");
}

function batchDeleteSelected() {
  const rows = batchSelectedRows();
  if (!rows.length) return false;
  if (!window.confirm(`将选中的 ${rows.length} 条移入回收站？`)) return false;
  const checkpoint = reviewChangeCheckpoint(rows);
  const ids = new Set(rows.map((row) => row.id));
  rows.forEach((row) => {
    row.deleted = true;
    row.deletedAt = new Date().toISOString();
    addHistory(row, { type: "batch-delete", actor: "human", reason: "批量移入回收站。", changes: [] });
    if (!state.reviewState.deletedIds.includes(row.id)) state.reviewState.deletedIds.push(row.id);
    state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
  });
  state.trashRows = [...state.trashRows, ...rows];
  state.rows = state.rows.filter((row) => !ids.has(row.id));
  state.batchSelectedIds = new Set([...state.batchSelectedIds].filter((id) => !ids.has(id)));
  state.undoAction = null;
  return finishBatchChange(rows, checkpoint, "batch-delete", "批量移入回收站。");
}

function batchIssueModal() {
  if (!state.batchIssueOpen) return "";
  const rows = batchSelectedRows();
  const tags = window.CalligraphySchema?.problemTags || [];
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="批量标记问题">
      <form class="edit-modal workflow-modal batch-issue-modal" id="batchIssueForm">
        <div class="modal-head"><div><h2>批量标记问题</h2><p>将应用到 ${rows.length} 条选中记录</p></div><button type="button" data-batch-issue-close aria-label="关闭" title="关闭">×</button></div>
        <label>问题标签<select name="problemTag" required>${tags.map((tag) => `<option value="${escapeHtml(tag.key)}">${escapeHtml(tag.label)}</option>`).join("")}</select></label>
        <label>补充说明<textarea name="problemNote" rows="4" maxlength="1000" placeholder="可选：记录需要人工核对的原因"></textarea></label>
        <div class="modal-actions"><button type="button" data-batch-issue-close>取消</button><button type="submit" ${rows.length ? "" : "disabled"}>应用到选中条目</button></div>
      </form>
    </div>`;
}

function batchMarkIssue(form) {
  const rows = batchSelectedRows();
  if (!rows.length) return false;
  const data = new FormData(form);
  const tag = String(data.get("problemTag") || "");
  const tagDefinition = (window.CalligraphySchema?.problemTags || []).find((item) => item.key === tag);
  if (!tagDefinition) return false;
  const note = String(data.get("problemNote") || "").trim();
  const checkpoint = reviewChangeCheckpoint(rows);
  rows.forEach((row) => {
    const before = normalizeProblemTags(row);
    row.problemTags = [...new Set([...before, tag])];
    row.flagged = true;
    row.reviewed = false;
    row.status = "待复核";
    row.bucket = "review";
    row.edited = true;
    row.problemResolution = { status: "open", at: new Date().toISOString(), reason: note || `批量标记：${tagDefinition.label}` };
    appendIssue(row, note || `批量标记：${tagDefinition.label}`);
    row.annotations = normalizeAnnotations(row);
    row.annotations.push({
      id: `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: tag === "page_issue" ? "page" : tag === "author_issue" ? "attribution" : "other",
      fieldId: "",
      fieldLabel: "整条记录",
      body: note || `批量标记：${tagDefinition.label}`,
      at: new Date().toISOString(),
    });
    addHistory(row, {
      type: "batch-issue",
      actor: "human",
      reason: `批量标记问题：${tagDefinition.label}${note ? `；${note}` : ""}`,
      changes: [{ fieldId: "problemTags", before: before.join(";"), after: row.problemTags.join(";") }],
    });
    state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
    state.reviewState.edits[row.id] = editableSnapshot(row);
  });
  state.batchIssueOpen = false;
  state.undoAction = null;
  return finishBatchChange(rows, checkpoint, "batch-issue", "批量标记问题。");
}

function persistBatchConsensusResult(row, consensus, category, reason) {
  const checkpoint = reviewChangeCheckpoint(row);
  const applyFields = category === "approved" || (category === "review" && consensus?.decision === "adopt_fields");
  const changes = applyFields ? applyUnanimousConsensusFields(row, consensus) : [];
  row.aiDraft = { ...(row.aiDraft || {}), ...Object.fromEntries(changes.map((change) => [change.fieldId, change.after])) };
  row.modelVersion = consensus ? consensusModelVersion(consensus) : row.modelVersion;
  row.promptVersion = state.promptVersion;
  row.edited = row.edited || changes.length > 0;
  if (category === "approved") {
    row.reviewed = true;
    row.reviewedAt = new Date().toISOString();
    row.problemResolution = { status: "resolved", at: row.reviewedAt, reason: "批量三模型共识自动判过。" };
  } else {
    row.reviewed = false;
    delete row.reviewedAt;
    row.status = "待复核";
    row.bucket = "review";
    row.problemResolution = { status: "pending_review", at: new Date().toISOString(), reason };
    appendIssue(row, reason);
  }
  addHistory(row, {
    type: category === "approved" ? "ai-consensus-auto-approve" : category === "failed" ? "ai-consensus-batch-error" : "ai-consensus-batch-review",
    actor: "system",
    reason,
    consensusRun: consensus ? consensusAuditSnapshot(consensus) : undefined,
    changes,
  });
  state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
  if (row.reviewed) state.reviewState.confirmedIds.push(row.id);
  state.reviewState.edits[row.id] = editableSnapshot(row);
  state.manifest = buildManifest(state.rows);
  if (!saveWorkspace()) {
    restoreReviewCheckpoint(checkpoint);
    return false;
  }
  syncRowChangeToCloud(row, category === "approved" ? "ai-consensus-auto-approve" : "ai-consensus-batch-review", reason, changes);
  return true;
}

function batchAiOutcome(category, reason, details = []) {
  return {
    category,
    reason: String(reason || "批量核验未返回原因。"),
    details: [...new Set((details || []).map((item) => String(item || "").trim()).filter(Boolean))],
  };
}

function batchConsensusIssueDetails(consensus) {
  const modelErrors = (consensus?.models || [])
    .filter((item) => item.status !== "success")
    .map((item) => `${item.profile?.displayName || item.profileId || "模型"}：${item.error || "调用失败"}`);
  const blockers = (consensus?.blockers || []).map((item) => consensusBlockerLabel(item, consensus?.fields || {}));
  return [...new Set([...modelErrors, ...blockers].filter(Boolean))];
}

function saveBatchAiOutcome(row, consensus, category, reason, details = []) {
  const saved = persistBatchConsensusResult(row, consensus, category, reason);
  if (saved) return batchAiOutcome(category, reason, details);
  return batchAiOutcome("failed", `${reason}；结果未能保存到当前工作区。`, details);
}

async function runBatchAiRow(row, job) {
  const sourceText = aiSourceForRow(row);
  if (!sourceText) {
    const reason = "三模型批处理失败：当前条目没有可用原文。";
    return saveBatchAiOutcome(row, null, "failed", reason);
  }
  const signature = aiInputSignature(row);
  try {
    const consensus = await requestConsensusForRow(row, sourceText, { reviewMode: "auto" });
    if (job.workspaceId !== state.workspaceId) return batchAiOutcome("failed", "核验完成时工作区已切换，结果未写入。");
    if (!state.rows.includes(row)) return batchAiOutcome("failed", "核验完成时条目已不存在，结果未写入。");
    if (signature !== aiInputSignature(row)) {
      const reason = "三模型返回期间条目已变化，未覆盖新编辑。请人工复核。";
      return saveBatchAiOutcome(row, consensus, "review", reason);
    }
    const modelFailed = consensus.models.some((item) => item.status !== "success");
    if (modelFailed) {
      const details = batchConsensusIssueDetails(consensus);
      const reason = details.length
        ? `三模型批处理失败：${details.join("；")}`
        : "三模型批处理存在模型失败，已转入人工复核。";
      return saveBatchAiOutcome(row, consensus, "failed", reason, details);
    }
    if (consensus.decision === "auto_approve_record") {
      return saveBatchAiOutcome(row, consensus, "approved", "批量三模型共识自动判过。");
    }
    const details = batchConsensusIssueDetails(consensus);
    const reason = consensus.decision === "adopt_fields"
      ? "已采纳一致字段，其余字段待人工复核。"
      : "三模型未形成可自动判过的完整共识。";
    return saveBatchAiOutcome(row, consensus, "review", reason, details);
  } catch (error) {
    const reason = `三模型批处理失败：${error?.message || "模型调用失败"}`;
    return saveBatchAiOutcome(row, null, "failed", reason);
  }
}

function batchReviewItems() {
  return (state.batchJob?.results || []).filter((item) => item.category !== "approved");
}

function batchReviewResult(rowId = state.batchReviewRowId) {
  return batchReviewItems().find((item) => item.rowId === rowId) || null;
}

function batchReviewAudit(row) {
  return normalizeHistory(row).slice().reverse().find((event) => event.consensusRun)?.consensusRun || null;
}

function batchReviewDecisionLabel(decision) {
  return {
    auto_approve_record: "已自动判过",
    adopt_fields: "部分字段可采纳",
    needs_human_review: "需要人工复核"
  }[decision] || "未形成结论";
}

function batchReviewConsensusFields(row, audit) {
  const fields = orderedSchema().filter((field) => audit?.fields?.[field.id]);
  if (!fields.length) return `<p class="batch-review-empty">本次运行没有留下可比较的字段建议。</p>`;
  return `<div class="batch-review-field-list">${fields.map((field) => {
    const result = audit.fields[field.id] || {};
    const current = String(fieldValue(row, field.id) || "");
    const suggested = String(result.value || "");
    const status = consensusStatusLabel({ consensus: result });
    const tone = result.status === "unanimous" ? "pass" : result.status === "split" ? "split" : "blocked";
    return `<article class="batch-review-field ${tone}">
      <header><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(status)}</span></header>
      <dl><dt>当前</dt><dd>${escapeHtml(current || "空")}</dd><dt>AI 建议</dt><dd>${escapeHtml(suggested || "空")}</dd></dl>
      <p>${escapeHtml(consensusEvidenceLabel(field, result))}${result.votes?.length ? ` · ${escapeHtml(result.votes.join(" ｜ "))}` : ""}</p>
    </article>`;
  }).join("")}</div>`;
}

function batchReviewModelDetails(audit) {
  const models = audit?.models || [];
  if (!models.length) return `<p class="batch-review-empty">模型调用失败或未保存模型方案，可依据左侧原文和上方失败原因处理。</p>`;
  return `<div class="batch-review-model-list">${models.map((model, index) => {
    const name = model.profile?.displayName || model.profileId || "模型";
    const proposalFields = Object.entries(model.proposal?.fields || {});
    return `<details class="batch-review-model" ${index === 0 ? "open" : ""}>
      <summary>
        <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(model.profile?.model || "未记录模型")} · ${escapeHtml(model.profile?.modelFamily || "未知家族")}</small></span>
        <em class="${escapeHtml(model.status || "error")}">${model.status === "success" ? `${Number(model.elapsedMs) || 0} ms` : "调用失败"}</em>
      </summary>
      <div class="batch-review-model-body">
        ${model.status !== "success" ? `<p class="ai-model-error">${escapeHtml(model.error || "模型返回异常")}</p>` : ""}
        ${proposalFields.length ? `<dl class="batch-review-model-fields">${proposalFields.map(([fieldId, value]) => `<dt>${escapeHtml(schemaField(fieldId)?.label || fieldId)}</dt><dd>${escapeHtml(value || "空")}</dd>`).join("")}</dl>` : ""}
        ${model.status === "success" ? modelReasoningMarkup(model) : ""}
      </div>
    </details>`;
  }).join("")}</div>`;
}

function batchReviewModal() {
  const row = state.rows.find((item) => item.id === state.batchReviewRowId);
  if (!row) return "";
  const result = batchReviewResult(row.id);
  const audit = batchReviewAudit(row);
  const items = batchReviewItems();
  const index = items.findIndex((item) => item.rowId === row.id);
  const author = fieldValue(row, "author") || "未标注书家";
  const scriptType = fieldValue(row, "scriptType") || "未标注书体";
  const quote = fieldValue(row, "quote") || "";
  const blockers = audit?.blockers || [];
  const canMoveBack = index > 0;
  const canMoveForward = index >= 0 && index < items.length - 1;
  return `<div class="batch-review-backdrop" role="dialog" aria-modal="true" aria-labelledby="batchReviewTitle">
    <section class="batch-review-workspace">
      <header class="batch-review-head">
        <div class="batch-review-heading">
          <span class="batch-review-kicker">批量异常审校</span>
          <h2 id="batchReviewTitle" tabindex="-1">${escapeHtml(author)} · ${escapeHtml(row.id)}</h2>
          <p>${escapeHtml(scriptType)} · ${escapeHtml(row.sourceFile || "无原文文件")} · 第 ${escapeHtml(row.pageNo || "-")} 页</p>
        </div>
        <div class="batch-review-progress" aria-label="异常条目进度">
          <button type="button" class="icon-control" data-batch-review-step="-1" ${canMoveBack ? "" : "disabled"} aria-label="上一条异常" title="上一条异常">‹</button>
          <strong>${index >= 0 ? index + 1 : 1} / ${Math.max(items.length, 1)}</strong>
          <button type="button" class="icon-control" data-batch-review-step="1" ${canMoveForward ? "" : "disabled"} aria-label="下一条异常" title="下一条异常">›</button>
          <button type="button" class="icon-control batch-review-close" data-batch-review-close aria-label="关闭全屏审校" title="关闭全屏审校">×</button>
        </div>
      </header>
      <div class="batch-review-alert ${escapeHtml(result?.category || "review")}">
        <strong>${result?.category === "failed" ? "运行失败" : "存在出入"}</strong>
        <p>${escapeHtml(result?.reason || "此条需要人工复核。")}</p>
        ${result?.details?.length ? `<ul>${result.details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="batch-review-body">
        <section class="batch-review-pane batch-review-record" aria-labelledby="batchReviewRecordTitle">
          <header><span>01</span><div><h3 id="batchReviewRecordTitle">条目与原文</h3><p>当前记录和可回溯的原文位置</p></div></header>
          <div class="batch-review-pane-scroll">
            <blockquote>${escapeHtml(quote || "无摘录")}</blockquote>
            <div class="batch-review-source"><strong>原文上下文</strong>${highlightedSource(row)}</div>
            <dl class="batch-review-current-fields">${orderedSchema().map((field) => `<dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(fieldValue(row, field.id) || "未标注")}</dd>`).join("")}</dl>
          </div>
        </section>
        <section class="batch-review-pane batch-review-consensus" aria-labelledby="batchReviewConsensusTitle">
          <header><span>02</span><div><h3 id="batchReviewConsensusTitle">AI 共识</h3><p>逐字段对照当前值与综合建议</p></div></header>
          <div class="batch-review-pane-scroll">
            ${audit ? `<div class="batch-review-decision"><span>综合结论</span><strong>${escapeHtml(batchReviewDecisionLabel(audit.decision))}</strong><small>run ${escapeHtml(audit.runId || "-")} · 快照 v${escapeHtml(audit.snapshotVersion || 1)}</small></div>` : `<p class="batch-review-empty">本次失败发生在形成共识之前，没有可用的共识快照。</p>`}
            ${blockers.length ? `<div class="batch-review-blockers"><strong>需要人工处理</strong><ul>${blockers.map((item) => `<li>${escapeHtml(consensusBlockerLabel(item, audit.fields || {}))}</li>`).join("")}</ul></div>` : ""}
            ${batchReviewConsensusFields(row, audit)}
          </div>
        </section>
        <section class="batch-review-pane batch-review-models" aria-labelledby="batchReviewModelsTitle">
          <header><span>03</span><div><h3 id="batchReviewModelsTitle">AI 助手方案</h3><p>展开查看各模型的建议、理由与证据</p></div></header>
          <div class="batch-review-pane-scroll">${batchReviewModelDetails(audit)}</div>
        </section>
      </div>
      <footer class="batch-review-actions">
        <button type="button" data-batch-review-close>返回批量结果</button>
        <button type="button" data-batch-review-edit>修改字段</button>
        <button type="button" class="primary" data-batch-review-confirm>${row.reviewed ? "已确认，查看下一条" : "确认此条并继续"}</button>
      </footer>
    </section>
  </div>`;
}

function closeBatchReview() {
  if (!state.batchReviewRowId) return false;
  state.batchReviewRowId = "";
  render();
  return true;
}

function moveBatchReview(step) {
  const items = batchReviewItems();
  const current = items.findIndex((item) => item.rowId === state.batchReviewRowId);
  const next = items[current + Number(step)];
  if (!next) return false;
  return openBatchResult(next.rowId);
}

function confirmBatchReview() {
  const row = state.rows.find((item) => item.id === state.batchReviewRowId);
  if (!row) return false;
  if (!row.reviewed && !confirmRow(row.id)) return false;
  if (!moveBatchReview(1)) render();
  return true;
}

function openBatchResult(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return false;
  if (!visibleRows().some((item) => item.id === rowId)) {
    state.filter = "all";
    state.query = "";
    state.qualityFocus = null;
  }
  state.selectedId = rowId;
  state.batchReviewRowId = rowId;
  state.detailCollapsed = false;
  state.sourceText = "";
  state.sourceStatus = "idle";
  resetResearchForRow(row);
  resetAiForRow(row);
  try {
    localStorage.setItem(storageKey() + ":selection", rowId);
  } catch {
    state.saveError = "当前位置未保存";
  }
  render();
  document.querySelector("#batchReviewTitle")?.focus({ preventScroll: true });
  loadSelectedSource();
  return true;
}

function stopBatchAiReview() {
  if (!state.batchJob?.running) return false;
  state.batchJob.stopRequested = true;
  return true;
}

async function startBatchAiReview() {
  const rows = batchSelectedRows();
  if (!rows.length || state.batchJob?.running || !state.cloud.config?.consensusEnabled) return false;
  const modelCount = state.modelSettings.profiles.filter((profile) => profile.enabled && profile.configured).length;
  if (!modelCount) return false;
  if (!window.confirm(`将对 ${rows.length} 条记录执行三模型核验，预计调用 ${rows.length * modelCount} 次模型。完整共识将自动判过，是否继续？`)) return false;
  const job = {
    id: `batch-${Date.now().toString(36)}`,
    workspaceId: state.workspaceId,
    rowIds: rows.map((row) => row.id),
    total: rows.length,
    completed: 0,
    approved: 0,
    review: 0,
    failed: 0,
    currentId: "",
    running: true,
    stopRequested: false,
    stopped: false,
    results: [],
  };
  state.batchJob = job;
  render();
  for (const rowId of job.rowIds) {
    if (job.stopRequested || job.workspaceId !== state.workspaceId) {
      job.stopped = true;
      break;
    }
    const row = state.rows.find((item) => item.id === rowId);
    if (!row) {
      job.results.push({ rowId, rowLabel: "", ...batchAiOutcome("failed", "条目已不存在，无法继续核验。") });
      job.failed += 1;
      job.completed += 1;
      continue;
    }
    job.currentId = row.id;
    const outcome = await runBatchAiRow(row, job);
    job.results.push({
      rowId: row.id,
      rowLabel: fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注",
      ...outcome,
    });
    job.completed += 1;
    if (outcome.category === "approved") job.approved += 1;
    else if (outcome.category === "review") job.review += 1;
    else job.failed += 1;
    if (job.workspaceId === state.workspaceId) render();
  }
  job.running = false;
  job.currentId = "";
  job.stopped = job.stopped || job.stopRequested;
  if (job.workspaceId === state.workspaceId) render();
  return true;
}

function rememberUndo(row, label) {
  const checkpoint = reviewChangeCheckpoint(row);
  state.undoAction = { row: cloneRow(row), label, workspaceId: state.workspaceId };
  return checkpoint;
}

function finishReviewChange(row, type, reason, changes = [], checkpoint) {
  state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
  if (row.reviewed && !row.deleted) state.reviewState.confirmedIds.push(row.id);
  state.reviewState.edits[row.id] = editableSnapshot(row);
  state.manifest = buildManifest(state.rows);
  const rows = visibleRows();
  if (!rows.some((item) => item.id === state.selectedId)) {
    const index = Math.max(0, checkpoint.queueIds.indexOf(checkpoint.selectedId));
    state.selectedId = rows[Math.min(index, rows.length - 1)]?.id || "";
  }
  if (!saveWorkspace()) {
    restoreReviewCheckpoint(checkpoint);
    return false;
  }
  state.sourceText = "";
  state.sourceStatus = "idle";
  if (state.researchRowId !== state.selectedId) resetResearchForRow(selectedRow());
  syncRowChangeToCloud(row, type, reason, changes);
  render();
  loadSelectedSource();
  revealSelectedRow();
  return true;
}

function undoLastAction() {
  const undo = state.undoAction;
  if (!undo || undo.workspaceId !== state.workspaceId) return;
  const current = [...state.rows, ...state.trashRows].find((row) => row.id === undo.row.id);
  if (!current) return;
  const checkpoint = reviewChangeCheckpoint(current);
  const restored = cloneRow(undo.row);
  restored.cloudId = current.cloudId || restored.cloudId;
  restored.history = normalizeHistory(current).map((event) => ({ ...event }));
  restored.deleted = false;
  const revertingConsensus = normalizeHistory(current).at(-1)?.type === "ai-consensus-auto-approve";
  addHistory(restored, {
    type: revertingConsensus ? "ai-consensus-reverted" : "undo",
    actor: "human",
    reason: "撤销最近一次" + undo.label + "。",
    revertedConsensusRunId: revertingConsensus ? normalizeHistory(current).at(-1)?.consensusRun?.runId || "" : "",
    changes: []
  });
  const index = state.rows.findIndex((row) => row.id === restored.id);
  if (index < 0) state.rows.push(restored);
  else state.rows[index] = restored;
  state.trashRows = state.trashRows.filter((row) => row.id !== restored.id);
  state.reviewState.deletedIds = state.reviewState.deletedIds.filter((id) => id !== restored.id);
  state.undoAction = null;
  state.selectedId = restored.id;
  return finishReviewChange(restored, "undo", "撤销最近一次" + undo.label + "。", [], checkpoint);
}

function restoreTrashRow(rowId) {
  const row = state.trashRows.find((item) => item.id === rowId);
  if (!row || state.rows.some((item) => item.id === rowId)) return;
  const checkpoint = reviewChangeCheckpoint(row);
  row.deleted = false;
  delete row.deletedAt;
  addHistory(row, { type: "restore", actor: "human", reason: "从回收站恢复。", changes: [] });
  state.trashRows = state.trashRows.filter((item) => item.id !== rowId);
  state.rows.push(row);
  state.reviewState.deletedIds = state.reviewState.deletedIds.filter((id) => id !== rowId);
  state.undoAction = null;
  state.selectedId = row.id;
  return finishReviewChange(row, "restore", "从回收站恢复。", [], checkpoint);
}

function setProblemStatus(rowId, status, reason) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || !["open", "pending_review", "resolved"].includes(status)) return;
  if (status === "resolved" && !String(reason || "").trim()) return;
  const checkpoint = rememberUndo(row, "问题状态变更");
  const before = rowProblemStatus(row);
  row.problemResolution = { status, reason: String(reason || "").trim(), at: new Date().toISOString() };
  row.reviewed = status === "resolved";
  row.reviewedAt = row.reviewed ? new Date().toISOString() : "";
  const changes = [{ fieldId: "problemStatus", before, after: status }];
  addHistory(row, { type: "problem-" + status, actor: "human", reason, changes });
  state.resolutionRowId = "";
  return finishReviewChange(row, "problem-" + status, reason, changes, checkpoint);
}

function problemStatusControls(row) {
  const status = rowProblemStatus(row);
  if (status === "none") return "";
  const labels = { open: "待处理", pending_review: "待复核", resolved: "已解决" };
  return `
    <div class="problem-lifecycle" aria-label="问题处理状态">
      <strong>${labels[status]}</strong>
      ${status === "resolved" ? `<button type="button" data-row-action="reopen" data-row-id="${escapeHtml(row.id)}">重新打开</button>`
        : `${status === "open" ? `<button type="button" data-row-action="submit-review" data-row-id="${escapeHtml(row.id)}">提交复核</button>` : ""}
          <button type="button" data-row-action="resolve" data-row-id="${escapeHtml(row.id)}">解决问题</button>`}
      ${row.problemResolution?.reason ? `<p>${escapeHtml(row.problemResolution.reason)}</p>` : ""}
    </div>`;
}

function confirmRow(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  const checkpoint = rememberUndo(row, "确认");
  row.reviewed = true;
  row.reviewedAt = new Date().toISOString();
  const changes = [];
  addHistory(row, {
    type: "confirm",
    actor: "human",
    reason: "人工确认当前条目。",
    changes
  });
  return finishReviewChange(row, "confirm", "人工确认当前条目。", changes, checkpoint);
}

function confirmAndNext(rowId) {
  const rows = visibleRows();
  const current = rows.find((item) => item.id === rowId);
  if (!current) return false;
  const currentIndex = current ? rows.findIndex((row) => row.id === current.id) : -1;
  if (!current.reviewed && !confirmRow(current.id)) return false;
  if (!rows.length) return;
  const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, rows.length - 1) : 0;
  const next = rows[nextIndex];
  if (next && next.id !== current?.id) selectResult(next.id);
}

function toggleFlagRow(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  const checkpoint = rememberUndo(row, "问题标注");
  row.flagged = !row.flagged;
  if (row.flagged) row.problemResolution = { status: "open", at: new Date().toISOString() };
  const changes = [{ fieldId: "flagged", before: !row.flagged, after: row.flagged }];
  addHistory(row, {
    type: row.flagged ? "flag" : "unflag",
    actor: "human",
    reason: row.flagged ? "人工标注为有问题。" : "取消人工问题标注。",
    changes
  });
  return finishReviewChange(row, row.flagged ? "flag" : "unflag", row.flagged ? "人工标注为有问题。" : "取消人工问题标注。", changes, checkpoint);
}

function toggleProblemTag(rowId, tagKey) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row || !tagKey) return;
  const checkpoint = rememberUndo(row, "问题标签");
  const before = normalizeProblemTags(row);
  const nextRow = before.includes(tagKey)
    ? window.CalligraphyReviewWorkflow.removeProblemTag(row, tagKey)
    : window.CalligraphyReviewWorkflow.addProblemTag(row, tagKey);
  row.problemTags = normalizeProblemTags(nextRow);
  row.problemResolution = { status: "open", at: new Date().toISOString() };
  row.edited = true;
  const after = normalizeProblemTags(row);
  const changes = [{ fieldId: "problemTags", before: before.join(";"), after: after.join(";") }];
  addHistory(row, {
    type: "tag",
    actor: "human",
    reason: `更新问题标签：${after.map((tag) => window.CalligraphySchema?.tagLabel?.(tag) || tag).join("、") || "无"}`,
    changes
  });
  return finishReviewChange(row, "tag", "人工更新问题标签。", changes, checkpoint);
}

function deleteRow(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  const checkpoint = rememberUndo(row, "删除");
  if (!state.reviewState.deletedIds.includes(row.id)) {
    state.reviewState.deletedIds.push(row.id);
  }
  row.deleted = true;
  row.deletedAt = new Date().toISOString();
  addHistory(row, { type: "delete", actor: "human", reason: "移入回收站。", changes: [] });
  state.trashRows.push(row);
  state.rows = state.rows.filter((item) => item.id !== row.id);
  return finishReviewChange(row, "delete", "人工删除当前条目。", [], checkpoint);
}

function openEdit(rowId) {
  if (!state.rows.some((row) => row.id === rowId)) return;
  state.editingId = rowId;
  render();
}

function saveEdit(form) {
  const row = state.rows.find((item) => item.id === state.editingId);
  if (!row) return;
  const checkpoint = rememberUndo(row, "修订");
  const data = new FormData(form);
  const changes = [];
  orderedSchema().forEach((field) => {
    const before = String(fieldValue(row, field.id) || "");
    const after = String(data.get(`field:${field.id}`) || "");
    if (before !== after) changes.push({ fieldId: field.id, before, after });
    setFieldValue(row, field.id, after);
  });
  row.status = String(data.get("status") || "");
  row.hit = String(data.get("hit") || row.hit || "");
  row.sourceFile = normalizePageFile(fieldValue(row, "sourceFile") || fieldValue(row, "pageNo"));
  syncLegacyFields(row);
  row.abnormal = hasAbnormal(row);
  row.edited = true;
  row.reviewed = false;
  state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
  if (rowHasProblem(row) || row.problemResolution) {
    row.problemResolution = { status: "pending_review", at: new Date().toISOString(), reason: "字段已修改，待复核。" };
  }
  addHistory(row, {
    type: "human-edit",
    actor: "human",
    reason: String(data.get("editReason") || "人工修订字段。"),
    changes
  });
  const annotationBody = String(data.get("annotationBody") || "").trim();
  if (annotationBody) {
    const fieldId = String(data.get("annotationField") || "");
    const field = fieldId ? schemaField(fieldId) : null;
    const annotation = {
      id: `anno-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type: String(data.get("annotationType") || "other"),
      fieldId,
      fieldLabel: field?.label || "",
      body: annotationBody,
      at: new Date().toISOString(),
      actor: "human"
    };
    row.annotations = normalizeAnnotations(row);
    row.annotations.push(annotation);
    addHistory(row, {
      type: "annotation",
      actor: "human",
      reason: `新增批注：${annotationLabel(annotation.type)}`,
      changes: [{ fieldId: fieldId || "annotation", before: "", after: annotationBody }]
    });
  }
  state.editingId = "";
  return finishReviewChange(row, "human-edit", String(data.get("editReason") || "人工修订字段。"), changes, checkpoint);
}

function resetReviewState() {
  if (!window.confirm("将恢复全部条目的导入初稿。请先导出工作区备份。继续重置？")) return false;
  if (!saveWorkspace()) return false;
  const checkpoint = reviewChangeCheckpoint();
  state.reviewState = reviewDefaults();
  state.trashRows = [];
  state.undoAction = null;
  state.rows = state.originalRows.map(cloneRow);
  state.manifest = buildManifest(state.rows);
  state.selectedId = visibleRows()[0]?.id || "";
  state.editingId = "";
  state.resolutionRowId = "";
  if (!saveWorkspace()) {
    restoreReviewCheckpoint(checkpoint);
    return false;
  }
  state.sourceText = "";
  state.sourceStatus = "idle";
  resetResearchForRow(selectedRow());
  render();
  loadSelectedSource();
  return true;
}

function applyTemplate(templateId) {
  const template = templateById(templateId);
  if (state.rows.length && !window.confirm("切换模板会替换字段配置，但不会删除已导入的行数据。继续？")) {
    render();
    return;
  }
  state.schemaTemplateId = template.id;
  state.schema = defaultSchema(template.id);
  state.schemaVersion += 1;
  state.promptVersion += 1;
  state.rows.forEach(syncLegacyFields);
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function updateSchemaField(fieldId, prop, value) {
  const field = schemaField(fieldId);
  if (!field) return;
  field[prop] = value;
  state.schemaVersion += prop === "label" || prop === "visible" || prop === "required" || prop === "evidenceRequired" || prop === "type" ? 1 : 0;
  state.promptVersion += prop === "prompt" ? 1 : 0;
  saveWorkspace();
  if (prop === "label" || prop === "visible" || prop === "type") {
    render();
    if (state.view === "detail") loadSelectedSource();
  } else if (state.view === "detail") {
    updateAiDom(selectedRow());
  }
}

function normalizeSchemaOrder() {
  state.schema = orderedSchema().map((field, index) => ({ ...field, order: index + 1 }));
}

function moveSchemaField(fieldId, direction) {
  normalizeSchemaOrder();
  const index = state.schema.findIndex((field) => field.id === fieldId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= state.schema.length) return;
  const next = state.schema.slice();
  [next[index], next[target]] = [next[target], next[index]];
  state.schema = next.map((field, fieldIndex) => ({ ...field, order: fieldIndex + 1 }));
  state.schemaVersion += 1;
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function deleteSchemaField(fieldId) {
  if (ensureSchema().length <= 1) return;
  const field = schemaField(fieldId);
  if (!field) return;
  const hasValues = state.rows.some((row) => String(fieldValue(row, fieldId) || "").trim());
  if (hasValues && !window.confirm(`删除字段“${field.label}”？已有行里该字段的历史仍保留在导出 JSON 中，但当前表格不再显示它。`)) return;
  state.schema = ensureSchema().filter((item) => item.id !== fieldId);
  normalizeSchemaOrder();
  state.schemaVersion += 1;
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function resetSchemaToTemplate() {
  if (!window.confirm("恢复当前模板的默认字段配置？上传的数据和审校历史不会清空。")) return;
  state.schema = defaultSchema(state.schemaTemplateId);
  state.schemaVersion += 1;
  state.promptVersion += 1;
  state.rows.forEach(syncLegacyFields);
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function saveCurrentAsCustomTemplate() {
  const name = window.prompt("给这个字段模板起个名字：", `${templateById(state.schemaTemplateId).name} 副本`);
  if (!name?.trim()) return;
  const templates = loadCustomTemplates();
  const id = `custom-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const template = {
    id,
    name: name.trim(),
    description: "用户保存的本地字段模板。",
    custom: true,
    fields: cloneSchema(orderedSchema())
  };
  saveCustomTemplates([...templates, template]);
  state.schemaTemplateId = id;
  state.schema = cloneSchema(template.fields);
  state.schemaVersion += 1;
  state.promptVersion += 1;
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function copyCurrentTemplate() {
  const current = templateById(state.schemaTemplateId);
  const id = `custom-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const template = {
    id,
    name: `${current.name} 副本`,
    description: current.description || "复制的字段模板。",
    custom: true,
    fields: cloneSchema(orderedSchema())
  };
  saveCustomTemplates([...loadCustomTemplates(), template]);
  state.schemaTemplateId = id;
  state.schema = cloneSchema(template.fields);
  state.schemaVersion += 1;
  state.promptVersion += 1;
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function deleteCurrentCustomTemplate() {
  const current = templateById(state.schemaTemplateId);
  if (!current.custom) return;
  if (!window.confirm(`删除我的模板“${current.name}”？当前行数据不会删除。`)) return;
  saveCustomTemplates(loadCustomTemplates().filter((template) => template.id !== current.id));
  state.schemaTemplateId = "calligraphy-style";
  state.schema = defaultSchema(state.schemaTemplateId);
  state.schemaVersion += 1;
  state.promptVersion += 1;
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function addSchemaField() {
  const next = ensureSchema().length + 1;
  const id = `custom_${next}`;
  state.schema.push({
    id,
    label: `自定义字段 ${next}`,
    type: "text",
    prompt: "说明这个字段要从材料中抽取什么，以及何时留空。",
    required: false,
    evidenceRequired: false,
    visible: true,
    order: next
  });
  state.rows.forEach((row) => {
    setFieldValue(row, id, "");
  });
  state.schemaVersion += 1;
  state.promptVersion += 1;
  saveWorkspace();
  render();
  if (state.view === "detail") loadSelectedSource();
}

function downloadBlob(filename, content, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportWorkspace() {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = state.datasetName.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-").slice(0, 48) || "calligraphy-workspace";
  downloadBlob(`${stamp}-${safeName}.json`, JSON.stringify(workspacePayload(), null, 2));
}

function downloadTemplateCsv() {
  const schemaHeaders = orderedSchema().map((field) => field.label);
  const headers = ["材料ID", "附表", "二轮状态", ...schemaHeaders, "原文命中"];
  const sampleFields = orderedSchema().map((field) => {
    if (field.id === "author") return "张旭";
    if (field.id === "scriptType") return "草书";
    if (field.id === "quote") return "示例摘录";
    if (field.id === "pageNo") return "191";
    if (field.id === "sourceFile") return "page_191.txt";
    if (field.id === "confidence") return "高";
    if (field.id === "gate") return "可入主表";
    return "";
  });
  const sample = ["ITEM-0001", "附表A｜确定风格主表", "待审校", ...sampleFields, "exact"];
  downloadBlob("calligraphy-workspace-template.csv", `${headers.join(",")}\n${sample.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")}\n`, "text/csv;charset=utf-8");
}

function exportFieldQualityCsv() {
  const headers = ["字段ID", "字段名", "字段类型", "必填", "需证据", "已填", "空值", "填充率", "缺必填行", "缺证据行"];
  const rows = fieldQualityStats().map((item) => [
    item.field.id,
    item.field.label,
    item.field.type,
    item.field.required ? "是" : "否",
    item.field.evidenceRequired ? "是" : "否",
    item.filled,
    item.empty,
    `${item.fillRate}%`,
    item.missingRequired,
    item.missingEvidence
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(`${stamp}-field-quality.csv`, `${csv}\n`, "text/csv;charset=utf-8");
}

function exportFields() {
  return [
    { key: "id", label: "材料ID" },
    { key: "importFileName", label: "导入文件" },
    { key: "appendix", label: "附表" },
    { key: "bucket", label: "队列" },
    { key: "status", label: "状态" },
    ...orderedSchema().map((field) => ({ key: field.id, label: field.label })),
    { key: "hit", label: "原文命中" },
    { key: "problemTags", label: "问题标签" },
    { key: "problemStatus", label: "问题状态" },
    { key: "resolutionReason", label: "处理结论" },
    { key: "flagged", label: "人工标注" },
    { key: "reviewed", label: "已确认" },
    { key: "edited", label: "已修改" },
  ];
}

function exportableRows(rows = state.rows) {
  return rows.map((row) => ({
    id: row.id,
    importFileName: row.importFileName || "",
    appendix: row.appendix || "",
    bucket: filters.find((item) => item.id === row.bucket)?.label || row.bucket || "",
    status: row.triageStatus || row.status || "",
    ...Object.fromEntries(orderedSchema().map((field) => [field.id, fieldValue(row, field.id)])),
    confidence: sourceQuality(row).label,
    hit: row.hit || "",
    problemTags: normalizeProblemTags(row).map((tag) => window.CalligraphySchema?.tagLabel?.(tag) || tag),
    problemStatus: ({ open: "待处理", pending_review: "待复核", resolved: "已解决", none: "" })[rowProblemStatus(row)],
    resolutionReason: row.problemResolution?.reason || "",
    flagged: row.flagged ? "是" : "否",
    reviewed: row.reviewed ? "是" : "否",
    edited: row.edited ? "是" : "否",
  }));
}

function reviewLogRows() {
  return [...state.rows, ...state.trashRows].flatMap((row) => normalizeHistory(row).map((event) => ({
    createdAt: event.at || "",
    rowId: row.id,
    action: event.type || "",
    actor: event.actor || "",
    detail: [event.reason || "", ...(event.changes || []).map((change) =>
      (schemaField(change.fieldId)?.label || change.fieldId) + ": " + String(change.before ?? "") + " → " + String(change.after ?? ""))].join("；"),
  })));
}

function exportMainTableCsv() {
  openExportPanel();
}

function openExportPanel(scope = "all") {
  state.exportOpen = true;
  state.exportScope = scope === "selected" && batchSelectedRows().length ? "selected" : "all";
  state.exportMode = "draft";
  state.exportMessage = "";
  render();
}

function deliveryRows() {
  if (state.exportScope === "selected") return batchSelectedRows();
  return state.exportScope === "view" ? visibleRows() : state.rows;
}

function deliveryScopeLabel() {
  return state.exportScope === "selected" ? "选中条目" : state.exportScope === "view" ? "当前筛选" : "全部主表";
}

function deliveryFacts(rows) {
  return rows.map((row) => ({
    id: row.id, reviewed: Boolean(row.reviewed) && !rowValidation(row).confirmedThenChanged,
    hasProblem: rowHasProblem(row),
    missingRequired: rowValidation(row).missingRequired.length > 0,
    sourceRank: sourceQuality(row).rank
  }));
}

function releaseFields() {
  const fields = orderedSchema().filter((field) =>
    (field.visible || ["sourceFile", "pageNo"].includes(field.id)) && !["gate", "issue"].includes(field.id));
  return [{ key: "id", label: "材料ID" }, ...fields.map((field) => ({ key: field.id, label: field.label }))];
}

function createFormalRelease() {
  const rows = deliveryRows();
  const facts = deliveryFacts(rows);
  if (!window.CalligraphyExportWorkflow.assessRelease(facts).ready) {
    state.exportMessage = "请先处理所选范围的阻塞条目。";
    render();
    return false;
  }
  const version = Math.max(0, ...state.exportVersions.map((item) => Number(item.version) || 0)) + 1;
  const id = newWorkspaceId();
  const snapshot = window.CalligraphyExportWorkflow.createRelease({
    metadata: {
      id, version, workspaceId: state.workspaceId, datasetName: state.datasetName,
      createdAt: new Date().toISOString(), actor: state.cloud.user?.email || "本地用户",
      scope: state.exportScope, scopeLabel: deliveryScopeLabel(),
      selection: { filter: state.filter, query: state.query, qualityFocus: state.qualityFocus },
      schemaVersion: state.schemaVersion, rulesVersion: "delivery-v1",
      filename: "书论成果-v" + String(version).padStart(3, "0") + "-" + id.slice(0, 8)
    },
    facts, rows: exportableRows(rows), fields: releaseFields(),
    sourcePages: Object.fromEntries([...new Set(rows.map((row) => row.sourceFile).filter(Boolean))]
      .map((name) => [name, cachedSourceText(name) || ""])),
    auditRows: rows
  });
  const previous = state.exportVersions;
  const previousLog = state.uploadLog;
  state.exportVersions = [...previous, snapshot];
  state.uploadLog = [...previousLog, logEntry("success", "正式成果 v" + version, "已保存 " + rows.length + " 条成果快照", { step: "成果导出", rows: rows.length })];
  if (!saveWorkspace()) {
    state.exportVersions = previous;
    state.uploadLog = previousLog;
    state.exportMessage = "版本未保存，未生成正式成果。可先下载工作草稿或工作区备份。";
    render();
    return false;
  }
  state.exportMessage = "已保存 v" + version + " · " + rows.length + " 条";
  render();
  downloadRelease(id, "csv");
  return true;
}

function downloadRelease(id, format = "csv") {
  const snapshot = state.exportVersions.find((item) => item.id === id);
  if (!snapshot) return;
  if (format === "json") {
    downloadBlob(snapshot.filename + ".json", JSON.stringify(snapshot, null, 2));
  } else {
    downloadBlob(snapshot.filename + ".csv", snapshot.csv, "text/csv;charset=utf-8");
  }
}

function downloadWorkingDraft() {
  const rows = deliveryRows();
  if (!rows.length) return;
  const csv = window.CalligraphyExportWorkflow.buildMainExport(exportableRows(rows), exportFields());
  const scope = deliveryScopeLabel();
  downloadBlob("工作草稿-" + scope + "-" + new Date().toISOString().slice(0, 10) + ".csv", "\uFEFF" + csv + "\r\n", "text/csv;charset=utf-8");
}

function inspectDeliveryBlockers(key) {
  const assessment = window.CalligraphyExportWorkflow.assessRelease(deliveryFacts(deliveryRows()));
  const rowIds = assessment.issues.filter((item) => !key || item.reasons.includes(key)).map((item) => item.id);
  state.exportOpen = false;
  navigateToView("detail", "review");
  state.filter = "all";
  state.query = "";
  state.qualityFocus = { mode: "delivery", rowIds, label: window.CalligraphyExportWorkflow.releaseChecks.find((item) => item.key === key)?.label || "成果检查" };
  state.selectedId = rowIds[0] || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function deliveryModal() {
  if (!state.exportOpen) return "";
  const rows = deliveryRows();
  const assessment = window.CalligraphyExportWorkflow.assessRelease(deliveryFacts(rows));
  const formal = state.exportMode === "formal";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="成果导出">
      <form class="edit-modal delivery-modal" id="deliveryForm">
        <div class="modal-head"><h2>成果导出</h2><button type="button" data-export-close aria-label="关闭成果导出" title="关闭">×</button></div>
        <div class="delivery-options">
          <fieldset><legend>类型</legend>
            <label><input type="radio" name="deliveryMode" value="draft" ${!formal ? "checked" : ""}>工作草稿</label>
            <label><input type="radio" name="deliveryMode" value="formal" ${formal ? "checked" : ""}>正式成果</label>
          </fieldset>
          <label>范围<select name="deliveryScope"><option value="all" ${state.exportScope === "all" ? "selected" : ""}>全部主表</option><option value="view" ${state.exportScope === "view" ? "selected" : ""}>当前筛选</option>${batchSelectedRows().length ? `<option value="selected" ${state.exportScope === "selected" ? "selected" : ""}>选中条目</option>` : ""}</select></label>
        </div>
        <div class="import-counts"><span><b>${rows.length}</b>所选条目</span><span><b>${assessment.blocked}</b>阻塞条目</span><span><b>${rows.length - assessment.blocked}</b>通过检查</span></div>
        <div class="delivery-checks">${assessment.checks.map((check) => `<button type="button" data-delivery-blocker="${check.key}" ${check.count ? "" : "disabled"}><span>${check.label}</span><strong>${check.count}</strong></button>`).join("")}</div>
        ${formal ? '<p class="muted">正式成果包含研究字段与出处，审校记录和原文保存在成果包中。</p>' : '<p class="muted">草稿保留全部工作字段及未完成条目。</p>'}
        ${state.exportMessage ? `<p class="delivery-message" role="status">${escapeHtml(state.exportMessage)}</p>` : ""}
        <details class="delivery-history" ${state.exportVersions.length ? "open" : ""}>
          <summary>版本记录（${state.exportVersions.length}）</summary>
          <div class="workflow-list-scroll">${state.exportVersions.slice().reverse().map((item) => `
            <article><div><strong>v${escapeHtml(item.version)} · ${item.rows.length} 条</strong><p>${escapeHtml(formatLocalTime(item.createdAt))} · ${escapeHtml(item.scopeLabel)}</p></div>
              <div class="delivery-downloads"><button type="button" data-release-csv="${escapeHtml(item.id)}">CSV</button><button type="button" data-release-json="${escapeHtml(item.id)}">成果包</button></div>
            </article>`).join("") || "<p>暂无正式成果版本</p>"}</div>
        </details>
        <div class="modal-actions"><button type="button" data-workspace-export>工作区备份</button><button type="submit" ${!rows.length || (formal && !assessment.ready) ? "disabled" : ""}>${formal ? "生成正式版本" : "下载草稿"}</button></div>
      </form>
    </div>`;
}

function exportProblemRowsCsv() {
  if (!state.rows.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = window.CalligraphyExportWorkflow.buildMainExport(exportableRows(state.rows.filter(rowHasProblem)), exportFields());
  downloadBlob(`${stamp}-问题条目.csv`, `${csv}\n`, "text/csv;charset=utf-8");
}

function exportReviewLogCsv() {
  if (!state.rows.length && !state.trashRows.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = window.CalligraphyExportWorkflow.buildReviewLogExport(reviewLogRows());
  downloadBlob(`${stamp}-审校日志.csv`, `${csv}\n`, "text/csv;charset=utf-8");
}

function resetWorkspace() {
  if (state.rows.length && !window.confirm("清空当前浏览器里的书论工作区？此操作不会影响其他用户或线上代码。")) return;
  if (!clearWorkspace()) return;
  state.view = "home";
  location.hash = "#home";
  render();
}

function handleRowAction(action, rowId) {
  if (action === "resolve") { state.resolutionRowId = rowId; render(); }
  if (action === "submit-review") setProblemStatus(rowId, "pending_review", "已完成处理，提交复核。");
  if (action === "reopen") setProblemStatus(rowId, "open", "人工重新打开问题。");
  if (action === "confirm") confirmRow(rowId);
  if (action === "confirm-next") confirmAndNext(rowId);
  if (action === "flag") toggleFlagRow(rowId);
  if (action === "edit") openEdit(rowId);
  if (action === "delete") deleteRow(rowId);
  if (action === "next") nextResult();
  if (action === "previous") previousResult();
}

function setQualityFocus(fieldId, mode) {
  state.qualityFocus = { fieldId, mode };
  state.filter = "all";
  state.selectedId = visibleRows()[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function clearQualityFocus() {
  state.qualityFocus = null;
  state.selectedId = visibleRows()[0]?.id || state.rows[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function appendIssue(row, note) {
  const current = String(fieldValue(row, "issue") || row.issue || "").trim();
  const next = current.includes(note) ? current : [current, note].filter(Boolean).join("；");
  setFieldValue(row, "issue", next);
  row.issue = next;
}

function batchMarkVisibleReview() {
  const rows = visibleRows();
  if (!rows.length) return false;
  if (!window.confirm(`将当前队列的 ${rows.length} 行标记为待复核？`)) return false;
  const checkpoint = reviewChangeCheckpoint(rows);
  rows.forEach((row) => {
    const beforeIssue = String(fieldValue(row, "issue") || row.issue || "");
    row.status = "待复核";
    row.bucket = "review";
    row.edited = true;
    row.problemResolution = { status: "open", at: new Date().toISOString(), reason: "批量标记待复核。" };
    row.reviewed = false;
    state.reviewState.confirmedIds = state.reviewState.confirmedIds.filter((id) => id !== row.id);
    appendIssue(row, "批量队列标记待复核");
    addHistory(row, {
      type: "batch-review",
      actor: "human",
      reason: "从字段质量队列批量标记为待复核。",
      changes: [{ fieldId: "issue", before: beforeIssue, after: row.issue }]
    });
    state.reviewState.edits[row.id] = editableSnapshot(row);
  });
  state.undoAction = null;
  state.manifest = buildManifest(state.rows);
  const remaining = visibleRows();
  if (!remaining.some((row) => row.id === state.selectedId)) state.selectedId = remaining[0]?.id || "";
  if (!saveWorkspace()) {
    restoreReviewCheckpoint(checkpoint);
    return false;
  }
  state.sourceText = "";
  state.sourceStatus = "idle";
  if (state.researchRowId !== state.selectedId) resetResearchForRow(selectedRow());
  render();
  loadSelectedSource();
  return true;
}

function setDetailDock(collapsed) {
  state.detailCollapsed = collapsed;
  const screen = document.querySelector(".review-screen");
  const panel = document.querySelector(".detail-panel");
  const button = document.querySelector("[data-detail-toggle]");
  screen?.classList.toggle("detail-collapsed", state.detailCollapsed);
  panel?.classList.toggle("collapsed", state.detailCollapsed);
  triggerWorkbenchMotion(state.detailCollapsed ? "detail-closing" : "detail-opening", 520);
  if (button) {
    const label = state.detailCollapsed ? "展开条目详情" : "收起条目详情";
    button.textContent = state.detailCollapsed ? "‹" : "›";
    button.setAttribute("aria-expanded", String(!state.detailCollapsed));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
}

function toggleDetailDock() {
  if (state.aiPanelOpen) return false;
  setDetailDock(!state.detailCollapsed);
  return true;
}

function toggleFilters() {
  state.filtersCollapsed = !state.filtersCollapsed;
  const controls = document.querySelector(".controls");
  const button = document.querySelector("[data-filter-toggle]");
  triggerWorkbenchMotion("filter-motion", 360);
  controls?.classList.toggle("collapsed", state.filtersCollapsed);
  if (button) {
    const label = state.filtersCollapsed ? "展开筛选" : "收起筛选";
    button.textContent = state.filtersCollapsed ? "⌄" : "⌃";
    button.setAttribute("aria-expanded", String(!state.filtersCollapsed));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
}

function applyTableViewState() {
  const screen = document.querySelector(".review-screen");
  const shell = document.querySelector(".app-shell");
  const headButton = document.querySelector("[data-table-head-toggle]");
  const railButtons = document.querySelectorAll("[data-rail-toggle]");
  const focusButton = document.querySelector("[data-table-focus]");
  screen?.classList.toggle("detail-collapsed", state.detailCollapsed);
  screen?.classList.toggle("rail-collapsed", state.railCollapsed || state.tableFocus);
  screen?.classList.toggle("table-focus", state.tableFocus);
  screen?.classList.toggle("table-head-collapsed", state.tableHeaderCollapsed);
  shell?.classList.toggle("table-focus-shell", state.tableFocus);
  if (headButton) {
    const label = state.tableHeaderCollapsed ? "显示表头" : "收起表头";
    headButton.textContent = "▤";
    headButton.classList.toggle("active", state.tableHeaderCollapsed);
    headButton.setAttribute("aria-pressed", String(state.tableHeaderCollapsed));
    headButton.setAttribute("aria-label", label);
    headButton.setAttribute("title", label);
  }
  railButtons.forEach((railButton) => {
    if (!railButton.classList.contains("rail-collapse-control") && !railButton.classList.contains("rail-restore-control")) {
      railButton.textContent = state.railCollapsed ? "显示侧栏" : "隐藏侧栏";
    }
    railButton.classList.toggle("active", state.railCollapsed);
    railButton.setAttribute("aria-pressed", String(state.railCollapsed));
    railButton.setAttribute("aria-label", state.railCollapsed ? "显示左侧栏" : "隐藏左侧栏");
    railButton.setAttribute("title", state.railCollapsed ? "显示左侧栏" : "隐藏左侧栏");
  });
  if (focusButton) {
    const label = state.tableFocus ? "退出表格专注" : "进入表格专注";
    focusButton.textContent = "⛶";
    focusButton.classList.toggle("active", state.tableFocus);
    focusButton.setAttribute("aria-pressed", String(state.tableFocus));
    focusButton.setAttribute("aria-label", label);
    focusButton.setAttribute("title", label);
  }
}

function toggleRail() {
  if (state.aiPanelOpen) return false;
  triggerWorkbenchMotion(state.railCollapsed ? "rail-opening" : "rail-closing", 560);
  state.railCollapsed = !state.railCollapsed;
  applyTableViewState();
  return true;
}

function toggleTableHeader() {
  state.tableHeaderCollapsed = !state.tableHeaderCollapsed;
  applyTableViewState();
}

function toggleConfidenceSort() {
  state.confidenceSort = state.confidenceSort === "desc" ? "asc" : "desc";
  state.selectedId = visibleRows()[0]?.id || "";
  render();
  loadSelectedSource();
}

function toggleTableFocus() {
  if (state.aiPanelOpen) return false;
  state.tableFocus = !state.tableFocus;
  if (state.tableFocus) {
    state.detailCollapsed = true;
    state.filtersCollapsed = true;
  }
  render();
  loadSelectedSource();
  return true;
}

function reviewStats() {
  const validations = state.rows.map(rowValidation);
  return {
    confirmed: state.rows.filter((row) => row.reviewed).length,
    edited: state.rows.filter((row) => row.edited).length,
    deleted: state.reviewState.deletedIds.length,
    flagged: state.rows.filter((row) => row.flagged).length,
    problem: state.rows.filter(rowHasProblem).length,
    invalid: validations.filter((validation) => !validation.ok).length,
    missingRequired: validations.filter((validation) => validation.missingRequired.length).length
  };
}

function triageStats(limit = 7) {
  return Object.entries(countBy(state.rows, "triageStatus"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function triageStatusPanel() {
  const items = triageStats();
  if (!items.length) return `<p class="muted">导入后显示第三轮队列分布。</p>`;
  return `
    <div class="triage-status-list">
      ${items.map(([label, count]) => `
        <button type="button" data-status-filter="${escapeHtml(label)}">
          <span>${escapeHtml(label || "未标注")}</span>
          <strong>${formatCount(count)}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function reviewToolbar() {
  const stats = reviewStats();
  return `
    <div class="review-toolbar">
      <span>已确认 <strong>${stats.confirmed}</strong></span>
      <span>已修改 <strong>${stats.edited}</strong></span>
      <span>人工标注 <strong>${stats.flagged}</strong></span>
      <span>问题队列 <strong>${stats.problem}</strong></span>
      <span>字段待补 <strong>${stats.invalid}</strong></span>
      <span>缺必填 <strong>${stats.missingRequired}</strong></span>
      <button type="button" data-trash-open>回收站 ${state.trashRows.length}</button>
      <button type="button" data-review-undo ${state.undoAction ? "" : "disabled"} aria-label="撤销最近操作" title="${state.undoAction ? "撤销" + escapeHtml(state.undoAction.label) : "暂无可撤销操作"}">↶</button>
      <button type="button" data-review-reset>重置审校</button>
    </div>
  `;
}

function qualityFocusBar(rows) {
  if (!state.qualityFocus) return "";
  if (["delivery", "dashboard"].includes(state.qualityFocus.mode)) return `
    <div class="queue-bar"><span>${escapeHtml(state.qualityFocus.label)} · ${rows.length} 条</span>
    <button type="button" data-main-table-export>重新检查成果</button><button type="button" data-quality-clear>清除队列</button></div>`;
  if (state.qualityFocus.mode === "triage") {
    return `
      <div class="queue-bar">
        <span>当前队列：${escapeHtml(state.qualityFocus.value || "未标注")} · ${rows.length} 行</span>
        <button type="button" data-quality-clear>清除队列</button>
      </div>
    `;
  }
  const field = schemaField(state.qualityFocus.fieldId);
  const modeLabel = {
    empty: "空值",
    evidence: "缺证据",
    required: "缺必填",
    issue: "全部问题"
  }[state.qualityFocus.mode] || "问题";
  return `
    <div class="queue-bar">
      <span>当前队列：${escapeHtml(field?.label || state.qualityFocus.fieldId)} · ${escapeHtml(modeLabel)} · ${rows.length} 行</span>
      <button type="button" data-quality-batch-review ${rows.length ? "" : "disabled"}>批量标记待复核</button>
      <button type="button" data-quality-clear>清除队列</button>
    </div>
  `;
}

function updateReviewToolbarDom() {
  const toolbar = document.querySelector(".review-toolbar");
  if (toolbar) toolbar.outerHTML = reviewToolbar();
  document.querySelector("[data-review-reset]")?.addEventListener("click", resetReviewState);
  document.querySelector("[data-review-undo]")?.addEventListener("click", undoLastAction);
  document.querySelector("[data-trash-open]")?.addEventListener("click", () => { state.trashOpen = true; render(); });
  attachQueueFilterEvents();

  document.querySelectorAll("[data-quality-focus]").forEach((button) => {
    button.addEventListener("click", () => setQualityFocus(button.dataset.qualityFocus, button.dataset.qualityMode));
  });

  attachQueueFilterEvents();
  document.querySelector("[data-quality-clear]")?.addEventListener("click", clearQualityFocus);
  document.querySelector("[data-quality-batch-review]")?.addEventListener("click", batchMarkVisibleReview);
}

function attachQueueFilterEvents() {
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.motionName = "queue";
      state.filter = "all";
      state.qualityFocus = { mode: "triage", value: button.dataset.statusFilter || "" };
      state.selectedId = visibleRows()[0]?.id || "";
      state.sourceText = "";
      state.sourceStatus = "idle";
      render();
      loadSelectedSource();
    });
  });
}

function updateVisibleCountDom() {
  const count = document.querySelector(".visible-count");
  if (count) count.textContent = `${visibleRows().length} / ${state.rows.length}`;
}

function updateTableRowStatus(row) {
  const tableRow = document.querySelector(`tbody tr[data-row-id="${CSS.escape(row.id)}"]`);
  if (!tableRow) return;
  tableRow.classList.toggle("abnormal", sourceNeedsReview(row));
  tableRow.classList.toggle("flagged", row.flagged);
  tableRow.classList.toggle("invalid", !rowValidation(row).ok);
  const reviewCellEl = tableRow.children[1];
  const validationCell = tableRow.children[2];
  const confidenceCell = tableRow.children[3];
  if (reviewCellEl) reviewCellEl.innerHTML = reviewCell(row);
  if (validationCell) validationCell.innerHTML = validationBadge(row);
  if (confidenceCell) confidenceCell.innerHTML = confidencePill(row);
}

function appendixBars() {
  const entries = Object.entries(state.manifest.stats.appendix);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return entries.map(([label, value]) => `
    <div class="bar-row">
      <span>${escapeHtml(label.replace("｜", " "))}</span>
      <div><i style="width:${Math.max(8, Math.round((value / max) * 100))}%"></i></div>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function editModal() {
  const row = state.rows.find((item) => item.id === state.editingId);
  if (!row) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="修改条目">
      <form class="edit-modal" id="editForm">
        <div class="modal-head">
          <div>
            <p class="kicker">Edit Row</p>
            <h2>修改条目</h2>
            <p>${escapeHtml(row.id)} · 修改后会进入当前浏览器审校记录。</p>
          </div>
          <button type="button" data-edit-cancel>关闭</button>
        </div>
        <div class="edit-grid">
          <label>二轮状态<input name="status" value="${escapeHtml(row.status)}" /></label>
          <label>原文命中
            <select name="hit">
              ${["exact", "compact", "partial", "miss", ""].map((hit) => `<option value="${hit}" ${row.hit === hit ? "selected" : ""}>${hit || "none"}</option>`).join("")}
            </select>
          </label>
          ${orderedSchema().map((field) => {
            const value = fieldValue(row, field.id);
            const wide = field.type === "longtext" || String(value).length > 42;
            const control = field.type === "longtext"
              ? `<textarea name="field:${escapeHtml(field.id)}" rows="3">${escapeHtml(value)}</textarea>`
              : `<input name="field:${escapeHtml(field.id)}" value="${escapeHtml(value)}" />`;
            return `
              <label class="${wide ? "wide" : ""}">
                <span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>
                ${control}
                <small>${escapeHtml(field.prompt || "")}</small>
              </label>
            `;
          }).join("")}
          <label class="wide">
            <span>修改原因/复核说明</span>
            <textarea name="editReason" rows="3" placeholder="说明为什么修改，方便后续回溯。"></textarea>
          </label>
          <label>
            <span>新增批注类型</span>
            <select name="annotationType">
              <option value="">不添加批注</option>
              ${annotationTypes.map((type) => `<option value="${escapeHtml(type.id)}">${escapeHtml(type.label)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>关联字段</span>
            <select name="annotationField">
              <option value="">整条记录</option>
              ${orderedSchema().map((field) => `<option value="${escapeHtml(field.id)}">${escapeHtml(field.label)}</option>`).join("")}
            </select>
          </label>
          <label class="wide">
            <span>批注内容</span>
            <textarea name="annotationBody" rows="3" placeholder="记录页码、归属、摘录、字段映射或专家判断问题。"></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" data-edit-cancel>取消</button>
          <button type="submit">保存修改</button>
        </div>
      </form>
    </div>
  `;
}

function importIssueEntries() {
  return state.importReports.flatMap((report, reportIndex) => (report.issues || []).map((issue, issueIndex) =>
    ({ report, issue, reportIndex, issueIndex, key: `${reportIndex}:${issueIndex}` })));
}

function conflictSourceFile(issue) {
  return issue.sourceFile || ((issue.sourceConflict || issue.reason?.includes("同名原文")) ? issue.row?.sourceFile : "") || "";
}

function resolveImportIssue(reportIndex, issueIndex, action, reason = "", quoteOverride) {
  const original = state.importReports[reportIndex];
  const originalIssue = original?.issues?.[issueIndex];
  const fail = (message) => { state.conflictMessage = message; render(); return false; };
  if (!originalIssue || !["keep", "add", "reopen"].includes(action)) return fail("冲突记录不存在，请重新选择。");
  if (originalIssue.resolution && action !== "reopen") return true;
  reason = String(reason).trim();
  if (!reason) return fail("请填写处理依据。");
  const report = cloneRow(original);
  const issue = report.issues[issueIndex];
  const sourceFile = conflictSourceFile(issue);
  const sourceText = report.sourceConflicts?.[sourceFile];
  const identity = issue.identity || window.CalligraphyImportWorkflow.issueIdentity(issue.row, sourceFile, sourceText ?? null);
  const actor = state.cloud.user?.email || "本地用户";
  const at = new Date().toISOString();
  const decision = { action, reason, actor, at };
  const before = Object.fromEntries(["rows", "originalRows", "uploadedPages", "importReports", "uploadLog", "undoAction"]
    .map((key) => [key, state[key]]));
  let addedRow = null;
  let versionFile = "";
  if (action === "add") {
    const existing = [...state.rows, ...state.trashRows].find((row) =>
      row.id === issue.acceptedRowId || row.importConflictKey === identity);
    if (existing && state.trashRows.includes(existing)) return fail("另存条目已在回收站，请先恢复，不会重复创建。");
    if (existing) {
      decision.resultId = existing.id;
    } else {
      if (sourceFile) {
        if (typeof sourceText !== "string") return fail("旧报告未保存冲突原文，请重新导入原文件后再另存。");
        versionFile = report.sourceVersions?.[sourceFile];
        if (!versionFile || state.uploadedPages.get(versionFile) !== sourceText) {
          const sameVersion = [...state.uploadedPages].find(([name, text]) =>
            name.startsWith(sourceFile.replace(/(?:__v[^.]*)?\.txt$/i, "") + "__v") && text === sourceText);
          versionFile = sameVersion?.[0] || sourceFile.replace(/(?:__v[^.]*)?\.txt$/i, "") + "__v" + newWorkspaceId() + ".txt";
        }
        decision.resultFile = versionFile;
        report.sourceVersions = { ...(report.sourceVersions || {}), [sourceFile]: versionFile };
      }
      if (issue.row) {
        const quote = String(quoteOverride ?? issue.row.fields?.quote ?? issue.row.quote ?? "").trim();
        if (!quote) return fail("请补齐原文摘录后再入表。");
        addedRow = cloneRow(issue.row);
        addedRow.id = "alternative-" + newWorkspaceId();
        ["cloudId", "deleted", "deletedAt", "reviewedAt"].forEach((key) => delete addedRow[key]);
        addedRow.reviewed = false;
        addedRow.edited = false;
        addedRow.flagged = true;
        addedRow.problemTags = [...new Set([...(addedRow.problemTags || []), "manual_review"])];
        addedRow.problemResolution = { status: "open", reason, at, actor };
        addedRow.importConflictKey = identity;
        setFieldValue(addedRow, "quote", quote);
        if (versionFile) setFieldValue(addedRow, "sourceFile", versionFile);
        syncLegacyFields(addedRow);
        addedRow.originalImportOrigin = addedRow.importOrigin;
        addedRow.importOrigin = { key: JSON.stringify(["alternative", addedRow.id]),
          signature: window.CalligraphyImportWorkflow.contentSignature(addedRow) };
        addHistory(addedRow, { type: "import-conflict-add", actor, reason,
          changes: ["quote", "sourceFile"].filter((fieldId) => issue.row.fields?.[fieldId] !== addedRow.fields[fieldId])
            .map((fieldId) => ({ fieldId, before: issue.row.fields?.[fieldId] || "", after: addedRow.fields[fieldId] })) });
        decision.resultId = addedRow.id;
      } else if (!versionFile) return fail("报告缺少可导入内容，请重新导入文件。");
    }
  }
  issue.identity = identity;
  issue.resolutionHistory = [...(issue.resolutionHistory || []), decision];
  issue.resolution = action === "reopen" ? null : decision;
  if (decision.resultId) issue.acceptedRowId = decision.resultId;
  if (addedRow) {
    state.rows = [...state.rows, addedRow];
    state.originalRows = [...state.originalRows, cloneRow(addedRow)];
    state.undoAction = null;
  }
  if (versionFile) state.uploadedPages = new Map([...state.uploadedPages, [versionFile, sourceText]]);
  state.importReports = state.importReports.map((item, index) => index === reportIndex ? report : item);
  state.uploadLog = [...state.uploadLog, logEntry("success", issue.row?.id || sourceFile,
    ({ keep: "保留当前内容", add: "另存待审", reopen: "重新处理" })[action] + "：" + reason,
    { step: "导入冲突", actor, resultId: decision.resultId || "", resultFile: decision.resultFile || "" })];
  if (!saveWorkspace()) {
    Object.assign(state, before);
    return fail("保存失败，本次处理未生效。请释放存储空间后重试。");
  }
  state.manifest = buildManifest(state.rows);
  state.sourceCache = new Map();
  state.conflictMessage = action === "reopen" ? "已重新打开；此前另存的条目和原文仍保留。"
    : action === "add" ? "已另存，条目仍需人工审校。" : "已记录处理依据，当前数据未改动。";
  if (cloudReady()) state.cloud.message = "冲突处理已保存在本地，待同步云端";
  render();
  return true;
}

function importConflictModal() {
  if (!state.conflictsOpen) return "";
  const entries = importIssueEntries();
  const filtered = entries.filter(({ issue }) => state.conflictFilter === "all"
    || Boolean(issue.resolution) === (state.conflictFilter === "resolved"));
  const selected = filtered.find((entry) => entry.key === state.conflictSelection) || filtered[0];
  const issue = selected?.issue;
  const incoming = issue?.row;
  const current = issue && [...state.rows, ...state.trashRows].find((row) => row.id === issue.existingId);
  const sourceFile = issue ? conflictSourceFile(issue) : "";
  const missingSource = sourceFile && typeof selected.report.sourceConflicts?.[sourceFile] !== "string";
  const fields = incoming ? orderedSchema().filter((field) => field.id === "quote"
    || String(incoming.fields?.[field.id] || "") !== String(current?.fields?.[field.id] || "")) : [];
  return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入冲突处理">
    <section class="edit-modal conflict-modal">
      <div class="modal-head"><div><h2>导入冲突</h2><p>待处理 ${entries.filter((entry) => !entry.issue.resolution).length} · 已处理 ${entries.filter((entry) => entry.issue.resolution).length}</p></div>
        <button type="button" data-conflict-close aria-label="关闭导入冲突" title="关闭">×</button></div>
      <div class="conflict-toolbar"><label>状态 <select data-conflict-filter>
        ${[["open", "待处理"], ["resolved", "已处理"], ["all", "全部"]].map(([key, label]) => `<option value="${key}" ${state.conflictFilter === key ? "selected" : ""}>${label}</option>`).join("")}
      </select></label><p role="status">${escapeHtml(state.conflictMessage)}</p></div>
      <div class="conflict-layout">
        <nav class="conflict-list" aria-label="导入问题列表">${filtered.map((entry) => `<button type="button" data-conflict-select="${entry.key}" aria-current="${entry === selected ? "true" : "false"}">
          <strong>${escapeHtml(entry.issue.row?.id || conflictSourceFile(entry.issue))}</strong><span>${escapeHtml(entry.issue.reason)}</span>
          <small>${escapeHtml(entry.report.fileNames?.join("、") || "历史导入")} · ${entry.issue.resolution ? "已处理" : "待处理"}</small></button>`).join("") || '<p class="muted">没有待显示的问题</p>'}</nav>
        <div class="conflict-detail">${issue ? `<form id="conflictForm" data-report-index="${selected.reportIndex}" data-issue-index="${selected.issueIndex}">
          <h3>${escapeHtml(incoming?.id || sourceFile)}</h3><p class="import-warning">${escapeHtml(issue.reason)}</p>
          ${fields.length ? `<table class="conflict-comparison"><thead><tr><th>字段</th><th>当前保留</th><th>本次导入</th></tr></thead><tbody>
            ${fields.map((field) => `<tr><th>${escapeHtml(field.label)}</th><td>${escapeHtml(current?.fields?.[field.id] || "未入表")}</td><td>${escapeHtml(incoming.fields?.[field.id] || "空")}</td></tr>`).join("")}</tbody></table>` : ""}
          ${sourceFile ? `<details class="conflict-source"><summary>原文版本对照 · ${escapeHtml(sourceFile)}</summary><div><section><h4>当前原文</h4><pre>${escapeHtml(selected.report.originalSources?.[sourceFile] ?? state.uploadedPages.get(sourceFile) ?? "原文不可用")}</pre></section>
            <section><h4>本次导入</h4><pre>${escapeHtml(selected.report.sourceConflicts?.[sourceFile] ?? "旧报告未保存原文，请重新导入")}</pre></section></div></details>` : ""}
          ${issue.resolution ? `<p>处理结果：${issue.resolution.action === "add" ? "另存待审" : "保留当前内容"}</p><p>${escapeHtml(issue.resolution.reason)}</p>
            <p class="muted">${escapeHtml(issue.resolution.actor)} · ${escapeHtml(issue.resolution.at)}</p>` : ""}
          ${issue.acceptedRowId ? `<button type="button" data-conflict-result="${escapeHtml(issue.acceptedRowId)}">查看另存条目</button>` : ""}
          ${!issue.resolution && incoming && !issue.acceptedRowId ? `<label>入表摘录<textarea name="quote" rows="4">${escapeHtml(incoming.fields?.quote || incoming.quote || "")}</textarea></label>` : ""}
          <label>处理依据<textarea name="reason" rows="2" required></textarea></label>
          ${missingSource && !issue.resolution ? '<p class="import-warning">旧报告缺少原文内容，另存前需重新导入原文件。</p>' : ""}
          <div class="modal-actions">${issue.resolution ? '<button type="submit" name="action" value="reopen">重新处理</button>' : `
            <button type="submit" name="action" value="keep">${current || sourceFile ? "保留当前" : "不导入"}</button>
            <button type="submit" name="action" value="add" ${missingSource ? "disabled" : ""}>${issue.acceptedRowId ? "保留另存条目" : incoming ? "另存为待审条目" : "另存原文版本"}</button>`}</div>
        </form>` : '<p class="muted">当前列表已处理完毕</p>'}</div>
      </div>
    </section></div>`;
}

function mappingSelect(name, value, headers) {
  return `
    <select name="${escapeHtml(name)}">
      <option value="">不导入</option>
      ${headers.map((header) => `<option value="${escapeHtml(header)}" ${value === header ? "selected" : ""}>${escapeHtml(header)}</option>`).join("")}
    </select>
  `;
}

function importMappingModal() {
  const pending = state.pendingImport;
  if (!pending) return "";
  const file = pending.files[pending.activeFile];
  const headers = file?.headers || [];
  const plan = pendingImportPlan();
  const labels = { added: "新增", duplicate: "重复跳过", updated: "更新", conflict: "冲突保留", invalid: "无效跳过" };
  const issues = [...plan.actions.filter((action) => ["conflict", "invalid"].includes(action.type)), ...plan.sourceIssues];
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="导入预览">
      <form class="edit-modal mapping-modal" id="mappingForm">
        <div class="modal-head">
          <div><h2>导入预览</h2><p>${escapeHtml(pending.name)} · ${pending.files.reduce((n, item) => n + item.rows.length, 0)} 行 · ${pending.pages.size} 个原文页</p></div>
          <button type="button" data-mapping-cancel aria-label="关闭导入预览" title="关闭">×</button>
        </div>
        <div class="import-options">
          <label>导入方式
            <select name="importMode">
              <option value="append" ${pending.mode === "append" ? "selected" : ""} ${pending.workspace ? "disabled" : ""}>追加到当前主表</option>
              <option value="update" ${pending.mode === "update" ? "selected" : ""} ${pending.workspace ? "disabled" : ""}>更新未人工处理的条目</option>
              <option value="new" ${pending.mode === "new" ? "selected" : ""} ${cloudReady() ? "disabled" : ""}>新建工作区</option>
            </select>
          </label>
          ${file ? `<label>来源文件<select name="importFile">
            ${pending.files.map((item, index) => `<option value="${index}" ${index === pending.activeFile ? "selected" : ""}>${escapeHtml(item.name)} · ${item.rows.length} 行</option>`).join("")}
          </select></label>` : ""}
        </div>
        <div class="import-counts" aria-label="导入统计">
          ${Object.entries(labels).map(([key, label]) => `<span><b>${plan.counts[key]}</b>${label}</span>`).join("")}
        </div>
        ${pending.mode === "update" ? '<p class="muted">已人工修改、确认或标注的条目不会被覆盖。</p>' : ""}
        ${pending.mode === "new" ? '<p class="muted">当前工作区会保留，可从首页切换回来。</p>' : ""}
        ${pending.pilot ? `<details class="pilot-coverage" open><summary>试审覆盖 · 最多 50 条</summary><dl>${pending.pilot.coverage.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${item.selected} 条${item.available ? ` / 原工作区 ${item.available} 条` : " · 未覆盖：原工作区无此类条目"}</dd></div>`).join("")}</dl></details>` : ""}
        ${pending.log.filter((item) => item.type === "error").map((item) => `<p class="import-warning">${escapeHtml(item.name)}：${escapeHtml(item.message)}</p>`).join("")}
        ${plan.pageConflicts.length ? `<p class="import-warning">原文重名冲突：${plan.pageConflicts.map(([name]) => escapeHtml(name)).join("、")}。保留旧原文，相关新条目暂不导入。</p>` : ""}
        ${issues.length ? `
          <details class="import-issues" open>
            <summary>待处理记录（${issues.length}）</summary>
            <div class="import-issue-list">
              ${issues.slice(0, 30).map((action) => `
                <article><strong>${escapeHtml(action.row?.id || action.sourceFile)} · ${escapeHtml(action.reason)}</strong>
                  ${action.existing ? `<p>当前：${escapeHtml(clip(action.existing.quote, 100))}</p>` : ""}
                  <p>导入：${escapeHtml(action.row ? clip(action.row.quote, 100) || "无摘录" : "原文新版本")}</p>
                </article>`).join("")}
              ${issues.length > 30 ? "<p>其余记录保存在导入报告中。</p>" : ""}
            </div>
          </details>` : ""}
        ${file?.type === "csv" ? `
          <details class="import-mapping" ${(file.mappingOpen ?? !file.known) ? "open" : ""}>
            <summary>字段映射 · ${escapeHtml(file.name)}</summary>
            <div class="mapping-preview"><strong>首行预览</strong><p>${headers.slice(0, 8).map((header) => escapeHtml(header + ": " + clip(file.rows[0]?.[header], 28))).join(" ｜ ")}</p></div>
            <div class="mapping-grid">
              ${importSystemFields.map((field) => `<label><span>${escapeHtml(field.label)}</span>${mappingSelect("system:" + field.id, file.mapping.system?.[field.id] || "", headers)}</label>`).join("")}
              ${orderedSchema().map((field) => `<label><span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>${mappingSelect("field:" + field.id, file.mapping.fields?.[field.id] || "", headers)}</label>`).join("")}
            </div>
          </details>` : ""}
        <div class="modal-actions">
          <button type="button" data-mapping-cancel>取消</button>
          <button type="submit">确认导入</button>
        </div>
      </form>
    </div>
  `;
}

function localWorkspaceList() {
  const items = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(WORKSPACE_STORAGE_PREFIX)) continue;
    try {
      const payload = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(payload?.rows)) items.push({
        id: key.slice(WORKSPACE_STORAGE_PREFIX.length),
        name: payload.datasetName || "未命名工作区",
        count: payload.rows.length, at: payload.savedAt || ""
      });
    } catch { /* Ignore unrelated or unreadable backups. */ }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

function buildReviewPilot() {
  const rows = state.rows.filter((row) => !row.deleted && String(row.id || "").trim());
  const groups = [
    { label: "字段缺失", limit: 5, rows: rows.filter((row) => rowValidation(row).missingRequired.length) },
    { label: "已有疑似重复标记", limit: 5, rows: rows.filter((row) => normalizeProblemTags(row).includes("duplicate")) },
    { label: "定位待核对", limit: 20, rows: rows.filter(sourceNeedsReview) },
    { label: "摘录已匹配", limit: 20, rows: rows.filter((row) => sourceQuality(row).rank >= 2) }
  ];
  const selected = new Map();
  // Round-robin sources within each stratum so one long source does not fill the pilot.
  const take = (candidates, limit) => {
    const sources = new Map();
    candidates.forEach((row) => {
      if (!sources.has(row.sourceFile)) sources.set(row.sourceFile, []);
      sources.get(row.sourceFile).push(row);
    });
    let added = 0;
    while (sources.size && added < limit && selected.size < 50) {
      for (const [source, queue] of sources) {
        const row = queue.shift();
        if (!queue.length) sources.delete(source);
        if (!selected.has(row.id)) { selected.set(row.id, row); added++; }
        if (added === limit || selected.size === 50) break;
      }
    }
  };
  groups.forEach((group) => take(group.rows, group.limit));
  take(rows, 50 - selected.size);
  const picked = [...selected.values()].map(cloneRow);
  const coverage = groups.map((group) => ({
    label: group.label, available: group.rows.length,
    selected: group.rows.filter((row) => selected.get(row.id) === row).length
  }));
  const pages = {};
  picked.forEach((row) => {
    const text = cachedSourceText(row.sourceFile);
    if (text) pages[row.sourceFile] = text;
    delete row.cloudId;
  });
  const base = workspacePayload();
  return {
    coverage, sourceWorkspaceId: state.workspaceId,
    payload: {
      ...base, workspaceId: "", datasetName: `试审副本 · ${picked.length} 条 · ${state.datasetName}`,
      rows: picked, originalRows: picked.map(cloneRow), uploadedPages: pages,
      trashRows: [], exportVersions: [], importReports: [], undoAction: null, uploadLog: [],
      selectedId: picked[0]?.id || "",
      reviewState: {
        ...reviewDefaults(),
        confirmedIds: (state.reviewState.confirmedIds || []).filter((id) => selected.has(id)),
        edits: Object.fromEntries(Object.entries(state.reviewState.edits || {}).filter(([id]) => selected.has(id)))
      }
    }
  };
}

async function prepareReviewPilot() {
  if (cloudReady() || !state.rows.length || state.pendingImport) return false;
  try {
    const pilot = buildReviewPilot();
    if (!pilot.payload.rows.length) return false;
    const text = JSON.stringify(pilot.payload);
    await processFiles([{ name: "review-pilot.json", text: async () => text }]);
    if (!state.pendingImport) return false;
    state.pendingImport.pilot = { coverage: pilot.coverage, sourceWorkspaceId: pilot.sourceWorkspaceId };
    state.pendingImport.log.push(logEntry("success", "试审副本", `来源工作区 ${pilot.sourceWorkspaceId}；条目 ${pilot.payload.rows.map((row) => row.id).join("、")}；`
      + pilot.coverage.map((item) => `${item.label} ${item.selected}/${item.available}`).join("；"), { step: "试审抽样" }));
    state.workspaceListOpen = false;
    render();
    return true;
  } catch (error) {
    window.alert("试审副本准备失败：" + error.message);
    return false;
  }
}

function switchLocalWorkspace(id) {
  if (cloudReady() || !id || !saveWorkspace()) return;
  const previous = state.workspaceId;
  const before = { ...state };
  try {
    localStorage.setItem(WORKSPACE_POINTER_KEY, id);
    if (!loadWorkspace()) throw new Error("工作区读取失败");
  } catch {
    Object.assign(state, before);
    localStorage.setItem(WORKSPACE_POINTER_KEY, previous);
    window.alert("工作区读取失败，已保留当前工作区。");
    return;
  }
  state.workspaceListOpen = false;
  state.filter = "all";
  state.query = "";
  state.qualityFocus = null;
  state.sourceText = "";
  state.sourceStatus = "idle";
  state.sourceCache = new Map();
  render();
  loadSelectedSource();
}

function workflowModal() {
  const row = state.rows.find((item) => item.id === state.resolutionRowId);
  if (row) return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="解决问题">
      <form class="edit-modal workflow-modal" id="resolutionForm">
        <div class="modal-head"><h2>解决问题 · ${escapeHtml(row.id)}</h2><button type="button" data-workflow-close aria-label="关闭" title="关闭">×</button></div>
        <blockquote>${escapeHtml(clip(row.quote, 200))}</blockquote>
        <label>处理说明<textarea name="reason" required rows="4" maxlength="2000"></textarea></label>
        <div class="modal-actions"><button type="button" data-workflow-close>取消</button><button type="submit">确认解决</button></div>
      </form>
    </div>`;
  if (!state.trashOpen && !state.workspaceListOpen) return "";
  const isTrash = state.trashOpen;
  const items = isTrash ? state.trashRows : localWorkspaceList();
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="${isTrash ? "回收站" : "切换工作区"}">
      <section class="edit-modal workflow-modal">
        <div class="modal-head"><h2>${isTrash ? "回收站" : "本地工作区"}</h2><button type="button" data-workflow-close aria-label="关闭" title="关闭">×</button></div>
        <div class="workflow-list-scroll">
          ${items.map((item) => `<article>
            <div><strong>${escapeHtml(isTrash ? item.id : item.name)}</strong><p>${escapeHtml(isTrash ? clip(item.quote, 100) : item.count + " 条 · " + formatLocalTime(item.at))}</p></div>
            <button type="button" ${isTrash ? "data-trash-restore" : "data-workspace-switch"}="${escapeHtml(item.id)}" ${!isTrash && (item.id === state.workspaceId || cloudReady()) ? "disabled" : ""}>${isTrash ? "恢复" : item.id === state.workspaceId ? "当前" : "打开"}</button>
          </article>`).join("") || "<p>暂无记录</p>"}
        </div>
        ${!isTrash ? `<div class="modal-actions"><button type="button" data-review-pilot ${!state.rows.length || cloudReady() ? "disabled" : ""}>创建试审副本</button></div>` : ""}
      </section>
    </div>`;
}

function hideButtonTooltip() {
  clearTimeout(buttonTooltipTimer);
  buttonTooltipTimer = 0;
  if (!buttonTooltip) return;
  buttonTooltip.classList.remove("visible");
  buttonTooltip.setAttribute("aria-hidden", "true");
}

function positionButtonTooltip(target) {
  if (!buttonTooltip || !target?.isConnected) return;
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = buttonTooltip.getBoundingClientRect();
  const gutter = 10;
  const edge = 8;
  let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;
  left = Math.max(edge, Math.min(left, window.innerWidth - tooltipRect.width - edge));
  let top = targetRect.bottom + gutter;
  let placement = "bottom";
  if (top + tooltipRect.height > window.innerHeight - edge) {
    top = targetRect.top - tooltipRect.height - gutter;
    placement = "top";
  }
  buttonTooltip.style.left = `${Math.round(left)}px`;
  buttonTooltip.style.top = `${Math.max(edge, Math.round(top))}px`;
  buttonTooltip.dataset.placement = placement;
}

function showButtonTooltip(target, immediate = false) {
  const label = target?.getAttribute("aria-label") || target?.getAttribute("title");
  if (!label || target.disabled) return;
  target.removeAttribute("title");
  clearTimeout(buttonTooltipTimer);
  const reveal = () => {
    if (!target.isConnected) return;
    buttonTooltip.textContent = label;
    buttonTooltip.setAttribute("aria-hidden", "false");
    buttonTooltip.classList.add("visible");
    positionButtonTooltip(target);
  };
  if (immediate) reveal();
  else buttonTooltipTimer = setTimeout(reveal, 160);
}

function initButtonTooltips() {
  if (buttonTooltip || !document.body) return;
  buttonTooltip = document.createElement("div");
  buttonTooltip.id = "buttonTooltip";
  buttonTooltip.className = "button-tooltip";
  buttonTooltip.setAttribute("role", "tooltip");
  buttonTooltip.setAttribute("aria-hidden", "true");
  document.body.append(buttonTooltip);

  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.(ICON_TOOLTIP_SELECTOR);
    if (!target || target.contains(event.relatedTarget)) return;
    showButtonTooltip(target);
  });
  document.addEventListener("pointerout", (event) => {
    const target = event.target.closest?.(ICON_TOOLTIP_SELECTOR);
    if (!target || target.contains(event.relatedTarget)) return;
    hideButtonTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest?.(ICON_TOOLTIP_SELECTOR);
    if (target) showButtonTooltip(target, true);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.closest?.(ICON_TOOLTIP_SELECTOR)) hideButtonTooltip();
  });
  document.addEventListener("pointerdown", hideButtonTooltip);
  window.addEventListener("resize", hideButtonTooltip);
  window.addEventListener("scroll", hideButtonTooltip, true);
}

function renderShell(content) {
  hideButtonTooltip();
  const motionClass = state.motionName ? `motion-${state.motionName}` : "";
  const workspaceEntryClass = state.workspaceEntryMotion ? "workspace-entering" : "";
  const sectionLabel = currentSectionLabel();
  app.innerHTML = `
    <main class="app-shell ${state.view === "home" ? "home-shell" : ""} ${state.view === "ingest" ? "ingest-shell" : ""} ${state.view === "detail" ? `detail-shell detail-mode-${state.detailMode}` : ""} ${state.tableFocus ? "table-focus-shell" : ""} ${motionClass} ${workspaceEntryClass}" ${state.primaryNavOpen ? "inert" : ""}>
      <header class="topbar compact">
        <div class="brand-cluster">
          <button type="button" class="brand-mark-trigger" data-primary-nav-toggle aria-label="打开工作区导航" title="打开工作区导航" aria-expanded="${String(state.primaryNavOpen)}">
            <img src="./src/assets/shulun-mark.png" alt="" />
          </button>
          <div class="brand-copy"><h1>书论工作区</h1><span>${sectionLabel}</span></div>
        </div>
        <div class="top-utility">
          <label><span>⌕</span><input type="search" value="${escapeHtml(state.query)}" placeholder="全局搜索（Ctrl+K）" data-global-search /></label>
          ${topUserControl()}
        </div>
      </header>
      ${content}
    </main>
    <div class="primary-nav-layer ${state.primaryNavOpen ? "open" : ""}" data-primary-nav-layer aria-hidden="${String(!state.primaryNavOpen)}">
      <button type="button" class="primary-nav-scrim" data-primary-nav-close tabindex="-1" aria-label="关闭导航"></button>
      <aside class="primary-nav-drawer" role="dialog" aria-modal="true" aria-label="工作区导航">
        <div class="drawer-brand">
          <span class="drawer-mark" aria-hidden="true"><img src="./src/assets/shulun-mark.png" alt="" /></span>
          <div><strong>书论工作区</strong><span>${sectionLabel}</span></div>
          <button type="button" class="drawer-close" data-primary-nav-close aria-label="关闭导航" title="关闭导航">×</button>
        </div>
        <nav class="drawer-nav">
          <button type="button" class="${state.view === "home" ? "active" : ""}" data-view="home" ${state.view === "home" ? "aria-current='page'" : ""}>工作台</button>
          <button type="button" data-home-focus="file">材料库</button>
          <button type="button" class="${state.view === "ingest" ? "active" : ""}" data-view="ingest" ${state.view === "ingest" ? "aria-current='page'" : ""}>古籍入库</button>
          <button type="button" class="${state.view === "detail" && state.detailMode === "table" ? "active" : ""}" data-view="detail" data-detail-mode="table" ${state.view === "detail" && state.detailMode === "table" ? "aria-current='page'" : ""}>统一主表</button>
          <button type="button" class="${state.view === "detail" && state.detailMode === "review" ? "active" : ""}" data-view="detail" data-detail-mode="review" ${state.view === "detail" && state.detailMode === "review" ? "aria-current='page'" : ""}>回检修订</button>
          <button type="button" data-home-focus="export" ${state.rows.length || state.exportVersions.length ? "" : "disabled"}>成果导出</button>
          <button type="button" data-home-focus="schema">项目设置</button>
        </nav>
      </aside>
    </div>
    ${batchReviewModal()}
    ${editModal()}
    ${importMappingModal()}
    ${importConflictModal()}
    ${workflowModal()}
    ${batchIssueModal()}
    ${deliveryModal()}
    ${dashboardImportSink()}
    ${templateDetailsModal()}
    <div id="workspaceConflictHost"></div>
  `;
  attachGlobalEvents();
  updateWorkspaceConflictDom();
  if (state.workspaceEntryMotion) {
    state.workspaceEntryMotion = false;
    window.setTimeout(() => document.querySelector(".app-shell")?.classList.remove("workspace-entering"), 560);
  }
  if (state.motionName) {
    const activeMotion = state.motionName;
    window.setTimeout(() => {
      document.querySelector(".app-shell")?.classList.remove(`motion-${activeMotion}`);
      if (state.motionName === activeMotion) state.motionName = "";
    }, 620);
  }
}

function renderHome() {
  renderShell(`
    <section class="dashboard-grid">
      <aside class="dashboard-left">
        ${dashboardProjectCard()}
      </aside>
      <main class="dashboard-center">
        ${dashboardWorkflow()}
        ${dashboardLogTable()}
      </main>
      <aside class="dashboard-right">
        ${dashboardRightColumn()}
      </aside>
    </section>
  `);
  attachHomeEvents();
}

function renderDetail() {
  reconcileBatchSelection();
  const rows = visibleRows();
  const row = selectedRow();
  state.selectedId = row?.id || "";
  if (state.researchRowId !== state.selectedId || state.researchWorkspaceId !== state.workspaceId) resetResearchForRow(row);
  if (state.aiRowId !== state.selectedId || state.aiWorkspaceId !== state.workspaceId) resetAiForRow(row);
  else invalidateAiCandidate(row);

  renderShell(`
    <section class="review-screen ${state.detailCollapsed ? "detail-collapsed" : ""} ${state.railCollapsed || state.tableFocus ? "rail-collapsed" : ""} ${state.tableFocus ? "table-focus" : ""} ${state.tableHeaderCollapsed ? "table-head-collapsed" : ""} ${state.aiPanelOpen ? "ai-review-open" : ""} ${state.aiPanelOpen ? `ai-mobile-${state.aiMobilePane}` : ""}">
      <aside class="dataset-rail">
        <button type="button" class="rail-collapse-control ${state.railCollapsed ? "active" : ""}" data-rail-toggle aria-pressed="${String(state.railCollapsed)}" aria-label="${state.railCollapsed ? "显示左侧栏" : "隐藏左侧栏"}" title="${state.railCollapsed ? "显示左侧栏" : "隐藏左侧栏"}"></button>
        <div class="rail-identity">
          <p class="kicker">Current Dataset</p>
          <h2>${escapeHtml(state.datasetName)}</h2>
          ${workspaceStatus()}
        </div>
        <details class="rail-section rail-review" open>
          <summary>审校状态</summary>
          ${reviewToolbar()}
        </details>
        <details class="rail-section" open>
          <summary>导入队列</summary>
          ${triageStatusPanel()}
        </details>
        <details class="rail-section">
          <summary>字段质量</summary>
          ${fieldQualityPanel()}
        </details>
        <details class="rail-section">
          <summary>工作区管理</summary>
          ${workspaceActions()}
          ${templatePanel()}
        </details>
        <details class="rail-section">
          <summary>上传处理</summary>
          ${uploadLog()}
        </details>
        <details class="rail-section">
          <summary>附表分布</summary>
          <div class="bars compact">${appendixBars()}</div>
        </details>
      </aside>

      ${state.aiPanelOpen ? `
        <div class="ai-mobile-switch" role="group" aria-label="移动端审校面板">
          <button type="button" data-ai-mobile-pane="fields" aria-pressed="${String(state.aiMobilePane === "fields")}">原字段</button>
          <button type="button" data-ai-mobile-pane="reasoning" aria-pressed="${String(state.aiMobilePane === "reasoning")}">AI 理由</button>
        </div>
      ` : ""}
      <section class="main-panel workbench-main">
        <button type="button" class="rail-restore-control ${state.railCollapsed ? "active" : ""}" data-rail-toggle aria-pressed="${String(state.railCollapsed)}" aria-label="显示左侧栏" title="显示左侧栏"></button>
        <div class="panel-head">
          <div>
            <p class="kicker">${state.detailMode === "review" ? "Revision Queue" : "Master Table"}</p>
            <h2>${state.detailMode === "review" ? "回检修订队列" : "统一主表"}</h2>
          </div>
          <div class="panel-tools">
            <div class="visible-count">${rows.length} / ${state.rows.length}</div>
            ${tableViewActions()}
          </div>
        </div>
        ${modeSummaryPanel(rows)}
        ${resultsControlPanel(rows)}
        ${batchActionBar()}
        ${resultTable(rows)}
      </section>
      ${detailPanel(row)}
      ${state.aiPanelOpen ? aiReviewPanel(row) : ""}
    </section>
  `);
  attachDetailEvents();
}

function renderAncientIngest() {
  renderShell(window.AncientIngestUI?.render?.() || `<section class="ingest-loading">古籍入库模块加载失败</section>`);
  window.AncientIngestUI?.attach?.();
}

function verifyDemoCredentials(account, password) {
  return String(account || "").trim().toLowerCase() === DEMO_LOGIN.account
    && String(password || "") === DEMO_LOGIN.password;
}

function localDemoSessionAvailable() {
  if (state.cloud.config?.enabled) return false;
  const hostname = String(location.hostname || "").toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const loginPreview = /(?:^|[?&])login=1(?:&|$)/.test(String(location.search || ""));
  return loopback && !loginPreview;
}

function restoreLocalDemoSession() {
  if (!localDemoSessionAvailable()) return false;
  try { localStorage.setItem(LOCAL_DEMO_SESSION_KEY, "active"); } catch { /* Local preview can still continue without storage. */ }
  state.entryStage = "workspace";
  state.entryAccount = "";
  state.entryEmail = "";
  state.entryRememberEmail = false;
  state.entryError = "";
  return true;
}

function persistLocalDemoSession() {
  if (!localDemoSessionAvailable()) return;
  try { localStorage.setItem(LOCAL_DEMO_SESSION_KEY, "active"); } catch { /* Login remains usable when storage is blocked. */ }
}

function emailMemoryEnabled() {
  return Boolean(state.cloud.config?.enabled && state.cloud.config.rememberEmail !== false);
}

function restoreRememberedEmail() {
  if (!emailMemoryEnabled()) {
    state.entryEmail = "";
    state.entryRememberEmail = false;
    try { localStorage.removeItem(REMEMBERED_EMAIL_KEY); } catch { /* Storage may be unavailable. */ }
    return;
  }
  try {
    state.entryEmail = String(localStorage.getItem(REMEMBERED_EMAIL_KEY) || "");
  } catch {
    state.entryEmail = "";
  }
  state.entryRememberEmail = Boolean(state.entryEmail);
}

function persistRememberedEmail(email, remember) {
  if (!emailMemoryEnabled()) return;
  try {
    if (remember) localStorage.setItem(REMEMBERED_EMAIL_KEY, String(email || "").trim().toLowerCase());
    else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch { /* Login must remain usable when browser storage is blocked. */ }
}

function renderEntry() {
  clearTimeout(entryStageTimer);
  document.body?.setAttribute("data-entry-active", "true");
  const signingIn = state.entryStage === "signin";
  const registering = state.entryStage === "register";
  const authenticating = signingIn || registering;
  app.innerHTML = `
    <main class="entry-gate ${registering ? "register-stage" : signingIn ? "signin-stage" : "welcome-stage"}">
      ${authenticating ? `
        <section class="entry-login" aria-labelledby="entryLoginTitle">
          <div class="entry-login-brand">
            <span class="entry-login-mark" aria-hidden="true"><img src="./src/assets/shulun-mark.png" alt="" /></span>
            <span>书论工作区</span>
          </div>
          ${registering ? `
            <form class="entry-login-form entry-register-form" id="entryRegisterForm" autocomplete="off">
              <header><h1 id="entryLoginTitle">创建工作区账号</h1><p>通过邮箱验证链接完成注册</p></header>
              <label><span>显示名称</span><input type="text" name="displayName" autocomplete="name" maxlength="60" required autofocus /></label>
              <label><span>工作邮箱</span><input type="email" name="email" value="${escapeHtml(state.entryEmail)}" autocomplete="${emailMemoryEnabled() ? "email" : "off"}" required /></label>
              <p class="entry-register-help">验证后可创建团队，也可接受已有团队的邀请。</p>
              ${state.entryError ? `<p class="entry-login-error" role="alert" aria-live="polite">${escapeHtml(state.entryError)}</p>` : ""}
              ${state.entryNotice ? `<p class="entry-register-notice" role="status" aria-live="polite">${escapeHtml(state.entryNotice)}</p>` : ""}
              <button type="submit" class="entry-login-submit">发送注册链接</button>
              <div class="entry-auth-switch"><span>已有账号？</span><button type="button" data-entry-signin>返回登录</button></div>
            </form>
          ` : `
            <form class="entry-login-form" id="entryLoginForm" autocomplete="off">
              <header><h1 id="entryLoginTitle">登录工作区</h1><p>进入书论材料整理与审校平台</p></header>
              <label><span>账号</span><input type="text" name="account" value="${escapeHtml(state.entryAccount)}" autocomplete="username" autocapitalize="none" spellcheck="false" required /></label>
              <label><span>密码</span><input type="password" name="password" autocomplete="current-password" required autofocus aria-invalid="${String(Boolean(state.entryError))}" /></label>
              ${emailMemoryEnabled() ? `<label class="entry-remember"><input type="checkbox" name="rememberEmail" ${state.entryRememberEmail ? "checked" : ""} /><span>在此设备记住账号</span></label>` : ""}
              <p class="entry-login-error" role="alert" aria-live="polite">${escapeHtml(state.entryError)}</p>
              <button type="submit" class="entry-login-submit">登录</button>
              <div class="entry-auth-switch"><span>还没有账号？</span><button type="button" data-entry-register>邮箱免密注册</button></div>
              <button type="button" class="entry-login-back" data-entry-back>返回介绍</button>
            </form>
          `}
        </section>
      ` : `
        <section class="entry-intro" aria-labelledby="entryTitle">
          <div class="entry-logo-sequence" aria-hidden="true">
            <span class="entry-logo-scroll"><img src="./src/assets/shulun-mark.png" alt="" /></span>
            <span class="entry-logo-unfold"><img src="./src/assets/shulun-mark.png" alt="" /></span>
          </div>
          <div class="entry-copy">
            <h1 id="entryTitle">书论工作区</h1>
            <p>从原始材料到可回溯的书论研究成果</p>
          </div>
        </section>
      `}
    </main>
  `;
  if (!authenticating) {
    const entryDelay = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 100 : 3200;
    entryStageTimer = window.setTimeout(() => {
      if (state.entryStage !== "welcome") return;
      state.entryStage = "signin";
      state.entryError = "";
      renderEntry();
    }, entryDelay);
  }
  document.querySelector("[data-entry-back]")?.addEventListener("click", () => {
    state.entryStage = "welcome";
    state.entryError = "";
    state.entryNotice = "";
    renderEntry();
  });
  document.querySelector("[data-entry-register]")?.addEventListener("click", () => {
    state.entryStage = "register";
    state.entryError = "";
    state.entryNotice = "";
    renderEntry();
  });
  document.querySelector("[data-entry-signin]")?.addEventListener("click", () => {
    state.entryStage = "signin";
    state.entryError = "";
    state.entryNotice = "";
    renderEntry();
  });
  document.querySelector("#entryRegisterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector("[type='submit']");
    const values = new FormData(form);
    const email = String(values.get("email") || "").trim().toLowerCase();
    const displayName = String(values.get("displayName") || "").trim();
    state.entryEmail = email;
    state.entryError = "";
    state.entryNotice = "";
    if (!state.cloud.store) {
      state.entryNotice = "注册入口已就绪。部署并配置云端认证后即可发送验证邮件。";
      renderEntry();
      return;
    }
    if (submit) { submit.disabled = true; submit.textContent = "正在发送..."; }
    try {
      await state.cloud.store.signInWithEmail(email, {
        createUser: true,
        metadata: { display_name: displayName }
      });
      state.entryNotice = `验证链接已发送至 ${email}`;
    } catch (error) {
      state.entryError = error?.message || "注册链接发送失败";
    }
    renderEntry();
  });
  document.querySelector("#entryLoginForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    state.entryAccount = String(values.get("account") || "").trim();
    state.entryRememberEmail = values.get("rememberEmail") === "on";
    if (!verifyDemoCredentials(state.entryAccount, values.get("password"))) {
      state.entryError = "账号或密码不正确";
      renderEntry();
      return;
    }
    state.entryStage = "workspace";
    state.entryError = "";
    persistRememberedEmail(state.entryAccount, state.entryRememberEmail);
    persistLocalDemoSession();
    state.workspaceEntryMotion = true;
    render();
    if (state.view === "detail") loadSelectedSource();
  });
}

function render() {
  if (!state.manifest) {
    app.innerHTML = "<div class='boot'>加载线上数据包...</div>";
    return;
  }
  if (state.entryStage !== "workspace") {
    renderEntry();
    return;
  }
  document.body?.removeAttribute("data-entry-active");
  const search = document.querySelector("#searchInput");
  const preserveSearch = search && document.activeElement === search && state.view === "detail";
  const selection = preserveSearch ? [search.selectionStart, search.selectionEnd, search.selectionDirection] : null;
  const panel = document.querySelector(".detail-panel");
  const sameRow = panel?.dataset.selectedId === state.selectedId && panel?.dataset.dockMode === state.detailMode;
  const table = document.querySelector(".table-shell");
  const detail = document.querySelector(".detail-dock-body");
  const scroll = sameRow ? { x: table?.scrollLeft || 0, y: table?.scrollTop || 0, detail: detail?.scrollTop || 0 } : null;
  if (state.view === "home") renderHome();
  else if (state.view === "ingest") renderAncientIngest();
  else renderDetail();
  if (preserveSearch) {
    document.querySelector("#searchInput")?.replaceWith(search);
    search.focus({ preventScroll: true });
    search.setSelectionRange(...selection);
  }
  if (scroll && state.view === "detail") {
    const nextTable = document.querySelector(".table-shell");
    const nextDetail = document.querySelector(".detail-dock-body");
    if (nextTable) { nextTable.scrollLeft = scroll.x; nextTable.scrollTop = scroll.y; }
    if (nextDetail) nextDetail.scrollTop = scroll.detail;
  }
}

function openTemplatePanel() {
  state.templatePanelExpanded = true;
  render();
  if (state.view === "detail") loadSelectedSource();
  if (state.settingsTab === "model" && state.modelSettings.status === "idle") loadModelConfig();
}

function closeTemplatePanel() {
  document.querySelectorAll("[data-model-profile-form] [name='apiKey']").forEach((keyInput) => {
    keyInput.value = "";
  });
  state.templatePanelExpanded = false;
  render();
  if (state.view === "detail") loadSelectedSource();
}

function activateWorkspaceTool(tool) {
  if (tool === "file") document.querySelector("#fileInput")?.click();
  if (tool === "schema") openTemplatePanel();
  if (tool === "export") openExportPanel();
}

function currentSectionLabel() {
  if (state.view === "home") return "工作台";
  if (state.view === "ingest") return "古籍入库";
  return state.detailMode === "review" ? "回检修订" : "统一主表";
}

function setPrimaryNav(open, restoreFocus = true) {
  state.primaryNavOpen = Boolean(open);
  const layer = document.querySelector("[data-primary-nav-layer]");
  const trigger = document.querySelector("[data-primary-nav-toggle]");
  const shell = document.querySelector(".app-shell");
  if (!layer || !trigger) return;
  layer.classList.toggle("open", state.primaryNavOpen);
  layer.setAttribute("aria-hidden", String(!state.primaryNavOpen));
  trigger.setAttribute("aria-expanded", String(state.primaryNavOpen));
  shell?.toggleAttribute("inert", state.primaryNavOpen);
  if (state.primaryNavOpen) {
    window.requestAnimationFrame(() => layer.querySelector("[aria-current='page'], [data-view]")?.focus({ preventScroll: true }));
  } else if (restoreFocus) {
    trigger.focus({ preventScroll: true });
  }
}

function attachGlobalEvents() {
  attachCloudControls();
  document.querySelector("[data-primary-nav-toggle]")?.addEventListener("click", () => setPrimaryNav(!state.primaryNavOpen));
  document.querySelectorAll("[data-primary-nav-close]").forEach((button) => button.addEventListener("click", () => setPrimaryNav(false)));
  document.querySelectorAll("[data-import-conflicts]").forEach((button) => button.addEventListener("click", () => {
    state.conflictsOpen = true; state.conflictMessage = ""; render();
  }));
  document.querySelector("[data-conflict-close]")?.addEventListener("click", () => { state.conflictsOpen = false; render(); });
  document.querySelector("[data-conflict-filter]")?.addEventListener("change", (event) => {
    state.conflictFilter = event.target.value; state.conflictSelection = ""; state.conflictMessage = ""; render();
  });
  document.querySelectorAll("[data-conflict-select]").forEach((button) => button.addEventListener("click", () => {
    state.conflictSelection = button.dataset.conflictSelect; state.conflictMessage = ""; render();
  }));
  document.querySelector("#conflictForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    resolveImportIssue(Number(form.dataset.reportIndex), Number(form.dataset.issueIndex),
      event.submitter?.value || "keep", data.get("reason"), data.get("quote") ?? undefined);
  });
  document.querySelector("[data-conflict-result]")?.addEventListener("click", (event) => {
    const id = event.currentTarget.dataset.conflictResult;
    if (!state.rows.some((row) => row.id === id)) { state.conflictMessage = "条目不在主表中，请检查回收站。"; render(); return; }
    state.conflictsOpen = false; state.query = ""; state.filter = "all"; state.selectedId = id;
    navigateToView("detail", "table"); render(); loadSelectedSource();
  });
  document.querySelectorAll("[data-home-focus]").forEach((button) => button.addEventListener("click", () => {
    if (button.closest?.(".primary-nav-drawer")) setPrimaryNav(false, false);
    activateWorkspaceTool(button.dataset.homeFocus);
  }));
  document.querySelectorAll("[data-dashboard-queue]").forEach((button) => button.addEventListener("click", () => inspectDashboardQueue(button.dataset.dashboardQueue)));
  document.querySelector("#fileInput")?.addEventListener("change", (event) => processFiles([...event.currentTarget.files]));
  document.querySelector("[data-export-close]")?.addEventListener("click", () => { state.exportOpen = false; render(); });
  document.querySelectorAll("[data-batch-review-close]").forEach((button) => button.addEventListener("click", closeBatchReview));
  document.querySelectorAll("[data-batch-review-step]").forEach((button) => button.addEventListener("click", () => {
    moveBatchReview(Number(button.dataset.batchReviewStep));
  }));
  document.querySelector("[data-batch-review-edit]")?.addEventListener("click", () => openEdit(state.batchReviewRowId));
  document.querySelector("[data-batch-review-confirm]")?.addEventListener("click", confirmBatchReview);
  document.querySelectorAll("[data-batch-issue-close]").forEach((button) => button.addEventListener("click", () => {
    state.batchIssueOpen = false;
    render();
  }));
  document.querySelector("#batchIssueForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    batchMarkIssue(event.currentTarget);
  });
  document.querySelector("#deliveryForm")?.addEventListener("change", (event) => {
    const data = new FormData(event.currentTarget);
    state.exportScope = String(data.get("deliveryScope") || "all");
    state.exportMode = String(data.get("deliveryMode") || "draft");
    state.exportMessage = "";
    render();
  });
  document.querySelector("#deliveryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.exportMode === "formal") createFormalRelease();
    else downloadWorkingDraft();
  });
  document.querySelectorAll("[data-delivery-blocker]").forEach((button) =>
    button.addEventListener("click", () => inspectDeliveryBlockers(button.dataset.deliveryBlocker)));
  document.querySelectorAll("[data-release-csv]").forEach((button) =>
    button.addEventListener("click", () => downloadRelease(button.dataset.releaseCsv)));
  document.querySelectorAll("[data-release-json]").forEach((button) =>
    button.addEventListener("click", () => downloadRelease(button.dataset.releaseJson, "json")));
  document.querySelector("[data-review-undo]")?.addEventListener("click", undoLastAction);
  document.querySelector("[data-trash-open]")?.addEventListener("click", () => { state.trashOpen = true; render(); });
  document.querySelector("[data-workspace-list]")?.addEventListener("click", () => { state.workspaceListOpen = true; render(); });
  document.querySelector("[data-review-pilot]")?.addEventListener("click", prepareReviewPilot);
  document.querySelectorAll("[data-workflow-close]").forEach((button) => button.addEventListener("click", () => {
    state.resolutionRowId = ""; state.trashOpen = false; state.workspaceListOpen = false; render();
  }));
  document.querySelectorAll("[data-trash-restore]").forEach((button) =>
    button.addEventListener("click", () => restoreTrashRow(button.dataset.trashRestore)));
  document.querySelectorAll("[data-workspace-switch]").forEach((button) =>
    button.addEventListener("click", () => switchLocalWorkspace(button.dataset.workspaceSwitch)));
  document.querySelector("#resolutionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    setProblemStatus(state.resolutionRowId, "resolved", new FormData(event.currentTarget).get("reason"));
  });
  document.querySelector("[data-import-report-export]")?.addEventListener("click", () => {
    downloadBlob("导入报告.json", JSON.stringify(state.importReports, null, 2));
  });

  document.querySelector("[data-global-search]")?.addEventListener("change", (event) => {
    state.query = event.target.value;
    navigateToView("detail", "table");
    state.selectedId = visibleRows()[0]?.id || "";
    render();
    loadSelectedSource();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.closest?.(".primary-nav-drawer")) setPrimaryNav(false, false);
      navigateToView(button.dataset.view, button.dataset.detailMode || state.detailMode);
      render();
      if (state.view === "detail") loadSelectedSource();
    });
  });

  document.querySelectorAll("[data-edit-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingId = "";
      render();
      if (state.view === "detail") loadSelectedSource();
    });
  });

  document.querySelector("#editForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEdit(event.currentTarget);
  });

  document.querySelector("#mappingForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    readImportMapping(event.currentTarget);
    confirmPendingImport();
  });
  document.querySelector("#mappingForm")?.addEventListener("change", (event) => {
    const controlName = event.target.name;
    readImportMapping(event.currentTarget);
    if (event.target.name === "importFile") state.pendingImport.activeFile = Number(event.target.value);
    render();
    document.querySelector("#mappingForm")?.elements.namedItem(controlName)?.focus();
  });

  document.querySelectorAll("[data-mapping-cancel]").forEach((button) => {
    button.addEventListener("click", cancelPendingImport);
  });

  document.querySelectorAll("[data-workspace-export]").forEach((button) => {
    button.addEventListener("click", exportWorkspace);
  });

  document.querySelectorAll("[data-main-table-export]").forEach((button) => {
    button.addEventListener("click", exportMainTableCsv);
  });

  document.querySelectorAll("[data-problem-export]").forEach((button) => {
    button.addEventListener("click", exportProblemRowsCsv);
  });

  document.querySelectorAll("[data-review-log-export]").forEach((button) => {
    button.addEventListener("click", exportReviewLogCsv);
  });

  document.querySelectorAll("[data-template-download]").forEach((button) => {
    button.addEventListener("click", downloadTemplateCsv);
  });

  document.querySelectorAll("[data-quality-export]").forEach((button) => {
    button.addEventListener("click", exportFieldQualityCsv);
  });

  document.querySelectorAll("[data-workspace-reset]").forEach((button) => {
    button.addEventListener("click", resetWorkspace);
  });

  document.querySelectorAll("[data-template-panel-open]").forEach((button) => {
    button.addEventListener("click", openTemplatePanel);
  });

  document.querySelectorAll("[data-template-panel-close]").forEach((button) => {
    button.addEventListener("click", closeTemplatePanel);
  });

  document.querySelector(".template-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeTemplatePanel();
  });

  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settingsTab = button.dataset.settingsTab;
      render();
      if (state.settingsTab === "model" && state.modelSettings.status === "idle") loadModelConfig();
    });
  });

  document.querySelectorAll("[data-model-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.modelSettings.activeProfileId = button.dataset.modelEdit;
      render();
    });
  });
  document.querySelectorAll("[data-model-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.modelSettings.activeProfileId === button.dataset.modelCancel) state.modelSettings.activeProfileId = "";
      render();
    });
  });
  document.querySelectorAll("[data-model-profile-form]").forEach((form) => {
    form.addEventListener("input", (event) => {
      if (event.target.name === "apiKey") return;
      const profile = state.modelSettings.profiles.find((item) => item.id === form.dataset.modelProfile);
      if (!profile || !["displayName", "apiUrl", "model", "modelFamily", "enabled"].includes(event.target.name)) return;
      profile[event.target.name] = event.target.name === "enabled" ? event.target.checked : event.target.value;
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveModelConfig(event.currentTarget);
    });
  });
  document.querySelectorAll("[data-model-test]").forEach((button) => {
    button.addEventListener("click", () => {
      const form = button.closest("form[data-model-profile-form]");
      testModelConfig(form, button.dataset.modelTest);
    });
  });
  document.querySelectorAll("[data-model-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteModelConfig(button.dataset.modelDelete));
  });
  document.querySelector("#modelPolicyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveModelPolicy(event.currentTarget);
  });
  document.querySelector("[data-field-override-apply]")?.addEventListener("click", (event) => {
    const editor = event.currentTarget.closest(".model-policy-override-editor");
    const fieldId = editor?.querySelector("[name='fieldOverrideId']")?.value || "";
    const mode = editor?.querySelector("[name='fieldOverrideMode']")?.value || "inherit";
    if (setModelFieldOverride(fieldId, mode)) render();
  });
  document.querySelectorAll("[data-model-override-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (setModelFieldOverride(button.dataset.modelOverrideRemove, "inherit")) render();
    });
  });

  document.querySelector("[data-template-select]")?.addEventListener("change", (event) => {
    applyTemplate(event.target.value);
  });

  document.querySelectorAll("[data-schema-field]").forEach((control) => {
    const handler = () => {
      const prop = control.dataset.schemaProp;
      const value = control.type === "checkbox" ? control.checked : control.value;
      updateSchemaField(control.dataset.schemaField, prop, value);
    };
    control.addEventListener(control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "blur", handler);
  });

  document.querySelector("[data-schema-add]")?.addEventListener("click", addSchemaField);
  document.querySelector("[data-schema-reset]")?.addEventListener("click", resetSchemaToTemplate);
  document.querySelector("[data-template-save]")?.addEventListener("click", saveCurrentAsCustomTemplate);
  document.querySelector("[data-template-copy]")?.addEventListener("click", copyCurrentTemplate);
  document.querySelector("[data-template-delete]")?.addEventListener("click", deleteCurrentCustomTemplate);
  document.querySelectorAll("[data-schema-move]").forEach((button) => {
    button.addEventListener("click", () => moveSchemaField(button.dataset.schemaMove, button.dataset.schemaDirection));
  });
  document.querySelectorAll("[data-schema-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteSchemaField(button.dataset.schemaDelete));
  });
}

function attachHomeEvents() {
  const zone = document.querySelector(".drop-zone");
  zone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone?.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
    processFiles([...event.dataTransfer.files]);
  });
}

function shouldIgnoreShortcut(event) {
  const target = event.target;
  if (!target) return false;
  const tag = target.tagName;
  return target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)
    || Boolean(target.closest(".modal-backdrop"));
}

function handleWorkbenchShortcut(event) {
  if (state.batchReviewRowId && event.key === "Escape" && !state.editingId) {
    event.preventDefault();
    closeBatchReview();
    return;
  }
  if (state.batchReviewRowId) return;
  if (state.batchIssueOpen && event.key === "Escape") {
    event.preventDefault();
    state.batchIssueOpen = false;
    render();
    return;
  }
  if (state.aiPanelOpen && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation?.();
    closeAiPanel();
    return;
  }
  if (state.primaryNavOpen && event.key === "Escape") {
    event.preventDefault();
    setPrimaryNav(false);
    return;
  }
  if (state.batchMode && event.key === "Escape" && !state.batchJob?.running) {
    event.preventDefault();
    setBatchMode(false);
    render();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("[data-global-search]")?.focus({ preventScroll: true });
    return;
  }
  if (state.view !== "detail" || event.isComposing || state.templatePanelExpanded || state.conflictsOpen || state.exportOpen || state.batchIssueOpen || state.pendingImport || state.resolutionRowId || state.trashOpen || state.workspaceListOpen || state.editingId || shouldIgnoreShortcut(event)) return;
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastAction();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === "j" || event.key === "J" || event.key === "ArrowDown") {
    event.preventDefault();
    nextResult();
  }
  if (event.key === "k" || event.key === "K" || event.key === "ArrowUp") {
    event.preventDefault();
    previousResult();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (event.repeat) return;
    confirmAndNext(state.selectedId);
  }
}

function attachDetailEvents() {
  document.querySelector("[data-detail-toggle]")?.addEventListener("click", toggleDetailDock);
  document.querySelector("[data-filter-toggle]")?.addEventListener("click", toggleFilters);
  document.querySelectorAll("[data-rail-toggle]").forEach((button) => {
    button.addEventListener("click", toggleRail);
  });
  document.querySelector("[data-table-head-toggle]")?.addEventListener("click", toggleTableHeader);
  document.querySelector("[data-confidence-sort]")?.addEventListener("click", toggleConfidenceSort);
  document.querySelector("[data-table-focus]")?.addEventListener("click", toggleTableFocus);
  document.querySelector("[data-batch-mode]")?.addEventListener("click", () => {
    if (setBatchMode(!state.batchMode)) render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.motionName = "filter";
      state.filter = button.dataset.filter;
      state.selectedId = visibleRows()[0]?.id || "";
      state.sourceText = "";
      state.sourceStatus = "idle";
      render();
      loadSelectedSource();
    });
  });

  const updateSearch = (event) => {
    if (event.isComposing) return;
    state.motionName = "filter";
    state.query = event.target.value;
    state.selectedId = visibleRows()[0]?.id || "";
    state.sourceText = "";
    state.sourceStatus = "idle";
    resetResearchForRow(selectedRow());
    render();
    loadSelectedSource();
  };
  document.querySelector("#searchInput")?.addEventListener("input", updateSearch);
  document.querySelector("#searchInput")?.addEventListener("compositionend", updateSearch);

  document.querySelector(".table-shell")?.addEventListener("click", (event) => {
    const batchSelect = event.target.closest("[data-batch-select]");
    if (batchSelect) {
      event.stopPropagation();
      toggleBatchSelection(batchSelect.dataset.batchSelect, batchSelect.checked);
      render();
      return;
    }
    const action = event.target.closest("[data-row-action]");
    if (action) {
      event.stopPropagation();
      handleRowAction(action.dataset.rowAction, action.dataset.rowId);
      return;
    }
    const item = event.target.closest("[data-row-id]");
    if (!item) return;
    selectResult(item.dataset.rowId);
  });

  const visibleSelector = document.querySelector("[data-batch-select-visible]");
  if (visibleSelector) {
    visibleSelector.indeterminate = visibleBatchSelectionState().mixed;
    visibleSelector.addEventListener("change", (event) => {
      setVisibleBatchSelection(event.target.checked);
      render();
    });
  }
  document.querySelector("[data-batch-clear]")?.addEventListener("click", () => {
    state.batchSelectedIds = new Set();
    render();
  });
  document.querySelector("[data-batch-confirm]")?.addEventListener("click", batchConfirmSelected);
  document.querySelector("[data-batch-ai]")?.addEventListener("click", startBatchAiReview);
  document.querySelector("[data-batch-stop]")?.addEventListener("click", stopBatchAiReview);
  document.querySelector("[data-batch-job-close]")?.addEventListener("click", () => {
    state.batchJob = null;
    state.batchReviewRowId = "";
    render();
  });
  document.querySelectorAll("[data-batch-result-row]").forEach((button) => {
    button.addEventListener("click", () => openBatchResult(button.dataset.batchResultRow));
  });
  document.querySelector("[data-batch-issue]")?.addEventListener("click", () => {
    state.batchIssueOpen = true;
    render();
  });
  document.querySelector("[data-batch-export]")?.addEventListener("click", () => openExportPanel("selected"));
  document.querySelector("[data-batch-delete]")?.addEventListener("click", batchDeleteSelected);

  document.querySelector(".review-screen")?.addEventListener("click", (event) => {
    const open = event.target.closest("[data-ai-panel-open]");
    if (open) {
      openAiPanel(open);
      return;
    }
    if (event.target.closest("[data-ai-panel-close]")) {
      closeAiPanel();
      return;
    }
    const retry = event.target.closest("[data-ai-retry-profile]");
    if (retry) {
      event.preventDefault();
      event.stopPropagation();
      retryConsensusModel(retry.dataset.aiRetryProfile, selectedRow());
      return;
    }
    const judgment = event.target.closest("[data-ai-judgment]");
    if (judgment) {
      setAiFieldJudgment(judgment.dataset.fieldId, judgment.dataset.aiJudgment);
      return;
    }
    const mobilePane = event.target.closest("[data-ai-mobile-pane]");
    if (mobilePane) {
      setAiMobilePane(mobilePane.dataset.aiMobilePane);
      return;
    }
    if (event.target.closest("[data-ai-generate]")) {
      performAiExtraction(state.selectedId);
      return;
    }
    if (event.target.closest("[data-ai-accept-all]")) {
      acceptAllAiFieldJudgments(selectedRow());
      return;
    }
    if (event.target.closest("[data-ai-clear]")) {
      clearAiProposal();
      return;
    }
    if (event.target.closest("[data-ai-apply]")) applyAiProposal(state.selectedId);
  });

  document.querySelector(".detail-panel")?.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-research-preset]");
    if (preset) {
      const row = selectedRow();
      if (!row) return;
      resetResearchForRow(row);
      state.researchQuery = researchPresetQuery(row, preset.dataset.researchPreset);
      state.researchStatus = "idle";
      state.researchResults = [];
      state.researchError = "";
      updateResearchDom(row);
      return;
    }
    const problemTag = event.target.closest("[data-problem-tag]");
    if (problemTag) {
      toggleProblemTag(problemTag.dataset.rowId, problemTag.dataset.problemTag);
      return;
    }
    const action = event.target.closest("[data-row-action]");
    if (!action) return;
    handleRowAction(action.dataset.rowAction, action.dataset.rowId);
  });

  document.querySelector(".detail-panel")?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-research-form]");
    if (!form) return;
    event.preventDefault();
    const row = selectedRow();
    const query = new FormData(form).get("researchQuery") || activeResearchQuery(row);
    performResearchSearch(query, row?.id);
  });

  document.querySelector(".detail-panel")?.addEventListener("input", (event) => {
    if (!event.target.matches("[data-research-form] input")) return;
    const row = selectedRow();
    if (state.researchRowId !== row?.id) resetResearchForRow(row);
    state.researchQuery = event.target.value;
  });

  document.querySelector("[data-review-reset]")?.addEventListener("click", resetReviewState);

  document.querySelectorAll("[data-quality-focus]").forEach((button) => {
    button.addEventListener("click", () => setQualityFocus(button.dataset.qualityFocus, button.dataset.qualityMode));
  });

  attachQueueFilterEvents();
  document.querySelector("[data-quality-clear]")?.addEventListener("click", clearQualityFocus);
  document.querySelector("[data-quality-batch-review]")?.addEventListener("click", batchMarkVisibleReview);
}

function isResultTable(rows) {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]);
  return keys.includes("附表") && (keys.includes("quote") || keys.includes("摘录") || keys.includes("原文"));
}

function mappedRowsFromPendingImport() {
  const pending = state.pendingImport;
  if (!pending) return [];
  return pending.files.flatMap((file) => file.rows.map((raw, index) => {
    let row;
    if (file.type === "json") {
      row = makeResult(raw, index);
    } else {
      const mapped = file.known ? { ...raw } : {};
      importSystemFields.forEach((field) => {
        const source = file.mapping.system?.[field.id];
        if (source) mapped[field.target] = raw[source] ?? "";
      });
      orderedSchema().forEach((field) => {
        const source = file.mapping.fields?.[field.id];
        mapped[field.label] = source ? raw[source] ?? "" : "";
        // Canonical aliases must take precedence over legacy raw columns.
        if (field.id === "quote") mapped.quote = mapped[field.label];
        if (field.id === "pageNo") mapped.page_no = mapped[field.label];
        if (field.id === "sourceFile") mapped.source_file = mapped[field.label];
      });
      mapped.__rowNumber = raw.__rowNumber || index + 2;
      row = makeResult(mapped, index);
      orderedSchema().forEach((field) => {
        const source = file.mapping.fields?.[field.id];
        setFieldValue(row, field.id, source ? raw[source] ?? "" : "");
      });
      syncLegacyFields(row);
      row.aiDraft = rowDraftFromFields(row.fields);
      row.history = createInitialHistory(row);
      row.abnormal = hasAbnormal(row);
    }
    const signature = window.CalligraphyImportWorkflow.contentSignature(row);
    const sourceId = file.type === "json" ? raw.id : raw[file.mapping.system?.id];
    if (!sourceId && !raw.id) row.id = pending.batch.id + "-" + file.index + "-" + index;
    row.importOrigin = raw.importOrigin || {
      key: JSON.stringify([file.name, sourceId || signature]),
      signature
    };
    row.importBatchId = pending.batch.id;
    row.importFileName = file.name;
    return row;
  }));
}

function pendingImportPlan() {
  const pending = state.pendingImport;
  if (!pending) return null;
  const pageConflicts = [...pending.pages].filter(([name, content]) =>
    pending.mode !== "new" && state.uploadedPages.has(name) && state.uploadedPages.get(name) !== content);
  const blockedPages = new Set(pageConflicts.map(([name]) => name));
  const workflow = window.CalligraphyImportWorkflow;
  const allIncoming = mappedRowsFromPendingImport();
  const decided = [];
  const incoming = allIncoming.filter((row) => {
    const sourceFile = blockedPages.has(row.sourceFile) ? row.sourceFile : "";
    const identity = workflow.issueIdentity(row, sourceFile, sourceFile ? pending.pages.get(sourceFile) : null);
    if (pending.mode !== "new" && workflow.resolvedDecision(state.importReports, identity)) {
      decided.push({ type: "duplicate", row, reason: "相同导入内容已人工处理" });
      return false;
    }
    return true;
  });
  const blockedRows = incoming.filter((row) => blockedPages.has(row.sourceFile));
  const plan = window.CalligraphyImportWorkflow.planImport(
    state.rows, incoming.filter((row) => !blockedPages.has(row.sourceFile)),
    { mode: pending.mode, deletedRows: state.trashRows, preserveInvalid: Boolean(pending.workspace) });
  blockedRows.forEach((row) => {
    plan.counts.conflict++;
    const existing = [...state.rows, ...state.trashRows].find((item) =>
      item.id === row.id || (row.importOrigin?.key && item.importOrigin?.key === row.importOrigin.key));
    plan.actions.push({ type: "conflict", row, existing, sourceConflict: true,
      sourceFile: row.sourceFile, reason: "同名原文内容不同，保留旧原文" });
  });
  plan.counts.duplicate += decided.length;
  plan.actions.push(...decided);
  const sourceIssues = pageConflicts.filter(([name, text]) =>
    !allIncoming.some((row) => row.sourceFile === name)
    && !workflow.resolvedDecision(state.importReports, workflow.issueIdentity(null, name, text)))
    .map(([sourceFile]) => ({ type: "source", row: null, sourceFile, sourceConflict: true,
      reason: "同名原文内容不同，保留旧原文" }));
  plan.counts.conflict += sourceIssues.length;
  return { ...plan, pageConflicts, sourceIssues };
}

function readImportMapping(form) {
  const pending = state.pendingImport;
  if (!pending) return;
  const file = pending.files[pending.activeFile];
  const data = new FormData(form);
  if (file?.type === "csv") {
    const mappingDetails = form.querySelector?.(".import-mapping");
    if (mappingDetails) file.mappingOpen = mappingDetails.open;
    file.mapping = { system: {}, fields: {} };
    importSystemFields.forEach((field) => {
      file.mapping.system[field.id] = String(data.get("system:" + field.id) || "");
    });
    orderedSchema().forEach((field) => {
      file.mapping.fields[field.id] = String(data.get("field:" + field.id) || "");
    });
  }
  pending.mode = String(data.get("importMode") || pending.mode);
}

function confirmPendingImport() {
  const pending = state.pendingImport;
  if (!pending) return false;
  if (pending.mode === "new" && cloudReady()) {
    window.alert("云端工作区请使用追加或更新；新建工作区需先完成云端项目配置。");
    return false;
  }
  const plan = pendingImportPlan();
  if (!saveWorkspace()) return false;
  const keys = ["rows", "originalRows", "workspaceId", "datasetName", "reviewState",
    "trashRows", "undoAction", "uploadedPages", "uploadLog", "importReports", "exportVersions", "schema",
    "schemaTemplateId", "schemaVersion", "promptVersion", "selectedId"];
  const before = Object.fromEntries(keys.map((key) => [key, state[key]]));
  const isNew = pending.mode === "new";
  if (isNew) {
    resetBatchUiState();
    state.workspaceId = newWorkspaceId();
    state.datasetName = pending.workspace?.datasetName || pending.name;
    state.reviewState = { ...reviewDefaults(), ...(pending.workspace?.reviewState || {}) };
    state.trashRows = (pending.workspace?.trashRows || []).map(makeResult);
    state.undoAction = null;
    state.importReports = pending.workspace?.importReports || [];
    state.exportVersions = pending.workspace?.exportVersions || [];
    state.uploadedPages = new Map();
    if (pending.workspace?.schema?.length) {
      state.schema = cloneSchema(pending.workspace.schema);
      state.schemaTemplateId = pending.workspace.schemaTemplateId || state.schemaTemplateId;
      state.schemaVersion = pending.workspace.schemaVersion || SCHEMA_VERSION;
      state.promptVersion = pending.workspace.promptVersion || PROMPT_VERSION;
    }
  }
  state.rows = plan.rows;
  const originals = new Map((isNew ? [] : state.originalRows).map((row) => [row.id, row]));
  plan.actions.filter((action) => ["added", "updated"].includes(action.type))
    .forEach((action) => originals.set(action.row.id, cloneRow(action.row)));
  if (isNew && pending.workspace?.originalRows) {
    pending.workspace.originalRows.forEach((row) => originals.set(row.id, cloneRow(row)));
  }
  state.originalRows = [...originals.values()];
  state.uploadedPages = new Map(state.uploadedPages);
  const blocked = new Set(plan.pageConflicts.map(([name]) => name));
  pending.pages.forEach((content, name) => {
    if (!blocked.has(name)) state.uploadedPages.set(name, content);
  });
  const report = {
    id: pending.batch.id, createdAt: new Date().toISOString(), mode: pending.mode,
    fileNames: pending.batch.fileNames, counts: plan.counts,
    pageConflicts: [...blocked],
    sourceConflicts: Object.fromEntries(plan.pageConflicts), sourceVersions: {},
    originalSources: Object.fromEntries(plan.pageConflicts.map(([name]) => [name, before.uploadedPages.get(name)])),
    issues: [...plan.actions.filter((action) => ["conflict", "invalid"].includes(action.type)), ...plan.sourceIssues]
      .map((action) => ({ type: action.type, row: action.row ? cloneRow(action.row) : null,
        existingId: action.existing?.id || "", reason: action.reason,
        sourceFile: action.sourceFile || "", sourceConflict: Boolean(action.sourceConflict),
        identity: window.CalligraphyImportWorkflow.issueIdentity(action.row, action.sourceFile || "",
          action.sourceFile ? pending.pages.get(action.sourceFile) : null) }))
  };
  state.importReports = [...state.importReports, report];
  const count = plan.counts;
  state.uploadLog = [...(isNew ? [] : state.uploadLog), ...pending.log,
    logEntry("success", pending.name, "新增 " + count.added + " · 跳过重复 " + count.duplicate
      + " · 更新 " + count.updated + " · 冲突 " + count.conflict + " · 无效 " + count.invalid,
    { rows: count.added, step: "导入完成" })];
  state.selectedId = state.rows.some((row) => row.id === before.selectedId) ? before.selectedId : state.rows[0]?.id || "";
  if (!saveWorkspace()) {
    Object.assign(state, before);
    return false;
  }
  state.pendingImport = null;
  state.conflictsOpen = report.issues.length > 0;
  state.conflictFilter = "open";
  state.conflictSelection = report.issues.length ? `${state.importReports.length - 1}:0` : "";
  state.conflictMessage = "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  state.sourceCache = new Map();
  state.manifest = buildManifest(state.rows);
  if (cloudReady()) state.cloud.message = "导入已保存在本地，待同步云端";
  state.filter = "all";
  state.query = "";
  state.qualityFocus = null;
  navigateToView("detail", "table");
  render();
  loadSelectedSource();
  return true;
}

function cancelPendingImport() {
  state.pendingImport = null;
  render();
}

async function processFiles(files) {
  if (!files.length) return;
  const batch = window.CalligraphyImportWorkflow.createImportBatch(files);
  const pending = {
    name: files.length + " 个文件", batch, files: [], pages: new Map(),
    log: [], activeFile: 0, mode: "append", workspace: null
  };
  for (const file of files) {
    const name = file.name;
    const lower = name.toLowerCase();
    try {
      if (SOURCE_PAGE_PATTERN.test(name)) {
        const content = await file.text();
        if (pending.pages.has(name) && pending.pages.get(name) !== content) throw new Error("同批次原文重名且内容不同");
        pending.pages.set(name, content);
      } else if (lower.endsWith(".csv")) {
        const rows = parseCsv(await file.text());
        if (!rows.length) throw new Error("CSV 没有数据行");
        pending.files.push({ type: "csv", name, rows, headers: csvHeaders(rows),
          known: isKnownResultCsv(name, rows), mapping: guessCsvMapping(rows), index: pending.files.length });
      } else if (lower.endsWith(".json")) {
        const payload = JSON.parse(await file.text());
        const workspace = payload.type === "calligraphy-workspace" ? payload : null;
        if (workspace && files.length !== 1) throw new Error("工作区备份请单独导入");
        const rows = Array.isArray(payload) ? payload : payload.rows || payload.results || [];
        if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("JSON 条目格式不正确");
        if (workspace) {
          pending.workspace = workspace;
          pending.mode = "new";
          pending.name = workspace.datasetName || name;
          Object.entries(workspace.uploadedPages || {}).forEach(([page, text]) => {
            if (SOURCE_PAGE_PATTERN.test(page)) pending.pages.set(page, String(text));
          });
        }
        pending.files.push({ type: "json", name, rows, index: pending.files.length });
      } else {
        throw new Error(lower.endsWith(".xlsx") ? "请先将 XLSX 转为 CSV" : "暂不支持此文件类型");
      }
      pending.log.push(logEntry("success", name, "文件已读取", { step: "材料导入" }));
    } catch (error) {
      pending.log.push(logEntry("error", name, error.message, { step: "材料导入" }));
    }
  }
  if (!pending.files.length && !pending.pages.size) {
    window.alert(pending.log.map((item) => item.name + "：" + item.message).join("\n"));
    return;
  }
  state.pendingImport = pending;
  render();
}

async function loadSelectedSource(options = {}) {
  if (state.view !== "detail") return;
  const row = selectedRow();
  const requestId = options.requestId || state.sourceRequestId + 1;
  state.sourceRequestId = requestId;
  if (!row?.sourceFile) {
    state.sourceText = "";
    state.sourceStatus = "missing";
    updateSourceDom(row);
    return;
  }

  if (state.uploadedPages.has(row.sourceFile)) {
    state.sourceText = state.uploadedPages.get(row.sourceFile);
    state.sourceStatus = "ready";
    updateSourceDom(row);
    return;
  }

  if (state.sourceCache.has(row.sourceFile)) {
    state.sourceText = state.sourceCache.get(row.sourceFile);
    state.sourceStatus = "ready";
    updateSourceDom(row);
    return;
  }

  state.sourceText = "";
  state.sourceStatus = "error";
  updateSourceDom(row);
}

async function loadBundledSampleData() {
  try {
    const requestedIngest = location.hash === "#ingest" || state.view === "ingest";
    const requestedReviewMode = location.hash === "#review" || state.detailMode === "review";
    const embedded = window.CALLIGRAPHY_EMBEDDED_SAMPLE;
    let csvText = embedded?.csv || "";
    if (!csvText) {
      const csvResponse = await fetch(SAMPLE_DATASET.csv, { cache: "no-store" });
      if (!csvResponse.ok) throw new Error(`样本主表读取失败：${csvResponse.status}`);
      csvText = await csvResponse.text();
    }
    const csvRows = parseCsv(csvText);
    if (!csvRows.length) throw new Error("样本主表没有数据行。");

    state.uploadedPages = new Map();
    if (embedded?.pages) {
      Object.entries(embedded.pages).forEach(([name, content]) => {
        if (SOURCE_PAGE_PATTERN.test(name)) state.uploadedPages.set(name, String(content));
      });
    } else {
      await Promise.all(SAMPLE_DATASET.pages.map(async (name) => {
        const response = await fetch(`./data/sample/source-pages/${name}`, { cache: "no-store" });
        if (response.ok) state.uploadedPages.set(name, await response.text());
      }));
    }

    const rows = csvRows.map(makeResult);
    state.rows = rows;
    state.originalRows = rows.map(cloneRow);
    state.datasetName = embedded?.name || "旧版第三轮综合总表 · 真实样本";
    state.manifest = buildManifest(rows);
    state.selectedId = rows[0]?.id || "";
    state.filter = "all";
    state.query = "";
    state.sourceText = "";
    state.sourceStatus = "idle";
    state.sourceCache = new Map();
    state.uploadLog = [
      logEntry("success", "旧版第三轮综合总表", `已自动载入 ${rows.length} 行真实样本。`, { rows: rows.length, step: "样本导入" }),
      logEntry("success", "原文页缓存", `已载入 ${state.uploadedPages.size} 个 page_*.txt 原文页。`, { count: state.uploadedPages.size, step: "原文页" })
    ];
    state.view = requestedIngest ? "ingest" : "detail";
    state.detailMode = requestedReviewMode ? "review" : "table";
    applyDetailModeDefaults(state.detailMode);
    location.hash = requestedIngest ? "#ingest" : state.detailMode === "review" ? "#review" : "#detail";
    return true;
  } catch (error) {
    state.uploadLog = [logEntry("warn", "真实样本", error.message, { step: "样本导入" })];
    return false;
  }
}

async function init() {
  initButtonTooltips();
  window.AncientIngestUI?.configure?.({
    rerender: () => render(),
    importFiles: (files) => processFiles(files),
  });
  await initCloudRuntime();
  restoreRememberedEmail();
  restoreLocalDemoSession();
  const loadedCloudWorkspace = await loadCloudWorkspaceData();
  const loadedWorkspace = loadedCloudWorkspace || loadWorkspace();
  if (!loadedWorkspace) {
    resetBatchUiState();
    state.workspaceId = newWorkspaceId();
    state.schemaTemplateId = "calligraphy-style";
    state.schema = defaultSchema(state.schemaTemplateId);
    state.schemaVersion = SCHEMA_VERSION;
    state.promptVersion = PROMPT_VERSION;
    state.reviewState = reviewDefaults();
    state.rows = [];
    state.originalRows = [];
    state.manifest = buildManifest([]);
  }
  if (!state.rows.length && !state.uploadedPages.size) {
    await loadBundledSampleData();
    saveWorkspace();
  }
  if (state.cloud.config?.aiEnabled && state.modelSettings.status === "idle") await loadModelConfig();
  if (state.view === "detail") applyDetailModeDefaults(state.detailMode);
  render();
  if (state.entryStage === "workspace" && state.view === "detail") loadSelectedSource();
}

window.addEventListener("hashchange", () => {
  if (state.suppressHashMotion) {
    state.suppressHashMotion = false;
    return;
  }
  const previousView = state.view;
  const previousDetailMode = state.detailMode;
  applyRouteFromHash();
  if (state.view === "detail") applyDetailModeDefaults(state.detailMode);
  const from = viewKey(previousView, previousDetailMode);
  const to = viewKey();
  state.motionName = from === to ? "refresh" : `${from}-${to}`;
  render();
  if (state.entryStage === "workspace" && state.view === "detail") loadSelectedSource();
});

window.addEventListener("keydown", handleWorkbenchShortcut);

compactWorkbench?.addEventListener("change", (event) => {
  state.railCollapsed = event.matches;
  if (state.manifest) applyTableViewState();
});
narrowWorkbench?.addEventListener("change", (event) => {
  setDetailDock(state.aiPanelOpen ? false : event.matches && state.detailMode === "table");
});

init().catch((error) => {
  app.innerHTML = `
    <div class="boot error">
      <strong>数据包读取失败</strong>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
});

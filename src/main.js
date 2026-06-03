const app = document.querySelector("#app");
const WORKSPACE_POINTER_KEY = "calligraphy-current-workspace-v2";
const WORKSPACE_STORAGE_PREFIX = "calligraphy-workspace-v2:";
const CUSTOM_TEMPLATES_KEY = "calligraphy-custom-schema-templates-v1";
const SCHEMA_VERSION = 1;
const PROMPT_VERSION = 1;

const schemaTemplates = [
  {
    id: "calligraphy-style",
    name: "书论风格评价抽取模板",
    description: "适合书论、书法品评、风格术语和原文证据整理。",
    fields: [
      { id: "author", label: "书家", type: "text", prompt: "抽取被评价或被讨论的书家姓名。若原文没有明确书家，留空并在待复核问题中说明。", required: true, evidenceRequired: true, visible: true },
      { id: "scriptType", label: "书体", type: "text", prompt: "抽取书体或可能书体，如楷书、草书、隶书等；无法确定时写“未标注”。", required: false, evidenceRequired: true, visible: true },
      { id: "quote", label: "原文摘录", type: "longtext", prompt: "摘录能够支持判断的最小原文片段，优先保留完整评价短语。", required: true, evidenceRequired: true, visible: true },
      { id: "pageNo", label: "页码", type: "text", prompt: "记录原文页码或页序，用于回到 page_*.txt。", required: true, evidenceRequired: false, visible: true },
      { id: "sourceFile", label: "原文文件", type: "text", prompt: "记录对应原文文件名，例如 page_191.txt。", required: true, evidenceRequired: false, visible: false },
      { id: "confidence", label: "证据等级", type: "select", prompt: "判断摘录是否足以支持入表，建议使用 高/中/低/待复核。", required: false, evidenceRequired: true, visible: true },
      { id: "gate", label: "门禁", type: "text", prompt: "判断该条是否可入主表、需补证、或应排除。", required: false, evidenceRequired: false, visible: true },
      { id: "issue", label: "待复核问题", type: "longtext", prompt: "记录 OCR、页码、归属、解释歧义等需要人工处理的问题。", required: false, evidenceRequired: false, visible: false },
      { id: "note", label: "备注", type: "longtext", prompt: "记录人工判断、补充说明或后续处理建议。", required: false, evidenceRequired: false, visible: false }
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
  { id: "invalid", label: "字段待补", tone: "Fix" }
];

const annotationTypes = [
  { id: "page", label: "页码问题" },
  { id: "attribution", label: "归属问题" },
  { id: "quote", label: "摘录不足" },
  { id: "mapping", label: "字段映射问题" },
  { id: "expert", label: "专家判断" },
  { id: "other", label: "其他" }
];

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
  view: location.hash === "#detail" ? "detail" : "home",
  filter: "all",
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
  detailCollapsed: false,
  filtersCollapsed: false,
  railCollapsed: false,
  tableFocus: false,
  tableHeaderCollapsed: false,
  templatePanelExpanded: false
};

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
  return { ...row };
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
    uploadedPages: Object.fromEntries(state.uploadedPages),
    uploadLog: state.uploadLog,
    reviewState: state.reviewState
  };
}

function saveWorkspace() {
  const id = ensureWorkspaceId();
  state.lastSavedAt = new Date().toISOString();
  localStorage.setItem(WORKSPACE_POINTER_KEY, id);
  localStorage.setItem(storageKey(id), JSON.stringify({ ...workspacePayload(), savedAt: state.lastSavedAt }));
}

function loadWorkspace() {
  const id = localStorage.getItem(WORKSPACE_POINTER_KEY);
  if (!id) return false;
  try {
    const payload = JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    if (!payload || !Array.isArray(payload.rows)) return false;
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
    state.reviewState = { ...reviewDefaults(), ...(payload.reviewState || {}) };
    state.originalRows = (payload.originalRows?.length ? payload.originalRows : payload.rows).map(cloneRow);
    state.rows = payload.rows.map(makeResult);
    state.baseRows = [];
    state.baseManifest = null;
    state.manifest = buildManifest(state.rows);
    state.selectedId = state.rows[0]?.id || "";
    state.lastSavedAt = payload.savedAt || "";
    return true;
  } catch {
    return false;
  }
}

function clearWorkspace() {
  const id = state.workspaceId || localStorage.getItem(WORKSPACE_POINTER_KEY);
  if (id) localStorage.removeItem(storageKey(id));
  localStorage.removeItem(WORKSPACE_POINTER_KEY);
  localStorage.removeItem("calligraphy-review-state-v1");
  state.workspaceId = newWorkspaceId();
  state.datasetName = "空白隔离工作区";
  state.schemaTemplateId = "calligraphy-style";
  state.schema = defaultSchema(state.schemaTemplateId);
  state.schemaVersion = SCHEMA_VERSION;
  state.promptVersion = PROMPT_VERSION;
  state.uploadedPages = new Map();
  state.uploadLog = [];
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
  saveWorkspace();
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
    abnormal: Boolean(row.abnormal)
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
  return Object.keys(rows[0]).filter((key) => key !== "__rowNumber");
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

function createPendingCsvImport(name, rows) {
  state.pendingImport = {
    type: "csv",
    name,
    rows,
    headers: csvHeaders(rows),
    mapping: guessCsvMapping(rows)
  };
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
  if (/^page_\d+\.txt$/i.test(file)) return file;
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
  if (row.appendix && row.id) {
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
      edited: Boolean(row.edited)
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
  const result = {
    id,
    rowNumber: row.__rowNumber || index + 2,
    appendix: row["附表"] || "",
    appendixCode: appendixCode(row["附表"]),
    bucket: classifyBucket(row),
    status: row["二轮状态"] || "",
    sourceData: row["来源数据"] || "",
    fields,
    aiDraft: rowDraftFromFields(fields),
    history: [],
    annotations: [],
    schemaVersion: state.schemaVersion,
    promptVersion: state.promptVersion,
    modelVersion: "csv-import",
    action: row["第二轮动作"] || "",
    recommendation: row["进入主表建议"] || "",
    originalRecord: row["对应原高置信记录"] || "",
    abnormal: hasAbnormal(row),
    reviewed: false,
    edited: false
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
  const confirmedThenChanged = Boolean(row.reviewed && row.edited);
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
    linkedRows: rows.filter((row) => row.sourceFile).length,
    exactHits: rows.filter((row) => row.hit === "exact").length,
    reviewRows: rows.filter((row) => row.bucket === "review").length,
    abnormalRows: rows.filter((row) => row.abnormal).length,
    invalidRows: validations.filter((validation) => !validation.ok).length,
    missingRequiredRows: validations.filter((validation) => validation.missingRequired.length).length,
    missingEvidenceRows: validations.filter((validation) => validation.missingEvidence.length).length,
    changedAfterConfirmRows: validations.filter((validation) => validation.confirmedThenChanged).length,
    confirmedRows: rows.filter((row) => row.reviewed).length,
    editedRows: rows.filter((row) => row.edited).length,
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
    ...orderedSchema().map((field) => fieldValue(row, field.id)),
    row.hit,
    row.reviewed ? "已确认" : "",
    row.edited ? "已修改" : "",
  ].join(" ");
}

function rowMatchesQualityFocus(row) {
  if (!state.qualityFocus) return true;
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
  return state.rows.filter((row) => {
    const filterPass = state.filter === "all"
      || (state.filter === "abnormal" ? row.abnormal : state.filter === "invalid" ? !rowValidation(row).ok : row.bucket === state.filter);
    const focusPass = rowMatchesQualityFocus(row);
    const queryPass = !query || rowText(row).toLowerCase().includes(query);
    return filterPass && focusPass && queryPass;
  });
}

function selectedRow() {
  return state.rows.find((row) => row.id === state.selectedId) || visibleRows()[0] || state.rows[0] || null;
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
      <button type="button" data-workspace-export ${state.rows.length ? "" : "disabled"}>导出工作区</button>
      <button type="button" data-quality-export ${state.rows.length ? "" : "disabled"}>导出字段质量</button>
      <button type="button" data-template-download>下载 CSV 模板</button>
      <button type="button" data-workspace-reset>清空本地工作区</button>
    </div>
  `;
}

function templatePanel() {
  const current = templateById(state.schemaTemplateId);
  const templates = allSchemaTemplates();
  const visibleCount = orderedSchema({ includeHidden: false }).length;
  const totalCount = orderedSchema().length;
  return `
    <details class="schema-panel" data-template-panel ${state.templatePanelExpanded ? "open" : ""}>
      <summary class="schema-summary">
        <div>
          <p class="kicker">Schema Studio</p>
          <h3>字段模板</h3>
          <p>${escapeHtml(current.description)}</p>
        </div>
        <div class="schema-summary-meta">
          <strong>${escapeHtml(current.custom ? "我的模板" : "内置模板")}</strong>
          <span>${visibleCount} / ${totalCount} 字段显示</span>
          <i>${state.templatePanelExpanded ? "收起" : "展开"}</i>
        </div>
      </summary>
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
    </details>
  `;
}

function filterChips(rows) {
  const counts = Object.fromEntries(filters.map((filter) => [filter.id, 0]));
  rows.forEach((row) => {
    counts.all += 1;
    counts[row.bucket] = (counts[row.bucket] || 0) + 1;
    if (row.abnormal) counts.abnormal += 1;
    if (!rowValidation(row).ok) counts.invalid += 1;
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

function sourceQuality(row, useLoadedText = false) {
  const factors = [];
  let score = 0;

  if (row.sourceFile) {
    score += 18;
    factors.push({ ok: true, label: "原文页已关联" });
  } else {
    factors.push({ ok: false, label: "缺原文页" });
  }

  if (row.pageNo) {
    score += 12;
    factors.push({ ok: true, label: "页码存在" });
  } else {
    factors.push({ ok: false, label: "缺页码" });
  }

  if (String(row.quote || "").trim().length >= 4) {
    score += 18;
    factors.push({ ok: true, label: "摘录可比对" });
  } else {
    factors.push({ ok: false, label: "摘录不足" });
  }

  const hitScore = { exact: 28, compact: 23, partial: 12, miss: 0 }[row.hit] ?? 6;
  score += hitScore;
  factors.push({ ok: hitScore >= 20, label: `命中：${row.hit || "none"}` });

  if (useLoadedText) {
    if (state.sourceStatus === "ready" && state.sourceText) {
      const range = findApproxRange(state.sourceText, row.quote);
      if (range) {
        score += 24;
        factors.push({ ok: true, label: "原文高亮命中" });
      } else {
        score += 4;
        factors.push({ ok: false, label: "高亮未定位" });
      }
    } else if (state.sourceStatus === "loading") {
      factors.push({ ok: true, label: "原文读取中" });
    } else if (state.sourceStatus === "error") {
      factors.push({ ok: false, label: "原文读取失败" });
    }
  }

  if (row.abnormal) {
    score -= 10;
    factors.push({ ok: false, label: "异常队列" });
  }

  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  const tone = normalized >= 82 ? "high" : normalized >= 64 ? "medium" : normalized >= 42 ? "low" : "risk";
  const label = normalized >= 82 ? "高" : normalized >= 64 ? "中" : normalized >= 42 ? "待复核" : "低";
  return { score: normalized, tone, label, factors };
}

function confidencePill(row) {
  const quality = sourceQuality(row, false);
  return `<span class="confidence-chip ${quality.tone}">${quality.score} · ${quality.label}</span>`;
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
    <div class="row-actions">
      <button type="button" data-row-action="confirm" data-row-id="${escapeHtml(row.id)}">${row.reviewed ? "已确认" : "确认"}</button>
      <button type="button" data-row-action="edit" data-row-id="${escapeHtml(row.id)}">修改</button>
      <button type="button" class="danger" data-row-action="delete" data-row-id="${escapeHtml(row.id)}">删除</button>
    </div>
  `;
}

function visibleTableFields() {
  const fields = orderedSchema({ includeHidden: false });
  return fields.length ? fields.slice(0, 6) : orderedSchema().slice(0, 6);
}

function resultTable(rows) {
  if (!rows.length) {
    return `
      <div class="empty-state">
        <strong>没有匹配结果</strong>
        <p>调整筛选或搜索词后再查看。</p>
      </div>
    `;
  }

  const tableFields = visibleTableFields();
  return `
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>回检</th>
            <th>审校</th>
            <th>字段</th>
            <th>置信</th>
            <th>附表</th>
            ${tableFields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr class="${row.id === state.selectedId ? "selected" : ""} ${row.abnormal ? "abnormal" : ""} ${!rowValidation(row).ok ? "invalid" : ""}" data-row-id="${escapeHtml(row.id)}" style="--row-delay:${Math.min(index, 22) * 18}ms">
              <td><button type="button" data-row-id="${escapeHtml(row.id)}">查看</button></td>
              <td>${reviewBadge(row)}${rowActionButtons(row)}</td>
              <td>${validationBadge(row)}</td>
              <td>${confidencePill(row)}</td>
              <td><span class="appendix">${escapeHtml(row.appendixCode)}</span>${escapeHtml(row.status)}</td>
              ${tableFields.map((field, fieldIndex) => {
                const value = fieldValue(row, field.id);
                const cell = field.type === "longtext" ? clip(value, 110) : value;
                const content = fieldIndex === 0
                  ? `<strong>${escapeHtml(cell || "未标注")}</strong><small>${escapeHtml(row.id)}</small>`
                  : escapeHtml(cell || "未标注");
                return `<td title="${escapeHtml(value)}">${content}</td>`;
              }).join("")}
            </tr>
          `).join("")}
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
  return `
    <pre>${escapeHtml(state.sourceText.slice(0, start))}<mark>${escapeHtml(state.sourceText.slice(start, end))}</mark>${escapeHtml(state.sourceText.slice(end))}</pre>
  `;
}

function detailCardContent(row) {
  const titleField = schemaField("author") || orderedSchema({ includeHidden: false })[0];
  const title = titleField ? fieldValue(row, titleField.id) : row.author;
  const quote = fieldValue(row, "quote") || row.quote;
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
      <blockquote>${escapeHtml(quote || "无摘录")}</blockquote>
      <div class="review-actions">
        <button type="button" data-row-action="confirm" data-row-id="${escapeHtml(row.id)}">${row.reviewed ? "已确认" : "确认此条"}</button>
        <button type="button" data-row-action="edit" data-row-id="${escapeHtml(row.id)}">修改字段</button>
        <button type="button" class="danger" data-row-action="delete" data-row-id="${escapeHtml(row.id)}">删除条目</button>
      </div>
      <dl>
        ${orderedSchema().map((field) => `
          <dt>${escapeHtml(field.label)}</dt>
          <dd>
            ${escapeHtml(fieldValue(row, field.id) || "未标注")}
            ${field.evidenceRequired ? "<small>需证据</small>" : ""}
          </dd>
        `).join("")}
        <dt>命中</dt><dd>${escapeHtml(row.hit || "none")}</dd>
      </dl>
  `;
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
              <strong>${escapeHtml(event.type === "ai-draft" ? "AI 初稿" : event.type === "confirm" ? "人工确认" : "人工修订")}</strong>
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
  return `
      <div class="source-head">
        <div>
          <p class="kicker">Original Page</p>
          <h2>${escapeHtml(row.sourceFile || "未关联原文")}</h2>
        </div>
        <span>${row.abnormal ? "需复核" : "可回检"}</span>
      </div>
      <div class="confidence-panel ${quality.tone}">
        <div class="confidence-head">
          <strong>原文置信度</strong>
          <span>${quality.score} · ${quality.label}</span>
        </div>
        <div class="confidence-bar"><i style="width:${quality.score}%"></i></div>
        <div class="confidence-factors">
          ${quality.factors.map((factor) => `<span class="${factor.ok ? "ok" : "warn"}">${escapeHtml(factor.label)}</span>`).join("")}
        </div>
      </div>
      ${highlightedSource(row)}
  `;
}

function sourceCard(row) {
  return `
    <section class="source-card" aria-live="polite">
      ${sourceCardContent(row)}
    </section>
  `;
}

function resultsControlPanel(rows) {
  return `
    <div class="controls ${state.filtersCollapsed ? "collapsed" : ""}">
      <div class="controls-head">
        <div>
          <span>筛选标签</span>
          <small>${escapeHtml(filters.find((item) => item.id === state.filter)?.label || "全部")} · ${rows.length} 条</small>
        </div>
        <button type="button" data-filter-toggle aria-expanded="${String(!state.filtersCollapsed)}">${state.filtersCollapsed ? "展开" : "收起"}</button>
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

function tableViewActions() {
  return `
    <div class="table-view-actions" aria-label="表格视图控制">
      <button type="button" class="${state.tableFocus ? "active" : ""}" data-table-focus aria-pressed="${String(state.tableFocus)}">${state.tableFocus ? "退出专注" : "专注表格"}</button>
      <button type="button" class="${state.railCollapsed ? "active" : ""}" data-rail-toggle aria-pressed="${String(state.railCollapsed)}">${state.railCollapsed ? "显示侧栏" : "隐藏侧栏"}</button>
      <button type="button" class="${state.tableHeaderCollapsed ? "active" : ""}" data-table-head-toggle aria-pressed="${String(state.tableHeaderCollapsed)}">${state.tableHeaderCollapsed ? "显示表头" : "收起表头"}</button>
    </div>
  `;
}

function detailPanel(row) {
  if (!row) {
    return `
      <aside class="detail-panel ${state.detailCollapsed ? "collapsed" : ""}">
        <div class="dock-grip"></div>
        <div class="detail-dock-head">
          <div>
            <p class="kicker">Inspection Dock</p>
            <h2>暂无数据</h2>
          </div>
          <button type="button" data-detail-toggle aria-expanded="${String(!state.detailCollapsed)}">${state.detailCollapsed ? "展开" : "收起"}</button>
        </div>
        <div class="detail-dock-body"><div class="empty-state"><strong>暂无数据</strong></div></div>
      </aside>
    `;
  }

  return `
    <aside class="detail-panel ${state.detailCollapsed ? "collapsed" : ""}">
      <div class="dock-grip"></div>
      <div class="detail-dock-head">
        <div>
          <p class="kicker">Inspection Dock</p>
          <h2>${escapeHtml(fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目")} · ${escapeHtml(row.id)}</h2>
        </div>
        <button type="button" data-detail-toggle aria-expanded="${String(!state.detailCollapsed)}">${state.detailCollapsed ? "展开" : "收起"}</button>
      </div>
      <div class="detail-dock-body">
        ${detailCard(row)}
        ${sourceCard(row)}
      </div>
    </aside>
  `;
}

function updateSelectedRowDom() {
  document.querySelectorAll("tbody tr[data-row-id]").forEach((row) => {
    row.classList.toggle("selected", row.dataset.rowId === state.selectedId);
  });
}

function updateDetailDom(row) {
  const panel = document.querySelector(".detail-panel");
  if (!panel) {
    render();
    return;
  }
  if (!row) {
    panel.innerHTML = "<div class='empty-state'><strong>暂无数据</strong></div>";
    return;
  }

  const detail = panel.querySelector(".detail-card");
  const source = panel.querySelector(".source-card");
  if (!detail || !source) {
    render();
    return;
  }

  const dockTitle = panel.querySelector(".detail-dock-head h2");
  if (dockTitle) dockTitle.textContent = `${fieldValue(row, "author") || fieldValue(row, orderedSchema({ includeHidden: false })[0]?.id) || "未标注条目"} · ${row.id}`;
  detail.innerHTML = detailCardContent(row);
  source.innerHTML = sourceCardContent(row);
}

function updateSourceDom(row) {
  const card = document.querySelector(".source-card");
  if (!card) {
    updateDetailDom(row);
    return;
  }
  card.innerHTML = sourceCardContent(row);
}

function cachedSourceText(sourceFile) {
  if (state.uploadedPages.has(sourceFile)) return state.uploadedPages.get(sourceFile);
  if (state.sourceCache.has(sourceFile)) return state.sourceCache.get(sourceFile);
  return null;
}

function selectResult(rowId) {
  if (!rowId) return;
  if (rowId === state.selectedId) {
    setDetailDock(false);
    return;
  }
  state.selectedId = rowId;
  setDetailDock(false);
  const requestId = state.sourceRequestId + 1;
  state.sourceRequestId = requestId;
  updateSelectedRowDom();
  const row = selectedRow();

  if (!row?.sourceFile) {
    state.sourceText = "";
    state.sourceStatus = "missing";
  } else {
    const cached = cachedSourceText(row.sourceFile);
    state.sourceText = cached || "";
    state.sourceStatus = cached ? "ready" : "loading";
  }

  updateDetailDom(row);
  if (row?.sourceFile && state.sourceStatus === "loading") {
    loadSelectedSource({ loadingRendered: true, requestId });
  }
}

function persistRow(row) {
  if (row.reviewed && !state.reviewState.confirmedIds.includes(row.id)) {
    state.reviewState.confirmedIds.push(row.id);
  }
  if (row.edited) {
    state.reviewState.edits[row.id] = editableSnapshot(row);
  }
  saveReviewState();
}

function confirmRow(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  row.reviewed = true;
  row.reviewedAt = new Date().toISOString();
  addHistory(row, {
    type: "confirm",
    actor: "human",
    reason: "人工确认当前条目。",
    changes: []
  });
  persistRow(row);
  state.manifest = buildManifest(state.rows);
  updateSelectedRowDom();
  if (state.selectedId === row.id) updateDetailDom(row);
  updateReviewToolbarDom();
  updateVisibleCountDom();
  updateTableRowStatus(row);
}

function deleteRow(rowId) {
  const row = state.rows.find((item) => item.id === rowId);
  if (!row) return;
  if (!state.reviewState.deletedIds.includes(row.id)) {
    state.reviewState.deletedIds.push(row.id);
  }
  saveReviewState();
  const currentRows = visibleRows();
  const currentIndex = Math.max(0, currentRows.findIndex((item) => item.id === row.id));
  state.rows = state.rows.filter((item) => item.id !== row.id);
  state.manifest = buildManifest(state.rows);
  const nextRows = visibleRows();
  state.selectedId = nextRows[Math.min(currentIndex, nextRows.length - 1)]?.id || state.rows[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function openEdit(rowId) {
  if (!state.rows.some((row) => row.id === rowId)) return;
  state.editingId = rowId;
  render();
}

function saveEdit(form) {
  const row = state.rows.find((item) => item.id === state.editingId);
  if (!row) return;
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
  persistRow(row);
  state.manifest = buildManifest(state.rows);
  state.editingId = "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function resetReviewState() {
  state.reviewState = reviewDefaults();
  state.rows = state.originalRows.map(cloneRow);
  state.manifest = buildManifest(state.rows);
  state.selectedId = state.rows[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  saveWorkspace();
  render();
  loadSelectedSource();
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
  URL.revokeObjectURL(url);
}

function exportWorkspace() {
  if (!state.rows.length) return;
  saveWorkspace();
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

function resetWorkspace() {
  if (state.rows.length && !window.confirm("清空当前浏览器里的书论工作区？此操作不会影响其他用户或线上代码。")) return;
  clearWorkspace();
  state.view = "home";
  location.hash = "#home";
  render();
}

function handleRowAction(action, rowId) {
  if (action === "confirm") confirmRow(rowId);
  if (action === "edit") openEdit(rowId);
  if (action === "delete") deleteRow(rowId);
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
  if (!rows.length) return;
  if (!window.confirm(`将当前队列的 ${rows.length} 行标记为待复核？`)) return;
  rows.forEach((row) => {
    row.status = "待复核";
    row.bucket = "review";
    row.edited = true;
    appendIssue(row, "批量队列标记待复核");
    addHistory(row, {
      type: "batch-review",
      actor: "human",
      reason: "从字段质量队列批量标记为待复核。",
      changes: [{ fieldId: "issue", before: "", after: row.issue }]
    });
    state.reviewState.edits[row.id] = editableSnapshot(row);
  });
  state.manifest = buildManifest(state.rows);
  saveWorkspace();
  render();
  loadSelectedSource();
}

function setDetailDock(collapsed) {
  state.detailCollapsed = collapsed;
  const screen = document.querySelector(".review-screen");
  const panel = document.querySelector(".detail-panel");
  const button = document.querySelector("[data-detail-toggle]");
  screen?.classList.toggle("detail-collapsed", state.detailCollapsed);
  panel?.classList.toggle("collapsed", state.detailCollapsed);
  if (button) {
    button.textContent = state.detailCollapsed ? "展开" : "收起";
    button.setAttribute("aria-expanded", String(!state.detailCollapsed));
  }
}

function toggleDetailDock() {
  setDetailDock(!state.detailCollapsed);
}

function toggleFilters() {
  state.filtersCollapsed = !state.filtersCollapsed;
  const controls = document.querySelector(".controls");
  const button = document.querySelector("[data-filter-toggle]");
  controls?.classList.toggle("collapsed", state.filtersCollapsed);
  if (button) {
    button.textContent = state.filtersCollapsed ? "展开" : "收起";
    button.setAttribute("aria-expanded", String(!state.filtersCollapsed));
  }
}

function applyTableViewState() {
  const screen = document.querySelector(".review-screen");
  const shell = document.querySelector(".app-shell");
  const headButton = document.querySelector("[data-table-head-toggle]");
  const railButton = document.querySelector("[data-rail-toggle]");
  const focusButton = document.querySelector("[data-table-focus]");
  screen?.classList.toggle("detail-collapsed", state.detailCollapsed);
  screen?.classList.toggle("rail-collapsed", state.railCollapsed || state.tableFocus);
  screen?.classList.toggle("table-focus", state.tableFocus);
  screen?.classList.toggle("table-head-collapsed", state.tableHeaderCollapsed);
  shell?.classList.toggle("table-focus-shell", state.tableFocus);
  if (headButton) {
    headButton.textContent = state.tableHeaderCollapsed ? "显示表头" : "收起表头";
    headButton.classList.toggle("active", state.tableHeaderCollapsed);
    headButton.setAttribute("aria-pressed", String(state.tableHeaderCollapsed));
  }
  if (railButton) {
    railButton.textContent = state.railCollapsed ? "显示侧栏" : "隐藏侧栏";
    railButton.classList.toggle("active", state.railCollapsed);
    railButton.setAttribute("aria-pressed", String(state.railCollapsed));
  }
  if (focusButton) {
    focusButton.textContent = state.tableFocus ? "退出专注" : "专注表格";
    focusButton.classList.toggle("active", state.tableFocus);
    focusButton.setAttribute("aria-pressed", String(state.tableFocus));
  }
}

function toggleRail() {
  state.railCollapsed = !state.railCollapsed;
  applyTableViewState();
}

function toggleTableHeader() {
  state.tableHeaderCollapsed = !state.tableHeaderCollapsed;
  applyTableViewState();
}

function toggleTableFocus() {
  state.tableFocus = !state.tableFocus;
  if (state.tableFocus) {
    state.detailCollapsed = true;
    state.filtersCollapsed = true;
  }
  render();
  loadSelectedSource();
}

function reviewStats() {
  const validations = state.rows.map(rowValidation);
  return {
    confirmed: state.rows.filter((row) => row.reviewed).length,
    edited: state.rows.filter((row) => row.edited).length,
    deleted: state.reviewState.deletedIds.length,
    invalid: validations.filter((validation) => !validation.ok).length,
    missingRequired: validations.filter((validation) => validation.missingRequired.length).length
  };
}

function reviewToolbar() {
  const stats = reviewStats();
  return `
    <div class="review-toolbar">
      <span>已确认 <strong>${stats.confirmed}</strong></span>
      <span>已修改 <strong>${stats.edited}</strong></span>
      <span>字段待补 <strong>${stats.invalid}</strong></span>
      <span>缺必填 <strong>${stats.missingRequired}</strong></span>
      <span>已删除 <strong>${stats.deleted}</strong></span>
      <button type="button" data-review-reset>重置审校</button>
    </div>
  `;
}

function qualityFocusBar(rows) {
  if (!state.qualityFocus) return "";
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

  document.querySelectorAll("[data-quality-focus]").forEach((button) => {
    button.addEventListener("click", () => setQualityFocus(button.dataset.qualityFocus, button.dataset.qualityMode));
  });

  document.querySelector("[data-quality-clear]")?.addEventListener("click", clearQualityFocus);
  document.querySelector("[data-quality-batch-review]")?.addEventListener("click", batchMarkVisibleReview);
}

function updateVisibleCountDom() {
  const count = document.querySelector(".visible-count");
  if (count) count.textContent = `${visibleRows().length} / ${state.rows.length}`;
}

function updateTableRowStatus(row) {
  const tableRow = document.querySelector(`tbody tr[data-row-id="${CSS.escape(row.id)}"]`);
  if (!tableRow) return;
  tableRow.classList.toggle("abnormal", row.abnormal);
  tableRow.classList.toggle("invalid", !rowValidation(row).ok);
  const reviewCell = tableRow.children[1];
  const validationCell = tableRow.children[2];
  const confidenceCell = tableRow.children[3];
  if (reviewCell) reviewCell.innerHTML = `${reviewBadge(row)}${rowActionButtons(row)}`;
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
  const headers = pending.headers || [];
  const sample = pending.rows[0] || {};
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="CSV 字段映射">
      <form class="edit-modal mapping-modal" id="mappingForm">
        <div class="modal-head">
          <div>
            <p class="kicker">CSV Mapping</p>
            <h2>确认字段映射</h2>
            <p>${escapeHtml(pending.name)} · ${pending.rows.length} 行 · ${headers.length} 列。左侧是工作台字段，右侧选择 CSV 来源列。</p>
          </div>
          <button type="button" data-mapping-cancel>关闭</button>
        </div>
        <div class="mapping-preview">
          <strong>首行预览</strong>
          <p>${headers.slice(0, 8).map((header) => `${header}: ${clip(sample[header], 28)}`).join(" ｜ ")}</p>
        </div>
        <div class="mapping-grid">
          <h3>系统字段</h3>
          ${importSystemFields.map((field) => `
            <label>
              <span>${escapeHtml(field.label)}</span>
              ${mappingSelect(`system:${field.id}`, pending.mapping.system?.[field.id] || "", headers)}
            </label>
          `).join("")}
          <h3>模板字段</h3>
          ${orderedSchema().map((field) => `
            <label class="${field.required ? "required" : ""}">
              <span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>
              ${mappingSelect(`field:${field.id}`, pending.mapping.fields?.[field.id] || "", headers)}
              <small>${escapeHtml(field.prompt || "")}</small>
            </label>
          `).join("")}
        </div>
        <div class="modal-actions">
          <button type="button" data-mapping-cancel>取消</button>
          <button type="submit">确认导入</button>
        </div>
      </form>
    </div>
  `;
}

function renderShell(content) {
  app.innerHTML = `
    <main class="app-shell ${state.tableFocus ? "table-focus-shell" : ""}">
      <header class="topbar compact">
        <div>
          <p class="kicker">Upload Evidence App</p>
          <h1>书论成果工作台</h1>
        </div>
        <nav class="top-actions">
          <button type="button" class="${state.view === "home" ? "active" : ""}" data-view="home">首页</button>
          <button type="button" class="${state.view === "detail" ? "active" : ""}" data-view="detail">详情</button>
          <button type="button" data-workspace-export ${state.rows.length ? "" : "disabled"}>导出</button>
        </nav>
      </header>
      ${content}
    </main>
    ${editModal()}
    ${importMappingModal()}
  `;
  attachGlobalEvents();
}

function renderHome() {
  renderShell(`
    <section class="home-layout">
      <article class="home-intro">
        <p class="kicker">Home</p>
        <h2>每个人都有自己的本地书论工作区</h2>
        <p>这个线上入口不再展示后端数据包或下载附件。上传 CSV/JSON/page 文本后，内容只进入当前浏览器；导出的工作区 JSON 可以发给别人导入复现。</p>
        ${workspaceStatus()}
        ${workspaceActions()}
        ${templatePanel()}
      </article>
      <section class="upload-panel">
        <div>
          <p class="kicker">Upload</p>
          <h2>上传或导入</h2>
          <p>支持：结果表 CSV/JSON、工作区 JSON、原文页 <code>page_*.txt</code>。XLSX 不在公网前端解析，请先转换为 CSV。</p>
        </div>
        <label class="drop-zone">
          <input id="fileInput" type="file" multiple accept=".csv,.json,.txt,.xlsx,application/json,text/csv,text/plain" />
          <strong>选择或拖入文件</strong>
          <span>可以一次上传结果表、原文页文本或工作区包</span>
        </label>
        ${uploadLog()}
      </section>
    </section>

    <section class="home-metrics">
      ${metricCards()}
    </section>

    <section class="flow-strip">
      <article><span>01</span><strong>上传</strong><p>CSV/JSON 结果表进入浏览器内处理。</p></article>
      <article><span>02</span><strong>识别</strong><p>字段映射为附表、书家、书体、摘录、页码和门禁。</p></article>
      <article><span>03</span><strong>隔离</strong><p>数据保存在当前浏览器，不进入公共后端目录。</p></article>
      <article><span>04</span><strong>导出</strong><p>下载工作区 JSON，发给其他人导入使用。</p></article>
    </section>
  `);
  attachHomeEvents();
}

function renderDetail() {
  const rows = visibleRows();
  const row = selectedRow();
  if (row && !state.selectedId) state.selectedId = row.id;

  renderShell(`
    <section class="review-screen ${state.detailCollapsed ? "detail-collapsed" : ""} ${state.railCollapsed || state.tableFocus ? "rail-collapsed" : ""} ${state.tableFocus ? "table-focus" : ""} ${state.tableHeaderCollapsed ? "table-head-collapsed" : ""}">
      <aside class="dataset-rail">
        <div>
          <p class="kicker">Current Dataset</p>
          <h2>${escapeHtml(state.datasetName)}</h2>
          <p>当前屏幕只使用你的本地工作区数据；不会读取公开后端文件。</p>
        </div>
        ${workspaceStatus()}
        ${workspaceActions()}
        ${templatePanel()}
        <div class="rail-metrics">${railMetrics()}</div>
        ${reviewToolbar()}
        <details class="rail-section">
          <summary>上传处理</summary>
          ${uploadLog()}
        </details>
        <details class="rail-section" open>
          <summary>字段质量</summary>
          ${fieldQualityPanel()}
        </details>
        <details class="rail-section">
          <summary>附表分布</summary>
          <div class="bars compact">${appendixBars()}</div>
        </details>
      </aside>

      <section class="main-panel workbench-main">
        <div class="panel-head">
          <div>
            <p class="kicker">Results</p>
            <h2>综合成果总表</h2>
          </div>
          <div class="panel-tools">
            <div class="visible-count">${rows.length} / ${state.rows.length}</div>
            ${tableViewActions()}
          </div>
        </div>
        ${resultsControlPanel(rows)}
        ${resultTable(rows)}
      </section>
      ${detailPanel(row)}
    </section>
  `);
  attachDetailEvents();
}

function render() {
  if (!state.manifest) {
    app.innerHTML = "<div class='boot'>加载线上数据包...</div>";
    return;
  }
  if (state.view === "home") renderHome();
  else renderDetail();
}

function attachGlobalEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      location.hash = state.view === "detail" ? "#detail" : "#home";
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
    const data = new FormData(event.currentTarget);
    if (state.pendingImport) {
      state.pendingImport.mapping = { system: {}, fields: {} };
      importSystemFields.forEach((field) => {
        state.pendingImport.mapping.system[field.id] = String(data.get(`system:${field.id}`) || "");
      });
      orderedSchema().forEach((field) => {
        state.pendingImport.mapping.fields[field.id] = String(data.get(`field:${field.id}`) || "");
      });
    }
    confirmPendingImport();
  });

  document.querySelectorAll("[data-mapping-cancel]").forEach((button) => {
    button.addEventListener("click", cancelPendingImport);
  });

  document.querySelectorAll("[data-workspace-export]").forEach((button) => {
    button.addEventListener("click", exportWorkspace);
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

  document.querySelector("[data-template-select]")?.addEventListener("change", (event) => {
    applyTemplate(event.target.value);
  });

  document.querySelector("[data-template-panel]")?.addEventListener("toggle", (event) => {
    state.templatePanelExpanded = event.currentTarget.open;
    const toggleText = event.currentTarget.querySelector(".schema-summary-meta i");
    if (toggleText) toggleText.textContent = state.templatePanelExpanded ? "收起" : "展开";
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
  const input = document.querySelector("#fileInput");
  const zone = document.querySelector(".drop-zone");
  input?.addEventListener("change", () => processFiles([...input.files]));
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

function attachDetailEvents() {
  document.querySelector("[data-detail-toggle]")?.addEventListener("click", toggleDetailDock);
  document.querySelector("[data-filter-toggle]")?.addEventListener("click", toggleFilters);
  document.querySelector("[data-rail-toggle]")?.addEventListener("click", toggleRail);
  document.querySelector("[data-table-head-toggle]")?.addEventListener("click", toggleTableHeader);
  document.querySelector("[data-table-focus]")?.addEventListener("click", toggleTableFocus);

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.selectedId = visibleRows()[0]?.id || "";
      state.sourceText = "";
      state.sourceStatus = "idle";
      render();
      loadSelectedSource();
    });
  });

  document.querySelector("#searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.selectedId = visibleRows()[0]?.id || "";
    state.sourceText = "";
    state.sourceStatus = "idle";
    render();
    loadSelectedSource();
  });

  document.querySelector(".table-shell")?.addEventListener("click", (event) => {
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

  document.querySelector(".detail-panel")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-row-action]");
    if (!action) return;
    handleRowAction(action.dataset.rowAction, action.dataset.rowId);
  });

  document.querySelector("[data-review-reset]")?.addEventListener("click", resetReviewState);

  document.querySelectorAll("[data-quality-focus]").forEach((button) => {
    button.addEventListener("click", () => setQualityFocus(button.dataset.qualityFocus, button.dataset.qualityMode));
  });

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
  if (!pending?.rows?.length) return [];
  const mapping = pending.mapping || { system: {}, fields: {} };
  return pending.rows.map((row) => {
    const mapped = {};
    importSystemFields.forEach((field) => {
      const source = mapping.system?.[field.id];
      if (source) mapped[field.target] = row[source] || "";
    });
    orderedSchema().forEach((field) => {
      const source = mapping.fields?.[field.id];
      mapped[field.label] = source ? row[source] || "" : "";
    });
    mapped.__rowNumber = row.__rowNumber;
    return mapped;
  });
}

function confirmPendingImport() {
  const pending = state.pendingImport;
  if (!pending) return;
  const nextRows = mappedRowsFromPendingImport().map(makeResult);
  state.reviewState = reviewDefaults();
  state.originalRows = nextRows.map(cloneRow);
  state.rows = nextRows;
  state.workspaceId = newWorkspaceId();
  state.datasetName = `上传：${pending.name}`;
  state.manifest = buildManifest(nextRows);
  state.selectedId = nextRows[0]?.id || "";
  state.filter = "all";
  state.query = "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  state.sourceCache = new Map();
  state.uploadLog = [{ type: "success", title: pending.name, message: `已按字段映射导入 ${nextRows.length} 行。` }];
  state.pendingImport = null;
  state.view = "detail";
  location.hash = "#detail";
  saveWorkspace();
  render();
  loadSelectedSource();
}

function cancelPendingImport() {
  state.pendingImport = null;
  render();
}

async function processFiles(files) {
  if (!files.length) return;
  const nextLog = [];
  let nextRows = null;
  let importedWorkspace = null;

  for (const file of files) {
    const name = file.name;
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".txt") && /^page_\d+\.txt$/i.test(name)) {
        state.uploadedPages.set(name, await file.text());
        nextLog.push({ type: "success", title: name, message: "已作为原文页加入回检缓存。" });
      } else if (lower.endsWith(".csv")) {
        const rows = parseCsv(await file.text());
        if (!rows.length) {
          nextLog.push({ type: "warn", title: name, message: "CSV 没有可导入的数据行。" });
        } else {
          createPendingCsvImport(name, rows);
          nextLog.push({ type: "success", title: name, message: `已读取 ${rows.length} 行。请确认 CSV 列与当前模板字段的映射。` });
        }
      } else if (lower.endsWith(".json")) {
        const payload = JSON.parse(await file.text());
        if (payload.type === "calligraphy-workspace" && Array.isArray(payload.rows)) {
          importedWorkspace = payload;
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
          nextRows = payload.rows.map(makeResult);
          Object.entries(payload.uploadedPages || {}).forEach(([page, content]) => {
            if (/^page_\d+\.txt$/i.test(page)) state.uploadedPages.set(page, String(content));
          });
          state.reviewState = { ...reviewDefaults(), ...(payload.reviewState || {}) };
          state.datasetName = payload.datasetName ? `导入：${payload.datasetName}` : `导入：${name}`;
          nextLog.push({ type: "success", title: name, message: `已导入 ${nextRows.length} 行和 ${state.uploadedPages.size} 个原文页。` });
          continue;
        }
        const rows = Array.isArray(payload) ? payload : payload.results || [];
        if (!rows.length) {
          nextLog.push({ type: "warn", title: name, message: "JSON 中没有找到 results 数组。" });
        } else {
          nextRows = rows.map(makeResult);
          state.datasetName = `上传：${name}`;
          nextLog.push({ type: "success", title: name, message: `已处理 ${nextRows.length} 行 JSON 结果。` });
        }
      } else if (lower.endsWith(".xlsx")) {
        nextLog.push({ type: "warn", title: name, message: "公网前端暂不直接解析 XLSX。请先通过后端/工作流转换为 CSV，再上传。" });
      } else {
        nextLog.push({ type: "warn", title: name, message: "文件类型未处理。" });
      }
    } catch (error) {
      nextLog.push({ type: "error", title: name, message: error.message });
    }
  }

  state.uploadLog = nextLog;
  if (nextRows) {
    if (!importedWorkspace) state.reviewState = reviewDefaults();
    state.originalRows = (importedWorkspace?.originalRows?.length ? importedWorkspace.originalRows : nextRows).map(cloneRow);
    state.rows = nextRows;
    state.workspaceId = newWorkspaceId();
    state.manifest = buildManifest(nextRows);
    state.selectedId = nextRows[0]?.id || "";
    state.filter = "all";
    state.query = "";
    state.sourceText = "";
    state.sourceStatus = "idle";
    state.sourceCache = new Map();
    state.view = "detail";
    location.hash = "#detail";
    state.uploadLog = nextLog;
    saveWorkspace();
    render();
    loadSelectedSource();
  } else {
    state.manifest = buildManifest(state.rows);
    saveWorkspace();
    render();
  }
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

async function init() {
  if (!loadWorkspace()) {
    state.workspaceId = newWorkspaceId();
    state.schemaTemplateId = "calligraphy-style";
    state.schema = defaultSchema(state.schemaTemplateId);
    state.schemaVersion = SCHEMA_VERSION;
    state.promptVersion = PROMPT_VERSION;
    state.reviewState = reviewDefaults();
    state.rows = [];
    state.originalRows = [];
    state.manifest = buildManifest([]);
    saveWorkspace();
  }
  render();
  if (state.view === "detail") loadSelectedSource();
}

window.addEventListener("hashchange", () => {
  state.view = location.hash === "#detail" ? "detail" : "home";
  render();
  if (state.view === "detail") loadSelectedSource();
});

init().catch((error) => {
  app.innerHTML = `
    <div class="boot error">
      <strong>数据包读取失败</strong>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
});

const app = document.querySelector("#app");
const REVIEW_STORAGE_KEY = "calligraphy-review-state-v1";

function assetPath(path) {
  return new URL(path.replace(/^\/+/, ""), document.baseURI).toString();
}

const filters = [
  { id: "all", label: "全部", tone: "All" },
  { id: "main", label: "确定主表", tone: "A" },
  { id: "candidate", label: "优先补入", tone: "B" },
  { id: "matched", label: "已入对照", tone: "C" },
  { id: "excluded", label: "非风格/品级", tone: "D" },
  { id: "review", label: "待校验", tone: "E" },
  { id: "abnormal", label: "命中异常", tone: "!" }
];

const state = {
  manifest: null,
  baseManifest: null,
  rows: [],
  baseRows: [],
  uploadedPages: new Map(),
  uploadLog: [],
  datasetName: "内置第二轮成果",
  view: location.hash === "#detail" ? "detail" : "home",
  filter: "all",
  query: "",
  selectedId: "",
  sourceText: "",
  sourceStatus: "idle",
  sourceCache: new Map(),
  sourceRequestId: 0,
  reviewState: { confirmedIds: [], deletedIds: [], edits: {} },
  originalRows: [],
  editingId: "",
  detailCollapsed: false
};

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

function reviewDefaults() {
  return { confirmedIds: [], deletedIds: [], edits: {} };
}

function canPersistReview() {
  return state.datasetName === "内置第二轮成果";
}

function loadReviewState() {
  try {
    const saved = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || "null");
    return saved && typeof saved === "object"
      ? { ...reviewDefaults(), ...saved, edits: saved.edits || {} }
      : reviewDefaults();
  } catch {
    return reviewDefaults();
  }
}

function saveReviewState() {
  if (!canPersistReview()) return;
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state.reviewState));
}

function editableSnapshot(row) {
  return {
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
  const hit = row["原文命中"] ?? row.hit ?? "";
  const quote = row.quote ?? row["quote"] ?? "";
  const pageNo = row.pageNo ?? row["page_no"] ?? "";
  const sourceFile = row.sourceFile ?? row["source_file"] ?? "";
  return !quote || !pageNo || !sourceFile || !["exact", "compact"].includes(hit);
}

function makeResult(row, index) {
  if (row.appendix && row.id) {
    return {
      ...row,
      bucket: row.bucket || classifyBucket(row),
      appendixCode: row.appendixCode || appendixCode(row.appendix),
      sourceFile: normalizePageFile(row.sourceFile || row.pageNo),
      abnormal: row.abnormal ?? hasAbnormal(row),
      reviewed: Boolean(row.reviewed),
      edited: Boolean(row.edited)
    };
  }

  const sourceFile = normalizePageFile(row["source_file"] || row["page_no"]);
  const id = row["材料ID"] || `UPLOAD-${String(index + 1).padStart(4, "0")}`;
  return {
    id,
    rowNumber: row.__rowNumber || index + 2,
    appendix: row["附表"] || "",
    appendixCode: appendixCode(row["附表"]),
    bucket: classifyBucket(row),
    status: row["二轮状态"] || "",
    sourceData: row["来源数据"] || "",
    author: row["书家"] || "",
    scriptType: row["书体/可能书体"] || row["书体"] || "",
    quote: row["quote"] || row["摘录"] || row["原文"] || "",
    pageNo: row["page_no"] || row["页码"] || "",
    sourceFile,
    hit: row["原文命中"] || "",
    confidence: row["证据等级"] || "",
    gate: row["门禁"] || "",
    action: row["第二轮动作"] || "",
    recommendation: row["进入主表建议"] || "",
    issue: row["问题/隐患"] || "",
    note: row["备注"] || "",
    originalRecord: row["对应原高置信记录"] || "",
    abnormal: hasAbnormal(row),
    reviewed: false,
    edited: false
  };
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "未标注";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildManifest(rows, source = state.baseManifest, options = {}) {
  const inheritedSourcePages = Number(source?.stats?.sourcePages || 0);
  const stats = {
    total: rows.length,
    sourcePages: Math.max(inheritedSourcePages, state.uploadedPages.size),
    linkedRows: rows.filter((row) => row.sourceFile).length,
    exactHits: rows.filter((row) => row.hit === "exact").length,
    reviewRows: rows.filter((row) => row.bucket === "review").length,
    abnormalRows: rows.filter((row) => row.abnormal).length,
    confirmedRows: rows.filter((row) => row.reviewed).length,
    editedRows: rows.filter((row) => row.edited).length,
    appendix: countBy(rows, "appendix"),
    hit: countBy(rows, "hit"),
    bucket: countBy(rows, "bucket")
  };
  return {
    ...(source || {}),
    title: "书论成果线上工作台",
    description: "上传文件后，系统会在浏览器内解析并生成前端可视化结果；不把文件上传到服务器。",
    stats,
    downloads: options.keepDownloads === false ? [] : source?.downloads || []
  };
}

function rowText(row) {
  return [
    row.id,
    row.appendix,
    row.status,
    row.author,
    row.scriptType,
    row.quote,
    row.pageNo,
    row.sourceFile,
    row.hit,
    row.confidence,
    row.reviewed ? "已确认" : "",
    row.edited ? "已修改" : "",
    row.issue,
    row.note
  ].join(" ");
}

function visibleRows() {
  const query = state.query.trim().toLowerCase();
  return state.rows.filter((row) => {
    const filterPass = state.filter === "all"
      || (state.filter === "abnormal" ? row.abnormal : row.bucket === state.filter);
    const queryPass = !query || rowText(row).toLowerCase().includes(query);
    return filterPass && queryPass;
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
    { value: stats.reviewRows, label: "待校验", note: "来源/OCR 队列" },
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
    { value: stats.reviewRows, label: "待校验" },
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
        <p>支持上传 CSV/JSON 结果表，也可以同时上传 page_*.txt 原文页。XLSX 建议由后端或工作流先安全转换为 CSV。</p>
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

function downloadCards() {
  if (!state.manifest.downloads.length) {
    return `
      <div class="empty-inline">
        <strong>当前是上传数据集</strong>
        <p>上传内容已经进入当前浏览器会话。要把它变成可公开访问的数据包，需要后端或工作流写入 <code>public/data</code> 后重新发布。</p>
      </div>
    `;
  }

  return state.manifest.downloads.map((file) => `
    <a class="download-card ${file.primary ? "primary" : ""}" href="${escapeHtml(assetPath(file.href))}">
      <span>${escapeHtml(file.format)} · ${escapeHtml(file.size)}</span>
      <strong>${escapeHtml(file.title)}</strong>
      <small>${escapeHtml(file.role)}</small>
    </a>
  `).join("");
}

function filterChips(rows) {
  const counts = Object.fromEntries(filters.map((filter) => [filter.id, 0]));
  rows.forEach((row) => {
    counts.all += 1;
    counts[row.bucket] = (counts[row.bucket] || 0) + 1;
    if (row.abnormal) counts.abnormal += 1;
  });
  return filters.map((filter) => `
    <button class="${state.filter === filter.id ? "active" : ""}" type="button" data-filter="${filter.id}">
      <span>${escapeHtml(filter.label)}</span>
      <small>${escapeHtml(filter.tone)} · ${counts[filter.id] || 0}</small>
    </button>
  `).join("");
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

function resultTable(rows) {
  if (!rows.length) {
    return `
      <div class="empty-state">
        <strong>没有匹配结果</strong>
        <p>调整筛选或搜索词后再查看。</p>
      </div>
    `;
  }

  return `
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>回检</th>
            <th>审校</th>
            <th>置信</th>
            <th>附表</th>
            <th>书家</th>
            <th>书体</th>
            <th>摘录</th>
            <th>命中</th>
            <th>门禁</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr class="${row.id === state.selectedId ? "selected" : ""} ${row.abnormal ? "abnormal" : ""}" data-row-id="${escapeHtml(row.id)}" style="--row-delay:${Math.min(index, 22) * 18}ms">
              <td><button type="button" data-row-id="${escapeHtml(row.id)}">查看</button></td>
              <td>${reviewBadge(row)}${rowActionButtons(row)}</td>
              <td>${confidencePill(row)}</td>
              <td><span class="appendix">${escapeHtml(row.appendixCode)}</span>${escapeHtml(row.status)}</td>
              <td><strong>${escapeHtml(row.author || "未标注")}</strong><small>${escapeHtml(row.id)}</small></td>
              <td>${escapeHtml(row.scriptType || "未标注")}</td>
              <td title="${escapeHtml(row.quote)}">${escapeHtml(clip(row.quote, 110))}</td>
              <td><span class="hit ${escapeHtml(row.hit || "none")}">${escapeHtml(row.hit || "none")}</span></td>
              <td>${escapeHtml(row.gate || "未标注")}</td>
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
  return `
      <p class="kicker">Source Trace</p>
      <div class="detail-title-row">
        <h2>${escapeHtml(row.author || "未标注书家")}</h2>
        ${reviewBadge(row)}
      </div>
      <div class="detail-meta">
        <span>${escapeHtml(row.appendix || "未标注")}</span>
        <span>${escapeHtml(row.pageNo || "无页码")}</span>
        <span>${escapeHtml(row.sourceFile || "无原文文件")}</span>
      </div>
      <blockquote>${escapeHtml(row.quote || "无摘录")}</blockquote>
      <div class="review-actions">
        <button type="button" data-row-action="confirm" data-row-id="${escapeHtml(row.id)}">${row.reviewed ? "已确认" : "确认此条"}</button>
        <button type="button" data-row-action="edit" data-row-id="${escapeHtml(row.id)}">修改字段</button>
        <button type="button" class="danger" data-row-action="delete" data-row-id="${escapeHtml(row.id)}">删除条目</button>
      </div>
      <dl>
        <dt>命中</dt><dd>${escapeHtml(row.hit || "none")}</dd>
        <dt>证据</dt><dd>${escapeHtml(row.confidence || "未标注")}</dd>
        <dt>门禁</dt><dd>${escapeHtml(row.gate || "未标注")}</dd>
        <dt>动作</dt><dd>${escapeHtml(row.action || "未标注")}</dd>
        <dt>隐患</dt><dd>${escapeHtml(row.issue || "无")}</dd>
      </dl>
  `;
}

function detailCard(row) {
  return `
    <section class="detail-card">
      ${detailCardContent(row)}
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
          <h2>${escapeHtml(row.author || "未标注书家")} · ${escapeHtml(row.id)}</h2>
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
  if (dockTitle) dockTitle.textContent = `${row.author || "未标注书家"} · ${row.id}`;
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
  row.status = String(data.get("status") || "");
  row.author = String(data.get("author") || "");
  row.scriptType = String(data.get("scriptType") || "");
  row.quote = String(data.get("quote") || "");
  row.pageNo = String(data.get("pageNo") || "");
  row.sourceFile = normalizePageFile(String(data.get("sourceFile") || row.pageNo));
  row.hit = String(data.get("hit") || "");
  row.confidence = String(data.get("confidence") || "");
  row.gate = String(data.get("gate") || "");
  row.issue = String(data.get("issue") || "");
  row.note = String(data.get("note") || "");
  row.abnormal = hasAbnormal(row);
  row.edited = true;
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
  if (canPersistReview()) localStorage.removeItem(REVIEW_STORAGE_KEY);
  state.rows = state.originalRows.map(cloneRow);
  state.manifest = buildManifest(state.rows);
  state.selectedId = state.rows[0]?.id || "";
  state.sourceText = "";
  state.sourceStatus = "idle";
  render();
  loadSelectedSource();
}

function handleRowAction(action, rowId) {
  if (action === "confirm") confirmRow(rowId);
  if (action === "edit") openEdit(rowId);
  if (action === "delete") deleteRow(rowId);
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

function reviewStats() {
  return {
    confirmed: state.rows.filter((row) => row.reviewed).length,
    edited: state.rows.filter((row) => row.edited).length,
    deleted: state.reviewState.deletedIds.length
  };
}

function reviewToolbar() {
  const stats = reviewStats();
  return `
    <div class="review-toolbar">
      <span>已确认 <strong>${stats.confirmed}</strong></span>
      <span>已修改 <strong>${stats.edited}</strong></span>
      <span>已删除 <strong>${stats.deleted}</strong></span>
      <button type="button" data-review-reset>重置审校</button>
    </div>
  `;
}

function updateReviewToolbarDom() {
  const toolbar = document.querySelector(".review-toolbar");
  if (toolbar) toolbar.outerHTML = reviewToolbar();
  document.querySelector("[data-review-reset]")?.addEventListener("click", resetReviewState);
}

function updateVisibleCountDom() {
  const count = document.querySelector(".visible-count");
  if (count) count.textContent = `${visibleRows().length} / ${state.rows.length}`;
}

function updateTableRowStatus(row) {
  const tableRow = document.querySelector(`tbody tr[data-row-id="${CSS.escape(row.id)}"]`);
  if (!tableRow) return;
  tableRow.classList.toggle("abnormal", row.abnormal);
  const reviewCell = tableRow.children[1];
  const confidenceCell = tableRow.children[2];
  if (reviewCell) reviewCell.innerHTML = `${reviewBadge(row)}${rowActionButtons(row)}`;
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
          <label>书家<input name="author" value="${escapeHtml(row.author)}" /></label>
          <label>书体<input name="scriptType" value="${escapeHtml(row.scriptType)}" /></label>
          <label>页码<input name="pageNo" value="${escapeHtml(row.pageNo)}" /></label>
          <label>原文文件<input name="sourceFile" value="${escapeHtml(row.sourceFile)}" /></label>
          <label>原文命中
            <select name="hit">
              ${["exact", "compact", "partial", "miss", ""].map((hit) => `<option value="${hit}" ${row.hit === hit ? "selected" : ""}>${hit || "none"}</option>`).join("")}
            </select>
          </label>
          <label>证据等级<input name="confidence" value="${escapeHtml(row.confidence)}" /></label>
          <label>门禁<input name="gate" value="${escapeHtml(row.gate)}" /></label>
          <label class="wide">摘录<textarea name="quote" rows="4">${escapeHtml(row.quote)}</textarea></label>
          <label class="wide">问题/隐患<textarea name="issue" rows="3">${escapeHtml(row.issue)}</textarea></label>
          <label class="wide">备注<textarea name="note" rows="3">${escapeHtml(row.note)}</textarea></label>
        </div>
        <div class="modal-actions">
          <button type="button" data-edit-cancel>取消</button>
          <button type="submit">保存修改</button>
        </div>
      </form>
    </div>
  `;
}

function renderShell(content) {
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar compact">
        <div>
          <p class="kicker">Upload Evidence App</p>
          <h1>书论成果工作台</h1>
        </div>
        <nav class="top-actions">
          <button type="button" class="${state.view === "home" ? "active" : ""}" data-view="home">首页</button>
          <button type="button" class="${state.view === "detail" ? "active" : ""}" data-view="detail">详情</button>
          <a href="${assetPath("data/manifest.json")}">数据清单</a>
        </nav>
      </header>
      ${content}
    </main>
    ${editModal()}
  `;
  attachGlobalEvents();
}

function renderHome() {
  renderShell(`
    <section class="home-layout">
      <article class="home-intro">
        <p class="kicker">Home</p>
        <h2>上传结果表，自动生成前端可视化</h2>
        <p>这里不是下载页。上传 CSV/JSON 结果表后，系统会在浏览器内解析字段、分类附表、生成筛选视图，并把 <code>source_file + page_no + quote</code> 接入原文回检。</p>
      </article>
      <section class="upload-panel">
        <div>
          <p class="kicker">Upload</p>
          <h2>上传文件</h2>
          <p>支持：结果表 CSV/JSON，原文页 <code>page_*.txt</code>。XLSX 不直接在公网前端解析，建议由后端或工作流转换为 CSV。</p>
        </div>
        <label class="drop-zone">
          <input id="fileInput" type="file" multiple accept=".csv,.json,.txt,.xlsx" />
          <strong>选择或拖入文件</strong>
          <span>可以一次上传结果表和原文页文本</span>
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
      <article><span>03</span><strong>展示</strong><p>详情页生成结果表、筛选、来源面板和回检高亮。</p></article>
      <article><span>04</span><strong>发布</strong><p>需要持久化时再接后端上传、存储和任务队列。</p></article>
    </section>
  `);
  attachHomeEvents();
}

function renderDetail() {
  const rows = visibleRows();
  const row = selectedRow();
  if (row && !state.selectedId) state.selectedId = row.id;

  renderShell(`
    <section class="review-screen ${state.detailCollapsed ? "detail-collapsed" : ""}">
      <aside class="dataset-rail">
        <div>
          <p class="kicker">Current Dataset</p>
          <h2>${escapeHtml(state.datasetName)}</h2>
          <p>表格、原文回检、审校状态都固定在同一屏内，避免来回滑动。</p>
        </div>
        <div class="rail-metrics">${railMetrics()}</div>
        ${reviewToolbar()}
        <details class="rail-section">
          <summary>上传处理</summary>
          ${uploadLog()}
        </details>
        <details class="rail-section">
          <summary>发布附件</summary>
          <div class="download-grid compact">${downloadCards()}</div>
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
          <div class="visible-count">${rows.length} / ${state.rows.length}</div>
        </div>
        <div class="controls">
          <div class="filter-row">${filterChips(state.rows)}</div>
          <label class="search-box">
            <span>搜索</span>
            <input id="searchInput" value="${escapeHtml(state.query)}" placeholder="书家、书体、摘录、页码..." />
          </label>
        </div>
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
}

function isResultTable(rows) {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]);
  return keys.includes("附表") && (keys.includes("quote") || keys.includes("摘录") || keys.includes("原文"));
}

async function processFiles(files) {
  if (!files.length) return;
  const nextLog = [];
  let nextRows = null;

  for (const file of files) {
    const name = file.name;
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".txt") && /^page_\d+\.txt$/i.test(name)) {
        state.uploadedPages.set(name, await file.text());
        nextLog.push({ type: "success", title: name, message: "已作为原文页加入回检缓存。" });
      } else if (lower.endsWith(".csv")) {
        const rows = parseCsv(await file.text());
        if (!isResultTable(rows)) {
          nextLog.push({ type: "warn", title: name, message: "已读取，但没有识别为书论结果表。请确认包含“附表”和“quote/摘录/原文”字段。" });
        } else {
          nextRows = rows.map(makeResult);
          state.datasetName = `上传：${name}`;
          nextLog.push({ type: "success", title: name, message: `已处理 ${nextRows.length} 行结果，自动生成前端数据。` });
        }
      } else if (lower.endsWith(".json")) {
        const payload = JSON.parse(await file.text());
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
    state.reviewState = reviewDefaults();
    state.originalRows = nextRows.map(cloneRow);
    state.rows = nextRows;
    state.manifest = buildManifest(nextRows, state.baseManifest, { keepDownloads: false });
    state.selectedId = nextRows[0]?.id || "";
    state.filter = "all";
    state.query = "";
    state.sourceText = "";
    state.sourceStatus = "idle";
    state.view = "detail";
    location.hash = "#detail";
    render();
    loadSelectedSource();
  } else {
    state.manifest = buildManifest(state.rows);
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

  state.sourceStatus = "loading";
  if (!options.loadingRendered) updateSourceDom(row);
  try {
    const response = await fetch(assetPath(`data/source-pages/${encodeURIComponent(row.sourceFile)}`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (requestId !== state.sourceRequestId) return;
    state.sourceText = await response.text();
    state.sourceCache.set(row.sourceFile, state.sourceText);
    state.sourceStatus = "ready";
  } catch {
    if (requestId !== state.sourceRequestId) return;
    state.sourceText = "";
    state.sourceStatus = "error";
  }
  updateSourceDom(row);
}

async function init() {
  const [manifest, payload] = await Promise.all([
    fetch(assetPath("data/manifest.json")).then((response) => response.json()),
    fetch(assetPath("data/results.json")).then((response) => response.json())
  ]);
  state.baseManifest = manifest;
  state.manifest = manifest;
  state.baseRows = payload.results.map(makeResult);
  state.originalRows = state.baseRows.map(cloneRow);
  state.reviewState = loadReviewState();
  state.rows = applyReviewState(state.baseRows);
  state.manifest = buildManifest(state.rows);
  state.selectedId = state.rows[0]?.id || "";
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

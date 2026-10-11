(function () {
  const state = {
    status: "idle",
    error: "",
    pdfs: [],
    jobs: [],
    capabilities: null,
    inbox: "",
    selectedPdfId: "",
    selectedBookKey: "",
    selectedJobId: "",
    selectedPrintedPage: null,
    pageStatus: "idle",
    pageText: "",
    rawText: null,
    uploading: false,
    notice: "",
    pageRecord: null,
    saving: false,
    creating: false,
    importing: false,
  };

  let host = { rerender: () => {}, importFiles: async () => {}, activateBookTask: () => false,
    bookTasks: () => [], currentBookTask: () => null };
  let pollTimer = 0;
  let pageRequest = 0;
  const drafts = new Map();
  const setupDrafts = new Map();
  const pageKey = (jobId, page) => `${jobId}:${page}`;

  window.addEventListener("beforeunload", (event) => {
    if (!drafts.size) return;
    event.preventDefault();
    event.returnValue = "";
  });

  function configure(options = {}) {
    host = { ...host, ...options };
  }

  function escapeHtml(value = "") {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatSize(value) {
    const bytes = Number(value || 0);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  }

  function currentPdf() {
    return state.pdfs.find((item) => item.id === state.selectedPdfId) || state.pdfs[0] || null;
  }

  function currentJob() {
    return state.jobs.find((item) => item.id === state.selectedJobId
      && (!state.selectedBookKey || bookKey(item.bookTitle || item.sourceName) === state.selectedBookKey)) || null;
  }

  function bookKey(value) {
    const title = String(value || "").normalize("NFKC").trim().replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim();
    return title ? `book:${title.toLocaleLowerCase()}` : "";
  }

  function bookTaskGroups() {
    const groups = new Map();
    for (const task of host.bookTasks()) {
      if (task?.key) groups.set(task.key, { key: task.key, title: task.title, jobs: [], count: task.count || 0 });
    }
    for (const job of state.jobs) {
      const title = job.bookTitle || job.sourceName || "未命名古籍";
      const key = bookKey(title);
      if (!groups.has(key)) groups.set(key, { key, title: title.replace(/\.pdf$/i, ""), jobs: [], count: 0 });
      groups.get(key).jobs.push(job);
    }
    return [...groups.values()];
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
    return payload;
  }

  function isLocalRuntime() {
    const hostname = String(window.location?.hostname || "").toLowerCase();
    return !hostname || ["localhost", "127.0.0.1", "::1"].includes(hostname);
  }

  async function load({ quiet = false } = {}) {
    if (!isLocalRuntime()) {
      clearTimeout(pollTimer);
      state.status = "local-only";
      state.error = "";
      host.rerender();
      return;
    }
    if (!quiet) {
      state.status = "loading";
      state.error = "";
      host.rerender();
    }
    try {
      const [inventory, jobsPayload] = await Promise.all([
        api("/api/ancient-ingest/pdfs"),
        api("/api/ancient-ingest/jobs"),
      ]);
      state.pdfs = inventory.pdfs || [];
      state.capabilities = inventory.capabilities || null;
      state.inbox = inventory.inbox || "";
      state.jobs = jobsPayload.jobs || [];
      const groups = bookTaskGroups();
      const currentTaskKey = host.currentBookTask()?.key;
      if (!state.selectedBookKey || !groups.some((group) => group.key === state.selectedBookKey)) {
        state.selectedBookKey = groups.find((group) => group.key === currentTaskKey)?.key || groups[0]?.key || "";
      }
      if (!state.selectedPdfId || !state.pdfs.some((item) => item.id === state.selectedPdfId)) {
        state.selectedPdfId = state.pdfs.find((item) => !item.duplicateOf)?.id || state.pdfs[0]?.id || "";
      }
      if (!state.selectedJobId || !state.jobs.some((item) => item.id === state.selectedJobId && bookKey(item.bookTitle || item.sourceName) === state.selectedBookKey)) {
        state.selectedJobId = groups.find((group) => group.key === state.selectedBookKey)?.jobs[0]?.id || "";
        pageRequest += 1;
        state.selectedPrintedPage = null;
        state.pageRecord = null;
        state.pageText = "";
      }
      state.status = "ready";
      state.error = "";
      schedulePoll();
    } catch (error) {
      state.status = error.message === "请求失败：404" ? "local-only" : "error";
      state.error = state.status === "local-only" ? "" : error.message;
    }
    host.rerender();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    const job = currentJob();
    if (!["queued", "running", "pausing"].includes(job?.status) && job?.extractionStatus !== "running") return;
    pollTimer = window.setTimeout(async () => {
      try {
        const refreshed = await api(`/api/ancient-ingest/jobs/${job.id}`);
        const index = state.jobs.findIndex((item) => item.id === job.id);
        if (index >= 0) state.jobs[index] = refreshed;
        else state.jobs.unshift(refreshed);
        schedulePoll();
        // Polling must not replace a focused editor or a partially filled setup form.
        if (document.querySelector(".ingest-page") && !document.activeElement?.closest?.(".ingest-page form")) host.rerender();
      } catch (error) {
        state.error = error.message;
        if (document.querySelector(".ingest-page") && !document.activeElement?.closest?.(".ingest-page form")) host.rerender();
      }
    }, 1400);
  }

  function capabilityMarkup() {
    const capability = state.capabilities;
    if (!capability) return "";
    const ready = capability.ocrReady;
    return `<div class="ingest-runtime ${ready ? "ready" : "blocked"}">
      <span class="status-dot" aria-hidden="true"></span>
      <div><strong>${ready ? "本地 OCR 可用" : "本地 OCR 未就绪"}</strong>
      <small>${capability.verticalReady ? "竖排中文模型" : "横排中文回退"} · ${escapeHtml(capability.ocrLanguages || "无中文模型")}</small></div>
    </div>`;
  }

  function pdfOptions() {
    return state.pdfs.map((pdf) => `<option value="${pdf.id}" ${pdf.id === state.selectedPdfId ? "selected" : ""}>
      ${escapeHtml(pdf.name)}${pdf.duplicateOf ? "（重复）" : ""}
    </option>`).join("");
  }

  function existingMaterialsPanel() {
    const task = host.currentBookTask();
    return `<section class="ingest-band ingest-existing">
      <div class="ingest-section-head"><div><span>已有文件</span><h2>导入已有材料</h2></div></div>
      <p class="ingest-import-target">导入目标：<strong>${escapeHtml(task?.title || "当前未归属古籍的工作区")}</strong></p>
      <button type="button" data-home-focus="file">选择 TXT／CSV／JSON</button>
    </section>`;
  }

  function uploadPanel() {
    return `<section class="ingest-band">
      <div class="ingest-section-head"><div><span>扫描件</span><h2>处理古籍 PDF</h2></div></div>
      <form id="ancientIngestUploadForm">
        <label>导入书论 PDF<input type="file" name="pdf" accept="application/pdf,.pdf" required ${state.uploading ? "disabled" : ""} /></label>
        <button type="submit" ${state.uploading ? "disabled" : ""}>${state.uploading ? "正在上传并校验…" : "导入 PDF"}</button>
        <small>最大 512 MB · 文件保存在本机 · 同一文件不会重复导入</small>
      </form>
      ${state.notice ? `<p role="status">${escapeHtml(state.notice)}</p>` : ""}
    </section>`;
  }

  async function uploadPdf(form) {
    if (state.uploading) return;
    const file = new FormData(form).get("pdf");
    if (!file?.size || file.size > 512 * 1024 * 1024) {
      state.error = "请选择不超过 512 MB 的 PDF"; host.rerender(); return;
    }
    state.uploading = true; state.error = ""; state.notice = ""; host.rerender();
    try {
      const result = await api("/api/ancient-ingest/pdfs/import", {
        method: "POST", headers: { "Content-Type": "application/pdf", "X-PDF-Filename": encodeURIComponent(file.name) }, body: file,
      });
      state.selectedPdfId = result.pdfId;
      state.notice = result.duplicate ? "该 PDF 已存在，已选中原文件。" : "PDF 已导入，请登记版本并选择处理页码。";
      await load({ quiet: true });
    } catch (error) { state.error = error.message; }
    finally { state.uploading = false; host.rerender(); }
  }

  function setupPanel() {
    const pdf = currentPdf();
    if (!pdf) {
      return `<section class="ingest-band ingest-empty"><strong>尚无 PDF</strong><span>可在上方导入，或将文件放入本机 inbox。</span>${state.inbox ? `<details><summary>查看 inbox 位置</summary><code>${escapeHtml(state.inbox)}</code></details>` : ""}</section>`;
    }
    const suggestedOffset = 0;
    const suggestedStart = pdf.existingTxtMin ? pdf.existingTxtMin + suggestedOffset : 1;
    const suggestedEnd = pdf.existingTxtMax ? pdf.existingTxtMax + suggestedOffset : Math.min(pdf.pages, suggestedStart + 9);
    return `<section class="ingest-band ingest-setup">
      <div class="ingest-section-head"><div><span>01</span><h2>材料与页码</h2></div>${capabilityMarkup()}</div>
      <form id="ancientIngestCreateForm" class="ingest-form-grid">
        <label class="wide"><span>inbox 古籍 PDF</span><select name="pdfId" data-ingest-pdf-select>${pdfOptions()}</select></label>
        <label class="wide"><span>书名</span><input name="bookTitle" value="${escapeHtml(pdf.title || pdf.name.replace(/\.pdf$/i, ""))}" maxlength="500" required /></label>
        <label class="wide"><span>版本／版次</span><input name="edition" maxlength="500" placeholder="如：某出版社某年版／某刻本" /></label>
        <label class="wide"><span>材料来源</span><input name="sourceNote" maxlength="500" placeholder="馆藏、下载出处或提供者" /></label>
        <label><span>PDF 起始页</span><input type="number" name="startPage" min="1" max="${pdf.pages}" value="${suggestedStart}" required /></label>
        <label><span>PDF 结束页</span><input type="number" name="endPage" min="1" max="${pdf.pages}" value="${suggestedEnd}" required /></label>
        <label><span>页码偏移</span><input type="number" name="pageOffset" value="${suggestedOffset}" required /><small>书中页码 = PDF 页码 - 偏移</small></label>
        <div class="ingest-options">
          <label><input type="checkbox" name="reuseExisting" checked /><span>复用已有 TXT</span></label>
          <label><input type="checkbox" name="ocrMissing" checked /><span>OCR 缺失页</span></label>
        </div>
        <div class="ingest-source-facts wide">
          <span><b>${pdf.pages}</b> 页</span><span><b>${formatSize(pdf.size)}</b></span>
          <span><b>${pdf.hasTextLayer ? "有" : "无"}</b>文字层</span>
          <span><b>${pdf.existingTxtCount}</b> 页可复用${pdf.existingTxtCount ? `（${pdf.existingTxtMin}-${pdf.existingTxtMax}）` : ""}</span>
        </div>
        <div class="ingest-form-actions wide">
          <p>${escapeHtml(pdf.relativePath)}</p>
          <button type="submit" ${state.creating ? "disabled" : ""}>${state.creating ? "正在创建…" : "创建处理批次"}</button>
        </div>
      </form>
    </section>`;
  }

  function jobStatusLabel(status) {
    return ({ queued: "排队中", running: "处理中", pausing: "正在暂停", paused: "已暂停", complete: "已完成", complete_with_errors: "完成，有异常", failed: "处理失败" })[status] || status || "未知";
  }

  function extractionStatusLabel(status) {
    return ({ idle: "待抽取", running: "正在抽取", complete: "候选已生成", complete_with_errors: "抽取完成，有异常", failed: "抽取失败" })[status] || "待抽取";
  }

  function jobsPanel() {
    const groups = bookTaskGroups();
    const activeGroup = groups.find((group) => group.key === state.selectedBookKey) || null;
    const job = currentJob();
    const progress = job?.total ? Math.round((job.completed + job.failed) / job.total * 100) : 0;
    return `<section class="ingest-band ingest-jobs">
      <div class="ingest-section-head"><div><span>${state.status === "local-only" ? "01" : "02"}</span><h2>古籍任务</h2></div>${state.status === "local-only" ? "" : `<button type="button" class="ingest-icon-button" data-ingest-refresh aria-label="刷新处理批次" title="刷新处理批次">↻</button>`}</div>
      <form id="bookTaskCreateForm" class="ingest-book-create"><label>新建任务<input name="bookTitle" maxlength="500" placeholder="输入古籍书名" required /></label><button type="submit">创建</button></form>
      <nav class="ingest-book-list" aria-label="按古籍选择任务">
        ${groups.map((group) => `<button type="button" data-ingest-book="${escapeHtml(group.key)}" aria-current="${String(group.key === state.selectedBookKey)}"><strong>${escapeHtml(group.title)}</strong><small>${group.jobs.length} 批次 · ${group.count} 条目</small></button>`).join("") || `<p>还没有古籍任务</p>`}
      </nav>
      ${state.status === "local-only" ? "" : `<div class="ingest-job-layout">
        <nav class="ingest-job-list" aria-label="当前古籍的处理批次">
          ${(activeGroup?.jobs || []).map((item) => `<button type="button" data-ingest-job="${item.id}" aria-current="${String(item.id === state.selectedJobId)}">
            <strong>${escapeHtml(item.edition || item.sourceName)}</strong><span>${escapeHtml(item.sourceName)} · ${item.startPage}-${item.endPage} · ${jobStatusLabel(item.status)}</span>
          </button>`).join("") || `<p>${activeGroup ? "本书尚无 PDF 处理批次，可导入已有材料。" : "选择或新建古籍任务"}</p>`}
        </nav>
        ${job ? `<div class="ingest-job-detail">
          <header><div><strong>${escapeHtml(job.bookTitle || job.sourceName)}</strong><span>${escapeHtml(job.edition || "版本未登记")} · ${jobStatusLabel(job.status)}${job.currentPage ? ` · PDF ${job.currentPage}` : ""}${job.extractionStatus === "running" ? ` · 正在抽取书页 ${job.currentExtractionPage || ""}` : ""}</span></div>
            <div class="ingest-job-actions">
              ${["queued", "running", "pausing"].includes(job.status) ? `<button type="button" data-ingest-pause>暂停</button>` : ""}
              ${["paused", "failed", "complete_with_errors"].includes(job.status) ? `<button type="button" data-ingest-resume>继续处理</button>` : ""}
            </div>
          </header>
          <div class="ingest-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i><span style="width:${progress}%"></span></i><b>${progress}%</b></div>
          ${job.error || job.recoveryMessage ? `<p role="status">${escapeHtml(job.error || job.recoveryMessage)}</p>` : ""}
          ${job.records.some((r) => r.status === "failed") ? `<details><summary>查看失败页（可继续处理重试）</summary>${job.records.filter((r) => r.status === "failed").map((r) => `<p>PDF ${r.pdfPage}：${escapeHtml(r.error)}</p>`).join("")}</details>` : ""}
          <dl class="ingest-counters">
            <div><dt>完成</dt><dd>${job.completed}/${job.total}</dd></div><div><dt>复用</dt><dd>${job.reused}</dd></div>
            <div><dt>OCR</dt><dd>${job.ocrCount}</dd></div><div><dt>候选</dt><dd>${job.extractedCount || 0}</dd></div><div><dt>异常</dt><dd>${job.failed}</dd></div>
          </dl>
        </div>` : `<div class="ingest-job-placeholder"><strong>${activeGroup ? "任务已就绪" : "创建任务后在这里查看进度"}</strong><span>${activeGroup ? "可导入 TXT／CSV，或在上方选择 PDF 创建处理批次。" : "每本书独立管理材料、主表和回检。"}</span></div>`}
      </div>`}
    </section>`;
  }

  function pageNavigation(job, page) {
    const completed = job.records.filter((item) => item.status === "complete");
    const currentIndex = completed.findIndex((item) => item.printedPage === page);
    const previous = currentIndex > 0 ? completed[currentIndex - 1] : null;
    const next = currentIndex >= 0 && currentIndex < completed.length - 1 ? completed[currentIndex + 1] : null;
    return `<nav class="ingest-page-nav" aria-label="逐页扫描导航">
      <div class="ingest-page-nav-actions">
        <button type="button" class="ingest-page-step" data-ingest-page="${previous?.printedPage || ""}" ${previous ? "" : "disabled"}>← 上一页</button>
        <strong>${page == null ? "等待页面" : `书页 ${page}`}</strong>
        <button type="button" class="ingest-page-step" data-ingest-page="${next?.printedPage || ""}" ${next ? "" : "disabled"}>下一页 →</button>
      </div>
      <div class="ingest-page-strip" aria-label="逐页处理状态">
        ${job.records.map((record) => `<button type="button" class="${record.status} ${record.printedPage === page ? "active" : ""}" data-ingest-page="${record.printedPage}" title="PDF ${record.pdfPage} · ${record.status}" ${record.status === "complete" ? "" : "disabled"}>${record.printedPage}</button>`).join("")}
      </div>
    </nav>`;
  }

  function reviewPanel() {
    const job = currentJob();
    if (!job) {
      return `<section class="ingest-review" aria-label="逐页校对">
        <div class="ingest-scan-pane">
          <div class="ingest-section-head"><div><span>03</span><h2>扫描页</h2></div><small>等待处理批次</small></div>
          <div class="ingest-job-placeholder"><strong>创建处理批次后在这里查看扫描页</strong><span>完成或复用页面后，扫描图与页码导航会出现在这里。</span></div>
        </div>
        <div class="ingest-editor-pane">
          <div class="ingest-editor-heading"><div><span>04</span><h2>文本与输出</h2></div><small>等待可校对页面</small></div>
          <div class="ingest-job-placeholder"><strong>文本编辑区尚未就绪</strong><span>OCR 或 TXT 复用完成后可在这里编辑、保存并生成候选。</span></div>
        </div>
      </section>`;
    }
    const completed = job.records.filter((item) => item.status === "complete");
    const selected = state.pageRecord || completed.find((item) => item.printedPage === state.selectedPrintedPage) || completed[0];
    const page = selected?.printedPage;
    return `<section class="ingest-review" aria-label="逐页校对">
      <div class="ingest-scan-pane">
        <div class="ingest-section-head"><div><span>03</span><h2>扫描页</h2></div><small>${completed.length ? `已处理 ${completed.length} 页` : "等待首个页面完成"}</small></div>
        ${pageNavigation(job, page)}
        ${page == null ? `<div class="ingest-job-placeholder"><strong>还没有可校对页面</strong><span>OCR 或 TXT 复用完成后会自动出现。</span></div>` : `<div class="ingest-scan-canvas"><figure><img src="/api/ancient-ingest/jobs/${job.id}/pages/${page}/preview" alt="书中第 ${page} 页扫描图" /><figcaption>${escapeHtml(job.bookTitle || job.sourceName)} · ${escapeHtml(job.edition || "版本未登记")}<br />PDF ${selected.pdfPage} · 书页 ${page}</figcaption></figure></div>`}
      </div>
      <div class="ingest-editor-pane">
        <div class="ingest-editor-heading"><div><span>04</span><h2>文本与输出</h2></div><small>TXT/OCR · CSV · AI 候选</small></div>
        ${page == null ? `<div class="ingest-job-placeholder"><strong>还没有可编辑文本</strong><span>OCR 或 TXT 复用完成后可在这里编辑、保存并生成候选。</span></div>` : `<form id="ancientIngestPageForm" data-page="${page}">
          <header><div><strong>${escapeHtml(selected.sourceFile)}</strong><span data-ingest-save-status>${drafts.has(pageKey(job.id, page)) ? "未保存 · 翻页保留草稿" : selected.method === "reused" ? "复用既有文本" : selected.method === "edited" ? "人工已修改" : "OCR 初稿"}</span></div><button type="submit" ${state.saving || state.pageStatus !== "ready" ? "disabled" : ""}>${state.saving ? "保存中…" : "保存文本"}</button></header>
          ${state.pageStatus === "loading" ? `<div class="ingest-text-loading">正在读取文本…</div>` : state.pageStatus === "error" ? `<div class="ingest-text-loading"><span>文本读取失败</span><button type="button" data-ingest-page="${page}">重试读取</button></div>` : `<textarea name="text" spellcheck="false" aria-label="第 ${page} 页 OCR 文本">${escapeHtml(state.pageText)}</textarea>`}
          <details class="ingest-original"><summary>查看原始 OCR／复用文本</summary><pre>${escapeHtml(state.rawText ?? "此历史任务未保留原始文本")}</pre></details>
        </form>`}
        ${outputsPanel()}
      </div>
    </section>`;
  }

  function outputsPanel() {
    const job = currentJob();
    if (!job) return "";
    const ready = ["complete", "complete_with_errors"].includes(job.status) || job.completed > 0;
    return `<section class="ingest-band ingest-outputs">
      <div class="ingest-section-head"><div><span>05</span><h2>CSV 与 AI 候选</h2></div><small>全文层保留回溯，证据层进入主表</small></div>
      <div class="ingest-output-list">
        <div><span class="file-kind">TXT</span><div><strong>逐页原文</strong><small>page_*.txt · ${job.completed} 页</small></div><button type="button" data-ingest-import-pages ${ready ? "" : "disabled"}>导入工作区</button></div>
        <div><span class="file-kind">CSV</span><div><strong>全文中间表</strong><small>pages.csv · 每页一行，保留 OCR 状态</small></div><a href="/api/ancient-ingest/jobs/${job.id}/outputs/pages.csv" download>下载</a></div>
        <div><span class="file-kind">CSV</span><div><strong>主表候选</strong><small>evidence.csv · ${job.extractedCount || 0} 条 · ${extractionStatusLabel(job.extractionStatus)}</small></div><span class="ingest-output-actions"><button type="button" data-ingest-extract ${ready && !window.CalligraphySession && job.extractionStatus !== "running" ? "" : "disabled"}>${window.CalligraphySession ? "模拟环境未启用模型" : job.extractionStatus === "running" ? "抽取中…" : "生成候选"}</button><a href="/api/ancient-ingest/jobs/${job.id}/outputs/evidence.csv" download>下载</a></span></div>
        <div><span class="file-kind">JSON</span><div><strong>处理清单</strong><small>页码映射、引擎和逐页错误</small></div><a href="/api/ancient-ingest/jobs/${job.id}/outputs/ocr-manifest.json" download>下载</a></div>
      </div>
    </section>`;
  }

  function render() {
    const currentKey = host.currentBookTask()?.key;
    if (currentKey && currentKey !== state.selectedBookKey) {
      state.selectedBookKey = currentKey;
      state.selectedJobId = bookTaskGroups().find((group) => group.key === currentKey)?.jobs[0]?.id || "";
      state.selectedPrintedPage = null;
    }
    if (!state.selectedBookKey) state.selectedBookKey = bookTaskGroups()[0]?.key || "";
    if (state.status === "local-only") {
      return `<section class="ingest-page ingest-local-only"><div class="ingest-local-only-card">
        <span>材料准备</span>
        <h2>导入材料</h2>
        ${jobsPanel()}
        ${existingMaterialsPanel()}
        <p class="ingest-local-pdf-note">PDF 识别与逐页校对需在本地服务中进行。</p>
      </div></section>`;
    }
    if (state.status === "idle" || state.status === "loading") {
      return `<section class="ingest-page"><div class="ingest-loading">正在准备材料导入与本机 PDF 工具…</div></section>`;
    }
    return `<section class="ingest-page ${state.error ? "has-alert" : ""}">
      ${state.error ? `<p class="ingest-alert" role="alert">${escapeHtml(state.error)}</p>` : ""}
      <div class="ingest-workbench">
        <aside class="ingest-sidebar" aria-label="古籍入库任务管理">
          ${existingMaterialsPanel()}${uploadPanel()}${setupPanel()}${jobsPanel()}
        </aside>
        ${reviewPanel()}
      </div>
    </section>`;
  }

  async function createJob(form) {
    if (state.creating) return;
    const data = new FormData(form);
    state.creating = true;
    state.error = "";
    host.rerender();
    try {
      const job = await api("/api/ancient-ingest/jobs", {
        method: "POST",
        body: JSON.stringify({
          pdfId: String(data.get("pdfId") || ""),
          bookTitle: String(data.get("bookTitle") || ""),
          edition: String(data.get("edition") || ""),
          sourceNote: String(data.get("sourceNote") || ""),
          startPage: Number(data.get("startPage")),
          endPage: Number(data.get("endPage")),
          pageOffset: Number(data.get("pageOffset")),
          reuseExisting: data.get("reuseExisting") === "on",
          ocrMissing: data.get("ocrMissing") === "on",
        }),
      });
      state.jobs = [job, ...state.jobs.filter((item) => item.id !== job.id)];
      state.selectedBookKey = bookKey(job.bookTitle || job.sourceName);
      state.selectedJobId = job.id;
      if (!host.activateBookTask(job)) state.error = "入库批次已创建，但对应古籍工作区未能激活；请检查保存状态后重试。";
      pageRequest += 1;
      state.selectedPrintedPage = null;
      state.pageText = "";
      state.pageRecord = null;
      schedulePoll();
    } catch (error) {
      state.error = error.message;
    } finally {
      state.creating = false;
      host.rerender();
    }
  }

  async function selectPage(page) {
    const job = currentJob();
    if (!job) return;
    const targetPage = Number(page);
    const request = ++pageRequest;
    state.selectedPrintedPage = targetPage;
    state.error = "";
    state.pageStatus = "loading";
    state.pageText = "";
    state.rawText = null;
    state.pageRecord = job.records.find((item) => item.printedPage === state.selectedPrintedPage) || null;
    host.rerender();
    try {
      const payload = await api(`/api/ancient-ingest/jobs/${job.id}/pages/${targetPage}`);
      if (request !== pageRequest || state.selectedJobId !== job.id) return;
      state.pageText = drafts.get(pageKey(job.id, targetPage)) ?? payload.text ?? "";
      state.pageRecord = payload.record || state.pageRecord;
      state.rawText = payload.rawText ?? null;
      state.pageStatus = "ready";
    } catch (error) {
      if (request !== pageRequest || state.selectedJobId !== job.id) return;
      state.error = error.message;
      state.pageStatus = "error";
    }
    host.rerender();
  }

  async function savePage(form) {
    const job = currentJob();
    if (!job || state.saving || state.pageStatus !== "ready") return;
    state.saving = true;
    const page = Number(form.dataset.page);
    const text = String(new FormData(form).get("text") || "");
    const key = pageKey(job.id, page);
    drafts.set(key, text);
    state.error = "";
    host.rerender();
    try {
      const payload = await api(`/api/ancient-ingest/jobs/${job.id}/pages/${page}`, {
        method: "POST", body: JSON.stringify({ text, revision: state.pageRecord?.revision ?? 0 }),
      });
      if (drafts.get(key) === text) drafts.delete(key);
      if (state.selectedJobId === job.id && state.selectedPrintedPage === page && state.pageStatus === "ready") {
        state.pageText = drafts.get(key) ?? payload.text ?? "";
        state.pageRecord = payload.record;
        state.rawText = payload.rawText ?? null;
      }
      const liveJob = state.jobs.find((item) => item.id === job.id);
      if (liveJob && payload.job) Object.assign(liveJob, payload.job);
      const index = liveJob?.records.findIndex((item) => item.printedPage === page) ?? -1;
      if (index >= 0) liveJob.records[index] = payload.record;
    } catch (error) {
      state.error = error.message;
    } finally {
      state.saving = false;
      host.rerender();
    }
  }

  async function importPages() {
    const job = currentJob();
    if (!job || state.importing) return;
    const records = job.records.filter((item) => item.status === "complete");
    if (!records.length) return;
    if (!host.activateBookTask(job)) {
      state.error = "无法进入该古籍任务，原文未导入当前主表。";
      host.rerender();
      return;
    }
    state.importing = true;
    state.error = "";
    host.rerender();
    try {
      const files = [];
      for (const record of records) {
        const payload = await api(`/api/ancient-ingest/jobs/${job.id}/pages/${record.printedPage}`);
        files.push(new File([payload.text || ""], record.sourceFile, { type: "text/plain" }));
      }
      await host.importFiles(files);
    } catch (error) {
      state.error = error.message;
    } finally {
      state.importing = false;
      host.rerender();
    }
  }

  function attach() {
    if (state.status === "idle") load();
    document.querySelector("#ancientIngestUploadForm")?.addEventListener("submit", (event) => {
      event.preventDefault(); uploadPdf(event.currentTarget);
    });
    document.querySelector("[data-ingest-refresh]")?.addEventListener("click", () => load());
    document.querySelector("#bookTaskCreateForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = String(new FormData(event.currentTarget).get("bookTitle") || "").trim();
      if (!title || !host.activateBookTask(title)) {
        state.error = "古籍任务未创建，请检查书名和工作区保存状态。";
      } else {
        state.selectedBookKey = bookKey(title);
        state.selectedJobId = bookTaskGroups().find((group) => group.key === state.selectedBookKey)?.jobs[0]?.id || "";
        state.error = "";
      }
      host.rerender();
    });
    document.querySelectorAll("[data-ingest-book]").forEach((button) => button.addEventListener("click", () => {
      const group = bookTaskGroups().find((item) => item.key === button.dataset.ingestBook);
      if (!group) return;
      if (!host.activateBookTask(group.title)) {
        state.error = "无法切换到该古籍任务，请检查当前工作区保存状态。";
        host.rerender();
        return;
      }
      state.selectedBookKey = group.key;
      state.selectedJobId = group.jobs[0]?.id || "";
      pageRequest += 1;
      state.selectedPrintedPage = null;
      state.pageRecord = null;
      state.pageText = "";
      state.error = "";
      schedulePoll();
      host.rerender();
    }));
    document.querySelector("[data-ingest-pdf-select]")?.addEventListener("change", (event) => {
      state.selectedPdfId = event.target.value;
      host.rerender();
    });
    document.querySelector("#ancientIngestCreateForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      createJob(event.currentTarget);
    });
    const setupForm = document.querySelector("#ancientIngestCreateForm");
    const setupFields = ["bookTitle", "edition", "sourceNote", "startPage", "endPage", "pageOffset", "reuseExisting", "ocrMissing"];
    const setupValues = setupDrafts.get(state.selectedPdfId);
    if (setupForm && setupValues) {
      for (const name of setupFields) {
        const input = setupForm.elements.namedItem(name);
        if (input.type === "checkbox") input.checked = setupValues[name];
        else input.value = setupValues[name];
      }
    }
    setupForm?.addEventListener("input", () => {
      const values = {};
      for (const name of setupFields) {
        const input = setupForm.elements.namedItem(name);
        values[name] = input.type === "checkbox" ? input.checked : input.value;
      }
      setupDrafts.set(state.selectedPdfId, values);
    });
    document.querySelector("#ancientIngestPageForm textarea")?.addEventListener("input", (event) => {
      state.pageText = event.target.value;
      drafts.set(pageKey(state.selectedJobId, state.selectedPrintedPage), state.pageText);
      const status = document.querySelector("[data-ingest-save-status]");
      if (status) status.textContent = "未保存 · 翻页保留草稿";
    });
    document.querySelectorAll("[data-ingest-job]").forEach((button) => button.addEventListener("click", () => {
      const job = state.jobs.find((item) => item.id === button.dataset.ingestJob);
      if (!job) return;
      if (!host.activateBookTask(job)) {
        state.error = "无法切换到该古籍任务，请检查当前工作区保存状态。";
        host.rerender();
        return;
      }
      state.selectedBookKey = bookKey(job.bookTitle || job.sourceName);
      state.selectedJobId = job.id;
      pageRequest += 1;
      state.selectedPrintedPage = null;
      state.pageRecord = null;
      state.pageText = "";
      schedulePoll();
      host.rerender();
    }));
    document.querySelector("[data-ingest-pause]")?.addEventListener("click", async () => {
      const job = currentJob();
      if (!job) return;
      try { Object.assign(job, await api(`/api/ancient-ingest/jobs/${job.id}/pause`, { method: "POST", body: "{}" })); }
      catch (error) { state.error = error.message; }
      host.rerender();
    });
    document.querySelector("[data-ingest-resume]")?.addEventListener("click", async () => {
      const job = currentJob();
      if (!job) return;
      try { Object.assign(job, await api(`/api/ancient-ingest/jobs/${job.id}/resume`, { method: "POST", body: "{}" })); schedulePoll(); }
      catch (error) { state.error = error.message; }
      host.rerender();
    });
    document.querySelectorAll("[data-ingest-page]").forEach((button) => button.addEventListener("click", () => selectPage(button.dataset.ingestPage)));
    document.querySelector("#ancientIngestPageForm")?.addEventListener("submit", (event) => { event.preventDefault(); savePage(event.currentTarget); });
    document.querySelector("[data-ingest-import-pages]")?.addEventListener("click", importPages);
    document.querySelector("[data-ingest-extract]")?.addEventListener("click", async () => {
      const job = currentJob();
      if (!job) return;
      const remaining = job.records.filter((item) => item.status === "complete" && !(job.extractedPages || []).includes(item.printedPage)).length;
      if (!remaining) { state.error = "所有已完成页面都已经抽取。"; host.rerender(); return; }
      if (!window.confirm(`将使用当前主模型处理 ${remaining} 页，每页一次调用。继续吗？`)) return;
      try {
        Object.assign(job, await api(`/api/ancient-ingest/jobs/${job.id}/extract`, { method: "POST", body: "{}" }));
        schedulePoll();
      } catch (error) {
        state.error = error.message;
      }
      host.rerender();
    });

    const job = currentJob();
    if (job && state.selectedPrintedPage == null) {
      const first = job.records.find((item) => item.status === "complete");
      if (first) selectPage(first.printedPage);
    }
  }

  window.AncientIngestUI = { configure, render, attach, load };
})();

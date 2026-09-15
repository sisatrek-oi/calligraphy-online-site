(function () {
  function createImportBatch(files = []) {
    return {
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      fileNames: files.map((file) => file.name),
      fileCount: files.length,
    };
  }

  function mergeRows(existingRows = [], incomingRows = []) {
    const merged = [...existingRows];
    const seen = new Set(existingRows.map((row) => String(row.id)));
    incomingRows.forEach((row) => {
      const originalId = String(row.id || "");
      if (originalId && seen.has(originalId)) {
        const nextId = `${originalId}-dup-${merged.length + 1}`;
        merged.push({
          ...row,
          id: nextId,
          originalDuplicateId: originalId,
          problemTags: [...new Set([...(row.problemTags || []), "duplicate"])],
        });
        seen.add(nextId);
      } else {
        merged.push(row);
        if (originalId) seen.add(originalId);
      }
    });
    return merged;
  }

  function collectCsvHeaders(files = []) {
    return [...new Set(files.flatMap((file) => file.headers || []))];
  }

  function contentSignature(row) {
    const fields = row.aiDraft || row.fields || {};
    return JSON.stringify([
      Object.keys(fields).filter((key) => !key.startsWith("_") && key !== "problemTags")
        .sort().map((key) => [key, String(fields[key] ?? "").trim()]),
      row.hit || "", row.appendix || ""
    ]);
  }

  function humanTouched(row) {
    return Boolean(row.reviewed || row.edited || row.flagged || row.problemResolution
      || (row.problemTags || []).length
      || (row.annotations || []).length
      || (row.history || []).some((event) => !["ai-draft", "import-update"].includes(event.type)));
  }

  function issueIdentity(row, sourceFile = "", sourceText = null) {
    return JSON.stringify(row ? [
      "row", row.importOrigin?.key || [row.importFileName || "", row.id],
      row.importOrigin?.signature || contentSignature(row), sourceFile, sourceText
    ] : ["source", sourceFile, sourceText]);
  }

  function resolvedDecision(reports, identity) {
    for (const report of [...reports].reverse()) {
      const issue = (report.issues || []).find((item) => {
        const sourceFile = item.sourceFile || (item.sourceConflict ? item.row?.sourceFile : "") || "";
        const key = item.identity || issueIdentity(item.row, sourceFile, report.sourceConflicts?.[sourceFile] ?? null);
        return key === identity;
      });
      if (issue) return issue.resolution?.action !== "reopen" ? issue.resolution || null : null;
    }
    return null;
  }

  function planImport(existingRows, incomingRows, options = {}) {
    const mode = options.mode || "append";
    const rows = mode === "new" ? [] : [...existingRows];
    const deletedRows = mode === "new" ? [] : (options.deletedRows || []);
    const byId = new Map([...rows, ...deletedRows].map((row) => [String(row.id), row]));
    const byOrigin = new Map([...rows, ...deletedRows]
      .filter((row) => row.importOrigin?.key).map((row) => [row.importOrigin.key, row]));
    const actions = [];
    const counts = { added: 0, duplicate: 0, updated: 0, conflict: 0, invalid: 0 };
    for (const incoming of incomingRows) {
      const row = { ...incoming };
      const quote = String(row.fields?.quote ?? row.quote ?? "").trim();
      const existing = byOrigin.get(row.importOrigin?.key) || byId.get(String(row.id));
      let type;
      let reason = "";
      if (!quote && !options.preserveInvalid) {
        type = "invalid";
        reason = "缺少原文摘录";
      } else if (existing?.deleted || deletedRows.includes(existing)) {
        type = "conflict";
        reason = "条目已在回收站，请先恢复";
      } else if (existing) {
        const before = existing.importOrigin?.signature || contentSignature(existing);
        const after = row.importOrigin?.signature || contentSignature(row);
        if (before === after) {
          type = "duplicate";
          reason = "相同来源内容，保留已有审校";
        } else if (mode === "update" && !humanTouched(existing)) {
          type = "updated";
          row.id = existing.id;
          row.cloudId = existing.cloudId;
          row.history = [...(existing.history || []), {
            type: "import-update", actor: "导入", at: new Date().toISOString(),
            reason: "导入更新未经人工处理的条目。",
            changes: Object.keys(row.fields || {}).filter((key) => existing.fields?.[key] !== row.fields[key])
              .map((fieldId) => ({ fieldId, before: existing.fields?.[fieldId] || "", after: row.fields[fieldId] }))
          }];
          rows[rows.indexOf(existing)] = row;
        } else {
          type = "conflict";
          reason = humanTouched(existing) ? "已有人工处理，保留当前值" : "相同编号内容不同，保留当前值";
        }
      } else {
        type = "added";
        if (mode === "new") delete row.cloudId;
        rows.push(row);
      }
      counts[type] += 1;
      actions.push({ type, reason, row, existing });
      if (type === "added" || type === "updated") {
        byId.set(String(row.id), row);
        if (row.importOrigin?.key) byOrigin.set(row.importOrigin.key, row);
      }
    }
    return { rows, actions, counts };
  }

  window.CalligraphyImportWorkflow = {
    createImportBatch,
    mergeRows,
    collectCsvHeaders,
    contentSignature,
    planImport,
    issueIdentity,
    resolvedDecision,
  };
})();

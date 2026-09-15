(function () {
  function toCsvValue(value) {
    const text = Array.isArray(value) ? value.join(";") : String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(rows, fields) {
    const header = fields.map((field) => toCsvValue(field.label)).join(",");
    const body = rows.map((row) => fields.map((field) => toCsvValue(row[field.key])).join(",")).join("\n");
    return [header, body].filter(Boolean).join("\n");
  }

  function buildMainExport(rows, fields) {
    return rowsToCsv(rows, fields);
  }

  function buildProblemExport(rows, fields) {
    return rowsToCsv(rows.filter((row) => (row.problemTags || []).length || row.flagged), fields);
  }

  function buildReviewLogExport(events) {
    const fields = [
      { key: "createdAt", label: "时间" },
      { key: "rowId", label: "条目ID" },
      { key: "action", label: "动作" },
      { key: "actor", label: "操作者" },
      { key: "detail", label: "详情" },
    ];
    return rowsToCsv(events || [], fields);
  }

  const releaseChecks = [
    { key: "unreviewed", label: "尚未人工确认" },
    { key: "openProblem", label: "问题未关闭" },
    { key: "missingRequired", label: "必填字段缺失" },
    { key: "unlocated", label: "原文未完整定位" },
    { key: "duplicateId", label: "条目编号重复" }
  ];

  function assessRelease(facts) {
    const idCounts = new Map();
    facts.forEach((row) => idCounts.set(String(row.id), (idCounts.get(String(row.id)) || 0) + 1));
    const issues = facts.map((row) => ({
      id: row.id,
      reasons: [
        !row.reviewed && "unreviewed",
        row.hasProblem && "openProblem",
        (row.missingRequired || !String(row.id || "").trim()) && "missingRequired",
        !(row.sourceRank >= 2) && "unlocated",
        idCounts.get(String(row.id)) > 1 && "duplicateId"
      ].filter(Boolean)
    })).filter((item) => item.reasons.length);
    const checks = releaseChecks.map((check) => ({
      ...check, count: issues.filter((item) => item.reasons.includes(check.key)).length
    }));
    return { total: facts.length, blocked: issues.length, ready: facts.length > 0 && issues.length === 0, checks, issues };
  }

  function createRelease({ metadata, facts, rows, fields, sourcePages, auditRows }) {
    const assessment = assessRelease(facts);
    if (!assessment.ready) throw new Error("所选范围尚未通过成果检查");
    if (rows.length !== facts.length || rows.some((row, index) => String(row.id) !== String(facts[index].id))) {
      throw new Error("导出范围与检查范围不一致");
    }
    // Keep byte-for-byte output with its source evidence, independent of later edits.
    return JSON.parse(JSON.stringify({
      type: "calligraphy-release", formatVersion: 1,
      ...metadata, assessment, fields, rows, sourcePages, auditRows,
      csv: "\uFEFF" + rowsToCsv(rows, fields) + "\r\n"
    }));
  }

  window.CalligraphyExportWorkflow = {
    rowsToCsv,
    buildMainExport,
    buildProblemExport,
    buildReviewLogExport,
    releaseChecks,
    assessRelease,
    createRelease,
  };
})();

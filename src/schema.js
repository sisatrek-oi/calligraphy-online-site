(function () {
  const canonicalFields = [
    { key: "id", label: "材料ID", required: true, aliases: ["材料ID", "id", "ID", "编号", "record_id"] },
    { key: "appendix", label: "附表/分类", required: false, aliases: ["附表", "分类", "bucket", "appendix"] },
    { key: "status", label: "状态", required: false, aliases: ["二轮状态", "第三轮状态", "状态", "status", "review_status"] },
    { key: "hit", label: "原文命中", required: false, aliases: ["原文命中", "hit", "match", "命中"] },
    { key: "author", label: "书家", required: true, aliases: ["书家", "作者", "人物", "artist", "author"] },
    { key: "scriptType", label: "书体", required: false, aliases: ["书体", "书体/可能书体", "字体", "script", "scriptType"] },
    { key: "quote", label: "原文摘录", required: true, aliases: ["quote", "摘录", "原文", "原文摘录", "片段", "text"] },
    { key: "pageNo", label: "页码", required: true, aliases: ["page_no", "页码", "页序", "page", "pageNo"] },
    { key: "sourceFile", label: "原文文件", required: true, aliases: ["source_file", "原文文件", "文件", "page_file", "sourceFile"] },
    { key: "confidence", label: "证据等级", required: false, aliases: ["证据等级", "置信度", "confidence", "置信等级"] },
    { key: "gate", label: "门禁", required: false, aliases: ["门禁", "进入主表建议", "gate"] },
    { key: "issue", label: "待复核问题", required: false, aliases: ["问题/隐患", "待复核问题", "问题", "issue"] },
    { key: "note", label: "备注", required: false, aliases: ["备注", "note"] },
  ];

  const problemTags = [
    { key: "unlocated", label: "未定位", severity: "high" },
    { key: "source_mismatch", label: "原文不符", severity: "high" },
    { key: "duplicate", label: "疑似重复", severity: "medium" },
    { key: "missing_field", label: "字段缺失", severity: "medium" },
    { key: "author_issue", label: "书家异常", severity: "medium" },
    { key: "script_issue", label: "书体异常", severity: "medium" },
    { key: "page_issue", label: "页码异常", severity: "medium" },
    { key: "manual_review", label: "需人工判断", severity: "low" },
  ];

  function normalizeHeader(value = "") {
    return String(value).trim().toLowerCase().replace(/[\s/_-]+/g, "");
  }

  function inferFieldMapping(headers = []) {
    const mapping = {};
    headers.forEach((header) => {
      const normalized = normalizeHeader(header);
      const match = canonicalFields.find((field) =>
        field.aliases.some((alias) => normalizeHeader(alias) === normalized)
      );
      if (match) mapping[header] = match.key;
    });
    return mapping;
  }

  function tagLabel(key) {
    return problemTags.find((tag) => tag.key === key)?.label || key;
  }

  window.CalligraphySchema = {
    canonicalFields,
    problemTags,
    inferFieldMapping,
    normalizeHeader,
    tagLabel,
  };
})();

(function () {
  function uniqueTags(tags = []) {
    return [...new Set(tags.filter(Boolean))];
  }

  function addProblemTag(row, tagKey) {
    return { ...row, problemTags: uniqueTags([...(row.problemTags || []), tagKey]) };
  }

  function removeProblemTag(row, tagKey) {
    return { ...row, problemTags: uniqueTags(row.problemTags || []).filter((tag) => tag !== tagKey) };
  }

  function hasProblem(row) {
    if (row.deleted || row.problemResolution?.status === "resolved") return false;
    return Boolean(row.problemResolution || row.flagged || (row.problemTags || []).length
      || row.bucket === "review" || row.abnormal
      || row.evidenceLevel === "待复核" || row.confidence === "待复核");
  }

  function problemStatus(row) {
    if (row.problemResolution?.status === "resolved") return "resolved";
    if (row.problemResolution?.status === "pending_review") return "pending_review";
    return hasProblem(row) ? "open" : "none";
  }

  function buildReviewQueue(rows, options = {}) {
    const tag = options.tag || "all";
    return rows.filter((row) => {
      if (!hasProblem(row)) return false;
      if (tag !== "all" && !(row.problemTags || []).includes(tag)) return false;
      return true;
    });
  }

  window.CalligraphyReviewWorkflow = {
    addProblemTag,
    removeProblemTag,
    buildReviewQueue,
    hasProblem,
    problemStatus,
    uniqueTags,
  };
})();

(function () {
  const text = (value) => String(value ?? "");

  function normalizeProposal(value) {
    if (!value || typeof value !== "object") return null;
    const fields = value.fields && typeof value.fields === "object"
      ? Object.fromEntries(Object.entries(value.fields).slice(0, 100).map(([id, fieldValue]) => [text(id).slice(0, 64), text(fieldValue).slice(0, 2000)])) : {};
    const evidence = Array.isArray(value.evidence) ? value.evidence.slice(0, 60).map((item) => ({
      fieldId: text(item?.fieldId).slice(0, 64), quote: text(item?.quote).slice(0, 500), verified: Boolean(item?.verified),
      location: item?.location && typeof item.location === "object" ? {
        page: text(item.location.page).slice(0, 120), paragraph: text(item.location.paragraph).slice(0, 120), item: text(item.location.item).slice(0, 120)
      } : {}
    })) : [];
    const reasoning = Array.isArray(value.reasoning) ? value.reasoning.slice(0, 30).map((item) => ({
      fieldId: text(item?.fieldId).slice(0, 64), decision: text(item?.decision).slice(0, 20), reason: text(item?.reason).slice(0, 800),
      evidenceQuote: text(item?.evidenceQuote).slice(0, 500), evidenceVerified: Boolean(item?.evidenceVerified)
    })) : [];
    const abstentions = Array.isArray(value.abstentions) ? value.abstentions.slice(0, 30).map((item) => ({
      fieldId: text(item?.fieldId).slice(0, 64), reason: text(item?.reason).slice(0, 500)
    })) : [];
    const answerSources = value.answerSources && typeof value.answerSources === "object"
      ? Object.fromEntries(Object.entries(value.answerSources).slice(0, 100)
        .filter(([, source]) => ["direct", "repair"].includes(source))
        .map(([id, source]) => [text(id).slice(0, 64), source])) : {};
    return { fields, evidence, reasoning, abstentions, answerSources };
  }

  function normalizeConsensusResponse(payload = {}) {
    const models = Array.isArray(payload.models) ? payload.models.map((item) => ({
      profileId: text(item?.profileId).slice(0, 80),
      status: item?.status === "success" ? "success" : "error",
      profile: {
        id: text(item?.profile?.id).slice(0, 80),
        displayName: text(item?.profile?.displayName || item?.profileId).slice(0, 80),
        model: text(item?.profile?.model).slice(0, 120),
        modelFamily: text(item?.profile?.modelFamily).slice(0, 80)
      },
      proposal: normalizeProposal(item?.proposal),
      error: text(item?.error).slice(0, 500),
      elapsedMs: Number(item?.elapsedMs) || 0
    })) : [];
    const sourceFields = payload.fields && typeof payload.fields === "object" ? payload.fields : {};
    const fieldReasons = new Set(["accepted", "abstention", "model_count", "missing_value", "disagreement", "insufficient_evidence", "rule_failure", "system_verified", "system_mismatch"]);
    const comparisonModes = new Set(["exact", "quote", "script_type", "confidence", "token_set", "advisory"]);
    const fields = Object.fromEntries(Object.entries(sourceFields).map(([id, field]) => [id, {
      status: ["unanimous", "split", "blocked"].includes(field?.status) ? field.status : "blocked",
      value: text(field?.value).slice(0, 2000),
      votes: Array.isArray(field?.votes) ? field.votes.slice(0, 3).map((value) => text(value).slice(0, 2000)) : [],
      policy: ["loose", "standard", "strict"].includes(field?.policy) ? field.policy : "standard",
      verifiedEvidence: Number(field?.verifiedEvidence) || 0,
      evidenceRequired: typeof field?.evidenceRequired === "boolean" ? field.evidenceRequired : undefined,
      voteCount: Math.max(0, Math.min(3, Number(field?.voteCount) || 0)),
      abstentionCount: Math.max(0, Math.min(3, Number(field?.abstentionCount) || 0)),
      reason: fieldReasons.has(field?.reason) ? field.reason : "rule_failure",
      comparisonMode: comparisonModes.has(field?.comparisonMode) ? field.comparisonMode : "exact",
      blocking: field?.blocking !== false,
      validationSource: field?.validationSource === "system" ? "system" : "model"
    }]));
    const decisions = ["adopt_fields", "needs_human_review", "auto_approve_record"];
    return {
      runId: text(payload.runId),
      status: text(payload.status),
      startedAt: text(payload.startedAt),
      completedAt: text(payload.completedAt),
      snapshotVersion: Math.max(1, Number(payload.snapshotVersion) || 1),
      retryToken: text(payload.retryToken).slice(0, 1500000),
      decision: decisions.includes(payload.decision) ? payload.decision : "needs_human_review",
      fields,
      models,
      blockers: Array.isArray(payload.blockers) ? payload.blockers.slice(0, 100).map((value) => text(value).slice(0, 500)) : []
    };
  }

  const adoptableFieldIds = (result) => Object.entries(result?.fields || {})
    .filter(([, field]) => field.status === "unanimous")
    .map(([id]) => id);

  window.CalligraphyAiConsensus = { adoptableFieldIds, normalizeConsensusResponse };
})();

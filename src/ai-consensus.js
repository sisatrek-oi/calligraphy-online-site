(function () {
  const text = (value) => String(value ?? "");

  function normalizeConsensusResponse(payload = {}) {
    const models = Array.isArray(payload.models) ? payload.models.map((item) => ({
      profileId: text(item?.profileId),
      status: item?.status === "success" ? "success" : "error",
      profile: {
        id: text(item?.profile?.id),
        displayName: text(item?.profile?.displayName || item?.profileId),
        model: text(item?.profile?.model),
        modelFamily: text(item?.profile?.modelFamily)
      },
      proposal: item?.proposal && typeof item.proposal === "object" ? item.proposal : null,
      error: text(item?.error),
      elapsedMs: Number(item?.elapsedMs) || 0
    })) : [];
    const sourceFields = payload.fields && typeof payload.fields === "object" ? payload.fields : {};
    const fields = Object.fromEntries(Object.entries(sourceFields).map(([id, field]) => [id, {
      status: ["unanimous", "split", "blocked"].includes(field?.status) ? field.status : "blocked",
      value: text(field?.value),
      votes: Array.isArray(field?.votes) ? field.votes.map(text) : [],
      policy: ["loose", "standard", "strict"].includes(field?.policy) ? field.policy : "standard",
      verifiedEvidence: Number(field?.verifiedEvidence) || 0
    }]));
    const decisions = ["adopt_fields", "needs_human_review", "auto_approve_record"];
    return {
      runId: text(payload.runId),
      status: text(payload.status),
      decision: decisions.includes(payload.decision) ? payload.decision : "needs_human_review",
      fields,
      models,
      blockers: Array.isArray(payload.blockers) ? payload.blockers.map(text) : []
    };
  }

  const adoptableFieldIds = (result) => Object.entries(result?.fields || {})
    .filter(([, field]) => field.status === "unanimous")
    .map(([id]) => id);

  window.CalligraphyAiConsensus = { adoptableFieldIds, normalizeConsensusResponse };
})();

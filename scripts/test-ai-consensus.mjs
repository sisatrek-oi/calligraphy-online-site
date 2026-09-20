import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(new URL("../src/ai-consensus.js", import.meta.url), "utf8"), context);
const api = context.window.CalligraphyAiConsensus;

test("normalizes consensus response and exposes unanimous fields", () => {
  const result = api.normalizeConsensusResponse({
    runId: "run-1",
    status: "complete",
    decision: "adopt_fields",
    fields: { author: { status: "unanimous", value: "苏轼", policy: "standard", verifiedEvidence: 3, votes: ["苏轼", "苏轼", "苏轼"] } },
    models: []
  });
  assert.equal(result.fields.author.value, "苏轼");
  assert.deepEqual(Array.from(api.adoptableFieldIds(result)), ["author"]);
});

test("never treats split fields as adoptable", () => {
  const result = api.normalizeConsensusResponse({
    runId: "run-2",
    status: "complete",
    decision: "needs_human_review",
    fields: { scriptType: { status: "split", value: "楷书", votes: ["楷书", "楷书", "行楷"] } },
    models: []
  });
  assert.deepEqual(Array.from(api.adoptableFieldIds(result)), []);
});

test("falls back to blocked fields and human review for malformed public payloads", () => {
  const result = api.normalizeConsensusResponse({
    decision: "unexpected",
    fields: { author: { status: "unexpected", votes: "not-an-array", verifiedEvidence: "nan" } },
    models: [{ profileId: "primary", status: "unknown", profile: null, elapsedMs: "bad" }],
    blockers: [null, "model_failure"]
  });
  assert.equal(result.decision, "needs_human_review");
  assert.equal(result.fields.author.status, "blocked");
  assert.deepEqual(Array.from(result.fields.author.votes), []);
  assert.equal(result.models[0].status, "error");
  assert.deepEqual(Array.from(api.adoptableFieldIds(result)), []);
});

test("keeps audit metadata while stripping model secrets and unknown proposal properties", () => {
  const result = api.normalizeConsensusResponse({
    runId: "run-safe",
    startedAt: "2026-09-20T00:00:00Z",
    completedAt: "2026-09-20T00:00:01Z",
    snapshotVersion: 2,
    models: [{
      profileId: "primary",
      status: "success",
      profile: { id: "primary", displayName: "A", model: "a", modelFamily: "family-a", apiKey: "secret" },
      proposal: {
        fields: { author: "苏轼" },
        reasoning: [{ fieldId: "author", decision: "change", reason: "有证据", apiKey: "secret" }],
        evidence: [{ fieldId: "author", quote: "苏轼", verified: true, apiKey: "secret" }],
        abstentions: []
      }
    }]
  });
  assert.equal(result.snapshotVersion, 2);
  assert.equal(result.startedAt, "2026-09-20T00:00:00Z");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.deepEqual(Object.keys(result.models[0].profile).sort(), ["displayName", "id", "model", "modelFamily"]);
  assert.equal(result.models[0].proposal.reasoning[0].reason, "有证据");
});

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

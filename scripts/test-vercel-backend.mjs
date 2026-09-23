import assert from "node:assert/strict";
import test from "node:test";

import { publicCloudConfig } from "../api/config.js";
import { requireAiAccess } from "../api/_auth.js";
import { healthPayload } from "../api/health.js";
import { activeModelProfiles, publicModelConfig } from "../api/_model-config.js";
import { evaluateConsensus, runConsensus } from "../api/_consensus.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-public",
  CLOUD_SYNC_ENABLED: "true",
  MODEL_PRIMARY_API_URL: "https://one.example/chat",
  MODEL_PRIMARY_API_KEY: "secret-one",
  MODEL_PRIMARY_NAME: "model-one",
  MODEL_PRIMARY_FAMILY: "family-one",
  MODEL_SECONDARY_API_URL: "https://two.example/chat",
  MODEL_SECONDARY_API_KEY: "secret-two",
  MODEL_SECONDARY_NAME: "model-two",
  MODEL_SECONDARY_FAMILY: "family-two",
  MODEL_TERTIARY_API_URL: "https://three.example/chat",
  MODEL_TERTIARY_API_KEY: "secret-three",
  MODEL_TERTIARY_NAME: "model-three",
  MODEL_TERTIARY_FAMILY: "family-three",
};

test("Vercel model config exposes capability without leaking secrets", () => {
  const profiles = activeModelProfiles(env);
  assert.equal(profiles.length, 3);
  const payload = publicModelConfig(env);
  assert.equal(payload.supported, false);
  assert.equal(payload.configured, true);
  assert.equal(payload.profiles.length, 3);
  assert.equal(JSON.stringify(payload).includes("secret-one"), false);
  assert.equal(payload.profiles[0].keyHint, "-one");
});

test("public config and health report deployable capabilities honestly", () => {
  assert.deepEqual(publicCloudConfig(env), {
    enabled: true,
    aiEnabled: true,
    aiAuthRequired: true,
    consensusEnabled: true,
    ancientIngestEnabled: false,
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-public",
    rememberEmail: true,
    defaultTeamName: "书论研究团队",
    defaultProjectName: "书论整理项目",
    defaultWorkspaceName: "书论统一主表",
  });
  const health = healthPayload(env);
  assert.equal(health.ok, true);
  assert.equal(health.capabilities.consensus, true);
  assert.equal(health.capabilities.ancientIngest, false);
});

test("AI access requires a valid Supabase session and an RLS-visible workspace", async () => {
  const workspaceId = "11111111-2222-4333-8444-555555555555";
  const teamId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/auth/v1/user")) return { ok: true, json: async () => ({ id: "user-1" }) };
    if (String(url).includes("/rest/v1/workspaces")) return { ok: true, json: async () => ([{ id: workspaceId, team_id: teamId }]) };
    return { ok: true, json: async () => ([{ role: "reviewer" }]) };
  };
  const result = await requireAiAccess(
    { headers: { authorization: "Bearer a-valid-test-session-token" } },
    { cloudWorkspaceId: workspaceId },
    { env, fetcher },
  );
  assert.equal(result.authenticated, true);
  assert.equal(result.workspaceId, workspaceId);
  assert.equal(calls.length, 3);
  await assert.rejects(
    () => requireAiAccess({ headers: {} }, { cloudWorkspaceId: workspaceId }, { env, fetcher }),
    (error) => error.status === 401,
  );
  await assert.rejects(
    () => requireAiAccess(
      { headers: { authorization: "Bearer a-valid-test-session-token" } },
      { cloudWorkspaceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      { env, fetcher },
    ),
    (error) => error.status === 403,
  );
});

test("consensus evaluator accepts matching evidence-backed fields", () => {
  const schema = [{ id: "author", required: true, evidenceRequired: true, comparisonMode: "exact" }];
  const models = ["primary", "secondary", "tertiary"].map((profileId, index) => ({
    profileId,
    status: "success",
    profile: { modelFamily: `family-${index}` },
    proposal: {
      fields: { author: "苏轼" },
      evidence: [{ fieldId: "author", quote: "苏轼", verified: true }],
      abstentions: [],
    },
  }));
  const result = evaluateConsensus({ schema, defaultConsensus: "standard", reviewMode: "assist", aliases: {}, fieldOverrides: {}, currentFields: {} }, models);
  assert.equal(result.fields.author.status, "unanimous");
  assert.equal(result.decision, "adopt_fields");
});

test("runConsensus keeps failures visible and never invents a three-model pass", async () => {
  const payload = {
    runId: "run-vercel-test",
    sourceText: "苏轼善行书。",
    sourceFile: "page_1.txt",
    pageNo: "1",
    currentFields: { author: "" },
    schema: [{ id: "author", label: "书家", required: true, evidenceRequired: true, comparisonMode: "exact" }],
    reviewMode: "assist",
    defaultConsensus: "standard",
  };
  const fetcher = async (url) => {
    if (String(url).includes("two.example")) return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        fields: { author: "苏轼" },
        evidence: [{ fieldId: "author", quote: "苏轼" }],
        reasoning: [{ fieldId: "author", decision: "change", reason: "原文直指", evidenceQuote: "苏轼" }],
        abstentions: [],
      }) } }] }),
    };
  };
  const result = await runConsensus(payload, { env, fetcher });
  assert.equal(result.models.filter((item) => item.status === "success").length, 2);
  assert.equal(result.decision, "needs_human_review");
  assert.ok(result.blockers.includes("model_failure"));
});

test("retry replaces only the requested model in an immutable client snapshot", async () => {
  const payload = {
    runId: "run-vercel-retry",
    sourceText: "苏轼善行书。",
    sourceFile: "page_1.txt",
    pageNo: "1",
    currentFields: { author: "" },
    schema: [{ id: "author", label: "书家", required: true, evidenceRequired: true, comparisonMode: "exact" }],
    reviewMode: "assist",
    defaultConsensus: "standard",
  };
  const proposal = (author) => ({
    fields: { author },
    evidence: [{ fieldId: "author", quote: author, verified: author === "苏轼" }],
    reasoning: [],
    abstentions: [],
  });
  const initialFetcher = async (url) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal(String(url).includes("two.example") ? "米芾" : "苏轼")) } }] }),
  });
  const previous = await runConsensus(payload, { env, fetcher: initialFetcher });
  const before = structuredClone(previous);
  const retryFetcher = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(proposal("苏轼")) } }] }) });
  const result = await runConsensus(payload, {
    env,
    fetcher: retryFetcher,
    retryProfileId: "secondary",
    retryToken: previous.retryToken,
  });
  assert.deepEqual(previous, before);
  assert.equal(result.snapshotVersion, 2);
  assert.equal(result.models[0].proposal.fields.author, "苏轼");
  assert.equal(result.models[1].proposal.fields.author, "苏轼");
  assert.equal(result.models[2].proposal.fields.author, "苏轼");
  assert.equal(result.fields.author.status, "unanimous");
});

test("retry rejects a tampered or cross-input snapshot token", async () => {
  const payload = {
    runId: "run-token-test",
    sourceText: "苏轼善行书。",
    schema: [{ id: "author", required: true, evidenceRequired: false, comparisonMode: "exact" }],
    reviewMode: "assist",
    defaultConsensus: "standard",
  };
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ fields: { author: "苏轼" }, evidence: [], reasoning: [], abstentions: [] }) } }] }),
  });
  const first = await runConsensus(payload, { env, fetcher });
  await assert.rejects(
    () => runConsensus(payload, { env, fetcher, retryProfileId: "secondary", retryToken: `${first.retryToken}x` }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    () => runConsensus({ ...payload, sourceText: "米芾善行书。" }, { env, fetcher, retryProfileId: "secondary", retryToken: first.retryToken }),
    (error) => error.status === 409,
  );
});

test("auto mode requires model-family diversity even when values agree", () => {
  const payload = {
    schema: [{ id: "author", required: true, evidenceRequired: false, comparisonMode: "exact" }],
    defaultConsensus: "standard",
    reviewMode: "auto",
    aliases: {},
    fieldOverrides: {},
    currentFields: {},
  };
  const models = ["primary", "secondary", "tertiary"].map((profileId) => ({
    profileId,
    status: "success",
    profile: { modelFamily: "same-family" },
    proposal: { fields: { author: "苏轼" }, evidence: [], abstentions: [] },
  }));
  const result = evaluateConsensus(payload, models);
  assert.equal(result.fields.author.status, "unanimous");
  assert.equal(result.decision, "needs_human_review");
  assert.ok(result.blockers.includes("model_family_diversity"));
});

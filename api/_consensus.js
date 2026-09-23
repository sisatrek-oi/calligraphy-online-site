import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { runExtraction } from "./ai/extract.js";
import { activeModelProfiles, publicModelProfile } from "./_model-config.js";

const POLICIES = new Set(["loose", "standard", "strict"]);
const REVIEW_MODES = new Set(["assist", "auto"]);
const COMPARISON_MODES = new Set(["exact", "quote", "script_type", "confidence", "token_set", "advisory"]);
const PUNCTUATION = new Map(Object.entries({ "，": ",", "：": ":", "；": ";", "（": "(", "）": ")", "。": ".", "！": "!", "？": "?", "【": "[", "】": "]" }));

function apiError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inputHash(payload) {
  return createHash("sha256").update(stableJson({
    runId: payload.runId,
    sourceText: payload.sourceText,
    sourceFile: payload.sourceFile || "",
    pageNo: payload.pageNo || "",
    schema: payload.schema,
    currentFields: payload.currentFields,
    reviewMode: payload.reviewMode,
    defaultConsensus: payload.defaultConsensus,
    fieldOverrides: payload.fieldOverrides,
    aliases: payload.aliases,
  })).digest("base64url");
}

function signingKey(profiles, env) {
  const configured = String(env.CONSENSUS_SNAPSHOT_SECRET || "").trim();
  if (configured) return configured;
  return createHash("sha256")
    .update(`calligraphy-consensus-snapshot\0${profiles.map((profile) => profile.apiKey).join("\0")}`)
    .digest();
}

function signRetryToken(payload, models, snapshotVersion, profiles, env) {
  const body = Buffer.from(JSON.stringify({
    version: 1,
    runId: payload.runId,
    snapshotVersion,
    inputHash: inputHash(payload),
    models,
  })).toString("base64url");
  const signature = createHmac("sha256", signingKey(profiles, env)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyRetryToken(token, payload, profiles, env) {
  const raw = String(token || "");
  if (!raw || raw.length > 1_500_000) throw apiError("重试令牌无效", 409);
  const [body, signature, extra] = raw.split(".");
  if (!body || !signature || extra) throw apiError("重试令牌无效", 409);
  const expected = createHmac("sha256", signingKey(profiles, env)).update(body).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw apiError("重试令牌无效", 409);
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw apiError("重试令牌验签失败", 409);
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw apiError("重试令牌无效", 409);
  }
  if (decoded?.version !== 1 || decoded.runId !== payload.runId || decoded.inputHash !== inputHash(payload) || !Array.isArray(decoded.models)) {
    throw apiError("重试令牌与当前输入不匹配", 409);
  }
  const ids = decoded.models.map((item) => item?.profileId);
  if (decoded.models.length !== 3 || new Set(ids).size !== 3 || profiles.some((profile) => !ids.includes(profile.id))) {
    throw apiError("重试令牌中的模型快照无效", 409);
  }
  return decoded;
}

function normalizeText(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).normalize("NFKC").replace(/[，：；（）。！？【】]/g, (character) => PUNCTUATION.get(character)).replace(/\s+/g, " ").trim();
}

function displayText(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function quoteKey(value) {
  return String(value || "").normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
}

function fieldValue(fieldId, value, aliases = {}) {
  const normalized = normalizeText(value);
  const fieldAliases = aliases?.[fieldId];
  return normalizeText(fieldAliases && typeof fieldAliases === "object" ? fieldAliases[normalized] ?? normalized : normalized);
}

function comparisonKey(fieldId, value, aliases, mode) {
  const normalized = fieldValue(fieldId, value, aliases);
  if (mode === "quote") return quoteKey(normalized);
  if (mode === "script_type") {
    const compact = normalized.replace(/\s+/g, "");
    const expanded = ({ "草": "草书", "行": "行书", "楷": "楷书", "真": "真书", "隶": "隶书", "篆": "篆书" })[compact] || compact;
    const generic = expanded.match(/^(草书|行书|隶书|篆书)\/(?:泛草|泛行|泛隶|泛篆)$/);
    return generic?.[1] || expanded;
  }
  if (mode === "confidence") return normalized.replace(/\s+/g, "").match(/^(待复核|高|中|低)(?:$|[;,/|])/)?.[1] || normalized.replace(/\s+/g, "");
  if (mode === "token_set") return [...new Set(normalized.split(/[,;|/、\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))].sort().join(";");
  return normalized;
}

function normalizeLocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(["page", "paragraph", "item"].flatMap((key) => {
    const normalized = normalizeText(value[key]);
    return normalized ? [[key, normalized]] : [];
  }));
}

function abstainsOn(item, fieldId) {
  return (Array.isArray(item?.abstentions) ? item.abstentions : []).some((entry) => String(entry?.fieldId ?? entry ?? "") === fieldId);
}

function evidenceFor(item, fieldId) {
  if (item?.evidence && !Array.isArray(item.evidence) && typeof item.evidence === "object") return item.evidence[fieldId] || {};
  return (Array.isArray(item?.evidence) ? item.evidence : []).find((entry) => String(entry?.fieldId || "") === fieldId) || {};
}

function countWinner(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0] || ["", 0];
}

function systemFields(payload) {
  const fields = {};
  const blockers = [];
  const current = payload.currentFields && typeof payload.currentFields === "object" ? payload.currentFields : {};
  for (const field of payload.schema.filter((item) => item.validationMode === "system")) {
    const id = String(field.id);
    const supplied = displayText(payload[id]);
    const existing = displayText(current[id]);
    const value = supplied || existing;
    const mismatch = Boolean(supplied && existing && supplied !== existing);
    const accepted = Boolean(value) && !mismatch;
    if (!accepted && (field.required || supplied || existing)) blockers.push(`${id}:blocked`);
    fields[id] = {
      status: accepted ? "unanimous" : "blocked",
      value,
      votes: [],
      voteCount: 0,
      abstentionCount: 0,
      verifiedEvidence: 0,
      evidenceRequired: false,
      policy: "standard",
      reason: accepted ? "system_verified" : mismatch ? "system_mismatch" : "missing_value",
      validationSource: "system",
    };
  }
  return { fields, blockers };
}

function normalizePayload(payload = {}) {
  const runId = String(payload.runId || `run-${crypto.randomUUID().replaceAll("-", "")}`).trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) throw apiError("运行标识无效");
  const sourceText = String(payload.sourceText || "");
  if (!sourceText.trim()) throw apiError("当前条目没有可用原文");
  if (sourceText.length > 40000) throw apiError("原文过长，请先缩小处理范围", 413);
  if (!Array.isArray(payload.schema) || !payload.schema.length || payload.schema.length > 30) throw apiError("字段模板为空或字段过多");
  const ids = new Set();
  const schema = payload.schema.map((raw) => {
    const id = String(raw?.id || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw apiError("字段模板包含无效字段");
    ids.add(id);
    const comparisonMode = String(raw.comparisonMode || "exact");
    if (!COMPARISON_MODES.has(comparisonMode)) throw apiError(`无效比较模式：${comparisonMode}`);
    return { ...raw, id, comparisonMode };
  });
  const reviewMode = String(payload.reviewMode || "assist");
  const defaultConsensus = String(payload.defaultConsensus || "standard");
  if (!REVIEW_MODES.has(reviewMode) || !POLICIES.has(defaultConsensus)) throw apiError("审核策略无效");
  if (payload.aliases != null && (typeof payload.aliases !== "object" || Array.isArray(payload.aliases))) throw apiError("别名表无效");
  if (payload.fieldOverrides != null && (typeof payload.fieldOverrides !== "object" || Array.isArray(payload.fieldOverrides))) throw apiError("字段覆盖策略无效");
  return {
    ...payload,
    runId,
    sourceText,
    schema,
    reviewMode,
    defaultConsensus,
    aliases: payload.aliases || {},
    fieldOverrides: payload.fieldOverrides || {},
    currentFields: payload.currentFields && typeof payload.currentFields === "object" ? payload.currentFields : {},
  };
}

export function evaluateConsensus(payload, models) {
  const schema = payload.schema || [];
  const outputs = models.filter((item) => item.status === "success").map((item) => item.proposal || item);
  const fields = {};
  const blockers = [];
  if (outputs.length !== 3) blockers.push("model_count");

  for (const rawField of schema.filter((field) => field.validationMode !== "system")) {
    const fieldId = String(rawField.id);
    const comparisonMode = String(rawField.comparisonMode || "exact");
    const override = payload.fieldOverrides?.[fieldId];
    const policy = String((override && typeof override === "object" ? override.policy : "") || payload.defaultConsensus || "standard");
    if (!POLICIES.has(policy)) throw apiError(`无效字段共识策略：${policy}`);
    const manualOnly = Boolean(override && typeof override === "object" && override.manualOnly);
    if (manualOnly) blockers.push(`${fieldId}:manual_only`);
    const abstentions = outputs.map((item) => abstainsOn(item, fieldId));
    const displayValues = outputs.map((item, index) => abstentions[index] ? "" : displayText(item?.fields?.[fieldId]));
    const values = outputs.map((item, index) => abstentions[index] ? "" : comparisonKey(fieldId, item?.fields?.[fieldId], payload.aliases, comparisonMode));
    const [winner, winnerCount] = countWinner(values);
    const winnerDisplays = displayValues.filter((value, index) => values[index] === winner && value);
    let winnerDisplay = countWinner(winnerDisplays)[0] || winner;
    const currentDisplay = displayText(payload.currentFields?.[fieldId]);
    if (comparisonMode !== "exact" && currentDisplay && comparisonKey(fieldId, currentDisplay, payload.aliases, comparisonMode) === winner) winnerDisplay = currentDisplay;
    const evidence = outputs.map((item, index) => abstentions[index] ? {} : evidenceFor(item, fieldId));
    const verified = evidence.filter((item) => Boolean(item.verified)).length;
    const quotes = evidence.map((item) => quoteKey(item.quote));
    const locations = evidence.map((item) => normalizeLocation(item.location));
    const abstentionCount = abstentions.filter(Boolean).length;
    const abstained = abstentionCount > 0;
    const unanimous = outputs.length === 3 && Boolean(winner) && winnerCount === 3 && !abstained;
    const evidenceRequired = Boolean(rawField.evidenceRequired) && fieldId !== "confidence" && comparisonMode !== "confidence";
    const sameLocations = locations.every((item) => Object.keys(item).length && JSON.stringify(item) === JSON.stringify(locations[0]));
    const evidencePasses = !evidenceRequired || policy === "loose" || (policy === "standard" && verified >= 1) || (policy === "strict" && verified === 3 && quotes.every(Boolean) && new Set(quotes).size === 1 && sameLocations);
    const accepted = unanimous && evidencePasses;
    const status = accepted ? "unanimous" : winnerCount === 2 && !abstained ? "split" : "blocked";
    const reason = accepted ? "accepted" : abstained ? "abstention" : outputs.length !== 3 ? "model_count" : !winner ? "missing_value" : winnerCount < 3 ? "disagreement" : !evidencePasses ? "insufficient_evidence" : "rule_failure";
    const blocking = comparisonMode !== "advisory";
    if (!accepted && blocking && (rawField.required || winner)) blockers.push(`${fieldId}:${status}`);
    fields[fieldId] = { status, value: winnerDisplay, votes: displayValues, voteCount: winnerCount, abstentionCount, verifiedEvidence: verified, evidenceRequired, policy, reason, comparisonMode, blocking };
  }

  const system = systemFields(payload);
  Object.assign(fields, system.fields);
  blockers.push(...system.blockers);
  if (outputs.length !== 3 && !blockers.includes("model_failure")) blockers.push("model_failure");
  const families = new Set(models.filter((item) => item.status === "success").map((item) => normalizeText(item.profile?.modelFamily)).filter(Boolean));
  if (payload.reviewMode === "auto" && families.size < 2) blockers.push("model_family_diversity");
  const decision = payload.reviewMode === "auto" && outputs.length === 3 && blockers.length === 0
    ? "auto_approve_record"
    : payload.reviewMode !== "auto" && Object.values(fields).some((item) => item.status === "unanimous")
      ? "adopt_fields"
      : "needs_human_review";
  return { fields, blockers: [...new Set(blockers)], decision };
}

async function executeModel(payload, profile, fetcher) {
  const startedAt = Date.now();
  try {
    const modelSchema = payload.schema.filter((field) => field.validationMode !== "system");
    const result = await runExtraction({ ...payload, schema: modelSchema }, { ...profile, fetcher });
    return {
      profileId: profile.id,
      status: "success",
      profile: publicModelProfile(profile),
      proposal: result.proposal,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      profileId: profile.id,
      status: "error",
      profile: publicModelProfile(profile),
      error: error?.message || "模型调用失败",
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export async function runConsensus(rawPayload, options = {}) {
  const payload = normalizePayload(rawPayload);
  const env = options.env || process.env;
  const profiles = activeModelProfiles(env);
  if (profiles.length !== 3) throw apiError("三模型共识尚未完整配置", 503);
  const startedAt = new Date().toISOString();
  let models;
  let snapshotVersion = 1;
  if (options.retryProfileId) {
    const profile = profiles.find((item) => item.id === options.retryProfileId);
    if (!profile) throw apiError("重试模型无效");
    const verified = verifyRetryToken(options.retryToken, payload, profiles, env);
    models = verified.models;
    const replacement = await executeModel(payload, profile, options.fetcher);
    const index = models.findIndex((item) => item.profileId === profile.id);
    if (index < 0) throw apiError("重试快照中缺少目标模型", 409);
    models[index] = replacement;
    snapshotVersion = Number(verified.snapshotVersion || 1) + 1;
  } else {
    models = await Promise.all(profiles.map((profile) => executeModel(payload, profile, options.fetcher)));
  }
  const consensus = evaluateConsensus(payload, models);
  return {
    runId: payload.runId,
    status: "complete",
    startedAt,
    completedAt: new Date().toISOString(),
    snapshotVersion,
    retryToken: signRetryToken(payload, models, snapshotVersion, profiles, env),
    models,
    ...consensus,
  };
}

const PROFILE_SLOTS = ["primary", "secondary", "tertiary"];
const REVIEW_MODES = new Set(["assist", "auto"]);
const CONSENSUS_POLICIES = new Set(["loose", "standard", "strict"]);

function clean(value, maxLength = 10000) {
  return String(value || "").trim().slice(0, maxLength);
}

function enabled(value) {
  return !["0", "false", "no", "off"].includes(clean(value).toLowerCase());
}

function safeApiUrl(value) {
  const raw = clean(value, 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function inferModelFamily(model) {
  const value = clean(model, 200).toLowerCase();
  if (!value) return "unknown";
  return value.split(/[/:]/)[0].split("-")[0] || "unknown";
}

function normalizePolicy(raw = {}, env = {}) {
  const reviewMode = clean(raw.reviewMode || env.MODEL_REVIEW_MODE || "assist");
  const defaultConsensus = clean(raw.defaultConsensus || env.MODEL_DEFAULT_CONSENSUS || "standard");
  const fieldOverrides = raw.fieldOverrides && typeof raw.fieldOverrides === "object" && !Array.isArray(raw.fieldOverrides)
    ? raw.fieldOverrides
    : {};
  return {
    reviewMode: REVIEW_MODES.has(reviewMode) ? reviewMode : "assist",
    defaultConsensus: CONSENSUS_POLICIES.has(defaultConsensus) ? defaultConsensus : "standard",
    fieldOverrides,
  };
}

function jsonBundle(env) {
  const raw = clean(env.MODEL_PROFILES_JSON, 50000);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? { profiles: parsed, policy: {} } : parsed;
  } catch {
    return null;
  }
}

function profileFromEnv(slot, env) {
  const prefix = `MODEL_${slot.toUpperCase()}`;
  const legacy = slot === "primary";
  const model = clean(env[`${prefix}_NAME`] || (legacy ? env.MODEL_NAME : ""), 200);
  const apiUrl = safeApiUrl(env[`${prefix}_API_URL`] || (legacy ? env.MODEL_API_URL : ""));
  const apiKey = clean(env[`${prefix}_API_KEY`] || (legacy ? env.MODEL_API_KEY : ""));
  if (!apiUrl || !apiKey || !model || !enabled(env[`${prefix}_ENABLED`])) return null;
  return {
    id: slot,
    displayName: clean(env[`${prefix}_DISPLAY_NAME`] || model, 200),
    apiUrl,
    apiKey,
    model,
    modelFamily: clean(env[`${prefix}_FAMILY`] || inferModelFamily(model), 200),
    enabled: true,
  };
}

function normalizeProfile(raw, fallbackId) {
  if (!raw || typeof raw !== "object" || !enabled(raw.enabled)) return null;
  const id = clean(raw.id || fallbackId, 30);
  const apiUrl = safeApiUrl(raw.apiUrl);
  const apiKey = clean(raw.apiKey);
  const model = clean(raw.model, 200);
  if (!PROFILE_SLOTS.includes(id) || !apiUrl || !apiKey || !model) return null;
  return {
    id,
    displayName: clean(raw.displayName || model, 200),
    apiUrl,
    apiKey,
    model,
    modelFamily: clean(raw.modelFamily || inferModelFamily(model), 200),
    enabled: true,
  };
}

export function activeModelProfiles(env = process.env) {
  const bundle = jsonBundle(env);
  const profiles = bundle?.profiles;
  if (Array.isArray(profiles)) {
    const candidates = profiles
      .slice(0, PROFILE_SLOTS.length)
      .map((profile, index) => normalizeProfile(profile, PROFILE_SLOTS[index]))
      .filter(Boolean);
    const seen = new Set();
    const normalized = candidates.filter((profile) => {
      if (seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });
    if (normalized.length) return normalized;
  }
  return PROFILE_SLOTS.map((slot) => profileFromEnv(slot, env)).filter(Boolean);
}

export function publicModelProfile(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    apiUrl: profile.apiUrl,
    model: profile.model,
    modelFamily: profile.modelFamily,
    enabled: true,
    configured: true,
    source: "environment",
    keyHint: profile.apiKey.slice(-4),
    lastTestedAt: "",
    latencyMs: 0,
    health: "unknown",
  };
}

export function publicModelConfig(env = process.env) {
  const bundle = jsonBundle(env);
  const profiles = activeModelProfiles(env).map(publicModelProfile);
  const active = profiles[0];
  return {
    supported: false,
    configured: Boolean(active),
    profiles,
    policy: normalizePolicy(bundle?.policy, env),
    source: active?.source || "none",
    apiUrl: active?.apiUrl || "",
    model: active?.model || "",
    keyHint: active?.keyHint || "",
  };
}

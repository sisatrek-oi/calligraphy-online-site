import { activeModelProfiles } from "./_model-config.js";

export function healthPayload(env = process.env) {
  const profiles = activeModelProfiles(env);
  const cloudConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  const cloudEnabled = env.CLOUD_SYNC_ENABLED ? env.CLOUD_SYNC_ENABLED === "true" : cloudConfigured;
  return {
    ok: true,
    service: "calligraphy-workspace",
    runtime: "vercel-node",
    capabilities: {
      cloudSync: cloudConfigured && cloudEnabled,
      ai: profiles.length > 0,
      consensus: profiles.length === 3,
      ancientIngest: false,
    },
  };
}

export default function handler(request, response) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).json({ error: "method not allowed" });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(200).json(healthPayload());
}

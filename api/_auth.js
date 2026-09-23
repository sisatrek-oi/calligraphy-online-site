function apiError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function isAiAuthRequired(env = process.env) {
  if (env.AI_AUTH_REQUIRED != null) return String(env.AI_AUTH_REQUIRED).toLowerCase() !== "false";
  return env.VERCEL === "1" || Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

function bearerToken(request) {
  const header = String(request?.headers?.get?.("authorization") || request?.headers?.authorization || request?.headers?.Authorization || "");
  const match = header.match(/^Bearer\s+([^\s]{20,10000})$/i);
  return match?.[1] || "";
}

export async function requireAiAccess(request, payload, options = {}) {
  const env = options.env || process.env;
  if (!isAiAuthRequired(env)) return { authenticated: false };
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anonKey = String(env.SUPABASE_ANON_KEY || "");
  if (!supabaseUrl || !anonKey) throw apiError("AI 鉴权尚未完整配置", 503);
  const token = bearerToken(request);
  if (!token) throw apiError("请先登录后使用 AI", 401);
  const fetcher = options.fetcher || fetch;
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` };
  const userResponse = await fetcher(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw apiError("登录会话无效或已过期", 401);
  const user = await userResponse.json().catch(() => ({}));
  if (!user?.id) throw apiError("登录会话无效或已过期", 401);

  const workspaceId = String(payload?.cloudWorkspaceId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw apiError("缺少可授权的云端工作区", 403);
  const url = new URL(`${supabaseUrl}/rest/v1/workspaces`);
  url.searchParams.set("id", `eq.${workspaceId}`);
  url.searchParams.set("select", "id,team_id");
  url.searchParams.set("limit", "1");
  const workspaceResponse = await fetcher(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!workspaceResponse.ok) throw apiError("无法验证工作区权限", workspaceResponse.status === 401 ? 401 : 403);
  const rows = await workspaceResponse.json().catch(() => []);
  const workspace = Array.isArray(rows) ? rows.find((row) => row?.id === workspaceId) : null;
  if (!workspace?.team_id) throw apiError("无权访问该工作区", 403);

  const membershipUrl = new URL(`${supabaseUrl}/rest/v1/team_members`);
  membershipUrl.searchParams.set("team_id", `eq.${workspace.team_id}`);
  membershipUrl.searchParams.set("user_id", `eq.${user.id}`);
  membershipUrl.searchParams.set("select", "role");
  membershipUrl.searchParams.set("limit", "1");
  const membershipResponse = await fetcher(membershipUrl, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!membershipResponse.ok) throw apiError("无法验证团队角色", membershipResponse.status === 401 ? 401 : 403);
  const memberships = await membershipResponse.json().catch(() => []);
  const role = Array.isArray(memberships) ? memberships[0]?.role : "";
  if (!["reviewer", "editor", "admin", "owner"].includes(role)) throw apiError("当前团队角色无权使用 AI", 403);
  return { authenticated: true, userId: user.id, workspaceId };
}

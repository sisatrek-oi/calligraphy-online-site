function publicCloudConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  const explicitEnabled = process.env.CLOUD_SYNC_ENABLED;
  const enabled = explicitEnabled ? explicitEnabled === "true" : Boolean(supabaseUrl && supabaseAnonKey);

  return {
    enabled,
    aiEnabled: Boolean(process.env.MODEL_API_URL && process.env.MODEL_API_KEY && process.env.MODEL_NAME),
    supabaseUrl,
    supabaseAnonKey,
    rememberEmail: process.env.REMEMBER_EMAIL_ENABLED !== "false",
    defaultTeamName: process.env.DEFAULT_TEAM_NAME || "书论研究团队",
    defaultProjectName: process.env.DEFAULT_PROJECT_NAME || "书论整理项目",
    defaultWorkspaceName: process.env.DEFAULT_WORKSPACE_NAME || "书论统一主表",
  };
}

export default function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(200).json(publicCloudConfig());
}

import { activeModelProfiles } from "./_model-config.js";
import { isAiAuthRequired } from "./_auth.js";

export function publicCloudConfig(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || "";
  const supabaseAnonKey = env.SUPABASE_ANON_KEY || "";
  const explicitEnabled = env.CLOUD_SYNC_ENABLED;
  const enabled = explicitEnabled ? explicitEnabled === "true" : Boolean(supabaseUrl && supabaseAnonKey);
  const modelProfiles = activeModelProfiles(env);

  return {
    enabled,
    aiEnabled: modelProfiles.length > 0,
    aiAuthRequired: isAiAuthRequired(env),
    consensusEnabled: modelProfiles.length === 3,
    ancientIngestEnabled: false,
    supabaseUrl,
    supabaseAnonKey,
    rememberEmail: env.REMEMBER_EMAIL_ENABLED !== "false",
    defaultTeamName: env.DEFAULT_TEAM_NAME || "书论研究团队",
    defaultProjectName: env.DEFAULT_PROJECT_NAME || "书论整理项目",
    defaultWorkspaceName: env.DEFAULT_WORKSPACE_NAME || "书论统一主表",
  };
}

export default function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(200).json(publicCloudConfig());
}

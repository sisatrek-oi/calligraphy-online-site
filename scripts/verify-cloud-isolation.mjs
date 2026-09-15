import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve("supabase/migrations/20260903094500_cloud_collaboration_isolation.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

const tables = [
  "profiles",
  "teams",
  "team_members",
  "team_invites",
  "projects",
  "workspaces",
  "materials",
  "source_pages",
  "review_rows",
  "review_events",
  "annotations",
  "search_logs"
];

const functions = [
  "current_team_role",
  "is_team_member",
  "can_manage_team",
  "can_edit_workspace",
  "can_review_workspace",
  "create_team_with_owner",
  "accept_team_invite"
];

const failures = [];

for (const table of tables) {
  if (!new RegExp(`create table if not exists public\\.${table}\\b`, "i").test(sql)) {
    failures.push(`missing table: ${table}`);
  }
  if (!new RegExp(`alter table public\\.${table} enable row level security`, "i").test(sql)) {
    failures.push(`missing RLS enable: ${table}`);
  }
  if (!new RegExp(`create policy "[^"]+" on public\\.${table}\\b`, "i").test(sql)) {
    failures.push(`missing policy: ${table}`);
  }
}

for (const fn of functions) {
  if (!new RegExp(`create or replace function public\\.${fn}\\b`, "i").test(sql)) {
    failures.push(`missing function: ${fn}`);
  }
}

const requiredFragments = [
  "team_id uuid not null",
  "project_id uuid not null",
  "workspace_id uuid not null",
  "created_by uuid not null",
  "external_row_id text",
  "external_annotation_id text",
  "role public.member_role",
  "lower(email) = lower(auth.jwt() ->> 'email')",
  "public.can_review_workspace(team_id)",
  "public.can_edit_workspace(team_id)"
];

for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) failures.push(`missing fragment: ${fragment}`);
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`cloud isolation migration ok: ${tables.length} tables, ${functions.length} functions`);

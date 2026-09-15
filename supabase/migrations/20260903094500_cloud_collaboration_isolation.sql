-- Cloud collaboration isolation for the calligraphy workspace.
-- Target: Supabase Postgres with auth.uid() and Row Level Security enabled.

create extension if not exists pgcrypto;

do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'editor', 'reviewer', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.workspace_status as enum ('active', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'confirmed', 'edited', 'flagged', 'deleted');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'viewer',
  invited_by uuid references public.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'reviewer',
  status text not null default 'pending',
  invited_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (team_id, email)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  description text not null default '',
  status public.workspace_status not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  schema_template_id text not null default 'calligraphy-style',
  schema_version integer not null default 1,
  prompt_version integer not null default 1,
  status public.workspace_status not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  material_type text not null default 'csv',
  storage_path text,
  row_count integer not null default 0,
  checksum text,
  imported_by uuid not null references public.profiles(id),
  imported_at timestamptz not null default now()
);

create table if not exists public.source_pages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  source_file text not null,
  page_no text,
  body text not null default '',
  storage_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, source_file)
);

create table if not exists public.review_rows (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  external_row_id text,
  row_number integer,
  appendix text not null default '',
  bucket text not null default 'review',
  triage_status text not null default '',
  review_status public.review_status not null default 'pending',
  flagged boolean not null default false,
  abnormal boolean not null default false,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  fields jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  source_file text,
  page_no text,
  quote text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_row_id)
);

create table if not exists public.review_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  row_id uuid references public.review_rows(id) on delete cascade,
  event_type text not null,
  actor_id uuid not null references public.profiles(id),
  reason text not null default '',
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.annotations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  row_id uuid not null references public.review_rows(id) on delete cascade,
  external_annotation_id text,
  annotation_type text not null default 'other',
  field_id text,
  body text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (row_id, external_annotation_id)
);

create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  row_id uuid references public.review_rows(id) on delete set null,
  query text not null,
  provider text not null default 'duckduckgo',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_team_members_user on public.team_members(user_id, team_id);
create index if not exists idx_team_invites_email on public.team_invites(lower(email), status);
create index if not exists idx_projects_team on public.projects(team_id);
create index if not exists idx_workspaces_project on public.workspaces(project_id);
create index if not exists idx_materials_workspace on public.materials(workspace_id);
create index if not exists idx_source_pages_workspace on public.source_pages(workspace_id);
create index if not exists idx_review_rows_workspace on public.review_rows(workspace_id, review_status);
create index if not exists idx_review_rows_fields on public.review_rows using gin(fields);
create index if not exists idx_review_events_row on public.review_events(row_id, created_at desc);
create index if not exists idx_annotations_row on public.annotations(row_id, created_at desc);

create or replace function public.current_team_role(target_team_id uuid)
returns public.member_role
language sql
security definer
set search_path = public
stable
as $$
  select tm.role
  from public.team_members tm
  where tm.team_id = target_team_id
    and tm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_team_role(target_team_id) is not null
$$;

create or replace function public.can_manage_team(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_team_role(target_team_id) in ('owner', 'admin')
$$;

create or replace function public.can_edit_workspace(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_team_role(target_team_id) in ('owner', 'admin', 'editor')
$$;

create or replace function public.can_review_workspace(target_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_team_role(target_team_id) in ('owner', 'admin', 'editor', 'reviewer')
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.set_actor_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by = auth.uid();
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.create_team_with_owner(team_name text, display_name text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_team_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, coalesce(nullif(display_name, ''), split_part(current_user_id::text, '-', 1)))
  on conflict (id) do update
    set display_name = coalesce(nullif(excluded.display_name, ''), public.profiles.display_name);

  insert into public.teams (name, created_by)
  values (coalesce(nullif(team_name, ''), '书论研究团队'), current_user_id)
  returning id into new_team_id;

  insert into public.team_members (team_id, user_id, role, invited_by)
  values (new_team_id, current_user_id, 'owner', current_user_id);

  return new_team_id;
end
$$;

grant execute on function public.create_team_with_owner(text, text) to authenticated;

create or replace function public.accept_team_invite(invite_id uuid, display_name text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(auth.jwt() ->> 'email');
  invite record;
begin
  if current_user_id is null or current_email is null then
    raise exception 'Authentication required';
  end if;

  select *
  into invite
  from public.team_invites
  where id = invite_id
    and lower(email) = current_email
    and status = 'pending'
  limit 1;

  if invite.id is null then
    raise exception 'No pending invite for current user';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, coalesce(nullif(display_name, ''), split_part(current_email, '@', 1)))
  on conflict (id) do update
    set display_name = coalesce(nullif(excluded.display_name, ''), public.profiles.display_name);

  insert into public.team_members (team_id, user_id, role, invited_by)
  values (invite.team_id, current_user_id, invite.role, invite.invited_by)
  on conflict (team_id, user_id) do update
    set role = excluded.role;

  update public.team_invites
  set status = 'accepted',
      accepted_by = current_user_id,
      accepted_at = now()
  where id = invite.id;

  return invite.team_id;
end
$$;

grant execute on function public.accept_team_invite(uuid, text) to authenticated;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists trg_teams_touch on public.teams;
create trigger trg_teams_touch before update on public.teams
for each row execute function public.touch_updated_at();

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects
for each row execute function public.touch_updated_at();

drop trigger if exists trg_workspaces_touch on public.workspaces;
create trigger trg_workspaces_touch before update on public.workspaces
for each row execute function public.touch_updated_at();

drop trigger if exists trg_review_rows_actor on public.review_rows;
create trigger trg_review_rows_actor before insert or update on public.review_rows
for each row execute function public.set_actor_fields();

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.projects enable row level security;
alter table public.workspaces enable row level security;
alter table public.materials enable row level security;
alter table public.source_pages enable row level security;
alter table public.review_rows enable row level security;
alter table public.review_events enable row level security;
alter table public.annotations enable row level security;
alter table public.search_logs enable row level security;

drop policy if exists "profiles read own or team peers" on public.profiles;
create policy "profiles read own or team peers" on public.profiles
for select using (
  id = auth.uid()
  or exists (
    select 1
    from public.team_members mine
    join public.team_members peer on peer.team_id = mine.team_id
    where mine.user_id = auth.uid()
      and peer.user_id = profiles.id
  )
);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "teams read member" on public.teams;
create policy "teams read member" on public.teams
for select using (public.is_team_member(id));

drop policy if exists "teams insert owner" on public.teams;
create policy "teams insert owner" on public.teams
for insert with check (created_by = auth.uid());

drop policy if exists "teams update manager" on public.teams;
create policy "teams update manager" on public.teams
for update using (public.can_manage_team(id)) with check (public.can_manage_team(id));

drop policy if exists "team members read member" on public.team_members;
create policy "team members read member" on public.team_members
for select using (public.is_team_member(team_id));

drop policy if exists "team members insert manager" on public.team_members;
create policy "team members insert manager" on public.team_members
for insert with check (public.can_manage_team(team_id));

drop policy if exists "team members update manager" on public.team_members;
create policy "team members update manager" on public.team_members
for update using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

drop policy if exists "team members delete manager" on public.team_members;
create policy "team members delete manager" on public.team_members
for delete using (public.can_manage_team(team_id));

drop policy if exists "team invites read manager or invited" on public.team_invites;
create policy "team invites read manager or invited" on public.team_invites
for select using (
  public.can_manage_team(team_id)
  or lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "team invites insert manager" on public.team_invites;
create policy "team invites insert manager" on public.team_invites
for insert with check (public.can_manage_team(team_id) and invited_by = auth.uid());

drop policy if exists "team invites update manager or invited" on public.team_invites;
create policy "team invites update manager or invited" on public.team_invites
for update using (
  public.can_manage_team(team_id)
  or lower(email) = lower(auth.jwt() ->> 'email')
) with check (
  public.can_manage_team(team_id)
  or lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "projects read member" on public.projects;
create policy "projects read member" on public.projects
for select using (public.is_team_member(team_id));

drop policy if exists "projects insert manager" on public.projects;
create policy "projects insert manager" on public.projects
for insert with check (public.can_manage_team(team_id) and created_by = auth.uid());

drop policy if exists "projects update manager" on public.projects;
create policy "projects update manager" on public.projects
for update using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));

drop policy if exists "workspaces read member" on public.workspaces;
create policy "workspaces read member" on public.workspaces
for select using (public.is_team_member(team_id));

drop policy if exists "workspaces insert editor" on public.workspaces;
create policy "workspaces insert editor" on public.workspaces
for insert with check (public.can_edit_workspace(team_id) and created_by = auth.uid());

drop policy if exists "workspaces update editor" on public.workspaces;
create policy "workspaces update editor" on public.workspaces
for update using (public.can_edit_workspace(team_id)) with check (public.can_edit_workspace(team_id));

drop policy if exists "materials read member" on public.materials;
create policy "materials read member" on public.materials
for select using (public.is_team_member(team_id));

drop policy if exists "materials insert editor" on public.materials;
create policy "materials insert editor" on public.materials
for insert with check (public.can_edit_workspace(team_id) and imported_by = auth.uid());

drop policy if exists "materials update editor" on public.materials;
create policy "materials update editor" on public.materials
for update using (public.can_edit_workspace(team_id)) with check (public.can_edit_workspace(team_id));

drop policy if exists "source pages read member" on public.source_pages;
create policy "source pages read member" on public.source_pages
for select using (public.is_team_member(team_id));

drop policy if exists "source pages insert editor" on public.source_pages;
create policy "source pages insert editor" on public.source_pages
for insert with check (public.can_edit_workspace(team_id) and created_by = auth.uid());

drop policy if exists "source pages update editor" on public.source_pages;
create policy "source pages update editor" on public.source_pages
for update using (public.can_edit_workspace(team_id)) with check (public.can_edit_workspace(team_id));

drop policy if exists "review rows read member" on public.review_rows;
create policy "review rows read member" on public.review_rows
for select using (public.is_team_member(team_id));

drop policy if exists "review rows insert editor" on public.review_rows;
create policy "review rows insert editor" on public.review_rows
for insert with check (public.can_edit_workspace(team_id));

drop policy if exists "review rows update reviewer" on public.review_rows;
create policy "review rows update reviewer" on public.review_rows
for update using (public.can_review_workspace(team_id)) with check (public.can_review_workspace(team_id));

drop policy if exists "review events read member" on public.review_events;
create policy "review events read member" on public.review_events
for select using (public.is_team_member(team_id));

drop policy if exists "review events insert reviewer" on public.review_events;
create policy "review events insert reviewer" on public.review_events
for insert with check (public.can_review_workspace(team_id) and actor_id = auth.uid());

drop policy if exists "annotations read member" on public.annotations;
create policy "annotations read member" on public.annotations
for select using (public.is_team_member(team_id));

drop policy if exists "annotations insert reviewer" on public.annotations;
create policy "annotations insert reviewer" on public.annotations
for insert with check (public.can_review_workspace(team_id) and created_by = auth.uid());

drop policy if exists "annotations update author or editor" on public.annotations;
create policy "annotations update author or editor" on public.annotations
for update using (created_by = auth.uid() or public.can_edit_workspace(team_id))
with check (created_by = auth.uid() or public.can_edit_workspace(team_id));

drop policy if exists "search logs read member" on public.search_logs;
create policy "search logs read member" on public.search_logs
for select using (public.is_team_member(team_id));

drop policy if exists "search logs insert member" on public.search_logs;
create policy "search logs insert member" on public.search_logs
for insert with check (public.is_team_member(team_id) and created_by = auth.uid());

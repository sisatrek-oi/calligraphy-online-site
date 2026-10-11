-- Apply after 20260903094500_cloud_collaboration_isolation.sql.
-- An invited user may read their invite, but only a team manager may change it.
-- accept_team_invite() is SECURITY DEFINER and remains the sole invite-accept path.
drop policy if exists "team invites update manager or invited" on public.team_invites;
drop policy if exists "team invites update manager" on public.team_invites;
create policy "team invites update manager" on public.team_invites
for update using (public.can_manage_team(team_id))
with check (public.can_manage_team(team_id));

-- An editor must not forge the author or attach a row to unrelated project IDs.
drop policy if exists "review rows insert editor" on public.review_rows;
create policy "review rows insert editor" on public.review_rows
for insert with check (
  public.can_edit_workspace(team_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.workspaces w
    where w.id = workspace_id
      and w.team_id = review_rows.team_id
      and w.project_id = review_rows.project_id
  )
);

-- Reviewers may change content/status, never the row's ownership or lineage.
create or replace function public.protect_review_row_identity()
returns trigger
language plpgsql
as $$
begin
  -- Existing bulk upserts include created_by for inserts; preserve the original actor on conflict.
  new.created_by := old.created_by;
  if new.id is distinct from old.id
    or new.team_id is distinct from old.team_id
    or new.project_id is distinct from old.project_id
    or new.workspace_id is distinct from old.workspace_id
    or new.external_row_id is distinct from old.external_row_id
    or new.created_at is distinct from old.created_at then
    raise exception 'review row identity is immutable' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists trg_review_rows_identity on public.review_rows;
create trigger trg_review_rows_identity before update on public.review_rows
for each row execute function public.protect_review_row_identity();

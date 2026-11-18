-- Planner reliability overhaul (docs/navi-1.5/PLANNER_RELIABILITY.md).
-- LOCAL FIRST: do not apply to hosted without the owner's OK. Additive and
-- idempotent: nothing is dropped or rewritten except the two change-set
-- functions, which keep the exact old behaviour for change sets made before
-- this migration (their ops and `base` check are unchanged). Used only by
-- accounts with profiles.preferences.planner_commands = true (on top of
-- planner_v2); everyone else runs as before.
-- Rollback: supabase/rollback/20261117000001_planner_commands_down.sql
-- restores the previous function bodies and trigger list (tables/columns stay).
--
--  1. day_plan_scope: per-day task scope (only these / also these / not these).
--  2. tasks.estimate_source: who set the estimate (the person's own number is
--     never scaled by the learned ratio).
--  3. plan_blocks.placement (auto / requested / manual), session_id/title
--     (grouped work sessions; each task keeps its own block).
--  4. plan_changesets: command, impact, postconditions, verification,
--     base_version (stale check over every planning input), idempotency_key,
--     conversation_id, offered.
--  5. planning_rules: learned / stated planning preferences with scope,
--     source and confidence.
--  6. accountability_checks: one challenge per decision, then respected.
--  7. plan_inputs_version(): a fingerprint of everything a plan depends on.
--  8. apply/revert_plan_changeset: new op kinds (move, remove, scope, exception)
--     and the base_version check.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.day_plan_scope (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  mode text not null check (mode in ('only','include','exclude')),
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date, task_id)
);
create index if not exists day_plan_scope_user_date on public.day_plan_scope (user_id, date);

-- 2 ---------------------------------------------------------------------------
alter table public.tasks add column if not exists estimate_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_estimate_source_check') then
    alter table public.tasks add constraint tasks_estimate_source_check check (estimate_source is null or estimate_source in ('user','ai','import','default'));
  end if;
end $$;

-- 3 ---------------------------------------------------------------------------
alter table public.plan_blocks add column if not exists placement text not null default 'auto';
alter table public.plan_blocks add column if not exists session_id uuid;
alter table public.plan_blocks add column if not exists session_title text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'plan_blocks_placement_check') then
    alter table public.plan_blocks add constraint plan_blocks_placement_check check (placement in ('auto','requested','manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plan_blocks_session_title_check') then
    alter table public.plan_blocks add constraint plan_blocks_session_title_check check (session_title is null or length(session_title) <= 200);
  end if;
end $$;
create index if not exists plan_blocks_session on public.plan_blocks (user_id, session_id) where session_id is not null;
-- Backfill = today's meaning: the person's own blocks are manual; blocks Navi
-- pinned at their request are requested.
update public.plan_blocks set placement = 'manual' where created_by = 'user' and placement = 'auto';
update public.plan_blocks set placement = 'requested' where created_by = 'navi' and pinned and placement = 'auto';

-- 4 ---------------------------------------------------------------------------
alter table public.plan_changesets add column if not exists idempotency_key text;
alter table public.plan_changesets add column if not exists base_version text;
alter table public.plan_changesets add column if not exists command jsonb;
alter table public.plan_changesets add column if not exists impact jsonb;
alter table public.plan_changesets add column if not exists postconditions jsonb not null default '[]'::jsonb;
alter table public.plan_changesets add column if not exists verification jsonb;
alter table public.plan_changesets add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
alter table public.plan_changesets add column if not exists offered boolean not null default false;
create unique index if not exists plan_changesets_idempotency on public.plan_changesets (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists plan_changesets_offers on public.plan_changesets (user_id, conversation_id) where status = 'proposed';
alter table public.plan_changesets drop constraint if exists plan_changesets_trigger_check;
alter table public.plan_changesets add constraint plan_changesets_trigger_check
  check (trigger in ('button','chat','voice','tick','recovery','event_change','overrun','onboarding','command','manual'));

-- 5 ---------------------------------------------------------------------------
create table if not exists public.planning_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('estimate_scale','daily_load_cap')),
  scope text not null default 'global' check (scope in ('task','project','workspace','global')),
  scope_id uuid,
  params jsonb not null default '{}'::jsonb,
  source text not null check (source in ('stated','inferred','observed')),
  confidence numeric(3,2) not null default 1 check (confidence between 0 and 1),
  -- suggested = inferred and not yet confirmed by the person: never applied.
  status text not null default 'active' check (status in ('active','suggested','paused')),
  note text check (note is null or length(note) <= 300),
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'global') = (scope_id is null))
);
create index if not exists planning_rules_user on public.planning_rules (user_id, status);

-- 6 ---------------------------------------------------------------------------
create table if not exists public.accountability_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  decision text not null check (decision in ('postpone','unschedule','exclude','lower')),
  context_key text not null,
  challenge text not null check (length(challenge) <= 600),
  status text not null default 'challenged' check (status in ('challenged','reaffirmed','changed')),
  user_reason text check (user_reason is null or length(user_reason) <= 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, context_key)
);

-- RLS, grants, updated_at for the new tables ---------------------------------
do $$
declare t text;
begin
  foreach t in array array['day_plan_scope','planning_rules','accountability_checks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
  end loop;
end $$;

-- 7 ---------------------------------------------------------------------------
-- A fingerprint of everything a plan for these dates is worked out from:
-- the day's blocks, events and one-session changes, routines, one-day facts,
-- scope, open tasks. A preview stores it; applying recomputes it under the
-- lock, so a change made in between (an event added, a block placed by hand,
-- a task edited) makes the preview stale instead of silently overriding it.
-- Runs with the caller's rights: under RLS a person only sees their own rows.
create or replace function public.plan_inputs_version(p_user uuid, p_dates date[])
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select md5(concat_ws('|',
    (select string_agg(concat_ws(',', id, starts_at, ends_at, status, pinned, placement, session_id, is_flexible), ';' order by id)
       from public.plan_blocks where user_id = p_user and plan_date = any(p_dates)),
    (select string_agg(concat_ws(',', id, updated_at, status), ';' order by id) from public.events where user_id = p_user),
    (select string_agg(concat_ws(',', id, updated_at), ';' order by id) from public.event_occurrence_overrides where user_id = p_user and occurrence_date = any(p_dates)),
    (select string_agg(concat_ws(',', id, updated_at, active), ';' order by id) from public.routines where user_id = p_user),
    (select string_agg(concat_ws(',', id, updated_at), ';' order by id) from public.day_exceptions where user_id = p_user and date = any(p_dates)),
    (select string_agg(concat_ws(',', id, mode, updated_at), ';' order by id) from public.day_plan_scope where user_id = p_user and date = any(p_dates)),
    (select string_agg(concat_ws(',', id, updated_at, status), ';' order by id) from public.tasks where user_id = p_user and status in ('todo','in_progress','blocked'))
  ));
$$;
revoke execute on function public.plan_inputs_version(uuid, date[]) from public, anon;
grant execute on function public.plan_inputs_version(uuid, date[]) to authenticated, service_role;

-- 8 ---------------------------------------------------------------------------
create or replace function public.apply_plan_changeset(p_changeset uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  cs public.plan_changesets;
  op jsonb;
  b jsonb;
  n int;
  current_ids jsonb;
  cur text;
begin
  select * into cs from public.plan_changesets where id = p_changeset for update;
  if not found then raise exception 'NAVI_NOT_FOUND: that plan change was not found'; end if;
  if cs.status <> 'proposed' then raise exception 'NAVI_STALE: that plan change is already %', cs.status; end if;
  perform pg_advisory_xact_lock(hashtextextended(cs.user_id::text || ':plan', 0));

  if cs.base_version is not null then
    -- Everything the plan was worked out from must still be the same.
    if public.plan_inputs_version(cs.user_id, cs.dates) is distinct from cs.base_version then
      raise exception 'NAVI_STALE: the plan or something it depends on changed since this was worked out';
    end if;
  else
    -- Change sets made before 20261117: Navi's own open blocks only (unchanged).
    select coalesce(jsonb_agg(to_jsonb(id::text) order by id::text), '[]'::jsonb) into current_ids
    from public.plan_blocks
    where user_id = cs.user_id and plan_date = any(cs.dates) and is_flexible and created_by = 'navi'
      and status = 'planned' and not pinned;
    if current_ids <> (select coalesce(jsonb_agg(x order by x #>> '{}'), '[]'::jsonb) from jsonb_array_elements(cs.base) x) then
      raise exception 'NAVI_STALE: the plan changed since this was worked out';
    end if;
  end if;

  for op in select value from jsonb_array_elements(cs.ops) loop
    if op->>'op' = 'insert' then
      b := op->'block';
      insert into public.plan_blocks (id, user_id, task_id, routine_id, title, plan_date, starts_at, ends_at, is_flexible, status, created_by, reason, basis, assumption, changeset_id, pinned, placement, session_id, session_title)
      values ((b->>'id')::uuid, cs.user_id, (b->>'task_id')::uuid, (b->>'routine_id')::uuid, b->>'title', (b->>'plan_date')::date,
              (b->>'starts_at')::timestamptz, (b->>'ends_at')::timestamptz, coalesce((b->>'is_flexible')::boolean, true), 'planned',
              coalesce(b->>'created_by', 'navi'), b->>'reason', b->>'basis', b->>'assumption', p_changeset,
              coalesce((b->>'pinned')::boolean, false), coalesce(b->>'placement', 'auto'), (b->>'session_id')::uuid, b->>'session_title');
    elsif op->>'op' = 'update' then
      update public.plan_blocks
      set starts_at = (op->'after'->>'starts_at')::timestamptz,
          ends_at = (op->'after'->>'ends_at')::timestamptz,
          reason = op->'after'->>'reason',
          basis = op->'after'->>'basis',
          assumption = op->'after'->>'assumption',
          changeset_id = p_changeset
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned' and not pinned
        and starts_at = (op->'before'->>'starts_at')::timestamptz and ends_at = (op->'before'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block moved since this was worked out'; end if;
    elsif op->>'op' = 'move' then
      -- A requested move/resize/lock of any open block (pinned or not, Navi's or the person's).
      update public.plan_blocks
      set starts_at = (op->'after'->>'starts_at')::timestamptz,
          ends_at = (op->'after'->>'ends_at')::timestamptz,
          plan_date = (op->'after'->>'plan_date')::date,
          pinned = (op->'after'->>'pinned')::boolean,
          placement = op->'after'->>'placement',
          session_id = (op->'after'->>'session_id')::uuid,
          session_title = op->'after'->>'session_title',
          reason = coalesce(op->'after'->>'reason', reason),
          changeset_id = p_changeset
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (op->'before'->>'starts_at')::timestamptz and ends_at = (op->'before'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block changed since this was worked out'; end if;
    elsif op->>'op' = 'delete' then
      delete from public.plan_blocks
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned' and not pinned
        and starts_at = (op->'before'->>'starts_at')::timestamptz and ends_at = (op->'before'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block changed since this was worked out'; end if;
    elsif op->>'op' = 'remove' then
      -- Unschedule a block the person asked about (any open block; its task stays).
      delete from public.plan_blocks
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (op->'before'->>'starts_at')::timestamptz and ends_at = (op->'before'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block changed since this was worked out'; end if;
    elsif op->>'op' = 'status' then
      update public.plan_blocks
      set status = op->'after'->>'status', outcome_reason = op->'after'->>'outcome_reason'
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = op->'before'->>'status';
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block was marked since this was worked out'; end if;
    elsif op->>'op' = 'scope' then
      select mode into cur from public.day_plan_scope where user_id = cs.user_id and date = (op->>'date')::date and task_id = (op->>'task_id')::uuid;
      if cur is distinct from op->>'before' then raise exception 'NAVI_STALE: what is planned that day changed since this was worked out'; end if;
      if op->>'after' is null then
        delete from public.day_plan_scope where user_id = cs.user_id and date = (op->>'date')::date and task_id = (op->>'task_id')::uuid;
      else
        insert into public.day_plan_scope (user_id, date, task_id, mode)
        values (cs.user_id, (op->>'date')::date, (op->>'task_id')::uuid, op->>'after')
        on conflict (user_id, date, task_id) do update set mode = excluded.mode;
      end if;
      cur := null;
    elsif op->>'op' = 'exception' then
      b := op->'row';
      insert into public.day_exceptions (id, user_id, date, kind, start_time, end_time, minutes, note, source)
      values ((b->>'id')::uuid, cs.user_id, (b->>'date')::date, b->>'kind', (b->>'start_time')::time, (b->>'end_time')::time, (b->>'minutes')::int, b->>'note', coalesce(b->>'source', 'chat'));
    else
      raise exception 'NAVI_BAD_OP: unknown operation %', op->>'op';
    end if;
  end loop;

  update public.plan_changesets set status = 'applied', applied_at = now() where id = p_changeset;
end;
$$;

create or replace function public.revert_plan_changeset(p_changeset uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  cs public.plan_changesets;
  op jsonb;
  b jsonb;
  n int;
  cur text;
begin
  select * into cs from public.plan_changesets where id = p_changeset for update;
  if not found then raise exception 'NAVI_NOT_FOUND: that plan change was not found'; end if;
  if cs.status <> 'applied' then raise exception 'NAVI_STALE: that plan change is %, so there is nothing to undo', cs.status; end if;
  perform pg_advisory_xact_lock(hashtextextended(cs.user_id::text || ':plan', 0));

  for op in select value from jsonb_array_elements(cs.ops) with ordinality as t(value, i) order by i desc loop
    n := 1;
    if op->>'op' = 'insert' then
      b := op->'block';
      delete from public.plan_blocks
      where id = (b->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (b->>'starts_at')::timestamptz and ends_at = (b->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
    elsif op->>'op' = 'update' then
      update public.plan_blocks
      set starts_at = (op->'before'->>'starts_at')::timestamptz,
          ends_at = (op->'before'->>'ends_at')::timestamptz,
          reason = op->'before'->>'reason',
          basis = op->'before'->>'basis',
          assumption = op->'before'->>'assumption',
          changeset_id = (op->'before'->>'changeset_id')::uuid
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (op->'after'->>'starts_at')::timestamptz and ends_at = (op->'after'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
    elsif op->>'op' = 'move' then
      update public.plan_blocks
      set starts_at = (op->'before'->>'starts_at')::timestamptz,
          ends_at = (op->'before'->>'ends_at')::timestamptz,
          plan_date = (op->'before'->>'plan_date')::date,
          pinned = (op->'before'->>'pinned')::boolean,
          placement = op->'before'->>'placement',
          session_id = (op->'before'->>'session_id')::uuid,
          session_title = op->'before'->>'session_title',
          reason = coalesce(op->'before'->>'reason', reason),
          changeset_id = (op->'before'->>'changeset_id')::uuid
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (op->'after'->>'starts_at')::timestamptz and ends_at = (op->'after'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
    elsif op->>'op' in ('delete', 'remove') then
      b := op->'before';
      insert into public.plan_blocks (id, user_id, task_id, routine_id, title, plan_date, starts_at, ends_at, is_flexible, status, created_by, reason, basis, assumption, changeset_id, pinned, placement, session_id, session_title)
      values ((op->>'id')::uuid, cs.user_id, (b->>'task_id')::uuid, (b->>'routine_id')::uuid, b->>'title', (b->>'plan_date')::date,
              (b->>'starts_at')::timestamptz, (b->>'ends_at')::timestamptz, coalesce((b->>'is_flexible')::boolean, true), 'planned',
              coalesce(b->>'created_by', 'navi'), b->>'reason', b->>'basis', b->>'assumption', (b->>'changeset_id')::uuid,
              coalesce((b->>'pinned')::boolean, false), coalesce(b->>'placement', 'auto'), (b->>'session_id')::uuid, b->>'session_title')
      on conflict (id) do nothing;
      get diagnostics n = row_count;
    elsif op->>'op' = 'status' then
      update public.plan_blocks
      set status = op->'before'->>'status', outcome_reason = op->'before'->>'outcome_reason'
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = op->'after'->>'status';
      get diagnostics n = row_count;
    elsif op->>'op' = 'scope' then
      select mode into cur from public.day_plan_scope where user_id = cs.user_id and date = (op->>'date')::date and task_id = (op->>'task_id')::uuid;
      if cur is distinct from op->>'after' then n := 0;
      elsif op->>'before' is null then
        delete from public.day_plan_scope where user_id = cs.user_id and date = (op->>'date')::date and task_id = (op->>'task_id')::uuid;
      else
        insert into public.day_plan_scope (user_id, date, task_id, mode)
        values (cs.user_id, (op->>'date')::date, (op->>'task_id')::uuid, op->>'before')
        on conflict (user_id, date, task_id) do update set mode = excluded.mode;
      end if;
      cur := null;
    elsif op->>'op' = 'exception' then
      delete from public.day_exceptions where id = (op->'row'->>'id')::uuid and user_id = cs.user_id;
      get diagnostics n = row_count;
    end if;
    if n = 0 then raise exception 'NAVI_CHANGED: part of that plan was changed since, so undoing it would throw that away'; end if;
  end loop;

  update public.plan_changesets set status = 'reverted', reverted_at = now() where id = p_changeset;
end;
$$;

revoke execute on function public.apply_plan_changeset(uuid) from public, anon;
revoke execute on function public.revert_plan_changeset(uuid) from public, anon;
grant execute on function public.apply_plan_changeset(uuid) to authenticated, service_role;
grant execute on function public.revert_plan_changeset(uuid) to authenticated, service_role;

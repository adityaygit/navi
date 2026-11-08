-- Constraint-first planning (docs/navi-1.5/PLANNING_AUDIT.md, owner approved
-- D1–D10 on 2026-11-08). LOCAL FIRST: do not apply to hosted without the
-- owner's OK. Additive and idempotent: no column is dropped or rewritten, the
-- old planner (profiles.availability, routines.is_fixed, replace_day_plan)
-- keeps working, and the new planner is used only for accounts with
-- profiles.preferences.planner_v2 = true.
--
--  1. availability_rules: usual free/busy times with how sure Navi is
--     (confirmed = the person said so; inferred = Navi's assumption).
--     profiles.availability stays the "usual free times" list from Settings.
--  2. day_exceptions: one-day facts ("only 2 hours today", "free after 3",
--     "busy 6–7:30 tonight"). They never touch the usual times.
--  3. event_occurrence_overrides: one session of a weekly event cancelled or
--     moved, without touching the series.
--  4. routines: protection (fixed / protected / flexible), kind, and a window
--     a protected routine may move within. Backfill keeps today's behaviour.
--  5. tasks: commitment (must / normal / optional) and not_before.
--  6. task_dependencies: a task waits for another.
--  7. plan_blocks: pinned (re-plans leave it where it is), basis/assumption
--     (planned in confirmed or assumed free time), changeset_id.
--  8. plan_changesets + apply/revert functions: every planning run of the
--     new planner is one unit that can be proposed, applied and undone.

-- 1 ---------------------------------------------------------------------------
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  days smallint[] not null check (array_length(days, 1) between 1 and 7 and days <@ '{0,1,2,3,4,5,6}'),
  start_time time not null,
  end_time time not null,
  kind text not null check (kind in ('free','busy')),
  basis text not null default 'confirmed' check (basis in ('confirmed','inferred')),
  source text not null default 'chat' check (source in ('settings','chat','onboarding','learned')),
  valid_from date,
  valid_until date,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time <> end_time)
);
create index if not exists availability_rules_user on public.availability_rules (user_id);

-- 2 ---------------------------------------------------------------------------
create table if not exists public.day_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('busy','free','capacity')),
  start_time time,
  end_time time,
  minutes int check (minutes is null or minutes between 0 and 1440),
  note text check (note is null or length(note) <= 300),
  source text not null default 'chat' check (source in ('chat','ui')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'capacity' or minutes is not null),
  check ((start_time is null) = (end_time is null))
);
create index if not exists day_exceptions_user_date on public.day_exceptions (user_id, date);

-- 3 ---------------------------------------------------------------------------
create table if not exists public.event_occurrence_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_date date not null,
  status text not null check (status in ('cancelled','moved')),
  starts_at timestamptz,
  ends_at timestamptz,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, occurrence_date),
  check (status <> 'moved' or (starts_at is not null and ends_at is not null and ends_at > starts_at))
);
create index if not exists event_overrides_user on public.event_occurrence_overrides (user_id, occurrence_date);

-- 4 ---------------------------------------------------------------------------
alter table public.routines add column if not exists protection text;
alter table public.routines add column if not exists kind text not null default 'other';
alter table public.routines add column if not exists window_start time;
alter table public.routines add column if not exists window_end time;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'routines_protection_check') then
    alter table public.routines add constraint routines_protection_check check (protection is null or protection in ('fixed','protected','flexible'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'routines_kind_check') then
    alter table public.routines add constraint routines_kind_check check (kind in ('sleep','meal','exercise','recovery','other'));
  end if;
end $$;
-- Backfill = today's behaviour: fixed stays fixed; a routine with a set time
-- that wasn't marked fixed was never moved by the planner, so it becomes
-- "protected" with no window (it stays at its time); untimed ones float.
update public.routines
set protection = case when is_fixed then 'fixed' when start_time is not null then 'protected' else 'flexible' end
where protection is null;

-- 5, 6 ------------------------------------------------------------------------
alter table public.tasks add column if not exists commitment text not null default 'normal';
alter table public.tasks add column if not exists not_before timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_commitment_check') then
    alter table public.tasks add constraint tasks_commitment_check check (commitment in ('must','normal','optional'));
  end if;
end $$;

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index if not exists task_dependencies_user on public.task_dependencies (user_id);

-- 7 ---------------------------------------------------------------------------
alter table public.plan_blocks add column if not exists pinned boolean not null default false;
alter table public.plan_blocks add column if not exists basis text;
alter table public.plan_blocks add column if not exists assumption text;
alter table public.plan_blocks add column if not exists changeset_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'plan_blocks_basis_check') then
    alter table public.plan_blocks add constraint plan_blocks_basis_check check (basis is null or basis in ('confirmed','inferred'));
  end if;
end $$;

-- 8 ---------------------------------------------------------------------------
create table if not exists public.plan_changesets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  actor text not null check (actor in ('user','navi','system')),
  trigger text not null check (trigger in ('button','chat','voice','tick','recovery','event_change','overrun','onboarding')),
  dates date[] not null,
  status text not null default 'proposed' check (status in ('proposed','applied','reverted','superseded','expired')),
  -- [{op:'insert',block:{...}} | {op:'update',id,before,after} | {op:'delete',id,before} | {op:'status',id,before,after}]
  ops jsonb not null default '[]'::jsonb,
  -- Ids of Navi's open, unpinned flexible blocks on these dates when the plan was made.
  base jsonb not null default '[]'::jsonb,
  summary text not null default '',
  explanation jsonb not null default '{}'::jsonb,
  approval_id uuid,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_changesets_user_time on public.plan_changesets (user_id, created_at desc);

-- RLS, grants, updated_at for the new tables ---------------------------------
do $$
declare t text;
begin
  foreach t in array array['availability_rules','day_exceptions','event_occurrence_overrides','task_dependencies','plan_changesets']
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

-- Apply / revert a plan change set -------------------------------------------
-- One locked step per person. Applying checks the plan is still the one the
-- change set was made from (same open Navi blocks, each still where it was),
-- so two planning runs at once can't both apply; a stale one fails with
-- NAVI_STALE and changes nothing. Reverting checks every block is still as the
-- change set left it, so undo never throws away a later edit (NAVI_CHANGED).
-- Both run with the caller's rights: row level security limits them to the
-- caller's own rows.
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
begin
  select * into cs from public.plan_changesets where id = p_changeset for update;
  if not found then raise exception 'NAVI_NOT_FOUND: that plan change was not found'; end if;
  if cs.status <> 'proposed' then raise exception 'NAVI_STALE: that plan change is already %', cs.status; end if;
  perform pg_advisory_xact_lock(hashtextextended(cs.user_id::text || ':plan', 0));

  select coalesce(jsonb_agg(to_jsonb(id::text) order by id::text), '[]'::jsonb) into current_ids
  from public.plan_blocks
  where user_id = cs.user_id and plan_date = any(cs.dates) and is_flexible and created_by = 'navi'
    and status = 'planned' and not pinned;
  if current_ids <> (select coalesce(jsonb_agg(x order by x #>> '{}'), '[]'::jsonb) from jsonb_array_elements(cs.base) x) then
    raise exception 'NAVI_STALE: the plan changed since this was worked out';
  end if;

  for op in select value from jsonb_array_elements(cs.ops) loop
    if op->>'op' = 'insert' then
      b := op->'block';
      insert into public.plan_blocks (id, user_id, task_id, routine_id, title, plan_date, starts_at, ends_at, is_flexible, status, created_by, reason, basis, assumption, changeset_id)
      values ((b->>'id')::uuid, cs.user_id, (b->>'task_id')::uuid, (b->>'routine_id')::uuid, b->>'title', (b->>'plan_date')::date,
              (b->>'starts_at')::timestamptz, (b->>'ends_at')::timestamptz, true, 'planned', 'navi', b->>'reason', b->>'basis', b->>'assumption', p_changeset);
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
    elsif op->>'op' = 'delete' then
      delete from public.plan_blocks
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = 'planned' and not pinned
        and starts_at = (op->'before'->>'starts_at')::timestamptz and ends_at = (op->'before'->>'ends_at')::timestamptz;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block changed since this was worked out'; end if;
    elsif op->>'op' = 'status' then
      update public.plan_blocks
      set status = op->'after'->>'status', outcome_reason = op->'after'->>'outcome_reason'
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = op->'before'->>'status';
      get diagnostics n = row_count;
      if n = 0 then raise exception 'NAVI_STALE: a block was marked since this was worked out'; end if;
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
begin
  select * into cs from public.plan_changesets where id = p_changeset for update;
  if not found then raise exception 'NAVI_NOT_FOUND: that plan change was not found'; end if;
  if cs.status <> 'applied' then raise exception 'NAVI_STALE: that plan change is %, so there is nothing to undo', cs.status; end if;
  perform pg_advisory_xact_lock(hashtextextended(cs.user_id::text || ':plan', 0));

  for op in select value from jsonb_array_elements(cs.ops) with ordinality as t(value, i) order by i desc loop
    if op->>'op' = 'insert' then
      b := op->'block';
      delete from public.plan_blocks
      where id = (b->>'id')::uuid and user_id = cs.user_id and status = 'planned'
        and starts_at = (b->>'starts_at')::timestamptz and ends_at = (b->>'ends_at')::timestamptz;
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
    elsif op->>'op' = 'delete' then
      b := op->'before';
      insert into public.plan_blocks (id, user_id, task_id, routine_id, title, plan_date, starts_at, ends_at, is_flexible, status, created_by, reason, basis, assumption, changeset_id)
      values ((op->>'id')::uuid, cs.user_id, (b->>'task_id')::uuid, (b->>'routine_id')::uuid, b->>'title', (b->>'plan_date')::date,
              (b->>'starts_at')::timestamptz, (b->>'ends_at')::timestamptz, true, 'planned', 'navi', b->>'reason', b->>'basis', b->>'assumption', (b->>'changeset_id')::uuid)
      on conflict (id) do nothing;
    elsif op->>'op' = 'status' then
      update public.plan_blocks
      set status = op->'before'->>'status', outcome_reason = op->'before'->>'outcome_reason'
      where id = (op->>'id')::uuid and user_id = cs.user_id and status = op->'after'->>'status';
    end if;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'NAVI_CHANGED: part of that plan was changed since, so undoing it would throw that away'; end if;
  end loop;

  update public.plan_changesets set status = 'reverted', reverted_at = now() where id = p_changeset;
end;
$$;

revoke execute on function public.apply_plan_changeset(uuid) from public, anon;
revoke execute on function public.revert_plan_changeset(uuid) from public, anon;
grant execute on function public.apply_plan_changeset(uuid) to authenticated, service_role;
grant execute on function public.revert_plan_changeset(uuid) to authenticated, service_role;

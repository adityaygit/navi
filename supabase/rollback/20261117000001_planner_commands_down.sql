-- Rollback for 20261117000001_planner_commands.sql (run by hand, only with
-- the owner's OK). Restores the change-set functions and the trigger list as
-- they were in 20261110000001_constraint_planning.sql. New tables and columns
-- are left in place (dropping them would destroy data); with
-- preferences.planner_commands off nothing reads them.
-- Change sets that use the new op kinds (move/remove/scope/exception) can no
-- longer be applied or undone after this rollback; revert them first if needed.

alter table public.plan_changesets drop constraint if exists plan_changesets_trigger_check;
alter table public.plan_changesets add constraint plan_changesets_trigger_check
  check (trigger in ('button','chat','voice','tick','recovery','event_change','overrun','onboarding')) not valid;

drop function if exists public.plan_inputs_version(uuid, date[]);

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

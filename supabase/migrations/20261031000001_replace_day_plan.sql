-- Replace Navi's planned flexible blocks for one day in a single step, under a
-- per-person-per-day lock, so two planning runs at once (a double tap on
-- "Re-plan today", or overlapping scheduler runs) can't both add a plan. Runs
-- with the caller's rights: row level security still limits it to their rows.
create or replace function public.replace_day_plan(p_user uuid, p_day date, p_blocks jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_day::text, 0));
  delete from public.plan_blocks
  where user_id = p_user and plan_date = p_day and is_flexible and created_by = 'navi' and status = 'planned';
  insert into public.plan_blocks (user_id, task_id, routine_id, title, plan_date, starts_at, ends_at, is_flexible, status, created_by, reason)
  select p_user, (b->>'task_id')::uuid, (b->>'routine_id')::uuid, b->>'title', p_day,
         (b->>'starts_at')::timestamptz, (b->>'ends_at')::timestamptz, true, 'planned', 'navi', b->>'reason'
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) as b;
end;
$$;

revoke execute on function public.replace_day_plan(uuid, date, jsonb) from public, anon;
grant execute on function public.replace_day_plan(uuid, date, jsonb) to authenticated, service_role;

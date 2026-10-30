-- Security review (session 3) hardening. NEEDS OWNER APPROVAL before it is
-- applied to the hosted project.
--
-- 1. Atomic AI budget reservations (L2/M2): a provider call first reserves a
--    pessimistic estimate under a per-day advisory lock, so concurrent calls
--    can't all pass a read-then-check; the row is settled with the real
--    usage afterwards. Optionally rate-limits a user's reservations of one
--    purpose (voice tokens) in the same locked step.
-- 2. ai_usage.session_id links voice turn rows to their session's
--    reservation, so a session is charged max(reserved, reported) once.
-- 3. Notifications: signed-in users may only change `status` (mark read),
--    nothing else about a notification.

-- ---------------------------------------------------------------------------
-- 2. Voice turns point at their session's reservation row.
alter table public.ai_usage add column if not exists session_id uuid;
create index if not exists ai_usage_session on public.ai_usage (session_id) where session_id is not null;
-- Rate-limit lookups: a user's recent rows of one purpose.
create index if not exists ai_usage_user_purpose_created on public.ai_usage (user_id, purpose, created_at);

-- ---------------------------------------------------------------------------
-- 1. Reserve budget atomically. Returns {"ok":true,"id":...,"spent":...} or
--    {"ok":false,"reason":"budget"|"rate_limited","spent":...}.
create or replace function public.ai_reserve(
  p_user uuid,
  p_provider text,
  p_model text,
  p_role text,
  p_purpose text,
  p_amount numeric,
  p_day date,
  p_cap numeric,
  p_rate_max int default null,
  p_rate_window_seconds int default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_spent numeric;
  v_recent int;
  v_id uuid;
begin
  if p_amount < 0 then
    raise exception 'reservation must not be negative';
  end if;
  -- One budget per day: serialise every reservation for that day.
  perform pg_advisory_xact_lock(hashtextextended('navi.ai_budget:' || p_day::text, 0));

  if p_rate_max is not null then
    select count(*) into v_recent
      from public.ai_usage
     where user_id = p_user
       and purpose = p_purpose
       and created_at > now() - make_interval(secs => coalesce(p_rate_window_seconds, 600));
    if v_recent >= p_rate_max then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'recent', v_recent);
    end if;
  end if;

  select coalesce(sum(cost_usd), 0) into v_spent from public.ai_usage where budget_day = p_day;
  if v_spent + p_amount > p_cap then
    return jsonb_build_object('ok', false, 'reason', 'budget', 'spent', v_spent);
  end if;

  insert into public.ai_usage (user_id, provider, model, role, purpose, cost_usd, cost_is_estimate, budget_day, ok)
  values (p_user, p_provider, p_model, p_role, p_purpose, p_amount, true, p_day, true)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'spent', v_spent);
end;
$$;

-- A voice session costs max(reserved, reported): its reservation row keeps
-- whatever part of the reserve the reported turns haven't used yet.
create or replace function public.ai_voice_settle(p_session uuid, p_reserve numeric)
returns numeric
language sql
security invoker
set search_path = ''
as $$
  update public.ai_usage r
     set cost_usd = greatest(0, p_reserve - coalesce((select sum(t.cost_usd) from public.ai_usage t where t.session_id = p_session), 0))
   where r.id = p_session
  returning r.cost_usd;
$$;

-- Server only (service role): never callable from the browser.
revoke execute on function public.ai_reserve(uuid, text, text, text, text, numeric, date, numeric, int, int) from public, anon, authenticated;
revoke execute on function public.ai_voice_settle(uuid, numeric) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, text, text, text, text, numeric, date, numeric, int, int) to service_role;
grant execute on function public.ai_voice_settle(uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Notifications: users can mark their own as read, nothing more.
revoke update on public.notifications from authenticated;
grant update (status) on public.notifications to authenticated;
drop policy if exists notifications_mark_read on public.notifications;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status = 'read');

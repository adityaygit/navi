-- Focus sessions: one open session per person (enforced by the database, so a
-- double tap or two devices can't start two), pause/resume, and an atomic end
-- so a repeated "end" adds the time to the task only once.
-- Idempotent and non-destructive: nothing is deleted.

alter table public.focus_sessions
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds integer not null default 0;

-- Existing duplicates: keep each person's newest open session; close the older
-- ones (no time added to any task) so the unique index below can be built.
update public.focus_sessions f
set ended_at = now(),
    outcome = coalesce(f.outcome, 'interrupted'),
    note = coalesce(f.note, 'Closed automatically: another focus session was open at the same time')
where f.ended_at is null
  and exists (
    select 1 from public.focus_sessions newer
    where newer.user_id = f.user_id
      and newer.ended_at is null
      and (newer.started_at, newer.id) > (f.started_at, f.id)
  );

create unique index if not exists focus_sessions_one_open
  on public.focus_sessions (user_id) where ended_at is null;

-- Seconds of focus so far: wall time minus completed pauses minus the current one.
create or replace function public.focus_elapsed_seconds(s public.focus_sessions, at_time timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(0, floor(
    extract(epoch from (at_time - s.started_at))
    - coalesce(s.paused_seconds, 0)
    - coalesce(extract(epoch from (at_time - s.paused_at)), 0)
  ))::integer
$$;

-- Pause an open, running session. Returns the row only if this call paused it.
create or replace function public.focus_pause(p_session uuid)
returns setof public.focus_sessions
language sql
security invoker
set search_path = ''
as $$
  update public.focus_sessions
  set paused_at = now()
  where id = p_session and ended_at is null and paused_at is null
  returning *
$$;

-- Resume a paused session. Returns the row only if this call resumed it.
create or replace function public.focus_resume(p_session uuid)
returns setof public.focus_sessions
language sql
security invoker
set search_path = ''
as $$
  update public.focus_sessions
  set paused_seconds = paused_seconds + greatest(0, floor(extract(epoch from (now() - paused_at))))::integer,
      paused_at = null
  where id = p_session and ended_at is null and paused_at is not null
  returning *
$$;

-- End a session: only the call that actually closes it gets a row back, and
-- only that call adds the minutes to the task (in the same statement).
create or replace function public.focus_end(p_session uuid, p_outcome text, p_note text)
returns setof public.focus_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.focus_sessions;
begin
  update public.focus_sessions f
  set ended_at = now(),
      actual_minutes = greatest(1, round(public.focus_elapsed_seconds(f, now()) / 60.0))::integer,
      paused_seconds = f.paused_seconds + coalesce(greatest(0, floor(extract(epoch from (now() - f.paused_at))))::integer, 0),
      paused_at = null,
      outcome = p_outcome,
      note = p_note
  where f.id = p_session and f.ended_at is null
  returning * into s;
  if not found then
    return;
  end if;
  if s.task_id is not null then
    update public.tasks set actual_minutes = actual_minutes + s.actual_minutes where id = s.task_id;
  end if;
  return next s;
end;
$$;

revoke execute on function public.focus_elapsed_seconds(public.focus_sessions, timestamptz) from public, anon;
revoke execute on function public.focus_pause(uuid) from public, anon;
revoke execute on function public.focus_resume(uuid) from public, anon;
revoke execute on function public.focus_end(uuid, text, text) from public, anon;
grant execute on function public.focus_elapsed_seconds(public.focus_sessions, timestamptz) to authenticated, service_role;
grant execute on function public.focus_pause(uuid) to authenticated, service_role;
grant execute on function public.focus_resume(uuid) to authenticated, service_role;
grant execute on function public.focus_end(uuid, text, text) to authenticated, service_role;

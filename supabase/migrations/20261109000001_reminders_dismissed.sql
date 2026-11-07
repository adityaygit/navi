-- Navi 1.5 (owner-approved 2026-11-07, LOCAL FIRST; do not apply to hosted
-- without owner approval):
--  1. tasks.remind_at: an optional reminder time for a task ("More details" →
--     Reminder). A push notification at that time, respecting quiet hours.
--  2. dismissed_suggestions: the page suggestions a person said "Not now" to
--     (Home insight, Tasks nudge), so the same one never comes back. `key` is
--     a stable id built from the check and the item it is about, e.g.
--     "event_without_task:<event id>".
-- Idempotent and non-destructive.

alter table public.tasks add column if not exists remind_at timestamptz;
alter table public.tasks add column if not exists reminded_at timestamptz;

create index if not exists tasks_remind_due on public.tasks (remind_at)
  where remind_at is not null and reminded_at is null;

create table if not exists public.dismissed_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (length(key) between 3 and 200),
  dismissed_at timestamptz not null default now(),
  unique (user_id, key)
);

alter table public.dismissed_suggestions enable row level security;

drop policy if exists dismissed_suggestions_owner on public.dismissed_suggestions;
create policy dismissed_suggestions_owner on public.dismissed_suggestions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.dismissed_suggestions to authenticated;
grant select, insert, update, delete on public.dismissed_suggestions to service_role;

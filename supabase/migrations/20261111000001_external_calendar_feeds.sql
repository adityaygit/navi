-- External calendar feeds (first provider: Canvas LMS private iCalendar feed).
-- LOCAL FIRST: do not apply to the hosted project without the owner's OK.
-- Additive: no existing column is dropped or rewritten.
--
-- Model (reusable for other calendar / school integrations):
--   integration_connections  one connected feed per row: non-secret status only.
--   integration_secrets      the encrypted feed URL. No API role can read it;
--                            only server code with the service role touches it.
--   external_courses         courses (or other groupings) seen in a feed, with
--                            the person's choices: excluded, linked space/project.
--   external_items           every imported occurrence, keyed by
--                            (connection, UID + recurrence occurrence). The
--                            provider owns its fields (title, times); Navi owns
--                            the linked task/event's planning fields.
--   integration_sync_runs    one row per sync attempt (status, counts, error).
--   integration_rate_events  rate limiting for connect/refresh (server only).
--
-- Imported assignments become ordinary tasks and timed events ordinary events
-- with source='external' and external_ref='ext:<external_items.id>', so the
-- existing tasks, planner and AI tools see them without a parallel system.

-- tasks: allow source 'external' and an owner reference, like events have ----
alter table public.tasks add column if not exists external_ref text;
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'tasks_source_check') then
    alter table public.tasks drop constraint tasks_source_check;
  end if;
  alter table public.tasks add constraint tasks_source_check
    check (source in ('user','navi','capture','onboarding','recurrence','external'));
  if not exists (select 1 from pg_constraint where conname = 'tasks_external_ref_key') then
    alter table public.tasks add constraint tasks_external_ref_key unique (user_id, external_ref);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_external_ref_key') then
    alter table public.events add constraint events_external_ref_key unique (user_id, external_ref);
  end if;
end $$;

-- connections -----------------------------------------------------------------
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('canvas')),
  kind text not null default 'ics_feed' check (kind in ('ics_feed')),
  -- Host of the feed (e.g. school.instructure.com): shown to the person, not secret.
  display_host text not null check (length(display_host) <= 253),
  -- HMAC of the normalized feed URL: detects the same feed twice without storing it.
  feed_fingerprint text not null,
  status text not null default 'active' check (status in ('active','error','reauth')),
  lock_token uuid,
  locked_until timestamptz,
  next_sync_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error text check (last_error is null or length(last_error) <= 500),
  consecutive_failures int not null default 0,
  -- The window the last successful sync confirmed (removals only happen inside it).
  window_start timestamptz,
  window_end timestamptz,
  item_count int not null default 0,
  last_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feed_fingerprint)
);
create index if not exists integration_connections_user on public.integration_connections (user_id);
create index if not exists integration_connections_due on public.integration_connections (next_sync_at);

create table if not exists public.integration_secrets (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists integration_secrets_user on public.integration_secrets (user_id);

-- courses ---------------------------------------------------------------------
create table if not exists public.external_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  course_key text not null check (length(course_key) <= 300),
  name text not null check (length(name) <= 300),
  excluded boolean not null default false,
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  association text check (association is null or association in ('auto','user')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, course_key)
);
create index if not exists external_courses_user on public.external_courses (user_id);
create index if not exists external_courses_workspace on public.external_courses (workspace_id) where workspace_id is not null;
create index if not exists external_courses_project on public.external_courses (project_id) where project_id is not null;

-- items -----------------------------------------------------------------------
create table if not exists public.external_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  -- Stable within the connection: UID, plus the occurrence for recurring events.
  external_id text not null check (length(external_id) <= 600),
  uid text not null check (length(uid) <= 500),
  recurrence_id text,
  kind text not null check (kind in ('assignment','event')),
  course_id uuid references public.external_courses(id) on delete set null,
  -- Provider-owned (untrusted, sanitized before storing; display as text only).
  title text not null check (length(title) between 1 and 500),
  description text check (description is null or length(description) <= 4000),
  url text check (url is null or length(url) <= 2000),
  location text check (location is null or length(location) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  all_day_date date,
  source_status text not null default 'confirmed' check (source_status in ('confirmed','tentative','cancelled')),
  content_hash text not null,
  -- Lifecycle. active → removed only after missing from two successful syncs
  -- inside the confirmed window; items that age out of the window stay as they are.
  state text not null default 'active' check (state in ('active','removed')),
  missing_count int not null default 0,
  missing_since timestamptz,
  removed_at timestamptz,
  -- The person's choices (Navi-owned).
  hidden boolean not null default false,
  hidden_reason text check (hidden_reason is null or hidden_reason in ('user','duplicate')),
  possible_duplicate_task_id uuid references public.tasks(id) on delete set null,
  -- Link to the Navi item it became. parked_status: the task status (or
  -- 'confirmed' for an event) to restore when sync un-parks it.
  task_id uuid references public.tasks(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  materialized boolean not null default false,
  parked_status text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  check (all_day = (all_day_date is not null))
);
create index if not exists external_items_user_start on public.external_items (user_id, starts_at);
create index if not exists external_items_course on public.external_items (course_id) where course_id is not null;
create index if not exists external_items_task on public.external_items (task_id) where task_id is not null;
create index if not exists external_items_event on public.external_items (event_id) where event_id is not null;
create index if not exists external_items_dup on public.external_items (possible_duplicate_task_id) where possible_duplicate_task_id is not null;

-- sync runs -------------------------------------------------------------------
create table if not exists public.integration_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.integration_connections(id) on delete cascade,
  trigger text not null check (trigger in ('connect','manual','schedule')),
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  error_code text,
  error text check (error is null or length(error) <= 500),
  window_start timestamptz,
  window_end timestamptz
);
create index if not exists integration_sync_runs_conn on public.integration_sync_runs (connection_id, started_at desc);
create index if not exists integration_sync_runs_user on public.integration_sync_runs (user_id);

-- rate limiting ---------------------------------------------------------------
create table if not exists public.integration_rate_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists integration_rate_events_lookup on public.integration_rate_events (user_id, key, created_at);

-- Counts a hit and says whether it is within the limit, atomically per user+key.
create or replace function public.integration_rate_hit(p_user uuid, p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('navi.integration_rate:' || p_user::text || ':' || p_key, 0));
  delete from public.integration_rate_events where user_id = p_user and key = p_key and created_at < now() - interval '1 day';
  select count(*) into v_recent from public.integration_rate_events
   where user_id = p_user and key = p_key and created_at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max then
    return false;
  end if;
  insert into public.integration_rate_events (user_id, key) values (p_user, p_key);
  return true;
end;
$$;
revoke execute on function public.integration_rate_hit(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.integration_rate_hit(uuid, text, int, int) to service_role;

-- RLS & privileges ------------------------------------------------------------
-- The person can read their own connection status, courses, items and runs.
-- Every write goes through server code (service role) that checks ownership,
-- validates input and keeps provider-owned fields intact.
do $$
declare t text;
begin
  foreach t in array array['integration_connections','external_courses','external_items','integration_sync_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_owner_read', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  foreach t in array array['integration_connections','external_courses','external_items','integration_secrets']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
  end loop;
end $$;

-- Secrets and rate events: RLS on with no policies, no API-role privileges.
alter table public.integration_secrets enable row level security;
alter table public.integration_rate_events enable row level security;
revoke all on public.integration_secrets, public.integration_rate_events from anon, authenticated;
grant select, insert, update, delete on public.integration_secrets, public.integration_rate_events to service_role;

-- Navi core schema. Every user-owned row carries user_id and is protected by RLS
-- so that a signed-in user can only ever see or change their own data.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access control: invite-only allowlist (no user-facing policies at all)
-- ---------------------------------------------------------------------------
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;

-- Supabase Auth "before user created" hook: rejects sign-ups (email or Google)
-- whose email is not on the allowlist, so public registration cannot happen
-- by accident even if the sign-up UI is reachable.
create or replace function public.navi_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text := lower(coalesce(event->'user'->>'email', ''));
begin
  if candidate <> '' and exists (select 1 from public.allowed_emails where email = candidate) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Navi is invite-only right now. This email is not on the access list.'
    )
  );
end;
$$;
grant execute on function public.navi_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.navi_before_user_created(jsonb) from authenticated, anon, public;
grant select on public.allowed_emails to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Profile & settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  quiet_hours_start time,
  quiet_hours_end time,
  morning_briefing_time time not null default '06:00',
  evening_review_time time not null default '21:00',
  weekly_review_day smallint not null default 0 check (weekly_review_day between 0 and 6),
  briefings_enabled boolean not null default true,
  -- [{ "days":[1,2,3,4,5], "start":"16:00", "end":"21:00" }] — when flexible work may be scheduled
  availability jsonb not null default '[]'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  onboarding_status text not null default 'not_started'
    check (onboarding_status in ('not_started','in_progress','reviewing','completed','skipped')),
  onboarding_conversation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Structure: workspaces, projects, goals, milestones
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text,
  color text,
  status text not null default 'active' check (status in ('active','archived')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  title text not null check (length(title) between 1 and 300),
  why text,
  measure text,
  target_date date,
  status text not null default 'active' check (status in ('active','paused','achieved','dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  objective text,
  notes text,
  links jsonb not null default '[]'::jsonb,
  due_date date,
  status text not null default 'active' check (status in ('active','paused','done','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete cascade,
  title text not null,
  due_date date,
  done_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (project_id is not null or goal_id is not null)
);

-- ---------------------------------------------------------------------------
-- Work: tasks, routines, calendar events, plan blocks, focus sessions
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  milestone_id uuid references public.milestones(id) on delete set null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null check (length(title) between 1 and 500),
  notes text,
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done','cancelled')),
  priority smallint not null default 3 check (priority between 1 and 4), -- 1 = highest
  due_at timestamptz,          -- deadline (distinct from scheduled work time)
  due_is_hard boolean not null default false,
  estimate_minutes int check (estimate_minutes is null or estimate_minutes between 1 and 1440),
  actual_minutes int not null default 0,
  recurrence jsonb,            -- {"freq":"daily"|"weekly","days":[0-6]}
  blocker text,
  links jsonb not null default '[]'::jsonb,
  source text not null default 'user' check (source in ('user','navi','capture','onboarding','recurrence')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_status on public.tasks (user_id, status);
create index tasks_user_due on public.tasks (user_id, due_at);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null,
  days smallint[] not null default '{0,1,2,3,4,5,6}', -- 0 = Sunday
  start_time time,              -- null = flexible within the day
  duration_minutes int not null default 30 check (duration_minutes between 1 and 1440),
  is_fixed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- weekly recurrence for fixed commitments such as classes: {"freq":"weekly","days":[1,3],"until":"2027-06-01"}
  recurrence jsonb,
  location text,
  notes text,
  source text not null default 'user' check (source in ('user','onboarding','capture','external')),
  external_ref text,           -- set only for events owned by a connected external calendar
  status text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_user_time on public.events (user_id, starts_at);

create table public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  routine_id uuid references public.routines(id) on delete set null,
  title text not null,
  plan_date date not null,     -- local date the block belongs to
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_flexible boolean not null default true,
  status text not null default 'planned'
    check (status in ('planned','in_progress','done','partial','skipped','missed','rest','interrupted')),
  outcome_reason text,         -- why it was skipped/missed (rest, interruption, missing info, estimate)
  created_by text not null default 'navi' check (created_by in ('navi','user')),
  reason text,                 -- explanation for placement/move
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index plan_blocks_user_date on public.plan_blocks (user_id, plan_date);

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  block_id uuid references public.plan_blocks(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  planned_minutes int,
  actual_minutes int,
  outcome text check (outcome in ('completed','progress','interrupted','abandoned')),
  note text,
  created_at timestamptz not null default now()
);

create table public.plan_disruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  description text not null,
  category text check (category in ('interruption','rest','missing_info','estimate','external','other')),
  replan_summary text,
  created_at timestamptz not null default now()
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  title text,
  body text not null,
  source text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Conversation, capture and the review inbox
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'chat' check (kind in ('chat','onboarding')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null default '',
  modality text not null default 'text' check (modality in ('text','voice')),
  tool_events jsonb not null default '[]'::jsonb, -- [{name, input, result_summary, ok}]
  created_at timestamptz not null default now()
);
create index messages_conv on public.messages (conversation_id, created_at);

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id text not null,     -- idempotency key generated on the device (offline queue safe)
  raw_text text not null check (length(raw_text) between 1 and 20000),
  source text not null default 'text' check (source in ('text','voice','offline','chat','onboarding')),
  status text not null default 'pending' check (status in ('pending','processed','needs_ai','failed')),
  error text,
  captured_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  capture_id uuid references public.captures(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  batch text,                   -- e.g. 'onboarding' groups an initial-setup proposal
  kind text not null check (kind in ('workspace','project','goal','routine','event','task','reminder','note','question','memory','preference')),
  payload jsonb not null,
  ref_key text,                 -- local key so proposals can reference each other (task -> project)
  source_excerpt text,          -- the user's own words this came from
  origin text not null default 'inferred' check (origin in ('stated','inferred')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  rationale text,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','deferred','merged')),
  result_table text,
  result_id uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index proposals_user_status on public.proposals (user_id, status);

-- ---------------------------------------------------------------------------
-- Memory
-- ---------------------------------------------------------------------------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('profile','project','episodic','behavioral')),
  content text not null check (length(content) between 1 and 2000),
  project_id uuid references public.projects(id) on delete cascade,
  origin text not null check (origin in ('stated','inferred','observed')),
  confidence real not null default 0.7 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active','superseded','rejected')),
  evidence jsonb not null default '[]'::jsonb,
  source_message_id uuid references public.messages(id) on delete set null,
  superseded_by uuid references public.memories(id) on delete set null,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_kind on public.memories (user_id, kind, status);

-- ---------------------------------------------------------------------------
-- Activity log, approvals
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  actor text not null check (actor in ('user','navi','system')),
  action text not null,
  entity_type text,
  entity_id uuid,
  summary text not null,
  before jsonb,
  after jsonb,
  reversible boolean not null default false,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);
create index activity_user_time on public.activity_log (user_id, created_at desc);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action_type text not null,
  summary text not null,        -- exactly what will happen, in plain words
  details jsonb not null,       -- the precise operation that will execute
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','executing','executed','failed','expired')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz,
  unique (user_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Briefings, notifications, push
-- ---------------------------------------------------------------------------
create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('morning','evening','weekly')),
  local_date date not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  generated_by text not null default 'rules' check (generated_by in ('rules','ai')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, local_date)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  url text not null default '/',
  dedupe_key text not null,
  deliver_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','sent','held_quiet_hours','failed','no_subscription','read')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI usage & budget guard
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  model text not null,
  role text not null,
  purpose text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  audio_seconds real not null default 0,
  cost_usd numeric(12,6) not null default 0,
  cost_is_estimate boolean not null default true,
  budget_day date not null,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index ai_usage_day on public.ai_usage (budget_day);

create table public.budget_overrides (
  budget_day date primary key,
  extra_usd numeric(8,2) not null check (extra_usd > 0 and extra_usd <= 20),
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.budget_overrides enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workspaces','goals','projects','tasks','routines','events','plan_blocks','notes','conversations','memories']
  loop
    execute format('create trigger %I_updated before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security: owner-only on every user table
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_owner on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','goals','projects','milestones','tasks','routines','events','plan_blocks',
    'focus_sessions','plan_disruptions','notes','conversations','messages','captures','proposals',
    'memories','activity_log','briefings','push_subscriptions'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_owner', t);
  end loop;
end $$;

-- Approvals: the user may read and decide, but execution state is server-controlled.
alter table public.approvals enable row level security;
create policy approvals_read on public.approvals for select to authenticated
  using (user_id = (select auth.uid()));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

-- Notifications: readable by owner; written by the server scheduler only.
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- AI usage: a user can see their own usage rows; inserts happen server-side.
alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

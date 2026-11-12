-- Linear integration (read-only import of assigned issues). LOCAL FIRST; apply
-- to hosted only with owner approval. Additive, idempotent, non-destructive.
--
--  1. integration_connections: one row per (person, provider, external
--     workspace). Readable by its owner (status in Settings); written only by
--     trusted server code with the service role (OAuth callback, sync, disconnect).
--  2. integration_tokens: the OAuth tokens, AES-256-GCM encrypted by the app
--     (NAVI_TOKEN_ENCRYPTION_KEY) before they reach the database. No API role
--     but service_role can read or write it; RLS is on with no policies.
--  3. tasks / projects: external_* columns linking an imported row to its
--     Linear issue / project. A unique (user_id, external_source, external_id)
--     prevents duplicates; ordinary Navi rows leave them null (nulls never clash).
--     People can't set or change these columns through the API (trigger), so
--     an imported link can't be forged or pointed at someone else's connection.

-- 1. Connections ---------------------------------------------------------------
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('linear')),
  external_org_id text not null,
  external_org_name text,
  external_org_url_key text,
  external_user_id text not null,
  external_user_name text,
  external_user_email text,
  scopes text[] not null default '{}',
  -- active: syncing. needs_reauth: token expired/revoked, the person must reconnect.
  status text not null default 'active' check (status in ('active','needs_reauth')),
  status_detail text,
  settings jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,          -- last attempt finished (ok or not)
  last_sync_ok_at timestamptz,       -- last attempt that succeeded
  last_sync_error text,              -- null after a success
  last_sync_stats jsonb,
  sync_started_at timestamptz,       -- lease: a sync is running (stale after 5 minutes)
  sync_requested_at timestamptz,     -- set by webhooks / "Sync now" to ask the next tick to sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_org_id)
);
create index if not exists integration_connections_due on public.integration_connections (provider, status, last_sync_at);
create index if not exists integration_connections_org on public.integration_connections (provider, external_org_id);

alter table public.integration_connections enable row level security;
drop policy if exists integration_connections_read on public.integration_connections;
create policy integration_connections_read on public.integration_connections for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.integration_connections from anon, authenticated;
grant select on public.integration_connections to authenticated;
grant select, insert, update, delete on public.integration_connections to service_role;

drop trigger if exists integration_connections_updated on public.integration_connections;
create trigger integration_connections_updated before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- 2. Tokens (service role only) -------------------------------------------------
create table if not exists public.integration_tokens (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  access_expires_at timestamptz,
  token_version int not null default 1,
  refresh_lease_until timestamptz,   -- one refresher at a time (refresh tokens rotate)
  updated_at timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated, public;
grant select, insert, update, delete on public.integration_tokens to service_role;

drop trigger if exists integration_tokens_updated on public.integration_tokens;
create trigger integration_tokens_updated before update on public.integration_tokens
  for each row execute function public.set_updated_at();

-- 3. External links on tasks and projects ----------------------------------------
alter table public.tasks add column if not exists external_source text;
alter table public.tasks add column if not exists external_id text;
alter table public.tasks add column if not exists external_url text;
alter table public.tasks add column if not exists external_data jsonb;
alter table public.tasks add column if not exists external_connection_id uuid
  references public.integration_connections(id) on delete set null;
alter table public.tasks add column if not exists external_synced_at timestamptz;

alter table public.projects add column if not exists external_source text;
alter table public.projects add column if not exists external_id text;
alter table public.projects add column if not exists external_url text;
alter table public.projects add column if not exists external_connection_id uuid
  references public.integration_connections(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_external_unique') then
    alter table public.tasks add constraint tasks_external_unique unique (user_id, external_source, external_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_external_unique') then
    alter table public.projects add constraint projects_external_unique unique (user_id, external_source, external_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_external_source_check') then
    alter table public.tasks add constraint tasks_external_source_check check (external_source is null or external_source in ('linear'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_external_source_check') then
    alter table public.projects add constraint projects_external_source_check check (external_source is null or external_source in ('linear'));
  end if;
end $$;

create index if not exists tasks_external_connection on public.tasks (external_connection_id) where external_connection_id is not null;
create index if not exists projects_external_connection on public.projects (external_connection_id) where external_connection_id is not null;

-- Imported tasks have source 'linear'.
alter table public.tasks drop constraint if exists tasks_source_check;
alter table public.tasks add constraint tasks_source_check
  check (source in ('user','navi','capture','onboarding','recurrence','linear'));

-- Only trusted server code (service role) may set or change the external link.
create or replace function public.guard_external_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.external_source is not null or new.external_id is not null or new.external_url is not null or new.external_connection_id is not null then
        raise exception 'external link fields are managed by Navi' using errcode = '42501';
      end if;
    elsif new.external_source is distinct from old.external_source
       or new.external_id is distinct from old.external_id
       or new.external_url is distinct from old.external_url
       or new.external_connection_id is distinct from old.external_connection_id then
      raise exception 'external link fields are managed by Navi' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_external_link() from public, anon, authenticated;

drop trigger if exists tasks_guard_external on public.tasks;
create trigger tasks_guard_external before insert or update on public.tasks
  for each row execute function public.guard_external_link();
drop trigger if exists projects_guard_external on public.projects;
create trigger projects_guard_external before insert or update on public.projects
  for each row execute function public.guard_external_link();

-- external_data is only ever written by the sync too.
create or replace function public.guard_task_external_data() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op = 'INSERT' and (new.external_data is not null or new.external_synced_at is not null))
       or (tg_op = 'UPDATE' and (new.external_data is distinct from old.external_data or new.external_synced_at is distinct from old.external_synced_at)) then
      raise exception 'external link fields are managed by Navi' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_task_external_data() from public, anon, authenticated;
drop trigger if exists tasks_guard_external_data on public.tasks;
create trigger tasks_guard_external_data before insert or update on public.tasks
  for each row execute function public.guard_task_external_data();

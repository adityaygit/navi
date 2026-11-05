-- Early-access waitlist: request → application → approval → allowlist.
-- Server-only tables (service role). No policies for anon/authenticated: the
-- public pages talk to API routes, never to these tables directly.

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  status text not null default 'requested' check (status in ('requested', 'applied', 'approved', 'declined')),
  -- Application link: only the SHA-256 of the token is stored; the token itself lives in the email.
  token_hash text unique,
  token_expires_at timestamptz,
  -- Answers (filled when status becomes 'applied').
  name text check (char_length(name) <= 120),
  reason text check (char_length(reason) <= 2000),
  use_case text check (char_length(use_case) <= 2000),
  timezone text check (char_length(timezone) <= 64),
  referral text check (char_length(referral) <= 300),
  -- Bookkeeping.
  request_count integer not null default 1,
  last_email_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  decision_email_sent boolean not null default false
);
create index waitlist_status_idx on public.waitlist (status, created_at desc);
create index waitlist_ip_recent_idx on public.waitlist (ip_hash, created_at desc);
alter table public.waitlist enable row level security;

-- One-row settings table for the waitlist (auto-approve switch).
create table public.waitlist_settings (
  id smallint primary key default 1 check (id = 1),
  auto_approve boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.waitlist_settings (id) values (1) on conflict do nothing;
alter table public.waitlist_settings enable row level security;

revoke all on public.waitlist, public.waitlist_settings from anon, authenticated;

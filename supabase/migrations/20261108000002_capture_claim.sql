-- Captures: a 'processing' state so exactly one request turns a capture into
-- proposals. The request that moves it pending → processing does the work; a
-- concurrent retry sees it claimed and doesn't create a second set.
-- claimed_at lets a claim abandoned by a crashed request be taken over later.
-- Idempotent and non-destructive.

alter table public.captures drop constraint if exists captures_status_check;
alter table public.captures
  add constraint captures_status_check
  check (status in ('pending','processing','processed','needs_ai','failed'));

alter table public.captures add column if not exists claimed_at timestamptz;

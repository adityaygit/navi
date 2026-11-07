-- Inline action cards. The approvals table stays Navi's one record of actions
-- that wait for the person's OK; this gives it a plain state machine, a link
-- to the chat that proposed it, an expiry and a revision counter.
--
--   proposed → approved → executing → completed | failed
--   proposed → declined | expired
--
-- Old names: pending → proposed, rejected → declined, executed → completed.
-- NEEDS OWNER APPROVAL before it is applied to the hosted project, and it must
-- be applied before the code that uses it is deployed.

alter table public.approvals drop constraint if exists approvals_status_check;
update public.approvals set status = case status
  when 'pending' then 'proposed'
  when 'rejected' then 'declined'
  when 'executed' then 'completed'
  else status end;
alter table public.approvals
  add constraint approvals_status_check
  check (status in ('proposed','approved','executing','completed','declined','failed','expired'));
alter table public.approvals alter column status set default 'proposed';

alter table public.approvals
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists expires_at timestamptz not null default (now() + interval '3 days'),
  add column if not exists revision integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

-- Old rows used "<hash>:<timestamp>" keys, so two identical requests made at
-- the same moment both got in. Now: at most one OPEN action per key (enforced
-- by the database, so a race can't create two cards); decided ones may repeat.
alter table public.approvals drop constraint if exists approvals_user_id_idempotency_key_key;
create unique index if not exists approvals_open_key
  on public.approvals (user_id, idempotency_key)
  where status in ('proposed','approved','executing');
create index if not exists approvals_user_status on public.approvals (user_id, status, created_at desc);
create index if not exists approvals_conversation on public.approvals (conversation_id) where conversation_id is not null;

-- People may still only create proposals; every later state is set by the server.
drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'proposed');

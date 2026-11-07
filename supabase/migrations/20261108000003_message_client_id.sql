-- Messages: an optional id chosen by the device, so a chat or voice turn that
-- is sent again (retry after a dropped connection, double tap) is recognised
-- instead of being saved and answered twice. The person's message carries the
-- device's id; the reply to it carries "<that id>:reply". Unique per person;
-- rows without one are unaffected (NULLs never collide, so a plain unique
-- index works and can also serve as an ON CONFLICT target).
-- Idempotent and non-destructive.

alter table public.messages add column if not exists client_id text;

alter table public.messages drop constraint if exists messages_client_id_length;
alter table public.messages
  add constraint messages_client_id_length check (client_id is null or length(client_id) between 8 and 120);

create unique index if not exists messages_user_client_id on public.messages (user_id, client_id);

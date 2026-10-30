-- Explicit API privileges. Newer hosted Supabase projects don't grant the API
-- roles access to new tables by default (local Supabase does), so state the
-- model here and get the same behaviour everywhere. RLS still decides rows.

-- Signed-out clients get no table access.
revoke all on all tables in schema public from anon;

-- Signed-in users: row access, limited to their own rows by RLS.
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- Invite list and budget overrides are managed by the server only.
revoke all on public.allowed_emails, public.budget_overrides from authenticated;

-- Server (jobs, admin scripts, account deletion).
grant select, insert, update, delete on all tables in schema public to service_role;

-- Hardening flagged by the Supabase security advisor.
-- Trigger helper: pin the search path (it only calls now(), from pg_catalog).
alter function public.set_updated_at() set search_path = '';
-- Profile-creation trigger runs as its owner; nobody needs to call it over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Hosted Supabase doesn't grant the API roles access to new tables (local does),
-- so the server's service role couldn't read or write the waitlist tables.
grant select, insert, update, delete on public.waitlist, public.waitlist_settings to service_role;

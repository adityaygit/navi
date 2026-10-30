-- Local development only: allowlisted test accounts. Real access is granted
-- with scripts/allow-email.mjs against the target project, never committed here.
insert into public.allowed_emails (email, note) values
  ('dev@navi.test', 'local dev account'),
  ('alice@navi.test', 'isolation test user A'),
  ('bob@navi.test', 'isolation test user B')
on conflict do nothing;

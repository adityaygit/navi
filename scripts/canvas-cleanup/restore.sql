-- Canvas cleanup, undo: puts every backed-up row back (rows that already
-- exist again are left alone). Then Canvas can be connected again from
-- Settings if wanted; the restored connection resumes on its schedule.
begin;
insert into public.integration_connections overriding system value select * from navi_backup.cc20261117_integration_connections on conflict do nothing;
insert into public.integration_secrets overriding system value select * from navi_backup.cc20261117_integration_secrets on conflict do nothing;
insert into public.external_courses overriding system value select * from navi_backup.cc20261117_external_courses on conflict do nothing;
insert into public.tasks overriding system value select * from navi_backup.cc20261117_tasks on conflict do nothing;
insert into public.events overriding system value select * from navi_backup.cc20261117_events on conflict do nothing;
insert into public.external_items overriding system value select * from navi_backup.cc20261117_external_items on conflict do nothing;
insert into public.integration_sync_runs overriding system value select * from navi_backup.cc20261117_integration_sync_runs on conflict do nothing;
insert into public.integration_rate_events overriding system value select * from navi_backup.cc20261117_integration_rate_events on conflict do nothing;
insert into public.plan_blocks overriding system value select * from navi_backup.cc20261117_plan_blocks on conflict do nothing;
insert into public.task_dependencies overriding system value select * from navi_backup.cc20261117_task_dependencies on conflict do nothing;
insert into public.notifications overriding system value select * from navi_backup.cc20261117_notifications on conflict do nothing;
insert into public.activity_log overriding system value select * from navi_backup.cc20261117_activity_log on conflict do nothing;
insert into public.approvals overriding system value select * from navi_backup.cc20261117_approvals on conflict do nothing;
insert into public.dismissed_suggestions overriding system value select * from navi_backup.cc20261117_dismissed_suggestions on conflict do nothing;
update public.focus_sessions f set task_id = l.task_id from navi_backup.cc20261117_focus_links l where f.id = l.id and f.task_id is null;
update public.tasks t set parent_task_id = d.parent_task_id from navi_backup.cc20261117_detached_steps d where t.id = d.id and t.parent_task_id is null;
commit;

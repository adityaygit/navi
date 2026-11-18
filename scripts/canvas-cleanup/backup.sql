-- Canvas cleanup, step 1: BACKUP. Copies every row the purge will remove or
-- change into schema navi_backup (not exposed by the Data API; only the
-- database owner can read it). Fails instead of overwriting if a backup with
-- this name already exists. Replace OWNER_EMAIL_HERE. Changes no app data.
begin;
create schema if not exists navi_backup;
revoke all on schema navi_backup from public, anon, authenticated;

create table navi_backup.cc20261117_target as
  select id as user_id, now() as backed_up_at from auth.users where lower(email) = lower('OWNER_EMAIL_HERE');
do $$ begin
  if (select count(*) from navi_backup.cc20261117_target) <> 1 then raise exception 'expected exactly one account for that email'; end if;
end $$;

create table navi_backup.cc20261117_task_ids as
  select id from public.tasks where user_id = (select user_id from navi_backup.cc20261117_target)
    and (source = 'external' or external_ref like 'ext:%' or external_ref like 'was:%');
create table navi_backup.cc20261117_conn_ids as
  select id from public.integration_connections where user_id = (select user_id from navi_backup.cc20261117_target);

create table navi_backup.cc20261117_tasks as select * from public.tasks where id in (select id from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_detached_steps as select id, parent_task_id from public.tasks where parent_task_id in (select id from navi_backup.cc20261117_task_ids) and id not in (select id from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_plan_blocks as select * from public.plan_blocks where task_id in (select id from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_task_dependencies as select * from public.task_dependencies where task_id in (select id from navi_backup.cc20261117_task_ids) or depends_on_task_id in (select id from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_focus_links as select id, task_id from public.focus_sessions where task_id in (select id from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_events as select * from public.events where user_id = (select user_id from navi_backup.cc20261117_target) and external_ref like 'ext:%';
create table navi_backup.cc20261117_integration_connections as select * from public.integration_connections where id in (select id from navi_backup.cc20261117_conn_ids);
create table navi_backup.cc20261117_integration_secrets as select * from public.integration_secrets where connection_id in (select id from navi_backup.cc20261117_conn_ids);
create table navi_backup.cc20261117_external_courses as select * from public.external_courses where connection_id in (select id from navi_backup.cc20261117_conn_ids);
create table navi_backup.cc20261117_external_items as select * from public.external_items where connection_id in (select id from navi_backup.cc20261117_conn_ids);
create table navi_backup.cc20261117_integration_sync_runs as select * from public.integration_sync_runs where connection_id in (select id from navi_backup.cc20261117_conn_ids);
create table navi_backup.cc20261117_integration_rate_events as select * from public.integration_rate_events where user_id = (select user_id from navi_backup.cc20261117_target) and (key like 'connect:%' or key = 'refresh');
create table navi_backup.cc20261117_notifications as select n.* from public.notifications n where n.user_id = (select user_id from navi_backup.cc20261117_target) and exists (select 1 from navi_backup.cc20261117_task_ids t where n.dedupe_key like '%' || t.id::text || '%');
create table navi_backup.cc20261117_activity_log as select a.* from public.activity_log a where a.user_id = (select user_id from navi_backup.cc20261117_target) and (a.entity_id in (select id from navi_backup.cc20261117_task_ids) or a.entity_id in (select id from navi_backup.cc20261117_conn_ids) or a.action like 'integration.%');
create table navi_backup.cc20261117_approvals as select a.* from public.approvals a where a.user_id = (select user_id from navi_backup.cc20261117_target) and (a.details->>'id') in (select id::text from navi_backup.cc20261117_task_ids);
create table navi_backup.cc20261117_dismissed_suggestions as select d.* from public.dismissed_suggestions d where d.user_id = (select user_id from navi_backup.cc20261117_target) and d.key in (select 'old_task:' || id from navi_backup.cc20261117_task_ids);

do $$ declare r record; begin
  for r in select table_name from information_schema.tables where table_schema = 'navi_backup' and table_name like 'cc20261117_%' loop
    execute format('revoke all on navi_backup.%I from public, anon, authenticated', r.table_name);
  end loop;
end $$;

-- What was backed up.
select 'tasks' as t, count(*) from navi_backup.cc20261117_tasks
union all select 'plan_blocks', count(*) from navi_backup.cc20261117_plan_blocks
union all select 'events', count(*) from navi_backup.cc20261117_events
union all select 'external_items', count(*) from navi_backup.cc20261117_external_items
union all select 'notifications', count(*) from navi_backup.cc20261117_notifications
union all select 'activity_log', count(*) from navi_backup.cc20261117_activity_log;
commit;

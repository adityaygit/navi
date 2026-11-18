-- Canvas cleanup, step 2: PURGE (destructive; needs the owner's approval).
-- Uses only the ids saved by backup.sql, in one transaction: either all of it
-- happens or none. Checks the backup is complete first. Disconnecting (deleting
-- the connection) stops Canvas sync, so nothing is imported again.
begin;
do $$ begin
  if to_regclass('navi_backup.cc20261117_tasks') is null then raise exception 'run backup.sql first'; end if;
  if (select count(*) from navi_backup.cc20261117_tasks) <> (select count(*) from navi_backup.cc20261117_task_ids) then raise exception 'backup incomplete'; end if;
  -- Nothing new imported since the backup (else re-run the backup under a new name).
  if exists (select 1 from public.tasks where user_id = (select user_id from navi_backup.cc20261117_target)
             and (source = 'external' or external_ref like 'ext:%' or external_ref like 'was:%')
             and id not in (select id from navi_backup.cc20261117_task_ids)) then raise exception 'new imported tasks since the backup'; end if;
end $$;

-- The person's own steps under an imported task stay (moved to top level).
update public.tasks set parent_task_id = null where id in (select id from navi_backup.cc20261117_detached_steps);
-- Stop syncing first: the connection and everything hanging off it (secret, courses, items, sync runs).
delete from public.integration_connections where id in (select id from navi_backup.cc20261117_conn_ids);
delete from public.integration_rate_events where id in (select id from navi_backup.cc20261117_integration_rate_events);
-- Plan blocks first (their task link would otherwise just be cleared).
delete from public.plan_blocks where id in (select id from navi_backup.cc20261117_plan_blocks);
delete from public.notifications where id in (select id from navi_backup.cc20261117_notifications);
delete from public.activity_log where id in (select id from navi_backup.cc20261117_activity_log);
delete from public.approvals where id in (select id from navi_backup.cc20261117_approvals);
delete from public.dismissed_suggestions where id in (select id from navi_backup.cc20261117_dismissed_suggestions);
delete from public.events where id in (select id from navi_backup.cc20261117_events);
-- Dependencies cascade; focus sessions keep their record with the task link cleared.
delete from public.tasks where id in (select id from navi_backup.cc20261117_task_ids);

-- Nothing imported is left for this account.
do $$ declare left_tasks int; left_items int; begin
  select count(*) into left_tasks from public.tasks where user_id = (select user_id from navi_backup.cc20261117_target) and (source = 'external' or external_ref like 'ext:%' or external_ref like 'was:%');
  select count(*) into left_items from public.external_items where user_id = (select user_id from navi_backup.cc20261117_target);
  if left_tasks <> 0 or left_items <> 0 then raise exception 'purge incomplete: % tasks, % items left', left_tasks, left_items; end if;
end $$;
commit;

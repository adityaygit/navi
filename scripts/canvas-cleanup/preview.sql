-- Canvas cleanup, step 0: READ-ONLY preview of exactly what would be removed.
-- Replace OWNER_EMAIL_HERE. Changes nothing (read-only transaction, rolled back).
begin read only;
with me as (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE')),
t as (select id from public.tasks where user_id = (select id from me) and (source = 'external' or external_ref like 'ext:%' or external_ref like 'was:%')),
c as (select id from public.integration_connections where user_id = (select id from me))
select 'tasks (imported: open)' as what, count(*) from public.tasks where id in (select id from t) and status in ('todo','in_progress','blocked')
union all select 'tasks (imported: done)', count(*) from public.tasks where id in (select id from t) and status = 'done'
union all select 'tasks (imported: cancelled/parked)', count(*) from public.tasks where id in (select id from t) and status = 'cancelled'
union all select 'steps you wrote under an imported task (kept, detached)', count(*) from public.tasks where parent_task_id in (select id from t) and id not in (select id from t)
union all select 'plan_blocks on imported tasks', count(*) from public.plan_blocks where task_id in (select id from t)
union all select 'task_dependencies touching imported tasks', count(*) from public.task_dependencies where task_id in (select id from t) or depends_on_task_id in (select id from t)
union all select 'focus_sessions on imported tasks (kept, unlinked)', count(*) from public.focus_sessions where task_id in (select id from t)
union all select 'events (imported)', count(*) from public.events where user_id = (select id from me) and external_ref like 'ext:%'
union all select 'integration_connections', count(*) from public.integration_connections where id in (select id from c)
union all select 'integration_secrets (encrypted feed link)', count(*) from public.integration_secrets where connection_id in (select id from c)
union all select 'external_courses', count(*) from public.external_courses where connection_id in (select id from c)
union all select 'external_items', count(*) from public.external_items where connection_id in (select id from c)
union all select 'integration_sync_runs', count(*) from public.integration_sync_runs where connection_id in (select id from c)
union all select 'integration_rate_events (feed limits)', count(*) from public.integration_rate_events where user_id = (select id from me) and (key like 'connect:%' or key = 'refresh')
union all select 'notifications about imported tasks', count(*) from public.notifications n where n.user_id = (select id from me) and exists (select 1 from t where n.dedupe_key like '%' || t.id::text || '%')
union all select 'activity_log entries about imported tasks / the feed', count(*) from public.activity_log a where a.user_id = (select id from me) and (a.entity_id in (select id from t) or a.entity_id in (select id from c) or a.action like 'integration.%')
union all select 'approvals about imported tasks', count(*) from public.approvals a where a.user_id = (select id from me) and (a.details->>'id') in (select id::text from t)
union all select 'dismissed_suggestions about imported tasks', count(*) from public.dismissed_suggestions d where d.user_id = (select id from me) and d.key in (select 'old_task:' || id from t)
union all select 'KEPT: your own tasks (all statuses)', count(*) from public.tasks where user_id = (select id from me) and id not in (select id from t);
rollback;

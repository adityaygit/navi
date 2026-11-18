-- Navi reliability repair (2026-11-16): READ-ONLY reconciliation preview.
-- Run in the Supabase SQL editor (or psql) against the project. It changes
-- nothing. Replace OWNER_EMAIL_HERE (every query) with the account's email. Every query is scoped to that
-- one account. See docs/navi-1.5/RELIABILITY_REPAIR.md for what each section
-- means and the proposed (not executed) actions.

begin read only;

-- 1. Canvas items vs Navi tasks: one task per item, no orphans.
select i.kind, i.state, i.hidden, i.hidden_reason, (i.task_id is not null) as has_task, count(*)
from external_items i where i.user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE'))
group by 1, 2, 3, 4, 5 order by count(*) desc;

-- 2. Imported tasks by status and deadline (overdue + open = held for triage after this repair).
select t.status,
       case when t.due_at < c.created_at then 'past due when imported'
            when t.due_at < now() then 'overdue since import'
            else 'upcoming' end as bucket,
       count(*)
from tasks t
join external_items i on i.task_id = t.id
join integration_connections c on c.id = i.connection_id
where t.user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE'))
group by 1, 2 order by 1, 2;

-- 3. The triage list itself (what the person decides: handed in / still to do / not needed).
select t.id, t.title, t.due_at, t.status
from tasks t
where t.user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE')) and t.source = 'external'
  and t.status in ('todo', 'in_progress', 'blocked') and t.due_at < now()
order by t.due_at;

-- 4. Same-title open tasks (possible duplicates). Different courses can share a title.
select lower(regexp_replace(title, '\s*\[[^\]]*\]\s*$', '')) as key, count(*),
       json_agg(json_build_object('id', id, 'title', title, 'source', source, 'created', created_at) order by created_at) as rows
from tasks
where user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE')) and status in ('todo', 'in_progress', 'blocked')
group by 1 having count(*) > 1;

-- 5. Open plan blocks on overdue imported tasks (Navi's auto blocks are replaced on the next re-plan;
--    pinned / user blocks are the person's choice and stay).
select b.plan_date, b.created_by, b.pinned, b.status, t.title, t.due_at
from plan_blocks b join tasks t on t.id = b.task_id
where b.user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE')) and t.source = 'external' and t.status = 'todo'
  and t.due_at < now() and b.status in ('planned', 'in_progress')
order by b.plan_date;

-- 6. Imported tasks left without any link (the pre-repair disconnect bug). Expected 0.
select count(*) as unlinked_imports from tasks
where user_id = (select id from auth.users where lower(email) = lower('OWNER_EMAIL_HERE')) and source = 'external' and external_ref is null;

-- 7. Migration history drift: schema objects present vs versions recorded.
select version, name from supabase_migrations.schema_migrations order by version;
select to_regclass('public.external_items') is not null as canvas_tables_present,
       to_regclass('public.day_exceptions') is not null as constraint_planning_present,
       to_regclass('public.day_plan_scope') is not null as planner_commands_present;

rollback;

# Navi core reliability repair (2026-11-16)

**Branch:** `claude/nice-noether-npoufz` (merged `claude/elegant-pascal-qmc5ct` first: it holds the planner command layer and the configurable 48-hour deadline-risk window `preferences.plan_deadline_risk_hours`, both kept as they were).
**Status:** implemented and verified locally (local Supabase, faked model network calls). **Not deployed.** No production data changed. No hosted migration needed for this repair's code.

## Evidence (read-only, owner's account on the hosted project)

Aggregate queries only, scoped to the owner's account (the project has one user).

| Finding | Number |
|---|---|
| Canvas connections / items / linked tasks | 1 / 75 / 75 (no item-level duplicates) |
| Assignments already **past due when first imported** (feed covers 30 days back) | 50 (owner marked 26 done by hand on Nov 15; **24 still open**) |
| Imported assignments that became overdue since | 7 open |
| Upcoming imported assignments | 17 |
| "Overdue" push notifications sent for imported items | 25 |
| Navi-created duplicate task ("PBL Major …", 70 s apart, from chat) | 1 pair |
| Imported tasks unlinked by the old disconnect path | 0 (that bug didn't hit this account; fixed anyway) |
| Account-specific settings | `planner_v2` on, `planner_commands` off, timezone America/New_York |
| RLS | Enabled on every public table; task/item/block/message/approval policies are `user_id = auth.uid()` |
| Migration history | `20261110000001` and `20261111000001` are applied (tables exist) but **not recorded** in `schema_migrations`; `20261117000001` (planner commands) not applied |

Production chat transcript (same day), turn by turn: a move to tomorrow was undone by the next re-plan; "I've sent a card…" with no card; "is it added?" created a second task; Oct 21 assignments reported as "due today but doesn't fit"; "for the next hour" saved as a 60-minute cap for the whole day.

## Root causes

1. **Canvas feeds have no submission state.** Every assignment from the last 30 days was imported as an open `todo` with a hard deadline, so handed-in work showed as overdue, filled plans ("47/49 didn't fit"), triggered overdue pushes and was listed in briefings. The triage rule existed only behind `planner_commands` (off for this account).
2. **Context truncation.** The model's overview listed the first 40 open tasks sorted by due date (nulls last). 31 overdue imports took most slots, so the person's own undated tasks (including one created a minute earlier) were invisible: the model re-created it.
3. **No check between the model's words and what happened.** The reply text was saved as is; with no text the reply was "Done."; `plan` reported `mutated: true` even when nothing changed and didn't name requested work that wasn't placed.
4. **Re-plan ignored work placed on later days.** `alreadyScheduledMinutes` counted only blocks on days *before* the planned day, so a test moved to tomorrow was planned again tonight (v1 and v2).
5. **Overdue wording.** "due today" was used for anything due on or before the day.
6. **Disconnect "keep items"** cleared `external_ref`, turning assignments into personal tasks; reconnecting re-imported everything (finished ones as new to-dos).

Account-specific explanation: the owner's experience differs from a fresh account because of (1) + (2): 75 imports, half past due, and `planner_v2` on. Not caused by RLS, auth or old migrations (the unrecorded migrations are applied; only the history is out of step).

## Changes

| Area | Files |
|---|---|
| Triage rule (pure) | `src/lib/triage.ts` (new): `awaitingTriage`, `isImported`, `isFeedOwned`, `provenanceRef`, `dueWording` |
| Schedulers | `src/server/planner/scheduler.ts` (v1: triage list, overdue wording), `scheduler-v2.ts` (triage under every policy; work the person placed is "chosen") |
| Planner persistence | `src/server/planner/plan-v2.ts` (`scheduledElsewhere`: pinned/user blocks on later days count), `plan.ts` (same for v1) |
| Briefings / pushes | `src/server/jobs/briefings.ts` (one "N imported items past due, which are done?" line), `tick.ts` ("If you handed it in, mark it done") |
| Canvas identity | `src/server/integrations/connections.ts` (disconnect keeps `was:canvas:<host>:<uid>`), `feed-sync.ts` (reconnect re-links by provenance, legacy only on exact title + due; `counts.relinked`), `entities.ts` + `task-card.tsx` (only `ext:` refs are Canvas-owned) |
| Chat truth | `src/lib/claims.ts` (new), `src/server/ai/agent.ts` (one correction pass, then deterministic removal; no bare "Done.") |
| Tools | `src/server/ai/tools.ts`: full open-task context with triage summary; `create_task` duplicate guard (`findSameTask`, `allow_duplicate`); `resolve_overdue_imports` (new, quote-checked, read-back verified); `get_backlog` in every mode; `plan` honest `mutated` + unmet focus named; `capacity_minutes` description |
| Plan summary | `src/lib/plan-summary.ts` (triage for every policy) |

Interaction model kept: explicit commands run directly; inferred items still go to the inbox; external actions still need approval; no new confirmation dialogs; no screen changes beyond the Canvas due-date lock following `ext:` refs.

## Verification

- `tsc --noEmit` and `eslint`: clean.
- Full suite (local Supabase): **unit 285/285, integration 296/296** (+1 skipped real-model test that needs a paid key).
- New tests: `tests/integration/chat-truth.test.ts` (8), `planner-repair.test.ts` (6), `account-parity.test.ts` (5), `canvas-sync.test.ts` (+2), `tests/unit/claims.test.ts` (6), `planner-repair.test.ts` (5). **18 of them fail on the pre-repair code** (checked by stashing `src/`).
- Hosted-shaped schema: with `20261117000001` removed locally, 14 core suites pass (182/183; the one failure is a planner-commands test that needs that migration by design).
- Not verified: real Claude (no paid calls this session; the correction pass is model-agnostic), Gemini Live voice, a physical phone, the hosted deployment.

## Production data: reconciliation plan (NOT executed; needs the owner's approval)

Run `scripts/reconcile-preview.sql` (read-only, `begin read only … rollback`) to see the current state. Proposed actions:

1. **No data change is needed for triage.** It's derived (open + imported + past due), so the 31 overdue imports stop being planned or nagged as soon as this code is deployed. The owner decides per item: in chat, "these are handed in" (uses `resolve_overdue_imports`), or mark done in Tasks.
2. **Duplicate "PBL Major – BID Urban Gardening"** (two open tasks created by Navi 70 s apart, no blocks or focus sessions on either): set the newer one to `cancelled` (reversible), keep the older. Preview: query 4 of the script. SQL to run only with approval:
   ```sql
   -- keeps the older copy; reversible (status back to 'todo')
   update tasks set status = 'cancelled'
   where id = '<newer id from query 4>' and status = 'todo'
     and not exists (select 1 from plan_blocks b where b.task_id = tasks.id);
   ```
3. **Stale Navi blocks on past days (6)** attached to overdue imports: leave them. They're the evening review's "how did it go" record; marking them is the owner's call. The one pinned block (moved test, tomorrow) is the owner's choice and stays planned.
4. **Migration history drift:** record the two applied versions so `supabase db push` doesn't try to re-run them (needs approval; check query 7 first):
   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('20261110000001', 'constraint_planning'), ('20261111000001', 'external_calendar_feeds')
   on conflict do nothing;
   ```
5. **Before turning on `planner_commands`**, apply `20261117000001_planner_commands.sql` (from the merged planner branch). This repair's code doesn't need it while the switch is off.

## Deploy order (each step needs the owner's OK)

1. Review/merge this branch (PR, CI green).
2. Optional: step 4 above (history only).
3. Deploy. No env var changes.
4. Watch: chat replies with `[agent] unsupported claim removed` in logs; `create_task` "NOT created again" rates.

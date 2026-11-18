# Planner reliability overhaul (scheduling commands)

**Status:** built and verified locally on `claude/elegant-pascal-qmc5ct` (2026-11-16). **Not deployed.** Hosted migration, merge, deploy and turning it on all need the owner's separate approval (see *Production rollout*).
**Switch:** `profiles.preferences.planner_commands = true` (on top of `planner_v2`). Default off: v2 behaves exactly as before.
**Source:** the owner's locked decisions D1–D6 (planner reliability handoff, 2026-11-16), the read-only audit in this session, and the approved implementation plan (Option B: a scheduling-command layer around the existing v2 engine).

## What changed for the person

| Before (historical failures) | Now |
|---|---|
| "Put Navi work at 2 PM" became "Made Navi work a must-do" and "Your plan already works; nothing changed" (R1/R2) | `schedule_task` saves a block at 2 PM; the reply comes from a read-back check. Must-do is reported as priority, never as a time. |
| Old overdue Canvas items filled the day; "47/49 things didn't fit" (R3/R7) | Overdue imported work is held for the person's decision (triage), keeping its deadline, course and ids. "Didn't fit" counts only today's work; future work "waits for another day". |
| "Only plan these today" was ignored; excluded Algebra came back (R3/R6) | Per-day scope (only / also / not), respected by every re-plan (chat, buttons, recovery, morning tick). |
| Clearing a day = 13 separate delete cards (R4) | One change (one card only if high impact), tasks kept, fixed events and hand-placed blocks kept, one Undo. |
| Grouping ignored (R5) | Grouped work session: back-to-back blocks sharing a session; moves and resizes as a unit; each task keeps its identity. |
| Brain-dump "schedule X at 4" went to the inbox (R8) | Explicit "add/schedule X at T" → created and planned directly; anything inferred still goes to the inbox. |
| Accountability could loop (R9) | One challenge per decision (recorded), then the person's choice runs; never for their own edits; never a block. |
| No preview, no check after (R10) | Every change: preview → impact → authorize → apply (one change set) → verify → report. |
| "30 minutes is enough" was scaled by the learned ratio (R11) | The person's own estimate is never scaled; a one-off correction is not a rule. |
| Overload hidden in counts (R12) | Must-do first, durations never shrunk, real shortfall named with options. |
| A proposal approved later could overlap a manual change (R13) | Stale check over every planning input; the card expires instead. |
| Manual and AI edits used different paths (R14) | One command contract: Navi's tools, "Put it there" (web), the phone `/api/m/schedule`. |

## Pipeline

```
Interpret → Preview → Analyze → Authorize → (Challenge once) → Apply → Verify → Report
```

- **Interpret** (`src/server/planner/commands/interpret.ts`): a command becomes exact ops on specific blocks (`insert`, `move`, `remove`), the day's scope (`scope`) and one-day facts (`exception`), plus the conditions that must hold afterwards. Impossible requests (finished task, started block, bad time) return `infeasible` with the reason and free times.
- **Preview** (`computeRun` in `src/server/planner/plan-v2.ts`): no writes. Applies the explicit ops in memory, then re-fits the affected days with the deterministic v2 scheduler. Explicit commands only move work already planned there (`refit: "existing"`); full re-plans and scope changes plan the day; "clear my day" refills nothing.
- **Analyze** (`impact.ts`, pure): displaced/pushed/unplanned work, deadlines at risk inside the configurable risk window (`preferences.plan_deadline_risk_hours`, default 48), must-do removed, overlaps with fixed commitments (infeasible unless explicitly allowed), changes to hand-placed or fixed blocks, spillover, soft notes.
- **Authorize** (`authorize.ts`, pure): the person's own edits run. Navi: low/moderate run with Undo (or a card in "ask me first"); **high impact needs informed approval**: one card listing the consequences, or the person's own words this turn naming every high consequence (`authorize` keys + `user_quote`, checked against the server-held message).
- **Challenge once** (`accountability.ts`): only when Navi would take at-risk work off (hard deadline in the window, must-do, skipped 3+ times without an outside reason), only if it would otherwise run directly, at most once per decision (`accountability_checks`), skipped if the person already gave a reason or reaffirmed.
- **Apply** (`persistRun` + `apply_plan_changeset`): one change set, under the per-person lock, all or nothing; refused as stale if `plan_inputs_version` (blocks, events, one-session changes, routines, day facts, scope, open tasks) changed since the preview; retried once from fresh data. Idempotent per request key.
- **Verify** (`verify.ts`): reads the saved rows back; checks every op and every requested condition. Stored on the change set.
- **Report** (`report` in `commands/index.ts`): the reply and card come from the verification. A failed check says exactly what isn't as asked (with Undo).

Conversational approval (`confirmChange`): "yes" resolves to exactly one plan card in this chat that was shown before this message, with its consequences on it; two waiting → one question; "no" or an offer made in the same turn → nothing approved. A newer offer for the same day expires the older card.

## Files

- New: `src/server/planner/commands/{index,types,interpret,impact,authorize,verify,accountability}.ts`, `src/server/domain/planning-rules.ts`, `supabase/migrations/20261117000001_planner_commands.sql`, `supabase/rollback/20261117000001_planner_commands_down.sql`.
- Changed: `scheduler-v2.ts` (policy "commands": scope, triage, chosen > must > upcoming hard deadlines, own estimates unscaled, far-off imports below own work, today/later buckets), `plan-v2.ts` (computeRun/persistRun split, new op kinds, rules), `plan-summary.ts` (honest wording and buckets), `tools.ts` (new tools, rerouting, partial-failure Undo, overview), `prompts.ts`, `chat.ts` (turn ids, routing, short "yes"), `devsim.ts`, `voice.ts`, `approvals.ts` (verified card apply, expiry of replaced offers), `tasks.ts` (estimate source), `place.ts`, `mobile/router.ts` (`POST /api/m/schedule`), `scripts/planner-flag.mjs` (`commands-on|off`).
- AI tools (only with the switch): `schedule_task`, `swap_work`, `change_block`, `remove_work`, `lock_block`, `set_day_scope`, `group_session`, `split_task`, `confirm_change`, `get_backlog`, `learn_planning_rule`, `list_planning_rules`, `update_planning_rule`. `plan`, `plan_day/week`, `move_block`, `shift_blocks`, `update_item` (block times), `delete_item` (blocks) and `create_task` (`schedule`) route through the pipeline.

## Migration `20261117000001_planner_commands` (local only)

Additive and idempotent: `day_plan_scope`, `planning_rules`, `accountability_checks` (owner-only RLS); `tasks.estimate_source`; `plan_blocks.placement/session_id/session_title` (backfill: user blocks → `manual`, pinned Navi blocks → `requested`); `plan_changesets` command/impact/postconditions/verification/base_version/idempotency_key/conversation_id/offered; `plan_inputs_version()`; replaced `apply/revert_plan_changeset` (old change sets keep the exact old logic). Verified locally: applies via `supabase db reset`, re-runs as a no-op, rollback script restores the old functions and the existing v2 suites pass on it, re-apply works.

## Tests (local stack, simulator unless noted)

- `tests/unit/planner-reliability.test.ts`, `tests/unit/planner-commands.test.ts`: policy, impact, authorization, verification, rules.
- `tests/integration/planner-commands.test.ts`: pipeline end to end, concurrency, idempotency, stale approvals, offers/"yes", grouped sessions, accountability, rules, RLS, Canvas-heavy overload.
- `tests/integration/planner-reliability.test.ts`: R1–R14 through the chat turn; all but two fail with the switch off.
- `tests/integration/mobile-api.test.ts`: `/api/m/schedule`.
- `tests/integration/planner-real-model.test.ts`: real Claude, skipped unless `NAVI_REAL_MODEL_EVAL=1`. Run: `scripts/local-only.sh env NAVI_ANTHROPIC_API_KEY="$NAVI_ANTHROPIC_API_KEY" NAVI_DAILY_BUDGET_USD=1 NAVI_REAL_MODEL_EVAL=1 NAVI_EVAL_OUT=/tmp/eval.txt npx vitest run tests/integration/planner-real-model.test.ts`.

**Real-model result (2026-11-16, local DB, Sonnet 5.5 planner / Haiku 5.5 fast, $1 local guard): 10/10 scenarios as intended, $0.29.** R1 schedule_task 14:00; R1b swap_work; R3 set_day_scope (only the two listed; Canvas left off; Algebra due tomorrow flagged); R4 one remove_work, 0 cards, 13 tasks kept; R11 estimate 30 (user), no rule; R9 one challenge then removed on "I know, take it off anyway"; R2 "isn't placed at a specific time yet"; R8 pamphlet planned at 4 PM, guitar to the inbox; R5 one session from 3 PM; offer → card → "yes" → confirm_change → planned at 4 PM.

## Production rollout (each step needs the owner's OK)

1. Review and merge `claude/elegant-pascal-qmc5ct` into `main` (PR; CI green).
2. Apply `supabase/migrations/20261117000001_planner_commands.sql` to the hosted project (`supabase db push`, or the SQL editor and then record the version). Additive; old code keeps working with it.
3. Deploy (Vercel from `main`).
4. Turn it on for the owner's account only: `node scripts/planner-flag.mjs commands-on <owner email>` with hosted env (or the SQL `update profiles set preferences = preferences || '{"planner_commands": true}' where id = '<id>'`).
5. Watch: `plan_changesets.verification` (any `ok:false`), `status in ('expired')` rates, `accountability_checks`.

**Rollback:** `commands-off` (instant; v2 as before). If needed, `supabase/rollback/20261117000001_planner_commands_down.sql` restores the previous functions (new tables/columns stay; dropping them would destroy data).

## Known limits

- The stale check fingerprints every open task: an unrelated task edit between a card and its approval expires the card ("ask Navi for a fresh plan"). Safe, occasionally inconvenient.
- Learned rules are inspected/edited by chat (`list_planning_rules`, `update_planning_rule`); no visual list (UI changes were out of scope, Session 3).
- Grouped sessions are stored as linked blocks; My day shows them as separate blocks until the Session 3 UI groups them.
- Real-model behaviour was checked on 10 scenarios once; voice (Gemini Live) uses the same tools and prompt but was not re-run with a real voice session.
- Three Playwright specs (`actions.spec.ts` ×2, `core.spec.ts` onboarding) fail identically on the untouched base `259a967` (they expect older chat/onboarding UI text); not caused by this work.

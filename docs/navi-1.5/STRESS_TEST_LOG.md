# Navi stress-test log

Started 2026-11-17 on `claude/nice-noether-npoufz`. Every entry: how it was found, the exact reproduction, expected vs actual, cause, fix, regression test. Isolated local test accounts only; never the owner's account.

## Harnesses

| Harness | What it drives | Model | Where |
|---|---|---|---|
| Stateful simulation | A seeded simulated student: ~2 weeks of mixed use through the real tools and APIs (create / Navi re-create, plan + re-plan, move + pin, place by hand, finish / drop / delete, skip, undo, Canvas syncs that change, drop and repeat items, disconnect + reconnect, triage). 8 invariants checked against the database after every step. Same seed = same run. | none (tools called directly) | `tests/integration/stress-sim.test.ts` (`NAVI_STRESS_SEEDS`, `NAVI_STRESS_STEPS`) |
| Scripted model | The real tool loop with the model's replies scripted (false claims, repeats, failures) | faked network only | `tests/integration/chat-truth.test.ts` |
| Real model | Multi-turn conversations through the real chat pipeline (`handleTurn`) with Claude, database checked after each turn | Claude (Haiku 5.5 fast / Sonnet 5.5 planner) | `tests/stress/real-model.test.ts` |

### Invariants (stateful simulation)

- **I1** a block the person placed, or asked Navi to move, stays where it is (until that task is finished or dropped)
- **I2** Navi's flexible blocks never overlap a fixed event
- **I3** a task is never booked twice at overlapping times, and Navi doesn't book far more time than it needs
- **I4** no open work is planned (from tomorrow on) for a finished, dropped or deleted task
- **I5** Navi never creates a second open copy of a task
- **I6** every open task appears exactly once on the phone's list (Today / Needs a time / Later / Needs a decision)
- **I7** overdue Canvas work is never auto-planned
- **I8** no task disappears unless it was deleted (directly or by undoing its creation)
- **E1** no operation throws

## Findings

### S1. The same task booked on several days (planner, data) — FIXED
- **Found by:** stress simulation, seeds 2 and 6.
- **Repro (seed 6):** plan Mon Nov 23 → plan Sat Nov 21 → plan Thu Nov 19. Each Canvas assignment (30 min) ends up with a block on all three days (90 min of blocks).
- **Expected:** one 30-minute block, on the earliest day that fits. **Actual:** three.
- **Cause:** `computeRun` only counted work already planned on days *before* the planned day; Navi's own blocks on *later* days were invisible, so each earlier day booked the task again.
- **Fix:** `src/server/planner/plan-v2.ts`: after a day books a task, Navi's own unpinned blocks for it on later days outside the run are dropped, latest first, until the task isn't booked beyond what it needs. The person's blocks and pinned blocks are never touched.
- **Regression:** `planner-repair.test.ts` "planning a later day and then an earlier one books a task once" (fails without the fix).

### S2. Undoing an old plan brings back finished work (planner, data) — FIXED
- **Found by:** stress simulation, seed 6, step 40.
- **Repro:** run A books "Math problem set" on day d → the person places it on d+1 → run B takes it off d → the person finishes it → undo run B. A planned block for the finished task reappears on d.
- **Cause:** `revert_plan_changeset` restores the blocks a run removed, regardless of what happened to their tasks since.
- **Fix:** `revertChangeset` drops open blocks from today on whose task isn't open any more (outcome-recorded blocks stay as history).
- **Regression:** `planner-repair.test.ts` "undoing an old plan run doesn't bring back blocks for work finished since" (fails without the fix).

### Harness corrections (not app bugs)
- Two "Navi moves" of the same block: the newer request replaces the older expectation.
- Undoing Navi's "created task" deletes it: counted as an explicit deletion for I8.

## Runs

| Date | Harness | Scope | Result |
|---|---|---|---|
| 2026-11-17 | stress simulation | seeds 1–8 × 40 steps (before fixes) | S1, S2 found |
| 2026-11-17 | stress simulation | seeds 1–12 × 50 steps (after fixes) | 12/12 pass, all invariants hold |

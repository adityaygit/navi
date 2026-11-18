# Navi stress-test log

Started 2026-11-17 on `claude/nice-noether-npoufz`. Every entry: how it was found, the exact reproduction, expected vs actual, cause, fix, regression test. Isolated local test accounts only; never the owner's account.

## Harnesses

| Harness | What it drives | Model | Where |
|---|---|---|---|
| Stateful simulation | A seeded simulated student: ~2 weeks of mixed use through the real tools and APIs (create / Navi re-create, plan + re-plan, move + pin, place by hand, finish / drop / delete, skip, undo, Canvas syncs that change, drop and repeat items, disconnect + reconnect, triage). 8 invariants checked against the database after every step. Same seed = same run. | none (tools called directly) | `tests/integration/stress-sim.test.ts` (`NAVI_STRESS_SEEDS`, `NAVI_STRESS_STEPS`) |
| Scripted model | The real tool loop with the model's replies scripted (false claims, repeats, failures) | faked network only | `tests/integration/chat-truth.test.ts` |
| Real model | 13 multi-turn scenarios (truth, planner, messy phrasing, continuity, Canvas backlog) through the real chat pipeline (`handleTurn`) with Claude; verdict from the database, not the reply. Mirrors the production account setup (planner v2 on, commands off, autonomy auto). | Claude (Haiku 5.5 fast / Sonnet 5.5 planner) | `tests/integration/stress-real-model.test.ts` |

Real-model run (needs `NAVI_ANTHROPIC_API_KEY`; spend capped by the app's own guard):

```bash
scripts/local-only.sh env NAVI_ANTHROPIC_API_KEY="$NAVI_ANTHROPIC_API_KEY" NAVI_DAILY_BUDGET_USD=1 NAVI_REAL_MODEL_EVAL=1 NAVI_EVAL_OUT=/tmp/real.md npx vitest run tests/integration/stress-real-model.test.ts
```

`NAVI_STRESS_ONLY=A1,C3` runs a subset. Full transcripts: `docs/navi-1.5/stress-runs/`.

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

### R1. "Did you actually do that?" → Navi retracts a true "Added" (chat truthfulness) — FIXED
- **Found by:** real-model scenario A1; reproduced in 4 of 5 runs before the fix.
- **Repro:** "add bio lab report due friday" (create_task runs, task created) → "wait did you actually do that?". Replies: "Not as a new task… was already on your list before your message… My earlier 'Added' was misleading" / "It was already there before I ran the add, so I can't say my request created it". The activity log shows the task was created by that reply.
- **Expected:** "Yes, it's on your list…" (true). **Actual:** a false retraction, no tool call.
- **Cause:** the model's inputs were correct (history: "Created task …"; snapshot listed the task), but nothing told it, as fact, that its earlier step really happened, and the rule "don't repeat earlier claims a tool result in this turn doesn't confirm" pushed it to distrust its own true history. Not fixed with prompt wording.
- **Fix:** `src/server/ai/chat.ts`: at the start of every turn Navi's code checks each earlier step in the history against the database (activity entry not undone, row still exists) and the history line says "verified by Navi's code at the start of this turn: this reply really did it (it created the item; it did not exist before), and it is still in place" — or "the user undid this". `src/server/ai/tools.ts` overview: recent tasks show "added N min ago".
- **Regression:** `chat-truth.test.ts` "A1: on the next turn Navi is told, from the database, …" (fails without the fix). Real model after the fix: A1 4/4 + 1/1 in the full run.

### R2. "Searching now shows…" with no search (chat truthfulness) — FIXED
- **Found by:** real-model scenario A1, run 1.
- **Repro:** second reply: "Yes, the task exists. Searching now shows one task …, and it was already on your list before I added it" — no tool ran. The claim check skipped the sentence because "already"/"before" mark references to earlier turns.
- **Fix:** `src/lib/claims.ts`: a new "checked" claim kind ("I checked", "I just looked", "searching now shows", "a quick search shows") is backed only by a tool that ran in this turn; a negation only counts before or inside the claim. Unbacked → the correction pass (the model then actually searches or rewrites).
- **Regression:** `claims.test.ts` "catches a claimed look-up when no tool ran", `chat-truth.test.ts` "A1: 'Searching now shows…' …" (both fail without the fix).

### R3. "Actually forget what I just said" → a deletion approval card (usability, chat) — FIXED
- **Found by:** real-model scenario C3.
- **Repro:** "add a task to call grandma tonight" (created) → "actually forget what I just said" → delete_item → a card "remove Call grandma", the task stays until the person taps Approve. Reply was honest about it.
- **Expected:** taking back what Navi itself just did is an undo, not a deletion of the person's data.
- **Fix:** `delete_item` on a task Navi created **in this same chat** (one of this chat's replies carries the creation's undo id), unchanged since (same values, no plan blocks, no steps, no later reversible change) is undone directly. Anything else still becomes a card.
- **Regression:** `chat-truth.test.ts` "C3: 'actually forget …' takes back the task Navi just added" (fails without the fix) and "deleting a task Navi didn't just add in this chat (or that changed since) still needs the card".

### Observations (not changed)
- **"Move to tomorrow" = keep off until tomorrow.** For unpinned work the model uses `keep_off_until tomorrow` (C1, C2): nothing is left today and tomorrow's morning plan places it (the 06:00 tick plans a day that has no blocks yet). If tomorrow already has blocks, the tick doesn't re-plan, so the task waits on the list without a time until the person or Navi plans that day. The task is never lost (I6/I8), but tomorrow's view won't show it in advance. Candidate improvement: place a block on tomorrow when tomorrow is already planned.
- **B1 ("I only have like 30 min")** goes to the planner model (Sonnet): $0.06 of the $0.10 run. Correct result (20 of 30 min).
- A failing `plan_day` call with a non-date argument (e.g. "tomorrow") is retried by the model with a date; harmless.

### Harness corrections (not app bugs)
- `NAVI_STRESS_SEEDS=13-40` was read as one `NaN` seed that "passed": ranges are now supported and anything else is an error.
- Long runs (150 steps) hit the Canvas connect rate limit ("Too many connection attempts"), correct app behaviour: the harness now clears rate events between seeds and records a refused (re)connect as an expected outcome.
- A1's first check read "I didn't create a second copy" as a denial; C1/C2 first required a block tomorrow (keep-off-until-tomorrow is also a correct move); C5 first used a loose "claims a change" regex. Each was corrected and re-run.
- Two "Navi moves" of the same block: the newer request replaces the older expectation.
- Undoing Navi's "created task" deletes it: counted as an explicit deletion for I8.

## Runs

| Date | Harness | Scope | Result |
|---|---|---|---|
| 2026-11-17 | stress simulation | seeds 1–8 × 40 steps (before fixes) | S1, S2 found |
| 2026-11-17 | stress simulation | seeds 1–12 × 50 steps (after fixes) | 12/12 pass, all invariants hold |
| 2026-11-17 | stress simulation | seeds 13–40 × 60 steps | 28/28 pass |
| 2026-11-17 | stress simulation | seeds 41–70 × 150 steps (after the rate-limit harness fix) | 30/30 pass |
| 2026-11-17 | real model | 13 scenarios (run 1, before fixes) | 10/13 by state; R1, R2, R3 found; $0.1008 |
| 2026-11-17 | real model | A1 ×8, C1–C3, C5 re-runs while fixing | A1 retraction in 4/5 before R1's fix, 0/4 after; ≈$0.05 |
| 2026-11-17 | real model | 13 scenarios (run 5, after fixes) | 13/13 as intended; $0.1024 |

## Real-model spend (hard ceiling $1, within the $2/day guard)

Local database, Anthropic API (Claude only; no other provider used). Each run's own `ai_usage` rows, priced by `src/server/ai/config.ts`.

| Run | Cost |
|---|---|
| A1 pipeline check | $0.0041 |
| Full run 1 | $0.1008 |
| Re-runs A1, C1, C2, C3, C5 | $0.0335 |
| A1 ×3 (snapshot provenance only) | $0.0055 |
| A1 debug dump (1 turn) | ≈ $0.002 |
| A1 ×4 (after R1 fix) | $0.0071 |
| Full run 5 | $0.1024 |
| **Total so far** | **≈ $0.26** |

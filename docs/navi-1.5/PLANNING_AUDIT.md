# Navi planning: audit and proposed plan (constraint-first, adaptive availability)

**Status:** proposal for owner review. Nothing in Navi's scheduling behaviour has been changed.
**Date:** 2026-11-08 · **Branch:** `claude/planning-audit` (from `claude/bold-cori-laltf6` = `main` @ `6d888d9`)
**Added in this pass:** this document and two test files that record how the planner behaves today (listed in section 11). No app code changed.

---

## Part 1: Summary

### What's wrong today, and why

Navi's planner is reliable but narrow. It does one thing: it takes the free-time windows saved in Settings ("weekdays 4–9 PM"), removes your fixed events, and fills what's left with tasks in order of importance. Everything else follows from that design:

1. **No saved free time means no plan.** If your account has no free-time windows, Navi plans nothing. It doesn't fall back on anything else it knows, such as your school hours, your wake-up time or the gaps between events, and the chat tells you to go and set your availability. That's the friction you ran into.
2. **When free time is saved, it's treated as certain.** New accounts get one window from wake-up to bedtime, every day. Navi then treats your whole waking day as confirmed free time. It doesn't hold back time for meals or rest unless they're saved as routines, and it never says "I'm assuming you're free here." Navi has two settings, either "no free time at all" or "free all day", and nothing between them.
3. **Navi can't record that something is different today.** There is no way to say "karate is cancelled tonight", "I only have two hours today" or "my afternoon opened up" for one day only. The tools Navi has can only cancel the whole weekly event (and that needs your approval) or rewrite your permanent free-time settings, which affects every future day and can't be undone.
4. **The categories you described don't exist yet.** Navi knows "fixed event", "routine" (fixed or not), and "task" (priority 1–4, a due date, and a hard or soft deadline). It has no "must-complete" flag, and no "protected but flexible" routine (for example, dinner sometime between 6 and 8). It has no task dependencies, no "don't start before" date, and no way to lock a block in place.
5. **Moves you ask for don't stick.** If you tell Navi "move my studying earlier", it can move the block, but the next "plan my day" deletes and redraws all of Navi's blocks, so the move is lost.
6. **Re-plans can't be undone.** A re-plan replaces the day's blocks in one step and records no Undo. A planning suggestion and an executed change are also the same thing: Navi has no "here's a proposed plan, apply it?"
7. **Overload is reported but not worked through.** When too much is due, Navi correctly keeps the leftover work and lists what didn't fit. It doesn't suggest tradeoffs, it plans one day at a time without looking ahead to later deadlines, and it doesn't ask the one question that would solve the problem.

**The core is worth keeping.** The scheduling engine is small, deterministic, well tested and safe. It never moves fixed items, never marks work done, never drops work, and handles time zones and daylight saving. The problems are mostly about what feeds the engine: how free time is worked out, how commitments are described, and how changes are saved. The engine's design isn't the problem. **A rewrite isn't needed.**

### What I propose

- **A "day model" in front of the existing scheduler.** For each day, Navi works out every stretch of time from what it already knows: wake-up and bedtime, school and work, events, routines, past plans you accepted, and anything you said about that day. Each stretch gets one of three labels: **confirmed** (you told Navi), **inferred** (Navi's reasonable guess, shown as an assumption) or **unknown** (Navi won't plan there without asking). The scheduler then plans into confirmed time first and inferred time second, and tells you which assumptions it made.
- **Your four categories become real.** Fixed commitments (never moved or overlapped). Protected routines: sleep, meals, exercise and recovery, each with a set amount of flexibility. Must-complete tasks, scheduled first and checked for "can this still be done before its deadline?" Flexible tasks, which fill the rest.
- **One-day exceptions.** "Karate is cancelled tonight", "I only have two hours today" and "I'm free after 3" change that day only, can be undone, and never touch your usual settings.
- **Plan changes as one undoable unit.** Every planning run is saved as one change set. Undo reverses the whole run. A *proposed* plan is shown as a proposal with an Apply button, never as something already done. Blocks you or Navi place on request stay where they are.
- **Honest overload handling.** When everything won't fit, Navi says so and gives you two or three concrete choices, for example: "push Reading to Thursday", "do 60 of the 90 minutes of AP World tonight" or "ask for an extension". It never drops, deletes or completes anything on its own.
- **Better conversation tools.** Navi gets tools that match how people talk ("plan tomorrow from what you know", "move this earlier", "I only have 2 hours"). It asks a question only when a plan can't be built without one, and then just the smallest one.

### What changes for you

- "Plan my day" works with no setup. You get a plan and a line like *"I assumed you're free 4–6 PM and after dinner. Want to change either?"*
- You can talk about today ("my afternoon opened up") without editing settings.
- Each automatic re-plan has an Undo and a one-line explanation of what changed.
- The Settings free-time editor becomes optional ("usual free times") instead of required.
- Existing schedules don't move. Everything that works today keeps working the same way until a plan is next made, and the new planner is switched on for your account first.

### Decisions you need to make (each has a recommended default)

| # | Decision | Recommended default |
|---|---|---|
| D1 | When Navi has no information about a stretch of waking time, should it plan there as an *assumption*, or ask first? | **Plan there as a labelled assumption**, show at most 2 assumptions per plan, and stop assuming once you correct one. |
| D2 | When you state a one-time fact ("karate 6–7:30 tonight", "only 2 hours today"), should Navi apply it right away? | **Yes, right away, with Undo.** It affects that day's plan only. New *recurring* commitments still go to the review inbox. |
| D3 | When you say one session of your own fixed event is cancelled ("no karate tonight"), should that need an approval card? | **No card for one session you cancel yourself.** It applies with Undo. Cancelling or changing the whole series, or anything from a connected calendar, still needs a card. |
| D4 | When Navi re-plans *on its own* (morning plan, after something changed), should it apply the changes or propose them? | **Apply automatically if the day had no plan yet, or if it only moves Navi's own flexible blocks, with Undo and a one-line note. Propose instead if it would move something you placed or locked.** |
| D5 | How flexible are protected routines by default? | **Sleep: never moved. Meals: can shift within ±30 minutes. Exercise and recovery: can move within the same day, but never dropped without asking.** |
| D6 | Should hard-deadline tasks automatically become must-complete? | **No.** Navi suggests it ("This is due tomorrow with a hard deadline. Treat it as must-complete?"), and you decide, or you say it in your own words ("this is non-negotiable"). |
| D7 | Should Navi keep some free time open instead of packing every free minute? | **Yes. By default it plans at most about 70% of free waking time each day.** You can change this by saying so ("you can fill my whole evening"). |
| D8 | In "ask me first" mode, should plans become proposals? | **Yes.** Today planning ignores that setting and runs straight away. |
| D9 | How should this roll out? | **Behind a switch: your account first, then new accounts, then everyone.** Database changes are made locally first, then on the live site only with your OK. |
| D10 | Should "Plan next 7 days" look ahead (save time early in the week for later deadlines)? | **Yes, for must-complete and hard-deadline tasks only.** |

### What I could not check

- **Your own account's data.** I didn't look at the live database, so I can't tell whether your account has no saved free time (problem 1) or the wake-to-bed default (problem 2). Both are covered by this plan.
- **How the real AI handles these sentences.** This pass used the built-in development simulator, not the real Claude or Gemini models, so I haven't confirmed how the real models respond to your example phrases. Section 10 includes a small paid test set to check this before release.
- **Browser tests.** The Playwright browser tests were not run in this pass.

---

## Part 2: Technical audit

### 2.1 Architecture as it stands

```
 Chat / Voice (Anthropic or Gemini Live, devsim locally)
        │  same tool registry: src/server/ai/tools.ts (TOOLS, runTool)
        ▼
 AI tools ── get_overview / get_plan (read) ─────────────► agenda.ts (pure day view)
        │    plan_day / plan_week / recover_plan ───────► plan.ts (I/O, persistence)
        │    update_item / update_task / delete_item ───► entities.ts (needsApproval → approvals.ts)
        │    update_settings (availability) ────────────► profiles row (no undo)
        ▼
 plan.ts ─ loads tasks/events/routines/profile.availability ─► scheduler.ts scheduleDay() (pure, greedy)
        └─ writes via SQL fn replace_day_plan (advisory lock; delete Navi 'planned' flexible blocks; insert new)
 UI: My day (planner/page.tsx) and Home use day.ts + agenda.ts; free gaps from wake/bed (not availability)
 Background: jobs/tick.ts morning tick → generateDayPlan if no blocks and availability non-empty
```

### 2.2 How availability is stored and interpreted

- **Stored:** a single JSON array on the profile, `profiles.availability jsonb default '[]'` (`supabase/migrations/20261030000001_core_schema.sql:68`), typed `AvailabilityWindow = { days, start, end }` (`src/lib/types.ts:20`), validated by `ProfileUpdate.availability` (max 14 windows, `src/server/domain/schemas.ts:113-117`).
- **Written by:**
  - 1.5 onboarding "Basics" sets **one window from wake to bed, every day** (`src/app/(app)/actions.ts:396-427`, line 419). A bedtime after midnight is clipped to 23:59 (line 410).
  - The Settings editor (`src/app/(app)/settings/schedule-settings.tsx:20,45`).
  - Accepting a `preference` proposal **replaces** the array (`src/server/domain/proposals.ts:208-212`).
  - The AI tool `update_settings` (`src/server/ai/tools.ts:589-609`) replaces it for all days, runs immediately in auto mode, and **cannot be undone**, because `profiles` is not in `REVERTIBLE_TABLES` (`src/server/domain/activity.ts:5-16`). This is pinned by a test.
  - Accounts that skipped Basics ("Do this later") and V1-era accounts can have `[]`.
- **Interpreted by `scheduleDay`** (`src/server/planner/scheduler.ts:144-162`): only the windows whose `days` include the weekday count as free time. They are clipped to "now", rounded to 5 minutes, and fixed items plus a 10-minute buffer are removed (line 164-165). Everything outside the windows is treated as **busy**.
  - `[]` → no flexible work and the warning "No availability is set…" (line 146-147).
  - A window crossing midnight (`22:00–01:00`) builds an invalid interval and is **silently dropped**, with no warning (line 152-156). This is pinned by a test.
- **Other readers:**
  - The AI context tells the model "No availability is set, so Navi hasn't scheduled flexible work" (`tools.ts:142`) and dumps the raw JSON (`tools.ts:254`).
  - The system prompt says "never invent availability" (`src/server/ai/prompts.ts:12`).
  - The morning tick only auto-plans when the array is non-empty (`src/server/jobs/tick.ts:45`). Otherwise the briefing says "Navi doesn't know your availability yet" (`src/server/jobs/briefings.ts:65`).
  - Insights' "next 7 days free time" uses the same scheduler and reports 0 free minutes when the array is empty (`src/server/domain/insights.ts:255-268`; the known "0m free" leftover in `BUILD_INTELLIGENCE.md:45`).
- **A second, inconsistent definition of free time:** My day draws "free stretches" and "fits here" suggestions from the **wake→bed span, or a hard-coded 07:00–23:00 when that is unknown**, not from `availability` (`src/app/(app)/planner/page.tsx:209-213`). The UI can therefore offer time the planner considers busy, and vice versa, and the 07:00–23:00 fallback treats unknown time as free.

**Root cause A.** Availability is a single, static, weekly, all-or-nothing allow-list. It is the planner's only source of free time, and it has no levels of certainty, no per-date exceptions and no inference. That produces both of the failures the owner described: an empty list blocks planning, and a wide list (wake→bed) packs the whole day while claiming certainty.

### 2.3 How fixed events, routines, deadlines and tasks are represented

| Concept | Storage | Planner treatment | Gaps against the brief |
|---|---|---|---|
| Fixed event | `events` (`core_schema.sql:192-209`): `starts_at/ends_at`, optional `recurrence {freq:'weekly',days,until}`, `status confirmed\|tentative\|cancelled`, `external_ref` | `eventOccurrence` expands weekly series (DST-safe) (`scheduler.ts:59-79`). Busy, buffered 10 min. Tentative is busy just like confirmed. | **No per-date exception**: cancelling "tonight" cancels the series (pinned). No kind (school/work/appointment). Weekly is the only recurrence. |
| Routine | `routines` (`core_schema.sql:177-190`): `days`, `start_time` (null = floating), `duration_minutes`, `is_fixed` | **Any routine with a `start_time` is immovable busy time, even when `is_fixed=false`** (`scheduler.ts:126-133`). Untimed routines become flexible blocks with score 30 (line 173-176). | Agenda and AI text say a non-fixed timed routine "can move" (`agenda.ts:410`, `tools.ts:128,258`), but the planner never moves it (inconsistency, pinned). No flexibility window, no "protected" level, no kind (sleep/meal/exercise). Sleep exists only as `preferences.wake_time/bed_time` (`src/server/day.ts:26-41`) and the **planner ignores it**. Untimed routines that don't fit aren't reported (pinned). |
| Deadline | `tasks.due_at` + `due_is_hard` (`core_schema.sql:162-163`). Date-only = 23:59 local convention (`tools.ts:274-283`). | Raises the urgency score (`taskScore`, `scheduler.ts:89-102`). Work placed after its deadline is flagged `afterDeadline`. | No feasibility check across days. An overdue task is placed but gets no "after deadline" warning (pinned). |
| Priority | `tasks.priority 1–4` | `(5−p)×10` added into the same score | High priority and close deadline are blended into one number: P4 due in 10 h outranks P1 with no due date (pinned). |
| Must-complete | **none** | n/a | Missing category. |
| Flexible task | `tasks` status `todo/in_progress` | Greedy fill; estimate × learned ratio (0.8–2, ≥5 samples); default 30 min; chunks ≥30 min, max 90; minus `actual_minutes` and minutes already planned on earlier days | No `not_before`, no dependencies (only `parent_task_id` and free-text `blocker`), no preferred time of day, no daily load cap. `blocked` tasks silently skipped. |
| Plan block | `plan_blocks` (`core_schema.sql:212-230`): `is_flexible`, `status`, `created_by navi\|user`, `reason` | `created_by='user'`, non-flexible, or started/marked blocks are kept (`plan.ts:16,48`) | **No `pinned`**: a Navi block the user asked to move stays `created_by='navi', status='planned'` and is deleted by the next re-plan (`replace_day_plan.sql:13-14`). No confirmed/inferred basis. No link to the run that made it. |

**Root cause B.** The four categories in the brief are only partly modelled. "Fixed vs flexible" is a single boolean in two places (`events` are always fixed; `routines.is_fixed`), and the scheduler and the AI text disagree about it. "Must-complete" and "protected but flexible" can't be expressed, so the planner can't tell *a fixed event*, *a hard deadline* and *a high-priority task* apart beyond the blended score.

### 2.4 How Navi decides whether a task can be scheduled

`scheduleDay` (`scheduler.ts:104-267`) is a pure, deterministic, greedy, single-day placer:

1. Busy = event occurrences + every timed routine + kept blocks (lines 116-142).
2. Free = today's availability windows ∩ [now, end of day], minus busy padded by 10 minutes (lines 144-166).
3. Queue = untimed routines (score 30) + open tasks that aren't parents with open subtasks, sorted by score, then earliest due (lines 168-208).
4. Each item takes the **earliest** slot that fits. Work up to 60 minutes is placed whole or not at all. Longer work is split into chunks of at least 30 minutes, at most 90 minutes, and never leaves a sliver behind (lines 210-264).
5. Leftover task minutes go to `unscheduled` with a reason. Work due today that doesn't fit triggers a warning (lines 252-263).

It never drops work: placed + unscheduled = total (pinned by a test).

**Limits:**
- Earliest-slot greedy, so the hardest work isn't matched to the best time.
- A week is seven independent day runs (`plan.ts:125-134`), so Monday can fill up with low-urgency work that Wednesday's hard deadline needed. There is no look-ahead reservation.
- No dependencies, no daily load cap, no time-of-day preference.
- Fixed 10-minute buffer.

**Root cause C.** Feasibility is local to one day and implicit, so the planner can say "didn't fit" but can't say "this deadline is impossible unless X" or offer tradeoffs.

### 2.5 How the conversational AI interacts with scheduling

- **One tool registry for chat, voice and onboarding** (`tools.ts:337-673`, `toolsFor` at 725-730). The planning tools take almost no parameters:
  - `plan_day {date}` (524-536)
  - `plan_week {}` (537-550)
  - `recover_plan {description, category, available_from, since}` (551-564)
  - `get_plan` / `get_overview` for reading
  - generic `update_item` / `update_task` for edits
- **Neither planning tool accepts constraints** ("only 2 hours", "free from 3", "focus on Chemistry", "keep karate"). The model's only options are:
  - (a) call `plan_day` and get the same deterministic result,
  - (b) rewrite permanent availability with `update_settings`, which is not undoable and affects every day, or
  - (c) hand-edit blocks with `update_item`, which the next re-plan wipes.
- The context the model receives (`overview`, `tools.ts:227-270`) shows raw availability JSON, routines, events, today's and tomorrow's agenda, and 40 tasks. It doesn't show free capacity, assumptions, overload or must-complete status, so the model is tempted to work these out itself or to ask for them.
- The prompt rule "never invent availability" (`prompts.ts:12`) combined with empty availability makes the model ask the user to set up availability. That is the behaviour the owner reported.
- The dev simulator (`src/server/ai/devsim.ts:116-128`) maps "plan my day/week" and "plan broke" to the same three tools, so local tests can't exercise richer intents yet. It also sends "I'm behind" to `recover_plan`, which records a disruption and marks the block in progress as interrupted. That isn't what "I'm behind on AP World, rework my day" means: the request is a re-prioritisation, not a disruption.

**Root cause D.** The tool interface is too coarse for conversational planning: there is no way to give a day-specific constraint, a pin or a focus, and no proposal/apply split.

### 2.6 How daily plans are generated, updated and recovered

- `generateDayPlan` (`plan.ts:36-123`) loads all open tasks, events, routines and the learned estimate ratio. It keeps fixed, user-made and marked blocks, keeps "past but unmarked" blocks (re-inserted with **new ids**, lines 53 and 95), computes the plan, then calls `replace_day_plan` (`supabase/migrations/20261031000001_replace_day_plan.sql`). That function takes an advisory lock, **deletes** all of Navi's `planned` flexible blocks for the day and inserts the new ones. So each re-plan is a wholesale replace (pinned by a test).
- "Moved" is counted by matching task, routine or title to the old start time (lines 113-117).
- The run is logged as `plan_generated`, **not reversible** (lines 118-121; pinned).
- `recoverPlan` (`plan.ts:203-269`) marks the blocks the disruption covered (interrupted, rest or skipped), re-plans today from when the user is free, carries what doesn't fit to tomorrow, records a `plan_disruptions` row, and refreshes the stored evening review. It is good behaviour and should be kept, but it is also not undoable.
- **Triggers:**
  - Buttons: "Plan my day", "Plan next 7 days", "My plan broke" (`planner/page.tsx:304-306`).
  - The Review page (`review/page.tsx:170`).
  - Finishing onboarding, which plans the week (`actions.ts:167-181`).
  - AI tools.
  - The morning tick, which auto-plans if the day is empty and availability is non-empty (`tick.ts:40-46`; earlier flagged in WORK_PROGRESS as P1 "auto-plans without review").
  - Nothing re-plans automatically when an event is cancelled or a task overruns.

**Root cause E.** Plans have no identity or history. A re-plan can't be undone, compared or proposed, and blocks lose their ids on every run.

### 2.7 Approvals and undo today

- **Approvals.** `requestApproval` / `decideApproval` (`src/server/domain/approvals.ts`) implement a robust state machine (proposed → approved → executing → completed|failed; declined|expired) with idempotency keys, revision checks and stale-guarding (`expect`). It runs as the user.
- **What needs approval** (`needsApproval`, `src/server/domain/entities.ts:93-120`) when Navi acts:
  - changing a hard deadline or cancelling a task
  - any change to an event's time, recurrence or status, and anything with `external_ref`
  - changing a fixed routine's time, days, duration or active flag
  - moving a non-flexible block, or marking a block done
  - finishing projects, goals or milestones, and archiving or dropping them
  - every delete
  - every change at all in "ask" autonomy (`src/lib/actions.ts:45-51`)
- **Undo.** Every `createEntity` / `updateEntity` writes a reversible `activity_log` entry with before/after. `runTool` collects their ids as `undo` for the chat's Undo button (`tools.ts:696-719`). `revertActivity` refuses if the row has changed since (`activity.ts:82-134`).
- **Gaps:**
  - Planning runs and recovery aren't undoable.
  - Settings/availability changes aren't undoable.
  - **Planning ignores "ask" mode**: `plan_day` runs without a card even when the user chose "ask me first" (pinned).
  - There is no "proposed plan" object, so a suggested plan can't be represented as anything other than an executed one.
  - Navi moving a flexible block is auto and undoable, and Navi changing a *non-fixed* timed routine is auto and undoable (both pinned and correct). But the scheduler then treats that routine as immovable anyway.

### 2.8 Can the existing logic support constraint-first planning without major change?

**Mostly yes.** The pure scheduler's contract (inputs → blocks, fixed, unscheduled, afterDeadline, warnings, freeMinutes) is the right shape:

- `availability` can be replaced by a richer **capacity** input through an adapter that reproduces today's behaviour exactly when only windows are given.
- Busy-time assembly, buffers, chunking, DST handling and the "never drop" invariant all carry over.

**What needs new code** (additive, not a rewrite):
- a capacity/day-model builder
- must-complete feasibility and look-ahead
- per-date exceptions and occurrence overrides
- pinning
- diff-based persistence with change sets (replacing the delete-all-and-insert function)
- richer tools

### 2.9 Defects found (recorded, not fixed: each changes scheduling behaviour, so each waits for review)

| # | Defect | Where | Proposed fix (milestone) |
|---|---|---|---|
| B1 | A free window crossing midnight is silently ignored | `scheduler.ts:152-156` | Split overnight windows into two (M1) |
| B2 | Navi blocks the user asked to move are wiped by the next re-plan | `replace_day_plan.sql:13-14` | `pinned` flag and diff-apply (M3) |
| B3 | Timed non-fixed routine: the scheduler treats it as immovable while the AI is told "can move" | `scheduler.ts:128` vs `agenda.ts:410`, `tools.ts:128,258` | Routine `protection` + flex window (M2) |
| B4 | Two definitions of free time (My day uses wake/bed or 07–23; the planner uses availability) | `planner/page.tsx:209-210` | My day reads the same day model (M5) |
| B5 | "Put it there" checks overlap only against plan blocks, not events or routines | `src/app/(app)/planner/actions.ts:29-38` | Check against the day model; warn rather than refuse (M5) |
| B6 | `update_settings` availability is permanent, for all days, and not undoable; one-day statements can overwrite it | `tools.ts:589-609`, `activity.ts:5-16` | Day exceptions + undoable settings log (M2/M4) |
| B7 | Re-plans and recovery have no undo; past unmarked blocks get new ids on every re-plan | `plan.ts:53,95,118-121` | Change sets (M3) |
| B8 | Planning bypasses "ask me first" | `tools.ts:524-550` | Proposal mode (M3) |
| B9 | Untimed routines and `blocked` tasks that aren't placed are not reported | `scheduler.ts:181-183,252` | Report in `unscheduled` with a kind (M1) |
| B10 | Cancelling one occurrence of a weekly event cancels the series | `scheduler.ts:60`, no exceptions table | `event_occurrence_overrides` (M2) |
| B11 | The morning tick skips planning (and the briefing says "doesn't know your availability") whenever availability is `[]` | `tick.ts:45`, `briefings.ts:65` | Use the day model (M6) |
| B12 | Week planning has no look-ahead for later deadlines | `plan.ts:125-134` | Horizon feasibility (M6) |

---

## Part 3: Proposed design

### 3.1 Architecture (reuse first)

```
                        ┌──────────────────────────────────────────────┐
 sources (DB)           │ NEW  src/server/planner/day-model.ts (pure)  │
 events + overrides ───►│  buildDayModel(date, sources) → segments:    │
 routines (protection)  │   fixed | protected | free(confirmed)        │
 availability_rules ───►│   | free(inferred, assumptionId) | unknown   │
 day_exceptions ───────►│   + assumptions[] (why each inference)       │
 wake/bed, past plans ─►└───────────────┬──────────────────────────────┘
                                        │ capacity (labelled intervals) + protected reservations
                        ┌───────────────▼──────────────────────────────┐
                        │ KEEP scheduler.ts scheduleDay (extended)     │
                        │  - capacity input (availability adapter)     │
                        │  - pass 1 must-complete (EDF), pass 2 rest   │
                        │  - confirmed before inferred; never unknown  │
                        │  - not_before, dependencies, load cap        │
                        │  - outputs + assumptions, tradeoffs,         │
                        │    clarification (smallest question)         │
                        └───────────────┬──────────────────────────────┘
                        ┌───────────────▼──────────────────────────────┐
                        │ NEW  planner/horizon.ts: multi-day feasibility│
                        │  for must/hard-deadline work (D10)           │
                        └───────────────┬──────────────────────────────┘
                        ┌───────────────▼──────────────────────────────┐
                        │ CHANGED plan.ts → builds a ChangeSet (diff:  │
                        │  insert/update/delete with before/after)     │
                        │  apply (SQL fn, locked) | propose | revert   │
                        └──────────────────────────────────────────────┘
```

Principles:
- **Engine stays pure and deterministic.** The AI never computes free time or schedules; it chooses intents and parameters and explains the results.
- **Same output contract plus fields**, so `summarizeDayPlan`, the UI and the tools keep working.
- **Legacy equivalence:** with the flag off, or with only `availability` windows and no new data, results are byte-identical to today (enforced by the characterization tests plus a new equivalence test).

### 3.2 Data-model changes (all additive, local migration first)

| Change | Shape | Purpose | Backfill / default |
|---|---|---|---|
| `availability_rules` (new table) | `user_id, days smallint[], start time, end time, kind 'free'\|'busy', basis 'confirmed'\|'inferred', source 'settings'\|'chat'\|'onboarding'\|'learned', valid_from date, valid_until date, note` | Usual free/busy times with a level of certainty; school terms via valid_from/until | Copy each `profiles.availability` window as `free/confirmed/settings`. Wake→bed defaults from 1.5 onboarding become **`free/inferred/onboarding`** (they were never stated as free time). The column stays for one release (rollback). |
| `day_exceptions` (new) | `user_id, date, kind 'busy'\|'free'\|'capacity', start time null, end time null, minutes int null, note, source 'chat'\|'ui', created_by` | "Only 2 hours today", "free after 3", "karate tonight 6–7:30" (one-off, D2) | none |
| `event_occurrence_overrides` (new) | `event_id, occurrence_date, status 'cancelled'\|'moved', starts_at null, ends_at null` unique (event_id, occurrence_date) | Cancel or move one session (D3) | none |
| `routines` (columns) | `protection 'fixed'\|'protected'\|'flexible'`, `kind 'sleep'\|'meal'\|'exercise'\|'recovery'\|'other'`, `window_start time null`, `window_end time null` | Protected routines with set flexibility (D5) | `is_fixed=true → fixed`. Timed non-fixed → `protected` with window = exact time (**identical to today's behaviour**). Untimed → `flexible`. `is_fixed` kept in sync. |
| `tasks` (columns) | `commitment 'must'\|'normal'\|'optional'` default `'normal'`, `not_before timestamptz null` | Must-complete vs flexible vs optional; "don't start before" | `normal` for all (D6: no automatic promotion) |
| `task_dependencies` (new) | `task_id, depends_on_task_id` (same user; cycle check in code) | Respect dependencies | none |
| `plan_blocks` (columns) | `pinned boolean default false`, `basis 'confirmed'\|'inferred' null`, `assumption text null`, `changeset_id uuid null` | Sticky moves; show which blocks rest on assumptions; tie to undo | `pinned=false`, `basis=null` (= legacy) |
| `plan_changesets` (new) | `user_id, created_at, actor, trigger 'button'\|'chat'\|'voice'\|'tick'\|'recovery'\|'event_change', dates date[], status 'proposed'\|'applied'\|'reverted'\|'superseded'\|'expired', ops jsonb (insert/update/delete + before/after), explanation jsonb (moved, added, removed, assumptions, tradeoffs, unscheduled, clarification), approval_id null, applied_at, reverted_at` | One unit per planning run: undo, proposals, history | none |
| `profiles.preferences` (keys) | `planner_v2: bool`, `plan_load_cap: 0.7`, `assume_free_time: true` | Rollout flag and D1/D7 settings, set by conversation | absent = defaults |

All tables get owner-only RLS (same pattern as `core_schema.sql:491`). The SQL functions `apply_plan_changeset(p_changeset uuid)` and `revert_plan_changeset(p_changeset uuid)` run with the caller's rights under the same advisory lock as `replace_day_plan`. Revert refuses blocks the user has changed since (same rule as `revertActivity`).

### 3.3 Scheduling logic

**Day model** (`buildDayModel`, pure):

1. **Awake span.** Wake→bed from the profile. Sleep is `protected/sleep`. If wake/bed are unknown, use availability rules only; with no rules either, the day is **unknown** and only fixed items are shown.
2. **Fixed segments.** Event occurrences after applying overrides; cancelled occurrences are removed. `fixed` routines. Kept and **pinned** blocks. Day exceptions of kind busy. **Never overlapped, never moved.**
3. **Protected reservations.** Timed protected routines at their time; meals inside their window, positioned to minimise disruption. They are reserved before any task, can shift only inside their window, and are never dropped. A routine that can't fit is reported as a conflict, never silently skipped (fixes B9).
4. **Labelling remaining awake time:**
   - **confirmed:** inside a `free/confirmed` rule, a `free` day exception, or time the user placed work in.
   - **inferred** (when D1 is on): awake time not covered by any `busy` rule or commitment. Each contiguous inferred stretch gets an assumption with a reason built from data, e.g. "after school ends at 3:30, nothing else on Tuesday", or "you accepted work here the last 2 Tuesdays". Learned patterns need 2 or more accepted or done blocks in the same weekday window within 4 weeks; nothing is invented.
   - **unknown:** awake time inside a `busy`-like gap with no data, e.g. weekday 8–3 for someone with a School space but no school events (configurable heuristics). Unknown time is never planned.
5. **Day exception `capacity N minutes`** caps the total flexible work placed (for "only 2 hours today").

**Placement** (extend `scheduleDay`; keep chunking, buffers and estimate ratio):

1. **Pass 1, must-complete and hard-deadline tasks**, ordered by earliest deadline then least slack (slack = capacity until deadline − remaining work). Confirmed capacity first, then inferred.
2. **Pass 2, everything else**, by the existing `taskScore` (kept for regression parity), within the load cap (D7).
3. **Constraints:**
   - nothing before `not_before`
   - a dependent task's first block starts after its prerequisite's last placed block, or the prerequisite is done
   - buffers around fixed and protected segments
   - nothing in the past or in unknown time
4. **Feasibility and tradeoffs** (pure; horizon for the week, D10). For every must or hard-deadline task, compare remaining work with the capacity until its deadline, counting already-pinned work. If it's short, produce `tradeoffs[]` from a fixed list, ranked by least harm:
   - move optional or normal tasks off the day
   - shorten a session ("do 60 of 90 min now")
   - use specific inferred time (if not already used)
   - shift a meal inside its window
   - ask for an extension or a deadline change. This one never happens on its own: it needs approval (`approvals.ts`).
   Never drop, delete or complete anything.
5. **Clarification.** If a must-complete task can't fit, or the day is mostly unknown, return **one** question naming the biggest unknown stretch that would resolve it ("Are you free between 4 and 6 tomorrow?"). The AI asks only that.
6. **Explanation.** A diff against the current plan (added, moved, removed and why, unchanged), the assumptions used (at most 2 surfaced, D1), the tradeoffs and the clarification. `summarizeDayPlan` gains these lines.

**Replanning triggers** (M6), each producing a change set:
- an occurrence cancelled or a day exception added → offer to fill or re-fit the freed or lost time
- a focus session ended with "needs more time", or a block marked partial → the remaining estimate grows and the rest of today is re-fitted (scenario 5)
- a new must-complete task
- the existing "My plan broke" recovery

### 3.4 AI tool changes

The read tools enrich their context; the write tools gain parameters. Existing names stay as aliases so voice and chat history keep working.

| Tool | Change |
|---|---|
| `get_overview`, `get_plan` | Add per-day capacity: confirmed / inferred / unknown minutes, assumptions, protected routines, must-complete list, overload flag. Replace the raw availability JSON. |
| `plan` (new; `plan_day`/`plan_week` become thin aliases) | `{ from: date, days: 1–7, mode: 'apply'\|'propose', focus_task_ids?, constraints?: { capacity_minutes?, free?: [{start,end}], busy?: [{start,end,title}], start_from? }, reason }`. Day-scoped constraints are stored as `day_exceptions`. Returns the change set id, the summary, assumptions, tradeoffs and the clarification. |
| `set_day_exception` (new) | One-off busy, free or capacity for a date (D2). Undoable. Never touches the usual rules. |
| `skip_occurrence` / `move_occurrence` (new) | One session of an internal event (D3): runs directly with undo. Series changes still go through `update_item`, which creates a card. |
| `move_block` (new) | Move one or more flexible blocks, or all blocks for a task ("move my studying earlier"), and **pin** them. Auto with undo. A fixed or protected target is refused with the reason. |
| `update_task` | Add `commitment`, `not_before`, `depends_on`. Promoting to must is automatic (internal, undoable); demoting a must-complete task the user set is a card. |
| `apply_plan` / `discard_plan` (new) | Act on a proposed change set when the user says so in words. The card also has Apply. |
| `undo_plan` (new) | Revert the latest applied change set when the user says "undo that". Same function as the card's Undo. |
| `confirm_assumption` (new) | "Yes, I'm free then": turns an inferred stretch into a `confirmed` rule (for that date, or as a usual time if the user says so). |
| `update_settings` | `availability` is written to `availability_rules` as confirmed. Undoable. The description says it is for *usual* times only. |
| `recover_plan` | Unchanged behaviour, but writes a change set (undoable). |

**Prompt changes** (`prompts.ts` CORE and CHAT):
- Replace "never invent availability" with the confirmed / inferred / unknown rule: "plan into inferred time only through the planner, say the assumptions it returns, never claim unknown time".
- Map intents to tools: "these are my non-negotiables" → mark must or protected, then `plan`. "Karate tonight, but I need to finish Chemistry" → `set_day_exception` (if karate isn't already on the calendar) + `plan` with focus. "Afternoon opened up" → `skip_occurrence` or a `free` exception, then `plan`. "Only two hours" → `plan` with `capacity_minutes:120` (propose if it would bump must-complete work). "Behind on AP World" → `plan` with focus and possibly a tradeoff. "Build tomorrow from what you know" → `plan {from:tomorrow}`.
- "Don't ask for anything get_overview or get_plan already shows. Ask only the clarification the planner returns."
- "Never put a one-day statement into usual settings."

**devsim:** add deterministic handlers for the six example phrases so integration and e2e tests can exercise them without a paid model.

### 3.5 Approval boundaries

| Action | Who | How |
|---|---|---|
| Place or re-place Navi's flexible blocks in confirmed or inferred time (user asked) | Navi, auto | Change set, applied, one-line explanation + Undo |
| Navi-initiated re-plan (tick, after an event change) | Navi | Apply if the day was empty or only Navi's unpinned flexible blocks move; otherwise **propose** (D4) |
| Pin or move a flexible block on request | Navi, auto | Undo |
| Day exception stated by the user (one day) | Navi, auto | Undo (D2) |
| Skip or move one occurrence of an internal event, on the user's statement | Navi, auto | Undo (D3) |
| Mark a task must-complete; add `not_before` or a dependency | Navi, auto | Undo |
| Move a protected routine *within* its window | Navi, auto | Within the change set |
| Move a protected routine *outside* its window, skip it for the day, or change sleep | Card | `approvals` (`internal.update.routines`) |
| Change an event's time or recurrence, cancel a series, change a fixed routine, change a hard deadline, demote a user-set must-complete | Card | existing `needsApproval` (`entities.ts:93-120`) + new rules |
| Anything with `external_ref`, or any outside action | Card | existing `request_external_action` |
| Any plan change in "ask me first" mode | Proposal card | fixes B8 (D8) |
| Drop, delete or complete work to make a plan fit | **Never** | tradeoffs only |

A **proposal** is a `plan_changesets` row with `status='proposed'`. The calendar shows it only as a dashed preview with Apply / Change / Dismiss, never as real blocks. The tool result says "proposed, nothing changed" (same wording rule as `WAITING`, `tools.ts:38`). Applying it re-validates against the current blocks (stale → expire, as in `approvals.ts` `checkStillTheSame`). To avoid card fatigue, a plan appears as **one** card per run, not one per block.

### 3.6 Migration strategy

1. **Additive local migration** (`2026111xxxxxxx_constraint_planning.sql`): new tables, columns and defaults, RLS, functions, and the backfill described in 3.2. It is idempotent (`if not exists`) and makes no destructive changes; `profiles.availability`, `routines.is_fixed` and `replace_day_plan` stay.
2. **Flag `preferences.planner_v2`.** With the flag off, code paths are unchanged (old `generateDayPlan`). With it on, the new day model, diff-apply and change sets are used.
3. **Equivalence gate.** A test runs both engines over the characterization fixtures and over a snapshot of synthetic accounts: with only confirmed windows and no new data, the v2 placements must equal v1's. Where they differ (bugs B1, B3, B9), the difference is listed and approved.
4. **No mass re-plan.** Migration doesn't touch existing `plan_blocks`. Today's and future blocks stay until the next plan run. The first v2 run re-uses existing block ids where the same task stays (diff-apply), so nothing visibly jumps.
5. **Rollout** (D9): the owner's account → new accounts → everyone. Rollback = flag off (data stays compatible because the old columns are still written).
6. **Hosted:** apply the migration only with owner approval, after local verification (same process as the 1.5 migrations).

### 3.7 Product experience (fits the approved 1.5 design; no settings-heavy UI)

- **Chat or voice reply after planning:** one sentence + at most 2 assumption chips ("Free 4–6 PM?", "After dinner?") + Undo. Example: *"Got it. I protected karate and dinner and put Chemistry at 4:10 before practice. I assumed you're free 8–9:30 PM; want to change that?"*
- **My day:** inferred blocks have a subtle dashed outline. A proposed plan appears as a ghost layer with "Apply / Not now". Free stretches come from the same day model (fixes B4).
- **Overload:** a short "Doesn't all fit" line with 2–3 tradeoff buttons, which run through the same tools.
- **Settings:** "Usual free times" becomes optional, with no red warning. Sleep, meals and protection are adjustable by talking; Settings shows them read-only with an edit link.

### 3.8 Implementation milestones (vertical slices, each testable on its own)

| M | Slice | Main files | Done when |
|---|---|---|---|
| M1 | Day model + scheduler capacity input + availability adapter + overnight split + report unplaced routines | `planner/day-model.ts` (new), `scheduler.ts` | Unit: scenarios 1, 2, 7 + equivalence with v1 |
| M2 | Migration: rules, exceptions, occurrence overrides, routine protection, task commitment / not_before / deps | `supabase/migrations/…`, `types.ts`, `schemas.ts`, `entities.ts` | Integration: RLS, backfill, scenario 4 data path |
| M3 | Change sets: diff-apply, revert, proposals, pinned blocks; `plan.ts` uses them (behind the flag) | `plan.ts`, new SQL fns, `activity`/`approvals` glue | Integration: scenario 9, B2, B7, B8 |
| M4 | AI tools + prompts + devsim intents for the six phrases | `tools.ts`, `prompts.ts`, `devsim.ts`, `tool-labels.ts` | Integration: scenario 8, intent tests; real-model eval (small budget) |
| M5 | UI: day model on My day, dashed inferred blocks, proposal layer, assumption chips, tradeoff buttons | `planner/page.tsx`, `components/day/*`, chat card | Playwright: no-setup plan, apply/undo |
| M6 | Must-complete feasibility, horizon look-ahead, tradeoffs, replan triggers (occurrence cancelled, overrun) | `planner/horizon.ts`, `tick.ts`, focus end | Unit + integration: scenarios 3, 5, 6 |
| M7 | Rollout: flag for the owner, monitoring, hosted migration with OK | — | Scenario 10 on a copy of real-shaped data |

---

## Part 4: Test plan

**Existing regression suite** (must stay green throughout): 35 files / 314 vitest tests on the local stack, including the existing planner tests (`tests/unit/scheduler.test.ts`, `agenda.test.ts`, `plan-summary.test.ts`, `day-layout.test.ts`; `tests/integration/flows.test.ts` planning, recovery and simultaneous-plan; `review.test.ts` recovery and review; `rls.test.ts` `replace_day_plan` isolation; `actions.test.ts` approvals and undo), plus the 58 Playwright tests.

**Characterization tests added in this pass** (the baseline any change is measured against): `tests/unit/planner-characterization.test.ts` (18) and `tests/integration/planning-characterization.test.ts` (7). Tests named "ROOT CAUSE" are expected to be updated deliberately by M1–M6.

**Validation scenarios** (U = pure unit, I = integration on the local DB via `runTool` + devsim, E = Playwright, R = real-model eval run manually within budget):

| # | Scenario | Given | Expect | Level |
|---|---|---|---|---|
| 1 | New user, no availability windows | Wake 7 / bed 23, one event, 2 tasks, `availability=[]` | Plan placed in inferred time; ≤2 assumptions listed; no block in sleep or event ±buffer; nothing in unknown time; reply names the assumptions | U, I, E |
| 2 | Student: recurring school + variable after-school | Weekly "School 8–3:15" M–F, karate Tue/Thu 5–6:30, a "Free after 4" confirmed rule, a Wed day exception "busy 4–6" | Tue/Thu work avoids karate; Wed starts after 6; confirmed time is used before inferred | U, I |
| 3 | Multiple must-complete assignments, competing deadlines | 3 must tasks due Tue/Wed/Thu with estimates exceeding Mon capacity | EDF order; Wed's work is reserved before Mon fills with normal tasks; feasibility per task; nothing dropped | U (horizon), I |
| 4 | Cancelled fixed commitment frees time | Karate tonight → `skip_occurrence` | Only tonight is removed (next week intact); change set applied with Undo; freed time offered or filled; no card (D3); series cancel → card | I, E |
| 5 | Task takes longer than estimated | Focus ended "needs 40 more min" on a 60-min block | Remaining estimate grows, rest of today re-fitted, pinned and fixed untouched; overflow → tomorrow or tradeoff; block marked partial, not done | I |
| 6 | Not enough time for every priority | Load > capacity incl. inferred | `tradeoffs[]` (≤3, ranked), honest summary, `unscheduled` complete, placed+unscheduled = total; no auto delete or complete | U, I |
| 7 | Conflicting constraints | Two fixed events overlap; protected dinner window fully covered by events; must task due before any capacity | Conflict reported (never resolved by moving fixed items); dinner reported as unplaceable, not silently skipped; one clarification question | U |
| 8 | User changes schedule conversationally | The six example phrases via devsim | Correct tool sequence per phrase (exception/skip/move/plan with constraints); no request for info already in context; replies quote tool results | I (devsim), R (Haiku/Sonnet, ~20 prompts) |
| 9 | Undo an automated scheduling adjustment | Tick re-plan or chat `plan` | One Undo restores the previous blocks (same ids) atomically; refuses if the user edited a block since; a second Undo is harmless | I, E |
| 10 | Migrating existing users without disruption | Seed accounts: `[]`, wake→bed default, custom windows, timed non-fixed routines, existing blocks | After migration and flag on: existing blocks unchanged; first v2 plan for confirmed-window accounts equals v1; wake→bed accounts get inferred labels; rollback (flag off) works | I (migration test), U (equivalence) |

**Additional regression checks:**
- DST (existing tests extended to day exceptions and occurrence overrides).
- RLS on every new table (`rls.test.ts` pattern).
- Concurrent plan runs still produce one plan (`flows.test.ts:430`).
- `needsApproval` matrix unchanged for existing rules.
- Briefings and Insights use the day model ("0m free" is fixed).
- Voice tool list includes the new tools (`voice-server.test.ts:56`).
- Playwright a11y on the new chips and cards.

---

## Part 5: Changes made in this pass

| File | What | Result |
|---|---|---|
| `tests/unit/planner-characterization.test.ts` (new) | 18 pure tests pinning the availability model, commitment handling, scoring, overload invariants and estimates | 18/18 pass |
| `tests/integration/planning-characterization.test.ts` (new) | 7 tests on the local DB: plan runs not undoable, re-plan replaces rows, "ask" mode ignored by planning, approval boundaries for blocks, routines and events, availability via `update_settings` not undoable | 7/7 pass |
| `docs/navi-1.5/PLANNING_AUDIT.md` (new) | This document | — |

**Verification (2026-11-08, local stack via `scripts/local-only.sh`, devsim AI):**
- `tsc --noEmit` OK
- `eslint` on the new files OK
- `vitest run`: **35 files / 314 tests passed** (was 33 / 289)
- Playwright not run (no UI change)

No production deploy, no hosted database access, no app code changes.

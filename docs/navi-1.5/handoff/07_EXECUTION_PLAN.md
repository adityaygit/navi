# 07 — Execution Plan and Parallel Work Coordination

## First response and kickoff behavior

Claude should first confirm repository location, inspect actual files, and produce a **short initial findings + action plan**, not a massive speculative architecture proposal. If a tool or credential is unavailable, report it and continue independent work.

## Workstream organization

**Track A / Audit & Core Engineering**
- Baseline, env and safety checks; app map and reproduction tests.
- Fix P0 security/data/auth/core-state defects first.
- Establish domain services, state synchronization, action proposal and persistence boundaries.
- Add tests, migration plans and safe preview deployment.

**Track B / Visual Product Design**
- Present concrete desktop prototypes for owner review during the audit.
- Lock functional shell states and the approved visual direction with owner.
- Build UI components against stable domain contracts once approved.

**Integrator (Claude or designated coordinating agent)**
- Owns shared interfaces, the decision log and `WORK_PROGRESS.md`.
- Prevents concurrent edits to the same files unless coordinated.
- Merges tested slices and reconciles design ↔ engineering findings.
- Maintains the next-session prompt and actual verification status.

If parallel agents/worktrees are unavailable, interleave the same tracks in one Claude session. Do not pretend agents were launched.

## Milestones and definition of done

### M0 — Safety baseline and truthful inventory
- Separate branch/worktree; baseline commit recorded.
- Env/dependency inventory, app routes and DB schema mapped.
- Confirm preview isolation and status of production/waitlist.
- Start `WORK_PROGRESS.md` and defect matrix.

### M1 — Reliable domain foundations
- Verified auth/user isolation and task CRUD.
- Capture draft/approval path with stable persisted records.
- Existing broken routes/state/integrations repaired or replaced where justified.
- Tests for key domain actions, authorization and idempotency.

### M2 — Desktop shell with design collaboration
- Collapsible left nav, Home, central workspace route, right persistent Navi panel/orb.
- Panel preference restoration and no conversation/draft reset across routes.
- Owner-reviewed visual direction; no forced palette decisions in this spec.

### M3 — Core complete loop
- Freeform capture → reviewable draft → persisted task → time block → Focus/start → complete.
- Home and conversation reflect real data changes.
- Reliable error/empty/loading states, edit/retry behavior.
- E2E happy-path and at least critical failure tests pass.

### M4 — Extra intelligence and preview QA
- Focus persistence, one-insight evaluator and voice continuity, where feasible and verified.
- Isolated preview accessible with relevant permissions/credentials.
- Owner's first testing checklist and open issue list.

## Scope control for the near-term desktop alpha

**Required first:** M0 + enough M1/M2/M3 to test an authentic end-to-end user journey. If advanced voice or proactivity threatens this, defer it with an explicit limitation. A one-night effort is a priority target, **not a promise of full scope**.

## Parallel coordination rules

- Establish typed contracts for shared domain state before simultaneous UI/backend edits.
- Use separate worktrees/branches and clear ownership where supported.
- Integrate frequently with typecheck/tests; don't let parallel branches diverge unreviewed.
- Avoid full rewrite plus visual redesign plus schema migration in one giant untested commit.
- Engineering audit findings can change implementation; changes to UX invariants require owner decision.
- Record architecture decisions (what/why/alternatives/risks) succinctly as discovered.

## Session-resumption requirement

At meaningful checkpoints and before resource exhaustion, update `WORK_PROGRESS.md` with:

- Current branch/commit, preview link (if real), latest commands and outcomes.
- Verified complete vs partially working vs blocked vs not started.
- Defects with reproduction details and fix status.
- Files changed, migrations created/applied, credentials needed (names only, never values).
- Owner design approvals and unresolved choices.
- Next three prioritized actions and exact resume instruction.

Continue work as long as your tooling/session permits. Do **not** claim background execution or automatic resumption after limits unless the actual platform supports and has configured it.

## End-of-session user report

Be concise and evidence-based: what changed, how to open preview, what tests passed/failed, what remains buggy, design review needed, and what to test first next session. The owner must not confuse a pretty prototype with a functional integrated build.

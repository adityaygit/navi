# 04 — Mandatory Navi V1 Audit and Repair Matrix

**Do not claim the V1 architecture or individual services are correct until inspected.** User reports V1 is already buggy and can't reliably perform promised workflows. That is a product-blocking fact, not a minor polish issue.

## Before implementation

1. Identify actual repo root, branch, app version, package manager, tooling and deployment topology. A prior project description mentioned Next.js, Supabase, Vercel, Trigger.dev and real-time voice; **verify whether each is present and in use**.
2. Create safe working branch/worktree; record baseline commit and setup instructions. Preserve production and waitlist.
3. Inventory routes/screens, shared state, persisted models, API routes/server actions, auth/session, database/RLS/migrations, background jobs, AI providers/tools, voice, notifications, feature flags, logging and tests.
4. Determine what is live, stubbed, flaky, incomplete, or unreachable. Test actual functionality, not presence of components.
5. Reproduce major defects, record steps and evidence, identify likely root causes, and classify by severity.

## Audit table template

| Subsystem | Current behavior (verified) | Defect / repro | Severity | Decision | Plan | Verification |
|---|---|---|---|---|---|---|
| Auth/session | TBD | TBD | TBD | Reuse / Repair / Refactor / Replace | TBD | TBD |
| User isolation / RLS | TBD | TBD | TBD | ... | TBD | TBD |
| Tasks | TBD | TBD | TBD | ... | TBD | TBD |
| Calendar / scheduling | TBD | TBD | TBD | ... | TBD | TBD |
| Inbox / capture | TBD | TBD | TBD | ... | TBD | TBD |
| AI tool execution | TBD | TBD | TBD | ... | TBD | TBD |
| Conversation persistence | TBD | TBD | TBD | ... | TBD | TBD |
| Voice state | TBD | TBD | TBD | ... | TBD | TBD |
| Background jobs / alerts | TBD | TBD | TBD | ... | TBD | TBD |
| Routing / refresh / navigation | TBD | TBD | TBD | ... | TBD | TBD |
| Waitlist and admin | TBD | TBD | TBD | ... | TBD | TBD |
| CI, tests, deployments | TBD | TBD | TBD | ... | TBD | TBD |

## Severity rubric

- **P0 blocker:** user-data loss, cross-user exposure, auth failure, destructive action, broken core P0 journey, false-success mutation, broken production/waitlist.
- **P1 high:** intermittent incorrect saves, duplicate actions, corrupted time/calendar calculations, repeated voice/reconnect failures, significant broken navigation or context.
- **P2 medium:** inconsistent display, recoverable sync lag, slow UI, secondary workflow failure.
- **P3 low:** cosmetic and low-impact refinement.

Severity is based on user impact and reproducibility, not only ease of fix.

## Mandatory reproduction paths

- Login/logout/token refresh and page refresh; simultaneous tabs/devices where feasible.
- Create/edit/complete/reopen task; refresh; check Home, Planner, detail and conversation correctness.
- Time-block edit/move/remove across daylight-saving dates and user time zone; observe duplicates/conflicts.
- Brain dump → parsed draft → approval → persistence; cancel, edit, retry and multi-item validation.
- Conversation asks factual account-specific question → grounded retrieval; tools succeed/fail/timeout; retry idempotently.
- Navigate Home ↔ Tasks ↔ Planner ↔ Focus with chat text draft and ongoing voice; verify no unwanted reset.
- Focus timer refresh/pause/interruption and persistence.
- Existing admin/waitlist approval flows, if present; ensure new work does not break them.

## Refactor vs replace decision

**Reuse** if healthy, tested, well-isolated and compatible with new behavior. **Repair** if local fix solves a reproducible issue. **Refactor** if state/domain logic is correct but coupling or architecture blocks new UX. **Replace** if model/state ownership is fundamentally inconsistent, safety/authorization is weak, hidden bugs are systemic, or a simpler tested implementation is more reliable.

For any substantial replacement, record: evidence, scope, migration/data preservation plan, rollback path, tests, risks and integration impact. Do not treat the user-authorized rewrite as a blanket reason to delete working features.

## Audit deliverable

A **concise, actionable** report: top failures, verified evidence, critical dependencies, proposed architectural seams, parallel-safe work items and a recommended order. The audit is continuous; new findings update the matrix. Do not wait for a book-length audit report before fixing isolated blockers.

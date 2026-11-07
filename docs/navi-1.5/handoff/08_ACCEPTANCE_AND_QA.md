# 08 — Acceptance Criteria and QA Checklist

Tests must exercise real authenticated persistence in an isolated environment where feasible. Stubs in unit tests are acceptable; stubs masquerading as product behavior are not.

## P0 acceptance tests (must explicitly pass or be reported blocked)

| ID | Scenario | Expected result |
|---|---|---|
| AUTH-01 | Sign in, reload, sign out, sign back in | Correct session and owned data; no blank screen |
| AUTH-02 | Access another user's resource/API ID | Denied on server/DB, no data leak |
| TASK-01 | Create/edit/complete/reopen task and refresh | State persists and shows consistently |
| TASK-02 | Retry a task create after simulated timeout | No duplicate records; outcome reconciled |
| CAP-01 | Freeform input creates multiple candidate drafts | Drafts distinguish proposed vs committed; editable |
| CAP-02 | Discard/decline proposed draft | No unwanted task or calendar mutation |
| CAP-03 | Approve draft | Saved records match exact approved content |
| PLAN-01 | Schedule task to time block, move it, refresh | Correct block/time zone/task link persists |
| PLAN-02 | Edit overlapping time block | Real conflict detected/handled per approved policy |
| NAV-01 | Switch Home ↔ Planner ↔ Tasks ↔ Projects ↔ Inbox | No lost conversation or unintended resets |
| NAV-02 | Collapse/expand left sidebar; reload | Preference restored |
| NAV-03 | Collapse/expand Navi panel; switch regular workspaces | Preference restored; text draft preserved |
| FOCUS-01 | Enter Focus from expanded Navi panel | Panel defaults collapsed; prior preference saved |
| FOCUS-02 | Exit Focus | Previous panel preference restored |
| CHAT-01 | Ask about current saved tasks | Response grounded in authorized real records |
| CHAT-02 | Request modification through Navi | Reviewable action when needed; no false success |
| LOOP-01 | Capture → review → task → plan → focus/start → complete | All views reflect same persisted state |
| ERR-01 | Simulate failed DB or AI call | Recoverable visible error; no deceptive success |
| SAFE-01 | Open production waitlist/admin flows in approved safe checks | Unchanged behavior; no unintended production mutation |

## P1 acceptance tests

| ID | Scenario | Expected result |
|---|---|---|
| FOCUS-03 | Pause/resume timer, navigate and refresh | Recoverable accurate duration/state |
| INS-01 | No actionable suggestion | Home remains calm, not filled with generic insight |
| INS-02 | Two eligible insights | At most one contextual insight shown |
| INS-03 | Dismiss/snooze | Suppressed across reload until policy conditions permit |
| INS-04 | Nonurgent insight during Focus | Deferred, not intrusive |
| VOICE-01 | Start voice and change workspace | Voice maintains or gracefully recovers, no false active status |
| VOICE-02 | Permission denied/mic disconnect | Clear state and recovery path |
| A11Y-01 | Keyboard control of navigation, tasks, panel, focus | All core actions reachable and labeled |

## Cross-cutting edge cases

- Narrow desktop widths; sidebar/panel both expanded; main workspace remains usable.
- Slow network, offline interruption, provider timeout, duplicate request, stale task update.
- DST shift, 12/24-hour display, time zone change, date-only due dates, midnight crossings.
- Empty account, lots of tasks, long titles, large chat thread, no project, permission denial.
- Back/forward navigation, reload on deep link, two tabs editing the same record.
- Concurrent AI proposed action and direct manual edit; stale proposal rejected/reconciled.
- Reduced-motion settings and screenreader announcements for state change.

## Verification levels

1. Static: lint, typecheck, build, tests and any existing CI requirements.
2. Domain: unit tests for scheduling, permissions, action state transitions, suppression and time zone rules.
3. Integration: authenticated DB persistence, RLS, tool calls, idempotency, migration compatibility.
4. E2E: browser journey with real preview/staging data and reliable selectors.
5. Manual owner test: coherent real-use journey, visual/interaction critique, no sample success claims.

For each test, record **PASS / FAIL / BLOCKED / NOT RUN**, command/evidence, environment, and defect link. Don't mark a feature verified merely because code compiles.

## Preview release gate

A preview is ready for owner's testing when:

- It is **isolated from production modifications** unless the owner knowingly authorizes a scoped shared service.
- Auth and basic data access don't violate user isolation.
- Core path functions or specific blockers are conspicuous and documented.
- Available tests and smoke checks have been run, with failures named.
- Preview URL and login setup, if generated, are real and accurate.
- No active stub/fake AI paths are misrepresented as working.
- A small actionable test script is provided to the owner.

Do not release to the waitlist cohort or switch production traffic as part of this handoff without explicit owner consent.

# 03 — Functional Scope, Action Contracts, and Priorities

## P0 — Must work for the first meaningful alpha

1. **Authentication and data isolation:** existing sign-in works in preview; authenticated user sees only their own records; logout and returning-session behavior correct.
2. **Navigation and continuity:** Home plus main desktop shell, sidebar, right Navi panel, persistent expanded/collapsed preferences, workspace switching without lost conversation.
3. **Real tasks:** create/read/update/complete/reopen/delete or archive with confirmation as appropriate; persist through refresh; stable IDs and timestamps.
4. **Usable planner:** see actual scheduled blocks/events, add/edit/move/remove, associate task and block, surface conflicts, persist state.
5. **Capture → draft → review:** user can type a freeform brain dump; system parses into proposed structured changes with explicit review; user can edit, approve or discard before saving.
6. **One end-to-end execution flow:** reviewed task → schedule → focus or start work → complete → synchronized Home/Tasks/Planner/conversation state.
7. **Meaningful conversation:** Navi can answer using *retrieved authorized real state* and can propose structured actions. Must not claim an action happened until backend confirms.
8. **Basic error handling:** no fake success, silent data loss, duplicate writes on retry, or unrecoverable blank screens for common failures.
9. **Preview/test handoff:** isolated desktop build with clear env dependency status, test instructions, and verified/blocked results.

## P1 — Valuable if reliable after P0

- Focus session start/pause/resume/end, persisted and associated with task/project.
- Contextual Home insight evaluator with dedupe/snooze/dismiss persistence.
- Continued existing real-time voice through workspace transitions; action confirmation and mic/permission UX. If voice is broken, isolate and report it rather than stubbing.
- Conflict-aware plan edits with undo/recovery; better task filtering and project detail.
- Durable conversation session summaries or scoped retrieval with user corrections.

## P2 — Explicitly defer if P0/P1 at risk

- Deep third-party integrations, autonomous external workflows, comprehensive agent orchestration.
- Fully automatic replanning and high-frequency proactive background jobs.
- Complex recurring routine engines or extensive intelligence memory features.
- Mobile interface; mobile UX is a separate upcoming design pass.
- Detailed personal analytics, scoring, streaks, decorative dashboards.

## Action state machine

A model suggestion is **not** an applied mutation. Represent clearly:

`input → interpreted proposal → draft/review (when required) → validated command → authorized execution → persisted result → UI confirmation`

When a user directly manipulates a task in UI, the command may be immediately applied if permitted; risky/consequential operations still require proper review. Every command should have a known outcome: pending, succeeded, rejected, failed or cancelled. An uncertain response must not be displayed as success.

### Brain dump example (illustrative, not seeded production data)

User: “I need to finish a chemistry worksheet tomorrow and study history sometime this weekend.”

- Extract two candidate tasks, notes on timing uncertainty and any project association.
- Display them as **drafts** with editable names, due dates and scheduling intent.
- User confirms two tasks; both persist and appear in Tasks/Inbox history.
- **Do not schedule an actual time block** from “sometime this weekend” without confirmation.
- User asks Navi to plan an hour Saturday morning; propose a block, verify against real calendar state and ask for approval as required.
- The approved block appears in Planner and links to the task.
- User enters Focus; leaving and returning preserves the session/state.
- Completion updates task and linked views. Navi's factual answers reflect that update.

## Action permissions

- Ordinary authorized app-internal edits that are explicitly requested through UI may execute directly, with appropriate undo/confirmation behavior.
- AI-inferred actions that create or modify multiple records, perform scheduling choices or have ambiguous intent require user review.
- External communications, third-party account changes, spending, production/billing changes, irreversible data actions need explicit approval and compatible provider permissions.
- Always separate **read**, **propose**, **approve**, **execute** and **report outcome**. Guard against replay.

## AI response rules

- Use structured validated tool outputs/commands, not regex on persuasive text as the source of truth.
- Confirm data is current/authorized before answering “what's on my calendar?” and similar.
- Acknowledge unknown, missing, stale or unsynced data; don't invent tasks, meetings or reminder settings.
- Explain impact and show the exact proposed changes before execution when confirmation is required.
- If a provider fails, report failure and keep a recoverable draft or pending action.

## Attentional behavior

- Context uses deadlines, recent activity, focus status, user preferences and quiet hours (verify supported V1 inputs).
- Deterministic rules for non-negotiable scheduling/deadline facts, time windows, suppression and permission boundaries; AI can interpret and phrase the suggestion.
- Per-user persistence for insight seen/snoozed/dismissed and meaningful-change reopening. Avoid repeating the same suggestion every session.
- Protect focus: defer nonurgent suggestions; actionable urgent issues should be exceptional, clearly explained, and respect notification policy.

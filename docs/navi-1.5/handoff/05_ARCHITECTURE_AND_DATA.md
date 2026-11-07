# 05 — Architecture, Data and AI Engineering Contracts

This is a **target architecture and audit checklist**, not a claim about the existing schema or stack. Map it onto the verified repository and adopt only changes that solve the documented problems.

## Design constraints

- Desktop UI state and persisted domain state are separate; one authenticated source of truth for tasks, plans, focus and actions.
- Chat/voice send **commands or proposals into domain services**, never directly mutate inconsistent parallel stores.
- Persist first, confirm after success; optimistic updates require rollback and error reconciliation.
- Provider/network errors do not silently produce duplicates or fake confirmations.
- Shared service contracts can support future mobile without designing mobile UI now.

## Logical layers

1. **Presentation:** Home, navigation, Planner, Tasks, Projects, Inbox, Focus, Navi panel/orb, voice controls.
2. **Client coordination:** selected workspace, panel prefs, local drafts, pending actions, optimistic state and reconciliation.
3. **Domain services:** tasks, events/blocks, focus, projects, capture/inbox, conversation, contextual suggestions, approval/action ledger.
4. **AI orchestration:** context retrieval, parsing, structured tool calls, proposal generation, reasoning, response rendering, voice transcription/streaming. Models/providers are configurable; audit existing routing and credentials.
5. **Persistence & integrations:** authenticated database, row-level security, background jobs, external APIs, logs and monitoring.

## Candidate logical entities (map to existing tables carefully)

| Entity | Essential properties / rules |
|---|---|
| User/profile/preferences | identity, time zone, locale, quiet hours, panel preferences, privacy controls |
| Task | stable ID, owner, title, status, optional due date, project, scheduling references, timestamps |
| Event | fixed-time commitment, start/end, time zone/source, edits and sync status |
| Time block | intentional allocation of time, linked task optional, start/end, status |
| Project | owner, metadata, status, associated tasks and contexts |
| Capture/Inbox item | original source, raw text, extracted candidates, review status |
| Action proposal | typed intent, proposed diff, explanation, confirmation/expiry status |
| Action execution | idempotency key, actor, authorization, result and linked records |
| Conversation/thread | owner, messages or durable summary, context scope, timestamps |
| Focus session | owner, linked work item, start/pause/resume/end, duration evidence |
| Insight | underlying reason, user relevance, seen/snoozed/dismissed and cooldown state |

Avoid designing premature tables for concepts whose behavior is still unverified. Normalize ownership and referential integrity; document time zone semantics and soft-delete/archive decisions.

## Data consistency invariants

- No cross-user access at DB/API/tool layer. Verify row-level access rules and server-side authorization for *every* user-owned resource.
- **Task completion** is a single domain event/state mutation; all displays read that state, not local copies.
- **Plan changes** are backed by persisted records and validated conflicts; UI and AI cannot disagree about the same event silently.
- **Approval** refers to exact proposed change(s) with known IDs/revision. Stale approvals must detect changes rather than overwriting newer edits.
- **Retry safety:** create/update and external side effects use idempotency keys or suitable dedupe mechanisms.
- **Time correctness:** store canonical instants with explicit time zones and differentiate local date-only deadlines from timed events; test DST.
- **Migration safety:** version migrations, backups, dry runs, rollback/forward-only plan, staging verification, explicit user approval before destructive production changes.

## Conversation continuity and scoped context

- Maintain a persistent authenticated thread/session with durable messages or checkpoints; navigation must not recreate it accidentally.
- Pass current workspace and user-selected entities as structured context; do not use a global mutable prompt that can point to the wrong account/workspace.
- Query relevant authorized state on demand, with stable references and timestamps. Do **not** dump the user's entire history into every model request.
- Summarization/memory must preserve facts, provenance and revisions; user correction should supersede old summaries. State uncertainty when data isn't available.
- Show pending proposals in UI with explicit confirmation, not silently inside assistant text.

## Unified text, voice and direct manipulation

- Text and voice use shared conversation state, domain commands and permission checks. Transcripts remain associated with the correct thread/session.
- UI changes emit the same domain events as approved AI actions. Incoming events update relevant screens and companion replies.
- Mic permission, actively listening, recording, reconnecting and speaking are distinct states. The orb should reflect *true* state, never spoof live capture.
- Entering workspaces and collapsing the panel shouldn't interrupt voice unless required by browser permission/SDK limitations; disclose limitations and design recoverable reconnect.

## Contextual attention engine

- Deterministic policy applies eligibility, urgency thresholds, quiet hours, user state, suppression, cooldown, dedupe and focus gate.
- Optional AI layer interprets ambiguous priorities and drafts language only within policy-defined eligibility.
- Persist dismissal/snooze without touching the source task/event. Resurface only after material change, policy expiry or explicit user reversal.
- Never invent alert severity or scheduled times. Define an inspectable reason for each shown insight.

## Observability and testability

- Structured logs with correlation/request IDs, action IDs, provider outcomes and safe redaction. Do not log sensitive freeform content by default.
- Test pure domain rules separately from UI and LLM calls. Stub models/providers only in **tests** and clearly marked demos, never in production-facing features portrayed as active.
- Integration tests for DB auth, transaction boundaries, action approval and idempotency; E2E for core user journeys.
- Verify feature flags, preview-only routes, environment variable separation and deployment triggers.

## Technology choices

The original project may use Next.js, Supabase, Vercel, Trigger.dev and specific AI/voice models. **Treat these as leads to verify**, not an instruction to preserve broken choices or lock model versions. Prefer compatible, incremental changes supported by testing; document reasons for any material stack replacement.

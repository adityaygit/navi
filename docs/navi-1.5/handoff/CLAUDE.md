# CLAUDE.md — Navi 1.5 Desktop

Read `START_HERE.md` and the linked specifications before changing implementation. This package describes product intent; the actual repository must be audited rather than presumed healthy.

## Mission

Build Navi as a companion-first **personal execution environment**, not ChatGPT with a calendar. The user's path is **Capture → Organize → Review → Plan → Execute → Adapt**. Work toward a **testable desktop alpha** in an isolated preview. Mobile design is explicitly out of scope for this pass.

## Parallel tracks

- **Audit/Engineering:** inspect real repo/auth/database/AI/voice/integrations; reproduce defects; classify reuse/repair/refactor/replace; fix important bugs and make meaningful architectural changes as needed. Work independently on stable contracts while visuals are being discussed.
- **Design with owner:** propose tangible desktop prototypes, get visual decisions from owner, integrate approved designs. **Do not prescribe or lock colors, typography, precise spacing, mascot art, decorative effects** from this packet.

Coordinate through `WORK_PROGRESS.md`, decision records and clear file/worktree ownership if parallel workers exist.

## Desktop interaction invariants

- Persistent collapsible left navigation. Central area shows contextual Home or the currently selected workspace.
- Home is companion-first **and work-centered**, showing continuation and **at most one** relevant contextual insight; not generic chatbot starter prompts or a KPI-card dashboard.
- Workspaces: Planner, Tasks, Projects, Inbox and Focus (keep/repair useful V1 pieces when sound).
- On workspaces, persistent **right Navi conversational panel** with small recognizable orb, chat input/history, and voice access. Panel expanded/collapsed preference persists across regular workspaces; focus defaults collapsed and restores prior preference upon exit.
- Text, voice and direct UI edits act on **the same authenticated persistent state**. Switching workspace must not reset conversation, draft, focus timer or voice connection unnecessarily.
- Structured actions must be reviewable/confirmable at appropriate boundaries; user data is authoritative. No silent auto-scheduling from brain dumps.
- Contextual attention is low-noise; protect focus; no fake urgency, arbitrary reminders or repeated dismissed suggestions.

## Nonnegotiable engineering standards

1. Audit before assuming any feature works. Substantial refactor/rewrite **is allowed** when evidence supports it.
2. Protect production, auth, existing user data and the waitlist. Use safe branch, isolated preview, and reversible/verified migrations. No destructive production changes or deploy without owner approval.
3. No fake functionality, dummy AI responses represented as real, or unpersisted state masquerading as complete.
4. Security: verify authorization and row-level access; never put secrets in client bundles/logs/reports.
5. Record real tests/results, blockers and next actions in `WORK_PROGRESS.md`. Make each session resumable.
6. Work in small, testable slices; avoid large simultaneous unverified rewrites.

## First actions

Audit repository/environment, reproduce the critical V1 flows, prepare parallel track work ownership, then present a concise findings/plan and design prototype direction. Independently fix safe foundational issues while collaborating on visual direction. Use `08_ACCEPTANCE_AND_QA.md` as the test contract.

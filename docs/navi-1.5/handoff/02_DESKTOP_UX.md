# 02 — Desktop UX Contract (Layout and Behavior, Not Styling)

The owner and Claude will decide visual appearance. This document specifies **structure, hierarchy, state changes, and interactions** only. Widths below are approximate orientation, not pixel-perfect design constraints.

## Desktop composition

### A. Home mode

- **Left:** persistent collapsible navigation sidebar, in familiar consumer-app pattern (full sidebar or icon rail).
- **Center:** companion-first Home with current continuity: a meaningful resume point or next appropriate action, and **at most one** contextual insight when justified.
- **Navi presence:** prominent companion on Home, with a conversational input/voice affordance. Avoid duplicating an oversized separate right-side chat panel on Home merely to enforce a rigid three-column template.
- Home can be calm/quiet when nothing needs attention. No artificial tasks, quotes, streaks, or prompt cards to fill empty space.

### B. Active workspace mode

- **Left:** collapsible navigation sidebar, roughly 240–260px at a typical desktop viewport when expanded; exact dimensions flexible.
- **Center:** flexible, primary workspace (Planner, Tasks, Projects, Inbox, Focus). Must retain usable width and content hierarchy.
- **Right:** compact persistent Navi conversation panel, roughly 320–380px when expanded on a roomy desktop; exact dimensions flexible. It contains recognizable mini companion/orb, conversation and text/voice controls. When collapsed, it becomes an unobtrusive orb/dock or reopen affordance.
- Individual workspace content is not a chat transcript. It remains interactive and directly manipulable.
- On narrower desktops, preserve usable workspace before enforcing side panel widths; collapsible panels, overlays or responsive docking may be used. Avoid hiding required functionality without discoverable controls.

## Navigation

- Top-level destination candidates: Home, Planner, Tasks, Projects, Inbox, Focus. Their final ordering and whether Focus is a persistent nav item can be refined with owner during design.
- Sidebar may contain optional recent conversations/project contexts, but **not** a dense upcoming-deadlines or productivity-metrics widget stack.
- Keyboard navigation and deep links should work; current workspace identifiable; back/forward behavior coherent.
- Sidebar collapse preference persists across app navigation and reload.

## Conversation panel behavior

- Panel expanded/collapsed state **persists across regular workspaces** and reloads (per-user setting or reliable client preference tied to account, chosen in audit).
- On entry to **Focus**, panel collapses by default *without overwriting the saved user preference*. It can be manually reopened while focusing.
- Leaving Focus restores the prior regular-workspace preference, unless the user expressly updated it outside the focus override.
- On workspace switches, preserve conversation context, unsent text draft, relevant selection, scroll position when practical, and voice state. Do not remount entire chat/voice providers unnecessarily.
- Orb states convey status without falsely implying that microphone capture is active. Distinguish idle, listening, processing and speaking with reliable controls and accessible labels.
- **User can always:** close/dock/open the panel; mute/end voice; inspect pending actions; cancel/retry failed requests; return to previous work.

## Companion-to-orb transition

Home's companion becomes a smaller persistent recognizable presence when the user enters a workspace. This is an **interaction continuity principle**, not a mandate for a specific visual effect. Avoid interrupting active requests, drafts or voice sessions while transitioning. Honor reduced-motion preferences.

## Workspace expectations

### Planner
- Calendar/time-oriented representation with clear current day/week context, task-to-timeblock association, adding/moving/editing/removing items, conflict signaling, and actionable changes.
- A plan item distinguishes **fixed event**, **flexible time block**, and **unscheduled task**. Avoid treating them as interchangeable.
- No mandatory Gantt/bar-style planning experience or dense management tooling.

### Tasks
- Capture, review, edit, complete/reopen, filters/search, due date, priority if meaningful, project links, and clear unscheduled versus scheduled status.
- Changes must appear consistently in other workspaces and Home.

### Projects
- Lightweight grouped work with actionable next steps, associated tasks and conversation context when available. Do not copy enterprise PM complexity.

### Inbox
- Single review area for AI-extracted drafts, ambiguous captures and proposed actions awaiting confirmation. Never silently turn raw capture into irreversible commitments.

### Focus
- Deliberate execution space: clear current task, timer/session status, controls, small companion orb/dock, protected attention. Reliable timer persistence across navigation/refresh as feasible.
- Ordinary suggestions deferred; urgent truly actionable cases may be shown at suitable boundaries and in accordance with quiet hours/permissions.

## Home content arbitration

Order of consideration (not unconditional display priority):

1. Truly urgent, actionable issue (e.g. imminent deadline with a real step the user can take).
2. Active continuity: resume interrupted work, unfinished focus session, in-progress plan.
3. Helpful next step supported by the user's actual data.
4. Calm, minimal Home if nothing deserves attention.

Show **no more than one contextual insight** at a time, separate from the main resume/continuation element if that exists. Importance alone does not imply interruption. No fabricated urgency. Dismiss and snooze have persistent effects and should not erase underlying tasks.

## Desktop accessibility baseline

Keyboard support for all core actions; visible focus; accessible control names; logical screenreader landmarks; reachable collapsed panel/voice controls; user-approved motion and reduced-motion behavior. No reliance on color alone for status.

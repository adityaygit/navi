# 01 — Product Direction and Operating Principles

## What Navi is

Navi is an AI-powered personal Life OS for follow-through, planning and daily execution. It has a conversational companion, but that conversation is **an interaction modality over a persistent user-owned system**, not the entire product.

**North-star behavior:** Navi helps someone progress from a messy thought to a trustworthy completed action, while reducing cognitive burden rather than introducing more screens, alerts or setup.

## Experience principles

1. **Continuation over blank-slate chat.** Show the user what they were doing and the next appropriate action, if one exists.
2. **Work over widgets.** The interface should prioritize the activity in progress. Do not turn Home into a dense control panel.
3. **User agency.** AI may suggest organization or changes, but the user can inspect, approve, adjust, undo when applicable, and dismiss recommendations.
4. **One system of record.** Conversational assertions, planner changes, task status and focus sessions must reconcile with persisted structured records.
5. **Adaptive, not intrusive.** Context may change what Navi surfaces; urgency is not a license to interrupt indiscriminately.
6. **Reliable before impressive.** A working capture/review/plan/execute loop matters more than broad but fragile integrations or animations.
7. **Continuity across contexts.** Home, Planner, Tasks, Focus and conversation are views into the same life/work context.
8. **Human companion, practical tool.** Friendly personality is useful, but Navi must never obstruct the work.

## Primary jobs to be done

- Capture freeform input through text or voice without requiring rigid form filling.
- Interpret it into structured **drafts** (tasks, events, project association, reminders), with uncertainty exposed.
- Review and resolve drafts, avoid duplicates, and preserve original wording when helpful.
- Plan work in a real time-aware context, with manual edits and AI-assisted adjustments.
- Execute work using task detail and focus sessions; track actual completion and interruptions.
- Adapt tomorrow's or today's plan based on state, priorities, availability and feedback, with proper approvals.
- Ask and answer questions about the user's own context without hallucinating what was saved.

## Immediate alpha audience and scope

Desktop first. The initial owner tests real personal use cases, but the system should be architected as a general consumer product. **Do not overfit UI labels or seeded data to school-specific examples.** Use demo/sample records only where clearly identified and isolated.

Mobile will be separately designed later. Shared domain logic should not be desktop-only, but do not prematurely design mobile navigation in this pass.

## Non-goals for initial desktop alpha

- A universal automation agent acting across third-party accounts without explicit approvals.
- Fully autonomous scheduling from raw brain dumps.
- A complete third-party connector marketplace.
- Advanced analytics and gamification dashboards.
- Perfect voice UX if the underlying service is unavailable; preserve working voice paths and accurately report limitations.
- A production-wide migration or V1 shutdown.
- Detailed color/theme/font/motion-art direction, which the owner will handle with Claude.

## Definition of a meaningful first success

A returning user opens Navi, sees useful continuity, captures a real commitment, reviews the structured draft, saves a task, sees it in Tasks, schedules it in Planner, starts/ends a focus period, marks the task done, and sees consistent state everywhere—without losing conversation context or corrupting data.

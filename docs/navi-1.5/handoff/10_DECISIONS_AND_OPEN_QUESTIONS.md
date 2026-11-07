# 10 — Locked Decisions, Flexible Details and Open Questions

## Locked product decisions (do not silently override)

| Topic | Decision |
|---|---|
| Product | Navi is a personal Life OS for follow-through, not chatbot-plus-calendar |
| Current scope | Desktop first; mobile design later |
| V1 code | Must audit; repair/refactor/replace substantial portions if justified |
| Work method | Engineering audit and user-guided visual design overlap |
| Home | Companion-first, continuity/next action, at most one contextual insight |
| Sidebar | Persistent, collapsible ChatGPT/Claude-style usability, not widget-heavy |
| Active workspace | Central main surface plus right-side Navi conversation panel |
| Companion | Home companion transitions into recognizable small orb while working |
| Navi panel | Persists text/voice/conversation; user-expandable/collapsible |
| Panel persistence | Remember expanded/collapsed setting across normal workspaces |
| Focus behavior | Defaults panel collapsed; restores prior regular-workspace preference on exit |
| Attention | Adaptive priority, low-noise, suppress nonurgent while focused |
| Action safety | Structured drafts, approvals where necessary, no silent auto-scheduling |
| Backend | Persistent single authoritative state across UI, chat and voice |
| Visual direction | Owner and Claude decide details directly; no prescribed colors or styling |
| Release | Isolated desktop alpha preview, preserve production and waitlist |

## Flexible implementation details (Claude proposes with evidence)

- Exact component library, state manager and state synchronization mechanism.
- Chat persistence/schema details and appropriate conversation scopes.
- Whether separate workspace tabs, route layout, or dock handles best suit responsive desktop.
- Reuse versus refactor versus replace of V1 modules and services.
- Recommended model/provider routing after verifying actual infrastructure.
- Specific visual system, sizes, icons, typographic scales and motion design.
- Sequencing of P1 features based on real blockers and cost.

## Questions worth resolving during design/audit (do not stall unrelated work)

1. Which V1 flows are broken, and which are already reliable? Need reproduction and evidence.
2. Is the current voice pipeline recoverable across route switches? What SDK/browser constraints apply?
3. Do Planner events/time blocks already share one normalized data layer with Tasks?
4. How should long-running Navi conversations relate to individual projects while retaining global context?
5. What is the best narrow-desktop panel behavior while preserving central workspace usability?
6. Which project details are essential to the alpha versus later iteration?
7. What can actually be safely deployed to a preview environment with existing credentials?
8. What visual designs does the owner approve after reviewing clickable screens?

## Conflict protocol

If a required behavior proves infeasible: show the technical reason, viable alternatives, tradeoffs and a recommended fallback. Do not silently substitute a different product direction. Record the owner decision in `WORK_PROGRESS.md` and update specs if authorized.

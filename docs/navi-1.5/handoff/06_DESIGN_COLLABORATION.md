# 06 — Design Collaboration in Parallel with Engineering Audit

## Authority and boundaries

The owner will work directly with Claude on visual appearance. **Do not prescribe colors, themes, typography, exact spacing, component decoration, gradients, shadows, or mascot/orb illustrations in this handoff.** Existing V1 visuals are references, not constraints.

The **functional layout contracts** in `02_DESKTOP_UX.md` are requirements. Within them, Claude should propose visual compositions, alternatives and prototypes. If a better design needs a change to an interaction invariant, flag it as a decision, don't silently change the product.

## Start at the same time as Track A

Track A (engineering) audits the repo and begins independent foundational fixes. Track B (design) simultaneously presents to the owner:

1. **Desktop shell concepts:** left nav, primary workspace, right conversation panel; show expanded/collapsed states.
2. **Home:** one meaningful continuity element with companion and (when warranted) one contextual insight; calm empty state.
3. **Tasks/Planner:** active workspace plus persistent conversational panel/orb, with real interaction affordances.
4. **Focus:** quiet execution surface, collapsed-but-available Navi, timer behavior and restoration.
5. **Responsive desktop:** narrow-window behavior, side-panel constraints, keyboard interactions.

**Show rather than tell:** clickable previews, locally running route prototypes or clear screenshots that the owner can critique. Do not claim fidelity until the owner approves direction.

## Product/engineering coordination contract

Define stable contracts early so both tracks can work independently:

- Navigation route IDs / workspace state and panel state transitions.
- Data entities and command interface for tasks, events/blocks, focus and proposals.
- Conversation panel host/component contract (thread ID, selected context, voice status, pending proposals).
- Design state expectations for loading, error, permission denied, empty, queued approval, offline and retry.

Use **mock data only inside isolated design prototypes**, labeled clearly; production-like flows must bind to real backend. No merging UI concept that hides broken or nonexistent behavior.

## Approval gates

- **Gate D1 — Shell:** owner approves approximate information hierarchy and panel ergonomics (not exact pixel values).
- **Gate D2 — Home + workspaces:** owner reviews interactive states and key transitions; unresolved layout feedback recorded.
- **Gate D3 — Integrated build:** owner reviews real app with real data after components are wired; fixes verified.

If owner is unavailable, continue Track A and testable nonvisual contracts; do not invent final visual approval. Capture proposed changes and next review request.

## Reference inspiration (patterns, not copying)

- Linear: workspace clarity and understated navigation.
- Amie: approachable, consumer-friendly planner patterns.
- Notion: flexible content/workspace composition.
- Opal: distinctive warmth and companion personality.

Do not directly reproduce another brand's artwork, signature screen, or proprietary visual language. No mandatory palette is specified here.

## End-of-design deliverable

A brief owner-approved desktop design decision record with reviewed states/screens, layout constraints, components to implement, remaining variants and any deviations from the UX contract. It is okay for visual refinement to continue after first alpha if core experience is usable.

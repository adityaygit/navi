# Navi landing — art direction v2

## Audit of v1
| Section | Verdict | Why |
|---|---|---|
| Nav | Rebuild | Generic link row; no hierarchy between sign-in and primary action. |
| Hero (device + dashboard) | Rebuild | Dashboard reads as a stock "analytics" mock; doesn't show what Navi is (conversation + plan sharing one state). |
| Highlights carousel | Remove | Three unrelated mock cards; carousel hides content; no story. |
| **Rock + dock ("One calm place for everything.")** | **Keep (protected)** | Strongest composition. Only responsive scaling added. |
| Rotator (briefing / routines / tools) | Remove, fold ideas into new chapters | Timed rotation hides two thirds of the content; orbit of chips is decoration. |
| Monitor week view | Rebuild as the planner chapter | Right idea (fixed vs flexible week), weak UI. |
| ⌘K keys + weekly card | Remove keys; weekly review folds into the review chapter | Keys say "shortcut", not what Navi does. |
| Review panel | Rebuild | Long scroll-jacked panel; content good, presentation heavy. |
| CTA + footer | Rebuild | Fine, but should close the editorial voice. |

## One language from three references
- **Structure (Fey):** every chapter shows the product doing one thing, with real UI as the hero of the chapter.
- **Type (Slash):** high-contrast serif for editorial statements (hero, chapter openers, numbers), with an italic word for emphasis. Sans for all UI and body. Product feature headings keep the sans display used by the protected rock section, so it belongs to the system rather than standing apart.
- **Precision (Resend):** pure black canvas, 1px hairlines instead of shadows, two radii (14px surfaces, 8px controls, pills for actions), mono for times, data and system text.
- **Colour:** no brand accent. Colour appears only as meaning (status in UI: kept, moved, at risk, focus, recovery) and in imagery.

Type: Instrument Serif (display), Instrument Sans (UI, also the rock section), Geist Mono (data). All OFL, from Google Fonts.

## Page architecture
1. **Nav**: wordmark, four links, quiet "Sign in", white pill "Join early access".
2. **Hero**: announcement pill → serif headline → one line → email pill. Below it, the product: one window where the conversation and the day plan sit side by side and change together (Navi proposes, you approve).
3. **Set-up chapter**: "Tell it about your life once." Voice transcript beside the proposal Navi builds from it (workspaces, routines, goals, commitments), each with approve/edit. Shows the spec's first-run promise.
4. **Rock + dock** (protected).
5. **Planner chapter**: "Fixed where it must be. Flexible everywhere else." A week grid on a landscape backdrop; fixed blocks solid, flexible blocks outlined; a new meeting lands and flexible work re-flows (purposeful motion).
6. **Voice moment**: portrait image with a live transcript and the tool calls it triggers.
7. **Three precise cards**: morning briefing, review inbox, inspectable memory.
8. **Accountability chapter**: serif numerals for an example week + the evening review sheet.
9. **Control chapter**: what Navi does on its own and what it asks first; privacy facts.
10. **Close**: serif statement + email pill; minimal footer.

Motion: content rises once on scroll (scroll-driven CSS); the hero plan updates when the conversation approves; the planner re-flows once on view; the voice waveform breathes; the dock keeps its cycle. All of it is disabled under reduced motion.

Responsive: real mobile layout (stacked chapters, product windows reflow or scroll inside their frame). The rock stage scales as one unit below 1186px.

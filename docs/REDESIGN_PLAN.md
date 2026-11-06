# Navi redesign plan

Status: **plan only, nothing built yet.** Written 2026-11-05 from the owner's direction in a design session.
Product rules still come from `Navi_Product_Spec.md`. This file only covers how the app *looks* and how a few screens *behave*.

## Why

The app works, but the UI is the deliberately basic first version (neutral greys, one blue accent, small text). Almost nothing reads well. The finished app should feel like a consumer product, not a tool. Target mood: **Opal** (dark, glassy, calm, premium) plus the amber-on-black dashboard the owner shared (Deep Work Time, Focus Stability bars, Daily Timeline).

Two things matter most:
1. **Chat shows what Navi is doing**, step by step, as it happens.
2. **Reflection is a core feature**, built in the way Opal does reports and insights.

---

## 1. Chat: show the work

### What the owner wants
Like ChatGPT or Claude showing "Using Gmail", Navi's chat should visibly show actions: adding a task, creating a project, planning the day, and so on.

### What exists now
Chat waits for the full reply and shows "Navi is thinking…". Actions only appear afterwards as small badges under the message (`tool_events`, see `src/components/chat.tsx`). Read-only lookups are hidden from the history on purpose.

### Plan
- **Live steps while Navi works.** The chat API streams events: a step starts ("Adding task: Finish essay"), then finishes, fails, or waits for approval. One line per step, with an icon, a verb, and the item's name.
- **Finished steps become small cards** in the history. A card links to the thing it made or changed (task, project, plan block) and has an Undo where the existing activity log can revert it.
- **Read-only steps** (checking the plan, searching memory) show live, then collapse to one quiet line ("Looked at your plan and inbox"). They stay out of the saved history as they are today.
- **Approvals appear inline.** When an action needs approval, the step turns into a card that says exactly what will happen, with Approve and Decline. Nothing is described as done until it actually is (spec §3.I).
- **Failures are honest.** A failed step is red and says what failed. No "done" unless confirmed.
- **Voice uses the same cards**, so text and voice history look identical.
- **Connected apps later.** Labels like "Using Gmail" or "Using Calendar" only appear once those connectors really exist. Today they are not connected, so the app must not fake them. The step component takes an app name and icon so it is ready.
- A **tool name → label and icon** table lives in one file next to `src/lib/tool-names.ts`.

### Done when
A real chat turn that creates a task and a project shows both steps live, ends with two linked cards, survives a reload, and looks the same when the turn came from voice. Covered by Playwright on desktop and iPhone.

---

## 2. Reflection (the big one)

### What Opal does that we borrow
Opal reflects on your progress better than anyone in this space. The patterns, with the screens saved in the Mobbin collection "Navi – Look":

- **Story-style report.** A thin segmented progress bar on top, one insight per screen, a big plain sentence with the key words coloured, one simple visual, then Continue. Example: "Your most productive day was **Friday**…" with one tall glowing bar. See [weekly recap](https://mobbin.com/screens/ea59c327-1787-47dc-b850-15708c5e337d?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp) and [daily average](https://mobbin.com/screens/62769965-9c74-417e-ae28-deb6c2aba10e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).
- **Blunt but kind tone.** "The bad news is…" and "Yep, you read this right." Direct, a little dramatic, never cruel. This fits the spec's "strict but fair". See [the projection screen](https://mobbin.com/screens/fc3f2fbd-6a46-4fbb-94ca-90aae5db1ec5?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).
- **One score with parts you can open.** A big number, three small pills under it, and a "What is this score?" explainer. See [Opal Score](https://mobbin.com/screens/bad32255-2039-4c36-adb1-23ba96c7a709?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp) and [Sleep Score](https://mobbin.com/screens/3f912d2e-2bc2-400b-aba4-88b02852a4c8?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).
- **Rows against your own average.** Each row shows the number, an AVG marker on a slider, and a word like Great, Good, Short, Late. Readable at a glance. See [Today stats](https://mobbin.com/screens/82640f74-6eda-4d4a-a8b9-77c7a695c1e9?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).
- **A report card on the main screen** that opens the full story ("Weekly Report" → Open).
- **Trends with a range switch** (week / month / 6 months) and a one-line plain-English reading above the chart. Other apps worth copying for this: [WHOOP](https://mobbin.com/screens/010184b9-da45-49df-a98f-e32722b7d3a6?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp), [Bevel](https://mobbin.com/screens/522ddab2-6b35-4dea-889c-a60767f75809?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp), [stoic.](https://mobbin.com/screens/b6f7f727-5420-4c02-ba9f-9ba544d5e40a?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).

### What exists now
The numbers are mostly there. The backend already computes the day review, the weekly insights (planned vs done, focus minutes, per-project progress, disruptions, next-week load), behavioural patterns, and stores them. The screens are plain lists. So this work is **mostly presentation**, plus a few extra fields (per-day series, personal averages).

### Plan
1. **Daily review as a short story** (about 4 screens): what you planned vs did, what slipped and why (rest, interruption, missing info, took longer), one thing Navi noticed, one question to answer. Your answer is saved and can become a memory.
2. **Weekly report as a story** (about 6 screens): best day, hardest day, time spent, per-project and goal progress, pattern Navi is learning, what changes next week. Ends with "Plan next week".
3. **Report card on Today** that opens the story. Appears when there is a review to show.
4. **Insights page = rows against your average**, with Great / Good / Needs care words and a range switch for trends.
5. **Score:** one explainable "follow-through" number with three visible parts, each tapping open to "how this is worked out". It only appears once there is enough evidence. The spec forbids a fake A–F grade built on assumptions, so each part must come from real planned-vs-actual data.
6. **Tone rules:** direct, specific, grounded in events. Never shame, never guess motives. If there isn't enough data, say so: "Not enough days yet."
7. **Everything is real.** No invented numbers. Empty states are honest.

### Done when
With a week of seeded real data, the weekly story shows true numbers matching `get_review`, empty weeks say there is not enough data, and all of it passes the accessibility checks on desktop and iPhone.

---

## 3. Visual system

- **Dark first**, with a proper light theme later. Near-black background, raised glass surfaces, soft glow in one corner of a card instead of hard borders.
- **Accent:** warm amber from the owner's reference, with a calm cool secondary. Green is reserved for "good", soft red for "slipping". Colour is never the only signal (a word or icon always goes with it).
- **Type:** big, light headings; small labels kept readable. Every text colour must still meet WCAG AA on glass. This is a rule, not a nice-to-have, because Navi has an automated axe check.
- **Hero element:** Navi itself as a glowing orb (made with CSS gradients, not stock photos). It sits on Today, in voice mode, and on review moments.
- **Words before numbers:** status words and short sentences first, raw numbers second.
- **Shapes:** large rounded cards, pill chips, round icon buttons.
- **Motion:** gentle glow and fade only, and fully off with "reduce motion".
- **Imagery:** gradients and generated art only. No licensed photos.

### Layout
- **Phone:** floating pill tab bar (Today, Navi, Inbox, Planner, More), one column, full-screen ritual states for focus and voice.
- **Desktop:** left sidebar, and Navi as a side panel next to any screen. Cards reflow into 2 to 3 columns, the timeline runs horizontally, and the reflection story opens as a centred panel. Same components, different arrangement.

### Components to build first
Glass card, stat card with glow, status row with AVG slider, score with parts, story screen with segmented progress, action step and action card (section 1), pill tab bar and sidebar, orb.

---

## 4. Build order

Each step ships working, tested, and does not break the existing tests.

1. **Design tokens and app shell:** new colours, type, glass card, pill tab bar, sidebar. Existing screens inherit the look immediately.
2. **Chat with live steps and action cards.**
3. **Today:** orb, greeting line, stat cards (focus time, goals done), timeline.
4. **Reflection:** daily story, weekly story, report card, insights rows, score.
5. **Planner, Tasks, Projects, Goals** restyled.
6. **Voice screen** restyled around the orb, captions toggle.
7. **Onboarding** restyled.

Checks for every step: `tsc`, lint, unit and integration tests, Playwright on desktop and iPhone, the axe accessibility spec, and screenshots of each changed screen at phone and desktop width.

## 5. Questions for the owner

1. **Accent colour:** amber like the reference, or Opal's mint green?
2. **Score:** keep one follow-through score with three parts, or show only the rows and sentences?
3. **Orb:** is a glowing orb the right face for Navi, or something else?

## References
- Mobbin collections (private): "Navi – How it works" and "Navi – Look".
- Owner's amber dashboard reference (dark glass cards, Focus Stability bars, Daily Timeline).
- Chat-with-steps examples: [Perplexity](https://mobbin.com/screens/4ea08f69-9f99-40a6-bc83-f003dcd20d3c?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp), [Manus](https://mobbin.com/screens/59294d00-2e82-406d-a422-a8efa4cd10ab?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp), [Linktree](https://mobbin.com/screens/7e370793-4b21-4992-8738-e417d3ce22dc?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp), [ChatGPT](https://mobbin.com/screens/22788818-5e74-459e-aa7a-1727fc376d3e?utm_source=claude&utm_medium=ai-assistant&utm_source_platform=mcp).

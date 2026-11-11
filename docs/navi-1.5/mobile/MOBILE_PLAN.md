# Navi 1.5 Mobile — Phase 1 research and written proposal

Status: **Draft for owner discussion (2026-11-11). Nothing drawn, nothing coded.** Phase 2 (boards) starts only after the owner approves this plan.

Inputs: approved R4 desktop boards and onboarding boards (`docs/navi-1.5/design-canvas/`, live canvas), the handoff contract (`docs/navi-1.5/handoff/01–03`), the product spec, the running app (local, demo account, phone and desktop widths), the owner's Mobbin collections "Navi – How it works" (21 screens) and "Navi – Look" (22 screens), and targeted Mobbin searches (references at the end).

---

## 0. What I found first

**R4 design language, in one paragraph.** Black ground, one soft green glow, Figtree, the green **Navi stone** as the only character. Navi speaks in **one plain sentence per page**, built only from real data, where the key facts are bright and the connective words are grey ("Four things today, **one already done**. Your **afternoon** is the busy part."). Lists are thin rows, not cards. There is at most **one** suggestion per page, always with "Not now". Anything Navi did appears as a quiet line with **Undo**. Anything Navi proposes is a small card that changes nothing until you press it ("Put it there" / "Another time"). Advanced settings stay hidden behind "More details". Focus is protected. Things that arrive during focus wait behind a quiet "2 waiting".

**The current app at phone width is not a starting point.** The mobile shell was removed on 2026-11-07, when the owner decided "desktop only". At 390 px today there's no navigation at all. The sidebar is gone, a floating "+ Capture" covers content on every page, a stray avatar floats bottom-left, and the Navi panel doesn't exist. It's useful only as a functional inventory, which I've listed below. This confirms your instruction not to build on the old PWA.

**What the product actually does today (what mobile must cover).**
- Home: greeting sentence, day bar, a continue / "Next up" card, one insight, and a composer. Chats live in a list (New chat, recent chats, `/chats`).
- Navi conversation: streaming replies, live action steps, one plan card per reply with one Undo, proposal cards, approval cards (approve / decline / change by talking, run once, expiry), a "Looking at" line, and "Navi opened ‹page›" pills.
- Voice states: not started, connecting, listening, muted, mic paused, speaking, connection lost, ended, error, and mic blocked.
- Capture: a quick capture box with a draft that survives reloads, an offline queue that shows itself and syncs when the connection returns, and on-device dictation.
- Review inbox: drafts with source quotes, "You said this" vs "Navi inferred", confidence, and Accept / Edit / Later / Reject / Merge into…, plus "Accept the 2 you said" / "Accept all".
- Tasks: Today / Upcoming / Anytime / Someday, a quick-add bar, steps, due vs hard deadline, estimates, repeat, reminders.
- My day: timeline (default) and week calendar, "Still needs a time" with "Place it", free-slot fits, Plan my day / Plan next 7 days, My plan broke, Add a fixed commitment, and the Fixed / Flexible / Routine legend.
- Focus: 25/50/90 presets or a picked task, pause / resume / done, and "N waiting".
- Daily review: mark each block as Done / Partly / Rest / Interrupted / Missing info / Took longer / Just didn't, then plan tomorrow. Weekly review and Insights (follow-through story, planned vs done, "Navi noticed").
- Memory, Notes, Activity & approvals, Settings (schedule, quiet hours, Navi's colour, planner v2 preview).
- Pushes: morning briefing, evening review, weekly review, due soon, hard deadline today / tomorrow, overdue, reminders.
- Global states: AI budget banner, AI unavailable, development-simulator notice, onboarding gate.

**Three conflicts you should know about.**
1. **"Desktop only" (2026-11-07) is reversed by this project.** I'll record the reversal when this plan is approved. The root `CLAUDE.md` still names the iPhone PWA as V1, which is now out of date in both directions.
2. **Native iOS sign-in.** Apple's App Review rule 4.8 generally requires *Sign in with Apple* when an app offers Google sign-in. Google also blocks sign-in inside embedded web views (we hit this with the desktop app). Neither affects the design much, but onboarding screen 1 probably needs an Apple button. I'll verify in Phase 3; this is not an architecture choice yet.
3. **R4 Home vs the later chat layout.** R4 Home is companion-first. The chat-layout work on 2026-11-08 (also approved) made Home start the conversation in the centre, with recent chats in the sidebar. The shipped desktop does both. My proposal follows R4, as you asked, and treats chats as a secondary list, not a home surface.

---

## 1. Mobile philosophy

**Navi on the phone is a pocket companion for the moment you're in, not a smaller desktop.** On desktop you sit down to plan and work. On the phone you're mostly doing one of five short things:

| Moment | What it needs | Time |
|---|---|---|
| Glance | "What's now, what's next, am I on track?" | 3–10 s |
| Capture | Get a thought out of your head before it's gone | 5–20 s |
| Adjust | "I'm running late" / "fit X in" / move one thing | 20–60 s |
| Execute | Start focus, tick things off, keep the timer visible when locked | minutes |
| Reflect | Morning briefing, evening wrap-up, weekly story | 1–3 min |

Design rules that follow from this:
1. **Every moment has a one-handed path from the bottom of the screen.** Primary actions sit in the thumb zone. Nothing important lives only at the top.
2. **Navi is always one tap away and always aware of what you're looking at,** without taking over the screen. The conversation is a layer over your work, never a page you get sent to.
3. **Same voice, fewer words.** The R4 sentence rules (sources board) carry over unchanged. On mobile the headline sentence is the screen's hero, and most detail moves behind a tap.
4. **Direct manipulation first, conversation second.** Swipe to complete, tap to place, drag where it's natural. Navi is for things that are slow by hand ("move everything after 3 back an hour").
5. **Native feel:** system sheets with detents, swipe-back, haptics on commit, a Live Activity for focus, real push, Dynamic Type, VoiceOver, reduced motion. Dark first, like R4.
6. **Calm by default.** No dashboards, no stacks of cards, no streaks or scores on Today, no ChatGPT-style empty chat screen. An empty day says "Your day is open." and stops.

---

## 2. Carry over, adapt, rethink

| Desktop R4 | Mobile | Why |
|---|---|---|
| Sentence rules, "Navi never says" list, one suggestion + "Not now", Undo lines, proposal cards, "Looking at", colours, type, stone | **Carry over as is** | This is the identity, and it's already phone-sized |
| Onboarding (one idea per screen, black, stone, step dots, "Do this later") | **Carry over, re-lay out** | Already Opal-style. Only "Talk it through" needs a real redesign (no room for a side panel) |
| Task row, steps, "More details" | **Carry over → bottom sheet** | The R4 task card is basically a sheet already |
| Timeline as the default My day | **Carry over** | A vertical timeline is a native phone layout |
| Left sidebar (Home, Tasks, My day, Inbox, Focus, Spaces, Chats) | **Rethink → bottom tab bar + Navi button + "You" sheet** | No sidebars on phones; Spaces and Chats are secondary |
| Right Navi panel, collapsing to an orb/dock | **Adapt → Navi sheet with three heights, plus the stone button** | The phone's version of a side panel is a sheet over the current page |
| Home companion becoming an orb in workspaces | **Adapt → Today's wide "Tell Navi anything" bar shrinks into the stone button on other tabs** | Same continuity idea, same meaning |
| ⌘K palette | **Rethink → typing in the Navi sheet shows matches first (Do / Tasks / Go to), "Ask Navi" last** | No keyboard shortcuts on phones; one input does both search and ask |
| Week calendar, 7 columns | **Rethink → 3-day grid by default, week as an overview of busy days** | 7 columns at 390 px gives unreadable 50 px blocks (see Outlook / Evernote references) |
| "Still needs a time" side column | **Adapt → a "3 need a time" tray at the bottom of My day** | No room for a second column |
| Hover, right-click, drag between panes | **Rethink → swipe actions, long-press menus, tap-to-place; long-press drag only on the timeline** | Touch idioms |
| Focus full page | **Adapt → full-screen takeover + Lock Screen / Dynamic Island Live Activity** | On the phone, focus mostly happens while the screen is locked |
| Morning / evening / weekly briefings (text) | **Rethink → short, story-style screens opened from the push** | The phone is where briefings are read |
| Daily review form (all blocks, chips per row) | **Rethink → one block at a time, one tap per answer, done in under a minute** | The form is too dense for a phone |
| Insights dashboard | **Adapt → weekly story, then detail** | Stays secondary; reached from the weekly review push or from "You" |
| Memory, Notes, Activity, Settings, Chats, Projects | **Adapt → plain native list screens under "You"** | Rarely used on the go |

---

## 3. Navigation approaches

### ▶ Owner direction, 2026-11-11: swipe layout with chat in the middle (supersedes the A / A+D recommendation below)
**Exactly three pages (owner, 2026-11-11):**
```
 ← swipe                          swipe →
[ How it's going ]  ←  [ Navi chat ]  →  [ Plan ]
   looking back          now, home         looking ahead
☰ on chat → drawer: chats list; your account bottom-left → Settings, Memory, etc.
```
- **Plan** combines My day, Tasks and Inbox. A tappable "3 to review · 1 needs your OK" row is pinned at the top when anything is waiting, and opens Inbox as a sheet. Below it are the week strip, the sentence, and a **Day · Week · List** switch:
  - **Day** (default) is the timeline, with tasks merged in: scheduled blocks, "due today, no time yet", and the "need a time" tray.
  - **Week** is the calendar overview.
  - **List** shows all tasks: Today / Upcoming / Anytime / Someday.
- **How it's going**: today so far (planned vs done), this week's follow-through, what Navi noticed, and the daily and weekly reviews. Real numbers only, no score tiles.
- No tab bar. Pages are reached by swiping or by tapping short labels at the top. You can always see where you are.
- The chat page is not a blank ChatGPT screen. A slim now/next line sits at the top, and Navi's first line each day comes from real data.
- The drawer opens only from the ☰ button, not an edge swipe, so it doesn't fight the swipe to "How it's going".
- On other pages, a small stone takes you back to the chat with context ("About: My day, Friday").
- Focus and full-screen voice cover all pages.
- No sideways swipes inside pages: tap to complete, long-press for options, tap the week strip to change days.
- Owner confirmed (2026-11-11): Plan opens on **Day**; Inbox is a pinned row that opens a sheet. **Phase 2 approved to start.** First boards: M1 structure (clickable prototype + map) on the existing canvas.

The earlier options are kept below for the record.

### A. Tab bar + companion button (recommended)
Floating tab bar with **Today · My day · Tasks · Inbox**, plus a separate round **stone button** to its right (the pattern iOS uses for a search button next to tabs; see Oura, Linear, Structured). Tap the stone → Navi sheet over the current screen. **Press and hold → voice starts immediately.** On Today, the stone stretches into a wide "Tell Navi anything" bar (the companion state). On other tabs it's just the stone (the orb state). Focus is a mode, not a tab. Secondary screens live in a "You" sheet opened from your initial, top-right.

- **For:** familiar and native, so nothing to learn. It maps one-to-one onto desktop (sidebar → tabs, right panel → sheet, Home companion → orb). Direct manipulation stays first. Deep links and back behave normally. Accessible (tab bar landmarks, no hidden gestures). Capture and voice are one thumb movement from anywhere.
- **Against:** a tab bar is ordinary, so the personality has to come from the stone, the sentences and motion. The stone can turn into "just a FAB" if we don't commit to its companion behaviour. Four tabs is the comfortable maximum.

### B. Navi-first (conversation as home)
Home is the conversation with Navi, with today's sentence and the next item pinned at the top. Tasks, My day and Inbox open as full screens from a drawer (Claude / ChatGPT pattern) or from cards inside the conversation.

- **For:** the strongest companion feeling. Voice and capture are central. Very little navigation.
- **Against:** this is exactly the ChatGPT-style interface you ruled out. It breaks the hybrid rule (the dashboard becomes second-class) and the R4 principle "Work over widgets / continuation over blank-slate chat". Glance and execute moments get slower, a growing transcript buries today's state, and it's hard to make accessible and deep-linkable.

### C. One canvas with layers (Amie / Joi style)
A single Today canvas (sentence + timeline). A bottom sheet pulls up into Tasks / Inbox lists. A pinned Navi bar at the bottom handles both capture and asking. Swipe sideways for days, pinch for the week.

- **For:** very fluid and distinctive. The fewest taps to see everything. It feels like one living object.
- **Against:** gesture-heavy and hard to discover (where are Tasks?). Nested sheets fight the Navi sheet. Weaker for VoiceOver and Dynamic Type. Focus, settings and deep links have no natural home. It's the biggest build risk and the hardest to keep reliable, which goes against the 1.5 goal "reliable before impressive".

### D. Hybrid Today: your day on top, Navi below (owner suggestion, 2026-11-11)
Approach A's tabs stay. **Today itself becomes a split screen**: the top is a glance of your day (sentence, a compact day / calendar strip, two or three real facts) and the bottom is the conversation with Navi, inline rather than in a sheet. Details are in §5.

- **For:** it's the most faithful mobile version of the desktop Home, which already stacks sentence → day bar → next up → composer, and since 2026-11-08 shows the chat in the centre. You see the *effect* of what you ask: "Put it there" and the block appears in the strip above. It gives the companion a real home without making it a blank chat. Insights become Navi's opening line instead of a separate row.
- **Against:** a phone keyboard takes about 40% of the screen, so the top must collapse while you type. A long conversation could bury the day unless the thread starts fresh each day. "Stats" can slide into a dashboard, so the top is limited to the sentence plus real counts (no tiles, scores or streaks).

**Recommendation (updated): A + D.** Tabs and the stone as in A. The Today tab is D's split screen, where the stone has nothing to open because Navi is already on the page. On My day, Tasks and Inbox, the stone opens the **same conversation** as a sheet. From C: My day uses sheet heights for the "need a time" tray. B's voice-first strength comes in through press-and-hold on the stone.

**Inbox as a tab (open question).** Inbox is where capture lands, so on a capture-heavy device it earns a tab with a badge. The alternative is three tabs, with Inbox as a row on Today ("3 things to review") and a filter in Tasks. I recommend the four-tab version and want your call.

---

## 4. Navigation structure and screen hierarchy (approach A)

```
Today (tab)              My day (tab)                Tasks (tab)                 Inbox (tab, badge)
├─ Briefing (from push)  ├─ Timeline (default)       ├─ Today/Upcoming/          ├─ Draft review
├─ Continue → Focus      │   └─ Block sheet          │  Anytime/Someday          │   └─ Edit draft sheet
├─ Insight row           ├─ Calendar: 3-day / Week   ├─ Task sheet               └─ Waiting for your OK
└─ "Finish setting up"   ├─ "Need a time" tray       │   └─ More details             (approvals)
                         └─ My plan broke (Navi)     └─ Space filter

Everywhere: Stone button → Navi sheet (peek / half / full)   Hold stone → Voice
            "You" (initial, top-right) → Spaces & projects · Insights · Memory · Notes ·
                                         Activity · Chats · Settings · Sign out
Modes (cover the tabs): Focus · Voice (full) · Onboarding · Daily/Weekly review · Briefing
```

- Up to **two levels deep** from any tab. Sheets for details, pushed screens only under "You".
- Back is the swipe-from-edge gesture everywhere. Sheets close with a downward swipe.
- Every screen and sheet has a deep link (push notifications, widgets, Navi's "See My day").

---

## 5. Today and the adaptive workspace

**Layout, top to bottom (one screen, rarely scrolls):**
1. Small stone (not the 130 px desktop hero), your initial top-right.
2. **The sentence** ("Afternoon, Alex. Four things today, **two already done**. Your **evening** is the busy part."), in large type, as on desktop.
3. **Now / next strip:** "Now — free until 3:00" · next 2 items with times. This replaces the horizontal desktop day bar, which is unreadable at 390 px. Tap → My day.
4. **Continue** (R4 "Pick up where you left off") with one button: Start focus. Only shows when there's real continuity.
5. **One insight row** with its action + "Not now" (same rules and sources as desktop).
6. **Inbox row**, only when something's waiting: "3 things to review" / "Navi needs your OK on 1 thing".
7. **"Tell Navi anything" bar** above the tab bar (the companion state of the stone).

**What adapts (the same arbitration as desktop, nothing new invented):** urgent and actionable → continuity → helpful next step → calm. Examples to draw:
- Morning before the first event.
- Mid-afternoon with a focus session that was left open.
- Overdue hard deadline.
- Evening (wrap-up offered).
- Empty day ("Your day is open.").
- First day after "Do this later".
- Offline.
- AI unavailable.

Nothing on Today is a widget the user arranges. It changes only because the data changes.

---

## 6. Navi companion, chat and voice

**Navi sheet** (opened by tapping the stone, from any tab):
- **Peek** (about 25%): last Navi line + composer. The screen underneath stays usable. Good for "done, Undo".
- **Half** (default): conversation over your page. The "Looking at · My day, Friday" line stays at the top, so it's clear Navi is talking about what you see.
- **Full:** long conversations, and the chats list (a "Chats" link at the top, not a drawer).
- The draft, scroll position and voice state persist when the sheet closes, matching R4 panel states. The closed stone shows a dot for a draft, a quiet number for something new, and a live waveform while talking.

**In the conversation:** the same pieces as desktop.
- User bubbles, plain Navi text.
- **Action lines with Undo**, **one plan card per reply** (moves behind a disclosure), **proposal cards** (Put it there / Another time), **approval cards** (exactly what will happen, Approve / Not now, or change it by talking).
- Live "working" steps while tools run (Perplexity / Manus references, kept to one quiet line).

No suggested-prompt chips on an empty sheet. Navi's first line comes from the page ("Want me to find time for the dentist call?" only when the data supports it). Otherwise the sheet shows just the composer.

**Search and ask in one field** (replaces ⌘K): as you type, matches appear above the composer — *Do* ("Fit 'Book the dentist' into today"), *Tasks*, *Go to*. Sending the text asks Navi.

**Voice:**
- **Press and hold the stone** → haptic tick → listening starts straight away. Release keeps the call going; it's a call, not walkie-talkie. Tap also works from the sheet's mic.
- **Full voice view:** the stone big and breathing (listening / speaking / thinking each look different, never implying the mic is on when it isn't), a live transcript underneath (saved to the same conversation), and three controls: **Mute · Type · End**. "Type" drops to the sheet with the same conversation. Cards Navi makes while talking show up as cards.
- **Minimise to keep working:** swipe down → a **talking pill** above the tab bar (stone + timer + mute + end). Voice continues while you switch tabs. This is R4's "Talking" dock state.
- States to draw: connecting, listening, muted, Navi speaking, interrupted (barge-in), reconnecting, ended with summary, mic blocked (text-only hint plus a path to Settings), no connection, and budget reached.
- Honesty rules carry over: voice needs a connection, there's no always-listening, and we never promise background audio iOS won't allow.

---

## 7. Quick capture and brain dump

Capture is the main reason to open Navi on a phone, so it gets the shortest paths:
1. **Today bar / stone tap:** type it and send. A one-liner that's clearly a task ("call dentist fri") becomes a task with a visible Undo. Anything bigger or vague becomes **drafts** in the Inbox, never silent commitments (spec rule).
2. **Hold stone → talk it out.** At the end, Navi says what it picked up in one sentence plus one card: "Picked up 4 things — Review". Raw words are kept.
3. **Tasks tab quick-add** (R4 bar with day and space chips, natural-language dates) for people who just want a list.
4. **From outside the app** (native packaging makes these possible; scope to be decided): Lock Screen / Home Screen capture widget, share sheet ("Send to Navi" from Safari or Mail, treated as data, not instructions), Siri / Shortcuts / Action button "Tell Navi…", and a long-press app-icon quick action.

**Brain-dump review on the phone:** Inbox shows the drafts grouped by source ("From your 1:40 capture"), with the quoted words, "You said this" vs "Navi inferred", and swipe right to Accept / left for Later. Tap → edit sheet. Merge stays in the sheet. "Accept the 2 you said" stays as the bulk action.

**Offline:** captures always succeed locally. A small "2 waiting to send" line appears on Today and in Inbox until synced. Nothing is ever lost. AI-dependent replies say plainly that they'll come when you're back online.

---

## 8. Tasks, My day / Calendar, Focus

**Tasks**
- Segmented control: Today / Upcoming / Anytime / Someday, with the R4 headline sentence ("4 left. The essay's the big one…").
- Rows as on desktop: circle, title, space dot, due / estimate. **Swipe right = done** (haptic, Undo toast). **Swipe left = When…** (Today / Tonight / Tomorrow / Pick / Find a time). Long-press = menu.
- **Task sheet** = the R4 "A task, as it opens": steps, notes, When / Due / Space. Primary actions at the bottom: **Focus · Find a time · Ask Navi**. "More details" expands hard deadline / estimate / repeat / reminder, as approved.
- Space filter as a chip row, not a sidebar.

**My day**
- Week strip at the top (swipe for weeks, dots for busy days). Headline sentence. **Vertical timeline** with Morning / Afternoon / Evening, the now-line, and free-slot rows ("30 free minutes — the dentist call fits here · Fit it in").
- **Fixed / Flexible / Routine** keep their three marks (filled / ring / dashed). Tapping a block opens a block sheet (Start, Move, Mark, Unlink).
- **"3 need a time" tray** pinned above the tab bar. Pull it up → list → "Place it" (Navi proposes a slot, you confirm).
- Long-press drag on the timeline is a candidate, not required for 1.5.
- **Calendar toggle:** 3-day grid by default, Week as an overview (busy-day bars plus the week sentence "Friday's the full one…"). Tap a day → that day's timeline.
- "My plan broke" lives in the Navi sheet and on the timeline when you're behind ("Running late? Shift the rest") → one plan card + Undo.

**Focus**
- Starts from Continue, a task sheet or a block. It **expands into a full-screen takeover**: task, space, big timer ring, Pause · I'm done, and a quiet "Ends at 2:48".
- Navi is closed. The stone shows "2 waiting".
- **Live Activity / Dynamic Island** with time left and Pause / Done (native only), so focus survives the phone being locked.
- Ending early asks once, neutrally ("Stop now? 18 min done counts.") — no Opal-style guilt. Strict but fair, never shaming.
- When focus ends: "While you focused: 2 new drafts · 1 reminder — Review".
- Breaks through focus: only a fixed event within 10 min or a hard deadline today (the R4 rule).

---

## 9. Approval cards, notifications, review inbox

- **Approvals live where they happen:** inside the conversation as cards (desktop pattern). Anything still waiting is mirrored in **Inbox → "Waiting for your OK"** and as one row on Today. Each shows exactly what will happen, its expiry, and the result once run ("Sent — Undo" / "Couldn't send — Retry"). Runs exactly once.
- **Push notifications (opt-in, quiet hours respected):**
  - Morning briefing at wake-up opens the **Briefing** screen: 2–3 short screens in the Opal story style from the "Navi – Look" references, real data only, ending in "Start my day".
  - Evening wrap-up at 21:00 opens the **Daily review** (one block at a time).
  - Weekly review opens the weekly story.
  - Due soon / hard deadline / reminder open the task sheet.
  - Approval needed opens the card.
- **Notification actions:** low-risk internal ones can act from the notification (Done, Snooze, Start focus). **Consequential approvals always open the app** so the full card is read. No approving outside messages from the Lock Screen.
- **Permission priming:** ask only when the value is clear (onboarding "Can I check in with you?" — already approved — then the system prompt). If declined: a quiet line in Settings, never nagging.
- **Review inbox:** as in §7, plus filters (All / From you / Navi's guesses) and an honest empty state ("Nothing to review.").

---

## 10. Onboarding and secondary screens

**Onboarding** (approved OB-01…10, re-laid out for the phone):
- Sign in: add **Sign in with Apple** on iOS (see conflict 2). Google uses the system browser sheet. The email 6-digit code uses the iOS one-time-code autofill.
- Hello, The basics (wheel pickers for wake / bed instead of steppers), Stay in touch and First plan translate almost one-to-one.
- **Talk it through** is the real redesign. The conversation goes full screen (voice-first: big stone, "Hold to talk" or type). **"What Navi's picked up" becomes a tray at the bottom with a live count** ("7 picked up ▴") that expands to the grouped list with source quotes. Topic chips stay at the top.
- **Review:** grouped list, toggles, uncertain items unchecked, sticky "Turn on 14 and plan my week".
- New: **mic permission priming** before the first voice use. Notifications priming stays in Stay in touch.
- "Do this later" is on every step → Today shows "Finish setting up Navi".

**Secondary (under "You")** — plain native grouped lists, same row style as today's More page:
- Spaces & projects (each space: its tasks, goals, next step)
- Insights (weekly story → detail)
- Memory (inspect / correct / delete, with origin)
- Notes
- Activity (what Navi did, with Undo)
- Chats (all conversations)
- Settings: schedule, quiet hours, notifications with diagnostics, voice, Navi's colour, privacy/export/delete, sign out

None of these get a tab.

---

## 11. Key journeys, states and transitions

**Journeys to prototype end to end in Phase 2:**
1. **Morning:** wake-up push → Briefing → Today → start the first block.
2. **Walking brain dump:** hold stone → talk 30 s → "Picked up 4" → later, swipe through Inbox.
3. **Subway capture offline** → "2 waiting to send" → reconnect → drafts appear.
4. **"Can I fit the dentist call in today?"** on My day → half sheet → proposal → "Put it there" → the timeline updates *under the sheet* → Undo.
5. **Running late:** "I'm 40 min behind" → one plan card (moves behind a disclosure) + one Undo.
6. **Focus with a locked phone:** start → lock → Live Activity → unlock → "I'm done" → "2 waiting".
7. **Consequential action:** Navi proposes emailing someone → approval card + push → open → Approve → honest result.
8. **Evening wrap-up:** 21:00 push → mark 4 blocks in under a minute → "Plan tomorrow?".
9. **First run on a phone:** sign in → … → first plan → Today.
10. **Talk while working:** voice → minimise to the pill → switch to Tasks → Navi adds a step live → end.

**States every relevant screen gets drawn with:** loading (skeleton rows, never spinners on Today), empty and calm, offline (+ queued count), AI unavailable or budget reached, permission denied (mic / notifications), action pending / done / failed / undone / expired, sync conflict ("Changed on another device — keep which?"), unfinished setup, signed out.

**Transitions:**
- Today bar ⇄ stone (the companion → orb continuity).
- Stone → sheet (grows from the button).
- Row → task sheet.
- Continue card → focus takeover.
- Sheet → voice full → pill.
- Proposal accepted → the block slides into the timeline.

All have reduced-motion versions (a cross-fade). Haptics only on commits (done, placed, approved, focus start / end), never on scroll.

---

## 12. Same identity, different shape

| | Desktop | Mobile |
|---|---|---|
| Navigation | Left sidebar | Tab bar (4) + stone button + "You" |
| Navi | Right panel, collapses to a dock | Sheet (peek / half / full), stone button, talking pill |
| Home → workspace | Big companion → orb | Today bar → stone |
| Search / commands | ⌘K | Typing in the Navi sheet |
| Calendar | Week grid | Timeline, 3-day, week overview |
| Unscheduled | Side column | "Need a time" tray |
| Focus | Full page, dock | Takeover + Live Activity |
| Briefings | Text in the app | Push → story screens |
| Daily review | One form | One block at a time |
| Input | Keyboard, hover, drag | Thumb, swipe, long-press, voice-first |
| **Same** | Sentence rules, single suggestion, Undo lines, proposal and approval cards, stone, colours, type, Fixed / Flexible / Routine marks, privacy promises, no fake numbers | |

---

## 13. Proposed design and review order (Phase 2, after approval)

Each step is boards on the existing canvas next to the desktop boards (desktop boards untouched), at 390×844, with realistic data from the same "Alex" world as R4. You review, I revise, and we lock before moving on.

| Gate | Boards | Lock before |
|---|---|---|
| **M0 Foundations** (1 board) | Mobile type scale, spacing, touch sizes, tab bar, stone sizes / states, sheet heights, row styles — all derived from R4, no new palette | Everything |
| **M1 Structure** | Approach A, clickable: tabs, stone → sheet (3 heights), hold → voice → pill, Focus takeover, "You" sheet; Today ⇄ stone transition | Screens |
| **M2 Today + Navi** | Today (8 situations from §5), Navi sheet (text, proposal, Undo, approval, search/ask), voice (all states), capture + offline | M3 |
| **M3 Plan & do** | My day (timeline, tray, 3-day, week), Tasks (list, swipe, sheet, More details), Focus (+ Lock Screen / Dynamic Island) | M4 |
| **M4 Loop closers** | Inbox, approvals, push notifications as they appear on the Lock Screen, Briefing, Daily review, Weekly story | M5 |
| **M5 Onboarding** | OB-01…10 adapted + Sign in with Apple + mic priming | M6 |
| **M6 Secondary** | "You", Spaces/project, Insights, Memory, Notes, Activity, Chats, Settings | Journeys |
| **M7 Journeys** | The 10 journeys of §11 as click-through flows | Phase 3 |

Phase 3 (implementation plan, including the Capacitor-or-not decision) starts only after M7 is locked.

---

## 14. Questions for you

1. **Approach A** (tab bar + stone), or do you want to see B or C drawn before deciding?
2. **Inbox:** its own tab (recommended), or folded into Today + Tasks (3 tabs)?
3. **Stone gestures:** tap = sheet, hold = voice. Or should tap go straight to voice?
4. **Theme:** dark only like R4, or follow the system (light needs its own pass)?
5. **Platform:** design iOS first and adapt for Android afterwards (recommended), or draw both together?
6. **Native extras in 1.5 scope:** Live Activity for focus, capture widget, share sheet, Siri / Action button. Draw all, or only Live Activity + widget?
7. **Briefings as story screens:** OK, or keep them as a simple text page?
8. **Names on mobile:** keep "My day" and "Today" (both exist on desktop: Home is Today here)? Tab labels need to be very short.

---

## References (Mobbin; patterns only, not copying)

From the owner's collections:
- Tiimo today timeline + companion: https://mobbin.com/screens/2e5e28b9-c537-46b3-89fe-5d46c59fe6a3
- Structured AI proposal card (Add / Edit / Discard, Accept all): https://mobbin.com/screens/2e36f6e3-a873-400a-a2ee-2a32c508290a
- Structured timeline: https://mobbin.com/screens/26fae4e6-2163-4d93-8c47-5bd9839cb369
- Joi sentence home with day sheet: https://mobbin.com/screens/362e5a69-9886-49b8-be3e-a260377a8681
- WHOOP companion chat sheet: https://mobbin.com/screens/7d3e2d82-0382-481c-9b93-208d552479b8
- Pi listening: https://mobbin.com/screens/7f86354d-c06a-4c2f-8396-616c1ac2995c
- Mindtrip voice interview: https://mobbin.com/screens/50ce7f51-fcec-4a35-aae3-dc56af5d25d1
- Opal leave-early sheet (what not to do on tone): https://mobbin.com/screens/e187ab82-450c-4625-8592-e6df33f395a3
- Perplexity working steps: https://mobbin.com/screens/4ea08f69-9f99-40a6-bc83-f003dcd20d3c
- Opal home, floating tab bar: https://mobbin.com/screens/1b3deee1-a193-4e36-93b0-7e89740f9c5c
- Opal timer: https://mobbin.com/screens/b7a85dff-8e86-4211-9dec-73f5bf2ac492
- Opal weekly story: https://mobbin.com/screens/ea59c327-1787-47dc-b850-15708c5e337d
- Oura tab bar + separate assistant button: https://mobbin.com/screens/f528871c-4be6-4bcf-ae97-c06f921449b1

New searches:
- Things 3 Today (calendar strip above list, This Evening): https://mobbin.com/screens/feadd020-045b-477e-b54f-d4c405995a58
- Todoist quick add with chips: https://mobbin.com/screens/febc6f42-7a96-4a9f-b0ed-f8ab8fe4deaa
- Todoist dictate in quick add: https://mobbin.com/screens/f95eff3c-c607-4dc2-a1c3-1df20da8ce36
- Linear tab bar + search button: https://mobbin.com/screens/f688fc71-2060-49c2-be67-bc6ab5e53bee
- Amie calendar over lists (sheet with detents): https://mobbin.com/screens/f64a6c25-51d6-46de-b01d-3616c3aa11c3
- Amie week grid at phone width: https://mobbin.com/screens/69b1c69c-76f8-4543-b8f3-b2ce67c7e1ac
- Outlook 3-day: https://mobbin.com/screens/f31a7a00-c2da-40ab-aa35-1b92cd641ae5
- Saturn "Chat to create" bar above tabs: https://mobbin.com/screens/b710b067-25bf-4ff1-8aff-bbd93549816a
- Claude voice: https://mobbin.com/screens/1052f36b-9be7-458e-a041-ad086ef59602
- Google Live listening controls: https://mobbin.com/screens/b1ede01b-db3f-432e-8df6-2c659f1e96eb
- Perplexity voice orb: https://mobbin.com/screens/039b3f98-2f2c-4b34-842b-b71727b67f30
- Cursor Lock Screen Live Activity: https://mobbin.com/screens/f006d2ae-c165-4c39-b4a0-a9c901d02826
- WHOOP Live Activity: https://mobbin.com/screens/8e5c6a84-be67-48f2-89a1-4923f0a71f50
- Joi action sheet (Complete / Edit / Remove): https://mobbin.com/screens/c7624c7d-6687-423d-8fd8-221952f7d35d
- ChatGPT notification priming: https://mobbin.com/screens/0fb5a49b-e98f-4f8f-803d-6571324fc342
- Brilliant priming with "No thanks": https://mobbin.com/screens/c33921fd-b1a6-4f0e-8c59-70b4121a18c7
- Claude chat (what Navi should *not* look like at home): https://mobbin.com/screens/ed3e4d7f-e3e5-44e8-a0ad-649a958ce5fa

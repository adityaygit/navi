# Navi mobile, M6 "Sky": locked design (owner approved 2026-11-16)

M6 replaces M4 (dark, colour-of-the-moment) as the design the Capacitor app is built from. M4 behaviour that M6 doesn't mention (data, API calls, sentence rules from the R4 sources board, offline queue) still applies.

Source of truth: `docs/navi-1.5/design-canvas/M6-*.dc.html` (copies of the live canvas). The clickable prototype is `M6-Sky-Proto.dc.html`; onboarding is `M6-Onboarding.dc.html`. Every screen and state is laid out in `M6-S1…S6`. Haptics and holds are in `M6-Haptics.dc.html`, the opening in `M6-Opening.dc.html`.

Assets (`docs/navi-1.5/design-canvas/assets/`; the canvas refers to them by upload id):

| File | Canvas id | Use |
|---|---|---|
| `sky-day.jpg` | `/_blob/7a0c579c…` | Chat home, Sign in, stories, the orb (morning/afternoon) |
| `sky-dusk.jpg` | `/_blob/58ffe9a3…` | Same places in the evening and at night; Focus done |
| `sky-focus.jpg` | `/_blob/b7249258…` | Focus (above the clouds) |
| `logo-n.png` | `/_blob/44c459d0…` | Opening: the N |
| `logo-word.png` | `/_blob/f364765c…` | Opening: the wordmark |

Skies were generated with Nano Banana Pro (`gemini-3-pro-image`) for this design.

## Look

- **Light, normal app.** Page `#FBFBFD`, grouped lists `#F3F5F9`, cards white. Ink `#11141A`; secondary text `#2E3442` / `#3B4252`; never lighter than `#5B6272` for text.
- **Sky only where it means something:** behind the Navi home greeting (washed, fades to white by ~430 px), Sign in, the three stories, Focus. Plan, Progress, sheets, settings and voice are plain. Every sky has a colour fallback while it loads, one image per screen, and a **Sky backgrounds** switch in Settings.
- **Type:** Figtree. Headlines bold (700–800), tight tracking (−0.035em); italic for the one word that matters (`.em`). Nothing under 14 px; secondary lines 15 px weight 500.
- **Glass:** controls you touch (nav pill, round buttons, composer, chips, sheets) are white glass: `rgba(255,255,255,0.6)` + `backdrop-filter: blur(24px) saturate(180%)`, hairline border, soft shadow. Sheets are stronger glass (0.86).
- **Primary buttons** are black pills; secondary are glass pills. All targets ≥ 44 px.
- **Navi's orb** is flat: a disc of the sky turning slowly, soft white petals, a breathing white ring (after ChatGPT voice and the ElevenLabs orb). No 3D lighting. It appears only where Navi is: Talk button, Ask bar, voice, onboarding Hello. The Navi tab carries a 16 px orb.
- **Categories** are small flat dots: School `#EE7A5C`, Work `#4D86FF`, Friends `#E9A93A`, Health `#36B386`, Rest `#A3A8BF`.
- **Plan blocks:** fixed = white card + lock; flexible = pale blue `#EEF3FC`; hard deadline = coral "Due 5" tag; clashes side by side in amber with "These clash · sort it out". Each block has a second line (time/place/why).

## Structure

Three pages: Progress ← **Navi** → Plan (swipe or tap the glass pill). Header: ☰ (chats, account), pill, Inbox with count.

- **Navi home:** with nothing to talk about, a centred greeting ("Good morning, *Aditya.*"), one line, and two pills (now/next, today's story). The conversation takes over once you start. One open card at a time; extra suggestions fold to "1 more suggestion"; long chats fold earlier messages.
- **Plan:** day name (tap → day picker) + one summary sentence; Day · Week · List; "N need OK" pill; Ask bar at the bottom.
- **Progress:** one headline, kept/focused/slipping card (tap → "How these are counted"), where hours went, one question, weekly story.
- **Inbox:** three piles: **Needs OK · To add · Done**. Things picked up are marked "You said this" or "Navi's guess".
- **You** (from your name in the chats menu): Settings, Memory (Navi's guesses on top: That's right / That's wrong; edit and delete on every row), Notes, Activity, Spaces.

## Rules decided with the owner

1. Plan changes happen on their own with Undo. **Anything that leaves Navi** (texts, emails, cancellations, payments) always asks, with a "Leaves Navi" tag saying what it does. Moving a **hard deadline** also asks.
2. **Undo** appears only when something can really be undone. Irreversible actions say "Can't be undone" before you approve.
3. **Kept** = things you planned for yourself and did; fixed events don't count; moving with a day's notice isn't a miss. **Slipping** = moved 3+ times or close to missing its deadline.
4. **Focus breaks through** only for fixed events 10 minutes before and hard deadlines within the hour. Everything else is held and shown after.
5. **Quick setup** (≈1 min: basics, notifications, first plan) or **Talk it through** (≈5 min). "Welcome back" resumes where you stopped.
6. The **lock tip** ("Locked means fixed…") shows once, the first time Plan opens.

## Motion

- Easing in `cubic-bezier(0.2, 0.9, 0.25, 1)`, out `cubic-bezier(0.4, 0, 1, 1)`. Enter 0.3–0.45 s, exit 0.26 s.
- Every sheet leaves the way it came. Bottom sheets close by dragging down from the top bar (past ~110 px), the chats menu by dragging left, the day picker up, You screens by dragging right from the left edge; short pulls spring back.
- Page swipe: flat slide, rounded corners while pulled, soft white edge glow, the page underneath sharpens.
- **Opening (≈3.2 s):** white; the N fades in centred → slides left while "Navi" comes out from behind it → the lockup blurs out → the white dissolves as home rises 90 px into place.
- Focus steps cross-fade; 3·2·1 each pop; stories animate each card; done states fade; reduced motion turns it off.

## Haptics (see `M6-Haptics.dc.html`)

Moving around is silent; weight follows cost; you feel the line; hold when a slip costs.

| Feel | When |
|---|---|
| Tick | page or sheet passes the commit line · segmented controls, durations, days, switches · hold start and rising (⅓, ⅔) |
| Light | page lands · sent · Undo · countdown 3, 2, 1 · voice ends |
| Medium | a hold completes inside Navi · voice on |
| Heavy | focus begins · a held approval that leaves Navi |
| Success | task done · approved inside your plan · added from Inbox · focus marked done · guess confirmed |
| Warning | delete a memory · sign out · a fixed event breaks through focus |
| Double tick | tapped something that needs a hold ("Press and hold …" hint) |

Holds: Begin focus 1.0 s · finish focus early 0.8 s · send/cancel anything outside Navi 0.8 s · Talk 0.45 s · sign out 1.2 s. The button sinks to 0.97 and a lighter fill sweeps across; letting go early drains it silently. Keyboard: hold Enter/Space. Screen readers: a confirm step instead of a hold. One feel per action, ticks < 40 ms apart dropped, a Haptics switch in Settings.

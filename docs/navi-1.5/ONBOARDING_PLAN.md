# Navi 1.5 — Sign-in and onboarding plan

Status: **Plan approved with answers below. Storyboard (10 screens) shown in chat 2026-11-06; awaiting approval before full-size canvas boards.**

## What exists today (verified in code, 2026-11-06)

- `/login`: Continue with Google (behind `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`), email link (`signInWithOtp`, `shouldCreateUser: false` → invite-only via `allowed_emails`), optional password.
- `/onboarding`: one chat (text or voice) in a card inside the normal app shell → status `reviewing` → grouped proposal checklist → "Activate N items and plan my week" → Home. "Skip for now" sets `skipped`.
- `profiles.onboarding_status`: `not_started | in_progress | reviewing | completed | skipped`.
- Gate: **only Home (`/`) redirects** unfinished users to `/onboarding`. Any other URL (`/tasks`, `/planner`…) lets an unfinished user into the app. The layout doesn't gate.

## Structure

```
Open app
  └─ signed out ──► Sign in (Google / email) ──► email code or link ──┐
  └─ signed in ───────────────────────────────────────────────────────┤
                                                                      ▼
                                          onboarding_status?
                    not_started / in_progress / reviewing ──► /welcome (resume at saved step)
                    completed / skipped ─────────────────────► Home
```

- **One gate, in the `(app)` layout** (server), so every app URL checks it, not just Home. Allowed while unfinished: `/welcome`, `/settings`, `/auth/*`.
- **Resumable.** The conversation is already saved; add `preferences.onboarding_step` (jsonb, no migration) so closing the tab and coming back lands on the same step, on any device.
- **Onboarding is full-screen** (`/welcome`, outside the app shell): black, the Navi stone, no sidebar, small step dots at the top, "Do this later" in the corner.

## Steps

0. **Sign in.** Google, or email with a 6-digit code; a password is the optional second way. Not invited → "You're on the list" (existing early-access page).
1. **Hello.** The stone fades in. "Hi, I'm Navi." One line on what Navi does. Continue. (One idea per screen, like Opal and Claude.)
2. **The basics.** Three quick answers, no typing beyond your name: name (pre-filled from Google), timezone (detected, confirm), wake-up and bedtime (hour steppers). Wake/bed feeds the "free time" maths on My day (see sources board).
3. **Talk it through** (the heart, text or voice). Split screen: conversation on the left; on the right **"What Navi's picked up"** fills in live (spaces, fixed things, routines, goals, tasks), each with the words it came from. Navi steers through four topics, shown as chips that tick off: *Your week · Fixed things · What you're working toward · What's on your mind*. "That's enough for now →" is always available.
4. **Review.** The existing grouped review, restyled: Spaces · Fixed things & routines · Goals & projects · Tasks · Things Navi will remember. Uncertain guesses start unchecked; tap to edit. "Activate 14 and plan my week". Unchecked items go to the Inbox.
5. **Stay in touch** (optional). Turn on notifications for the 6:00 morning and 21:00 evening briefings, with quiet hours. A short "what Navi never does" privacy panel. Skip is fine.
6. **Your first plan.** Today's timeline with its Navi sentence (built from the data just activated), then "Go to Home".

**"Do this later"** at any step sets `skipped` and lands on Home, where the one insight slot says "Finish setting up Navi" until done (also in Settings). Finishing later resumes where you left.

## Edge cases

- AI unavailable (budget hit / provider down): step 3 says so plainly and lets you write it all down; that's saved as a capture and processed when AI is back. No forms wizard.
- Microphone blocked: text only, with a one-line hint.
- Second device / reinstall: status is on the account, so a finished user goes straight to Home.
- Signed in but deleted invite: sign-out with an explanation.

## References (Mobbin)

- Claude web onboarding: Google + email with code fallback; "Hello, I'm Claude" single-line intro. https://mobbin.com/flows/0b72f658-84df-4d18-88e3-4255d758194f
- Sana web: split sign-in; "Tell the assistant about yourself" with the assistant preview beside it. https://mobbin.com/flows/25b7b891-4e05-48de-8f71-5ef8fdc6b737
- Gorgias AI agent setup: steps on the left, a live sample conversation on the right that changes as you answer. https://mobbin.com/flows/9e4f738f-d37b-4cb6-8334-0d34084fbd7f
- Opal iOS: black, one question per screen, big type, hour stepper, "Opal does NOT see" privacy sheet. https://mobbin.com/flows/91394aa7-8b77-461f-b95a-ad3f177e98f3
- Emergent Wingman: setup happens inside the chat. https://mobbin.com/flows/aa3023b8-dd64-464b-844e-78d20fb7e4bc
- Rise web: "Getting started" you can revisit after skipping. https://mobbin.com/flows/919314a5-0e4a-4b3a-a422-19ce8dc75316
- Clockwise (what not to do): dropdown questionnaire, i.e. a forms wizard. https://mobbin.com/flows/30c2a14d-4f5a-4f2d-9a0d-f1be7dd52467

## Mockups to make after approval

Sign in · Email code · Hello · The basics · Talk it through (early and late) · Review · Stay in touch · First plan · Home with "Finish setting up".

## Owner answers (2026-11-06)

1. Invite-only sign-in for the alpha: **yes**.
2. Email: **two options — a 6-digit code (default) or a password (optional)**. No email link. (Supersedes "link and code" in step 0.)
3. Wake-up and bedtime: **their own quick step** (step 2).
4. Notifications: **during onboarding** (step 5).
5. Process: **show the screens first** (storyboard in chat), then put them on the design canvas, then code.

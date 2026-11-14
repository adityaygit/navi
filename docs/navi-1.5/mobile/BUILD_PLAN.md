# Navi 1.5 Mobile: build plan (Phase 3)

Status: designs approved by the owner on 2026-11-13 (M4 after the spacing pass). This is the plan for turning them into an app on the owner's phones. Nothing here is built yet.

## Decisions (owner, 2026-11-13)

- **Native app, not a PWA.** Capacitor app named **Navi**, for **iPhone and Android**. The installable PWA is retired as the mobile target; the web app stays for desktop.
- **Option B:** the M4 screens are rebuilt as real code and bundled inside the app. The app talks to the existing backend (www.meetnavi.app API, Supabase, AI providers) for data and AI. No "website in a frame".
- **No paid Apple Developer account.** iPhone installs use a free Apple ID (see Distribution).
- **Hold to talk:** voice mode starts by pressing and holding the Talk button, not a tap.

## Architecture

- New `mobile/` app in this repo: React + TypeScript, built to static files and packed into the Capacitor iOS and Android projects. Design tokens, type scale, spacing and motion come straight from the M4 canvas (`docs/navi-1.5/design-canvas/M4-*.dc.html`).
- Backend stays where it is. Server changes needed:
  - API routes accept a Supabase **bearer token** as well as the web cookie session.
  - CORS for the app origins (`capacitor://localhost`, `https://localhost`).
  - Sign-in by **emailed code** (no link-back needed); Google sign-in later.
- Native plugins: Haptics, Status Bar, Keyboard, Splash Screen, App (lifecycle and back button), Local Notifications, Push Notifications (Android, and iPhone only if a paid account is ever added), Preferences/Filesystem (offline capture queue), microphone permission for voice.

## Distribution without a paid account

- **Android:** the app file (APK) is built in the cloud and installed directly. No account or fee. Push notifications work (Firebase, free).
- **iPhone:** an iPhone app can only be compiled on macOS, but the owner does not need to own a Mac:
  1. GitHub Actions builds the iPhone app on a GitHub-hosted Mac. Mac minutes on private repos are counted at a higher rate against the free allowance, so builds are kept to when a version is ready.
  2. The owner installs it with a sideloading tool that signs it with their **free Apple ID** from a Windows, Linux or Mac computer (Sideloadly, AltStore/SideStore or similar; check current versions at the time). Use a secondary Apple ID if possible, since these tools log in with it.
  3. With a free Apple ID the app **expires after 7 days** and must be re-signed (AltStore/SideStore can refresh it automatically). This also limits Apple's capabilities: **no remote push notifications on iPhone**, and the free Apple ID is limited to a few sideloaded apps at once.
  4. Workaround for notifications on iPhone: the app schedules **local notifications** on the phone (morning and evening briefings, focus done, reminders). Messages that arrive from the server while the app is closed ("Sam replied") show up only when the app is opened, until a paid account is added.
- Haptics, the microphone, voice, the keyboard and offline capture all work with a free account.

## Haptics map

| Moment | Feel |
|---|---|
| Page swipe crosses the halfway point | light tick (selection) |
| Page settles on Progress / Navi / Plan | light impact |
| Day / Week / Tasks switch, day picker, toggles | selection tick |
| Hold Talk: hold starts | soft tick; rises while held |
| Hold Talk: voice mode on (~0.4 s) | medium impact, voice opens and stays open hands-free |
| Tap Talk without holding | tiny tick + "Hold to talk" hint |
| Send a message | light impact |
| Approve, Add, task ticked, block marked done | success |
| Undo | light impact |
| Focus countdown 3, 2, 1 / Start | light ×3, then heavy |
| Focus finished | success |
| End early, delete, overlap warning | warning |
| Pull-down sheet to dismiss past threshold | light impact |

One setting turns haptics off. Haptics follow the system setting where the platform has one.

## Build order (each step ends installable)

1. **Pipeline and shell.** `mobile/` app, Capacitor iOS + Android projects, app icon and splash, cloud builds (Android APK; iPhone app on GitHub's Mac runner), sign-in with emailed code, bearer auth + CORS on the server. First install on both phones.
2. **Chat (home).** Real conversation and AI, drawer with chats and account, composer riding the keyboard, receipts with Undo, proposals with approve buttons, hold-to-talk entry.
3. **Plan.** Day timeline to scale, Week, Tasks, Inbox with approvals and drafts, contextual Ask sheet, pull between pages with haptics.
4. **Focus and voice.** Focus setup → countdown → session → break/minimise → end early → done, local notification on finish; live two-way voice.
5. **Progress and stories.** Stones, patterns, where-hours, weekly story, morning briefing, evening wrap-up. Needs **new server work** (stone and pattern data, story generation), so this step is larger.
6. **Polish.** Offline capture queue, notifications, full haptics pass, Reduce Motion, device testing on both phones, fixes.

Outward messages (for example "Send Sam 1:00 PM?") always require the owner's OK, as in the designs.

## Open

- Which computer the owner will use to install on the iPhone (Windows, Mac or Linux), to pick the sideloading tool.
- Lock Screen / Dynamic Island focus timer and home-screen widgets need native extensions; planned after step 6, not promised in the first version.

## Execution (proposed 2026-11-13, awaiting "approved, start coding")

Checked in this environment: Android SDK, Google Maven, Gradle and npm are reachable and Java 21 is installed, so Android builds can be made and checked here and in CI. iPhone builds run only on GitHub's macOS runners (`.github/workflows/mobile.yml`), unsigned; the owner signs and installs them with a free Apple ID from Windows or Mac (Sideloadly).

What the server needs: the web app does most writes through 53 server actions, which a phone app can't call. Step 1 adds bearer-token auth to `requireApiCtx`, CORS for the app origins, and a small JSON API under `/api/m/*` that wraps the existing actions (no logic copied). Additive only.

Team:
- Lead (main session): `mobile/` foundation (Vite + React + TS, M4 tokens, three-page pull navigation, motion, haptics service, API client, offline queue), integration, review, screenshots against the M4 canvas, BUILD_INTELLIGENCE.
- Server agent (worktree): bearer auth, CORS, `/api/m/*` endpoints, emailed-code sign-in, tests against local Supabase.
- Native agent (worktree): Capacitor iOS/Android projects, plugins, icon and splash, `mobile.yml` producing an Android APK and an unsigned iPhone app; verifies the APK builds here.
- From step 3: one agent per screen area (Plan, Focus/voice, Progress/stories) working in parallel against the agreed API contract; at most three at a time.

Owner checkpoints (the only planned interruptions):
1. End of step 1: approve merging the server changes to main (production) and the Supabase email change (code in the sign-in email); install the first build on both phones.
2. Any hosted database migration (step 5 stones/patterns).
3. Device feedback after steps 2, 4 and 6 (haptics and feel can only be judged on the phone).

# Navi mobile: device pass (M6)

What can only be checked on a real iPhone and Android phone. Everything here has been checked in a browser at phone size; nothing here has been checked on a device yet. Tick each item, note the phone and OS, and file anything that fails.

**Before you start:** the phone app talks to the hosted server (`https://www.meetnavi.app`). Progress, the You screens and setup need this branch deployed there first; until then they say they need the newest server. Install the Android APK from the latest "Mobile app" CI run (artifact `Navi-android`); iOS needs Xcode on a Mac to sign the unsigned build (see `INSTALL.md`).

## Install and launch
- [ ] App icon is the black N on white (home screen, app switcher, Settings, notification).
- [ ] Android 12+: the launch screen shows the N on white, then the opening plays (N fades in → slides left as "Navi" appears → home rises). No black flash.
- [ ] iPhone: plain white launch, then the same opening.
- [ ] Status bar icons are dark on every screen; nothing sits under the notch or the home bar.

## Sign in and setup
- [ ] Emailed code: the six boxes fill from the keyboard, and from the code suggestion above the keyboard (iOS "From Messages/Mail", Android autofill).
- [ ] Password sign-in works; wrong password says so.
- [ ] A new account lands in setup. Quick setup and Talk it through both finish and show the first plan.
- [ ] Talk it through by voice: the microphone prompt appears once; the answer comes back spoken; the turn shows in the thread after voice closes.
- [ ] "Later" opens the app; Settings shows "Finish setting up Navi"; coming back mid-talk says "Welcome back".
- [ ] Notifications prompt appears on the check-ins step (Allow and Don't Allow both carry on).

## Haptics and holds (Settings → Vibration on)
- [ ] Page swipe: a tick when it passes halfway, a light bump when it lands. Moving around otherwise is silent.
- [ ] Talk: tick, rising ticks, medium bump at 0.45 s; a quick tap gives a double tick and "Press and hold to talk".
- [ ] Begin focus (1.0 s): fill sweeps, ticks at ⅓ and ⅔, heavy bump; 3·2·1 each a light tap.
- [ ] Finish focus early (0.8 s), send/cancel outside Navi (0.8 s, heavy), sign out (1.2 s, warning).
- [ ] Letting go early drains the fill silently. Turning Vibration off silences all of it.
- [ ] Sheets: a tick as a drag passes the close line; short pulls spring back.

## Gestures
- [ ] Inbox, block sheet, Ask sheet, focus rules, password and edit sheets close by dragging down from the top bar.
- [ ] Day picker closes by pushing it up; the chats menu by dragging it left; You screens by dragging right from the left edge.
- [ ] None of these fight vertical scrolling inside the sheet.

## Voice
- [ ] Hold the orb → voice opens and listens; speak → Navi answers through the speaker (not the earpiece).
- [ ] Talk over Navi: it stops and listens.
- [ ] Mute, Type instead, End all work; the transcript is in the chat afterwards.
- [ ] A phone call or Siri during voice: the mic pauses ("tap to resume") and comes back on a tap.
- [ ] Bluetooth headphones: input and output both switch to them.

## Focus
- [ ] Minimise during focus: the pill shows the time left; tapping it returns.
- [ ] Lock the phone during focus: the "Focus done" notification arrives at the end.
- [ ] A fixed event 10 minutes out breaks through with a warning buzz; nothing else does.

## Offline
- [ ] Airplane mode: Plan, Inbox and Progress still show what was last loaded, with "Offline · as of …".
- [ ] Type a message offline: "Saved on your phone…", chip "Offline · 1 waiting to send".
- [ ] Back online (or reopen the app): it's sent, and appears in Inbox as something to add.
- [ ] Voice offline says it needs a connection.

## Accessibility
- [ ] VoiceOver / TalkBack: every button says what it does; holds work as a single activation (confirm step).
- [ ] Reduce Motion on: no slides, pops or drifting skies; everything still works.
- [ ] Larger Text: known gap, text doesn't follow the phone's text size yet (pinch zoom is off, as usual for an app). Note how it looks at the largest size.
- [ ] Sky backgrounds off (Settings): plain backgrounds everywhere, nothing unreadable.

## Notes
- Phones tested:
- Failures (screen, what happened, steps):

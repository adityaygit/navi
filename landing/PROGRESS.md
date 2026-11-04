# Landing Page Reconstruction — Progress Record

Separate from the Navi app. Self-contained static site in `landing/`, published as a Claude artifact.

## Decisions (established with user — do not re-ask)
- Layout, geometry, type scale, colors, effects, motion, responsive behavior: match the reference page (fey.com) as closely as possible.
- Branding/copy: **Navi** brand with original copy written to matching lengths/line breaks. No Fey name, logo, verbatim marketing copy, or product screenshots/artwork; those are replaced with original substitutes in the same roles.
- Fonts: use the reference font only if openly licensed; otherwise closest open font, metrics-tuned.
- Images: Gemini `gemini-3-pro-image` (Nano Banana Pro). Key lives only in `landing/.env.local` (gitignored), used only from local scripts.
- Preview: Claude artifact (static HTML + files, CDN libs only from allowed hosts).
- Comparison viewports: 1440, 1280, 1024, 768, 390.
- Branch: `claude/landing-reconstruction`.

## Milestones
1. [x] Refero research
2. [x] Reference inspection (desktop, from recording)
3. [ ] Initial page structure
4. [ ] Assets generated and integrated
5. [ ] First visual comparison
6. [ ] Refinement passes
7. [ ] Final testing and verification

## Research findings
- Refero tokens captured (colors #0b0b0b/#191919/#131313, text #fff/#868f97, accents #ffa16c/#479ffa/#4ebe96, gradients Ember/Frost/Volt, radii 16/10/6/99/275, shadow rgba(0,0,0,.8) 0 0 44px, display 48–54px at -0.08em, max-width 1200, section gap 64). Font: Calibre (Klim, commercial; substitute needed).
- ~~BLOCKER~~ (resolved): the live page no longer exists. fey.com (all paths) now serves a one-screen "Fey joined Wealthsimple" notice. web.archive.org returns 429 / connection resets from this container.
- Available fragments: Refero Highlights thumbnail; Mobbin has 2 Fey marketing sections (desktop-download hero with nav; "Get started" CTA + footer) plus many app-UI screens. Mobbin has no capture of the home landing page.
- **Resolved via Refero's scroll recording** (21 s, 1600×1000, full desktop page). Frames + stitched page in session scratchpad only. Layout notes: `research/reference-notes.md`.
- Remaining reference gaps: mobile/tablet layouts, hover states, footer detail.

## Log
- 2026-11-04: Branch created, Gemini key verified (model list returned image models).
- 2026-11-04: Refero research done. Reference site gone; blocked on reference captures.
- 2026-11-04: Found Refero recording; tracked scroll stops; stitched page; wrote section notes.

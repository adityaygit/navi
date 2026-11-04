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
1. [ ] Refero research
2. [ ] Reference site inspection
3. [ ] Initial page structure
4. [ ] Assets generated and integrated
5. [ ] First visual comparison
6. [ ] Refinement passes
7. [ ] Final testing and verification

## Log
- 2026-11-04: Branch created, Gemini key verified (model list returned image models).

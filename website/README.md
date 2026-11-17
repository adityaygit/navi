# Navi marketing website ("Sky")

What www.meetnavi.app shows to signed-out visitors at `/` and at the marketing paths
(`src/proxy.ts` rewrites them to `public/landing/index.html`). The owner's rule: **the live site is
verbatim the reviewed Claude artifact.** One build makes both.

```
website/parts/*.html   page source, concatenated in order (head + styles, chrome, pages, script)
website/assets/a, s    images and app screens
website/fonts          Figtree (OFL-1.1, self-hosted: the CSP allows same-origin fonts only)
website/build.py       builds public/landing/ (deployed) and website/dist/navi-website.html (artifact page)
website/checks/        browser checks against the built files (no server needed)
```

## Change the site

1. Edit `website/parts/*.html` (or assets).
2. `python3 website/build.py`
3. Check: `node website/checks/sweep-selftest.mjs`, then
   `node website/checks/layout-sweep.mjs 320x568,390x844,768x1024,1440x900 /tmp/sweep.jsonl` (empty output file = clean;
   the full matrix used for launch is in BUILD_INTELLIGENCE.md), `node website/checks/waitlist-flow.mjs`, `node website/checks/panel-seams.mjs` (rounded panel corners match what's beside them), and
   `scripts/local-only.sh npx vitest run tests/unit/landing-proxy.test.ts`.
4. Update the artifact preview by publishing `website/dist/navi-website.html` with the files under `public/landing/`
   at the same paths (`landing/...`), so preview and live stay identical.

## Rules the build enforces

- One script, written to `landing/site.js` (the production CSP blocks inline scripts).
- No third-party requests; every asset path is relative (`landing/...`), so it resolves from `/` and from `/about`.
- Only images the page uses are copied.

Sign-up uses the app's existing waitlist (`POST /api/waitlist {email, website}`); nothing about it lives here.

// Capture the page the same way the reference recording was stitched:
// scroll to each stop, set animation state, screenshot the viewport, paste at the stop's y.
// Usage: node tests/visual/capture-stops.mjs <url> <outdir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const stops = [[0, {}], [1028, {}], [1960, { dock: 0 }], [2980, { slide: 0 }], [3168, { slide: 2, ring: 2 }], [4052, {}], [5092, {}], [6416, {}], [7108, {}]];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(url + (url.includes('?') ? '&' : '?') + 'capture', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important;transition:none!important;animation:none!important} .rot-slide{transition:none!important}' });
for (const [y, state] of stops) {
  await p.evaluate(([y, state]) => { window.scrollTo(0, y); for (const [k, v] of Object.entries(state)) window.__navi[k]?.(v); }, [y, state]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${outDir}/stop${y}.png` });
}
console.log(JSON.stringify({ errors, height: await p.evaluate(() => document.documentElement.scrollHeight) }));
await b.close();

// Full-page capture of the built page at a given viewport, with reveal animations settled.
// Usage: node tests/visual/capture.mjs <url> <out.png> [width] [height]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, w = '1600', h = '1000'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important;transition:none!important}' });
await page.waitForTimeout(600);
const height = await page.evaluate(() => document.documentElement.scrollHeight);
await page.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ out, height, errors }));
await browser.close();

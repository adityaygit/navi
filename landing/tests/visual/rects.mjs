// Print page-coordinate boxes of key elements (desktop tuning aid).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, w = '1600', h = '1000'] = process.argv.slice(2);
const sel = ['.nav-pill', '.device', '.hero-kicker', '.hero h1', '.hl-label', '.hl-text', '.hl-arrows', '.hl-card', '.hl-cap', '.dock-sec h2', '.sculpture', '.dock-bar', '.dock-search', '.annot h3', '.rot-link', '.rot-slide.on h2', '.rot-slide.on .lede', '.portrait', '.notif', '.mon-sec h2', '.mon-sec .lede', '.mon-bezel', '.mon-stand', '.band', '.cmd h2', '.cmd .lede', '.key-wide', '.wk-card', '.weekly-copy h2', '.soon', '.review h2', '.review .lede', '.panel', '.chart-card', '.stat-card', '.cta-note', '.cta h2', '.cta .lede', '.btn-ghost', '.footer'];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto(url, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important;transition:none!important}' });
const r = await p.evaluate((sel) => sel.map((s) => { const e = document.querySelector(s); if (!e) return [s, null]; const b = e.getBoundingClientRect(); return [s, [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]]; }), sel);
for (const [s, v] of r) console.log(s.padEnd(22), JSON.stringify(v));
console.log('docHeight', await p.evaluate(() => document.documentElement.scrollHeight));
await b.close();

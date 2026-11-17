// Rounded panels: what shows through outside each rounded corner must match the section right beside the
// panel (above or below it). Otherwise the corner shows a stepped seam (e.g. white gutter vs a blue section).
// usage: node website/checks/panel-seams.mjs
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';

const ORIGIN = 'http://navi.test';
const PAGES = ['home', 'product', 'plan', 'voice', 'focus', 'trust', 'about', 'early-access', 'faq', 'contact', 'privacy', 'terms'];
const SIZES = [[1440, 900], [1024, 768], [390, 844], [320, 568]];

const b = await chromium.launch();
let seams = 0;
for (const [W, H] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, reducedMotion: 'reduce' });
  await serve(ctx, ORIGIN);
  const p = await ctx.newPage();
  await p.goto(ORIGIN + '/#home'); await p.waitForTimeout(800);
  for (const pg of PAGES) {
    await p.evaluate((h) => { location.hash = h; }, '#' + pg); await p.waitForTimeout(500);
    const panels = await p.evaluate(() => [...document.querySelectorAll('.page.on .panel, footer.ftr')].filter((e) => e.offsetParent).map((e) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { sel: e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, rt: parseFloat(cs.borderTopLeftRadius), rb: parseFloat(cs.borderBottomLeftRadius) };
    }));
    for (const pn of panels) for (const edge of ['top', 'bottom']) {
      const rad = edge === 'top' ? pn.rt : pn.rb;
      const y = edge === 'top' ? pn.top : pn.bottom;
      if (rad < 8 || pn.left < 2 || (edge === 'top' && y < 12)) continue;
      await p.evaluate((yy) => scrollTo(0, Math.max(0, yy - 300)), y); await p.waitForTimeout(200);
      const vy = y - await p.evaluate(() => scrollY);
      const png = (await p.screenshot({ clip: { x: 0, y: Math.max(0, vy - 12), width: Math.min(W, 60), height: 24 } })).toString('base64');
      const s = await p.evaluate(async ([d, left, e]) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const at = (a, bb) => [...x.getImageData(Math.round(a), bb, 1, 1).data].slice(0, 3);
        return e === 'top' ? { cut: at(left + 1, 13), beyond: at(left + 1, 8) } : { cut: at(left + 1, 10), beyond: at(left + 1, 15) };
      }, [png, pn.left, edge]);
      const d = Math.max(...s.cut.map((v, k) => Math.abs(v - s.beyond[k])));
      if (d > 6) { seams++; console.log(`SEAM ${W}x${H} ${pg} ${pn.sel} ${edge} corners: behind the corner ${s.cut} vs next to the panel ${s.beyond}`); }
    }
  }
  await ctx.close();
}
await b.close();
console.log(seams ? `${seams} seams` : 'no seams');
process.exitCode = seams ? 1 : 0;

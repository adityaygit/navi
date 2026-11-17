// Layout sweep: every page x many viewport sizes. Flags clipped text, off-screen content,
// overlapping text/controls, text covered by other elements while scrolling, oversize sticky
// blocks, stray scrollbars, and menu/accordion/tab/form states that don't fit.
// usage: node website/checks/layout-sweep.js 390x844,1440x900 out.jsonl   (PAGES=home,faq to limit pages)
// Run website/checks/sweep-selftest.js first to see each check catch a planted defect.
const { chromium } = require('playwright');
const fs = require('fs');
const SIZES = (process.argv[2] || '').split(',').filter(Boolean).map(s => s.split('x').map(Number));
const OUT = process.argv[3];
const PAGES = process.env.PAGES ? process.env.PAGES.split(',') : ['home', 'product', 'plan', 'voice', 'focus', 'trust', 'about', 'early-access', 'faq', 'contact', 'privacy', 'terms', 'nope'];
const { serve } = require('./serve');
const ORIGIN = 'http://navi.test', BASE = ORIGIN + '/';
const NOANIM = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;scroll-behavior:auto!important}';

function audit(o) {
  const vw = document.documentElement.clientWidth, vh = innerHeight, out = [];
  const CS = new Map(); const cs = e => { let s = CS.get(e); if (!s) { s = getComputedStyle(e); CS.set(e, s); } return s; };
  const sel = el => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 4 && e !== document.body; e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) { p.unshift(s + '#' + e.id); break; } const c = [...e.classList].filter(c => !['on', 'show', 'pre', 'rise', 'in', 'glass'].includes(c)).slice(0, 2); if (c.length) s += '.' + c.join('.'); p.unshift(s); } return p.join('>'); };
  const shown = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = cs(e); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false; } return true; };
  const fixedOf = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (cs(e).position === 'fixed') return e; return null; };
  const inPhone = el => !!el.closest('.phone,.orb');
  const push = (type, el, extra) => out.push({ type, sel: sel(el), ...extra });
  const scopes = o.scopes.map(s => document.querySelector(s)).filter(e => e && shown(e));
  const lines = [];
  for (const sc of scopes) {
    const tw = document.createTreeWalker(sc, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim() ? 1 : 2 });
    let n; while ((n = tw.nextNode())) {
      const el = n.parentElement; if (!shown(el) || el.closest('.sr-only,.visually-hidden,.vh,script,style')) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) lines.push({ el, n, r: q, txt: n.nodeValue.trim().slice(0, 36) });
    }
  }
  const shrink = (r, x, y) => ({ left: r.left + x, right: r.right - x, top: r.top + y, bottom: r.bottom - y });
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const px = (v, w) => v.endsWith('%') ? parseFloat(v) / 100 * w : parseFloat(v) || 0;

  if (o.static) {
    // clipped / off-screen text
    for (const L of lines) {
      const t = shrink(L.r, 1.5, L.r.height * 0.2);
      let scroller = null, clip = null;
      for (let a = L.el; a && a !== document.body; a = a.parentElement) {
        const s = cs(a), ox = s.overflowX, oy = s.overflowY;
        if (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') { scroller = a; break; }
        if (ox === 'visible' && oy === 'visible') continue;
        const b = a.getBoundingClientRect(), bl = b.left + a.clientLeft, bt = b.top + a.clientTop, br = bl + a.clientWidth, bb = bt + a.clientHeight;
        if (a.clientHeight < 2 || a.clientWidth < 2) { clip = 'collapsed'; break; }
        if ((ox !== 'visible' && (t.left < bl - 1 || t.right > br + 1)) || (oy !== 'visible' && (t.top < bt - 1 || t.bottom > bb + 1))) { clip = a; break; }
        // rounded corners of a clipping box
        const W = b.width, H = b.height, R = { tl: px(s.borderTopLeftRadius, W), tr: px(s.borderTopRightRadius, W), bl: px(s.borderBottomLeftRadius, W), br: px(s.borderBottomRightRadius, W) };
        const pts = [[t.left, t.top, 'tl'], [t.right, t.top, 'tr'], [t.left, t.bottom, 'bl'], [t.right, t.bottom, 'br']];
        for (const [x, y, k] of pts) {
          const r = Math.min(R[k], W / 2, H / 2); if (r < 4) continue;
          const cx = k[1] === 'l' ? b.left + r : b.right - r, cy = k[0] === 't' ? b.top + r : b.bottom - r;
          const inCorner = (k[1] === 'l' ? x < cx : x > cx) && (k[0] === 't' ? y < cy : y > cy);
          if (inCorner && Math.hypot(x - cx, y - cy) > r + 1) { clip = a; break; }
        }
        if (clip) break;
      }
      if (clip === 'collapsed') continue;
      if (clip && !inPhone(L.el)) push('text-clipped', L.el, { txt: L.txt, by: sel(clip) });
      else if (!scroller && !clip && (t.left < -1 || t.right > vw + 1)) push('text-offscreen', L.el, { txt: L.txt, x: Math.round(L.r.left) + '..' + Math.round(L.r.right), vw });
    }
    // overlapping text (different text nodes)
    const collapsed = el => { for (let a = el; a && a !== document.body; a = a.parentElement) { const s = cs(a); if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && (a.clientHeight < 2 || a.clientWidth < 2)) return true; } return false; };
    const ls = lines.filter(L => !inPhone(L.el) && !collapsed(L.el)).sort((a, b) => a.r.top - b.r.top);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length && ls[j].r.top < ls[i].r.bottom; j++) {
      const A = ls[i], B = ls[j]; if (A.n === B.n) continue;
      const fa = fixedOf(A.el), fb = fixedOf(B.el); if ((!!fa !== !!fb) && !o.atTop) continue;
      if (inter(shrink(A.r, 2, A.r.height * 0.22), shrink(B.r, 2, B.r.height * 0.22)) > 6) push('text-overlap', A.el, { txt: A.txt, with: sel(B.el), txt2: B.txt });
    }
    // overlapping controls
    const ctr = []; for (const sc of scopes) sc.querySelectorAll('a[href],button,input,textarea,select,[role=tab],label').forEach(e => { if (shown(e) && !inPhone(e) && !collapsed(e) && !e.closest('.vh')) { const r = e.getBoundingClientRect(); if (r.width > 2 && r.height > 2) ctr.push({ e, r }); } });
    for (let i = 0; i < ctr.length; i++) for (let j = i + 1; j < ctr.length; j++) {
      const A = ctr[i], B = ctr[j]; if (A.e.contains(B.e) || B.e.contains(A.e)) continue;
      if (A.e.tagName === 'LABEL' && (A.e.contains(B.e) || A.e.control === B.e)) continue; if (B.e.tagName === 'LABEL' && B.e.control === A.e) continue;
      if ((!!fixedOf(A.e) !== !!fixedOf(B.e)) && !o.atTop) continue;
      if (inter(shrink(A.r, 1, 1), shrink(B.r, 1, 1)) > 4) push('control-overlap', A.e, { with: sel(B.e) });
    }
    for (const sc of scopes) sc.querySelectorAll('a[href],button,input,textarea,select,[tabindex]').forEach(e => {
      if (e.tabIndex < 0 || e.disabled || !shown(e) || e.closest('.vh,[inert]')) return;
      const r = e.getBoundingClientRect();
      if (collapsed(e) || r.width < 1 || r.height < 1) push('focusable-but-hidden', e, { txt: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30) });
    });
    // form fields and buttons squashed below a usable height
    for (const sc of scopes) sc.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not(.hp), select, textarea, .btn').forEach(e => {
      if (!shown(e) || e.closest('.vh') || collapsed(e)) return; const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height < 40) push('control-too-short', e, { h: Math.round(r.height) });
    });
    // boxes running past the viewport edge without a clipping container
    for (const sc of scopes) for (const e of sc.querySelectorAll('*')) {
      const r = e.getBoundingClientRect(); if (r.width < 1 || (r.right <= vw + 1 && r.left >= -1)) continue;
      if (!shown(e)) continue; let ok = false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const s = cs(a); if (s.overflowX !== 'visible') { const b = a.getBoundingClientRect(); if (b.left >= -1 && b.right <= vw + 1) ok = true; break; } }
      if (!ok) { const p = e.parentElement, pr = p && p.getBoundingClientRect(); if (p && pr && (pr.right > vw + 1 || pr.left < -1) && shown(p) && p !== document.body && sc.contains(p)) continue; push('box-offscreen', e, { x: Math.round(r.left) + '..' + Math.round(r.right), vw }); }
    }
    // sticky blocks taller than the viewport, unexpected scrollbars
    for (const sc of scopes) for (const e of sc.querySelectorAll('*')) {
      const s = cs(e); if (s.display === 'none') continue;
      if (s.position === 'sticky' && shown(e)) { const h = e.getBoundingClientRect().height; if (h > vh - parseFloat(s.top || 0) + 2) push('sticky-too-tall', e, { h: Math.round(h), vh }); }
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 2 && shown(e) && !e.matches(o.vscrollOk)) push('unexpected-vscroll', e, { sh: e.scrollHeight, ch: e.clientHeight });
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 2 && shown(e) && !e.matches(o.hscrollOk)) push('unexpected-hscroll', e, { sw: e.scrollWidth, cw: e.clientWidth });
    }
  }
  if (o.occlusion) {
    const hdr = document.querySelector('#hdr').getBoundingClientRect().bottom;
    const mb = document.querySelector('#mbar'); const mTop = mb && mb.classList.contains('show') && shown(mb) ? mb.getBoundingClientRect().top : vh;
    const pe = document.createElement('style'); pe.textContent = '*{pointer-events:auto!important}'; document.head.appendChild(pe);
    for (const L of lines) {
      if (inPhone(L.el) || fixedOf(L.el)) continue;
      const r = L.r; const sc = L.el.closest('.m-snap,.m-row,.bento,.mcap-chips'); if (sc) { const b = sc.getBoundingClientRect(); if (r.left < b.left || r.right > b.right) continue; }
      if (r.top < (scrollY > 0 ? hdr + 2 : 0) || r.bottom > mTop - 2 || r.left < 0 || r.right > vw) continue;
      for (const fx of [0.25, 0.5, 0.75]) {
        const x = r.left + r.width * fx, y = r.top + r.height / 2; let bad = null;
        for (const h of document.elementsFromPoint(x, y)) {
          if (h === L.el || L.el.contains(h) || h.contains(L.el)) break;
          if (!shown(h)) continue; if (fixedOf(h)) break;
          const s = cs(h); if (h.tagName.toLowerCase() === 'svg' && s.backgroundImage === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) continue; const paints = /^(IMG|svg|VIDEO|CANVAS|PICTURE|INPUT|TEXTAREA)$/i.test(h.tagName) || h.closest('svg') || s.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) || s.backdropFilter !== 'none';
          if (!paints) continue; bad = h; break;
        }
        if (bad) { push('text-covered', L.el, { txt: L.txt, by: sel(bad), y: Math.round(scrollY) }); break; }
      }
    }
    pe.remove();
  }
  return out;
}

module.exports = { audit };
if (require.main === module) (async () => {
  const b = await chromium.launch();
  const issues = [];
  const add = (size, page, state, list) => list.forEach(i => issues.push({ size, page, state, ...i }));
  for (const [W, H] of SIZES) {
    const size = W + 'x' + H;
    const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: W < 900, isMobile: W < 700 });
    await serve(ctx, ORIGIN);
    const p = await ctx.newPage(); p.setDefaultTimeout(5000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '#home'); await p.waitForTimeout(700);
    const opts = (x) => ({ scopes: ['.page.on', 'footer.ftr', '#hdr'], static: true, occlusion: false, atTop: true, vscrollOk: '#drawer,#drawer *,textarea,.acc-panel', hscrollOk: '.m-snap,.m-row,.mcap-chips,.tablist,.bento,.starts,.chips,.legal-toc,.t-chips,.fchips,.faq-chips', ...x });
    for (const pg of PAGES) { try {
      process.stderr.write(size + ' ' + pg + '\n');
      await p.evaluate(h => { location.hash = '#' + h; }, pg); await p.waitForTimeout(650);
      await p.evaluate(css => { window.scrollTo(0, 0); const s = document.createElement('style'); s.id = 'noanim'; s.textContent = css; if (!document.getElementById('noanim')) document.head.appendChild(s); document.querySelectorAll('.pre,.pre-k').forEach(e => e.classList.remove('pre', 'pre-k')); }, NOANIM);
      await p.waitForTimeout(120);
      add(size, pg, 'top', await p.evaluate(audit, opts()));
      // scroll the page and check nothing covers text along the way
      const total = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < total; y += Math.round(H * 0.7)) {
        await p.evaluate(y => window.scrollTo(0, y), y); await p.waitForTimeout(70);
        await p.evaluate(() => document.querySelectorAll('.pre,.pre-k').forEach(e => e.classList.remove('pre', 'pre-k')));
        add(size, pg, 'scroll', await p.evaluate(audit, opts({ static: false, occlusion: true, atTop: false })));
      }
      // swipe through every carousel so off-screen cards get the same checks
      const nCar = await p.evaluate(() => [...document.querySelectorAll('.page.on .m-snap, .page.on .m-row, .page.on .bento, .page.on .mcap-chips')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 2).length);
      for (let c = 0; c < nCar; c++) {
        const nKids = await p.evaluate(c => { const e = [...document.querySelectorAll('.page.on .m-snap, .page.on .m-row, .page.on .bento, .page.on .mcap-chips')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 2)[c]; e.scrollIntoView({ block: 'center' }); return e.children.length; }, c);
        for (let k = 0; k < nKids; k++) {
          await p.evaluate(([c, k]) => { const e = [...document.querySelectorAll('.page.on .m-snap, .page.on .m-row, .page.on .bento, .page.on .mcap-chips')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 2)[c]; e.scrollLeft = e.children[k].offsetLeft - 20; }, [c, k]);
          await p.waitForTimeout(50);
          add(size, pg, 'carousel', await p.evaluate(audit, opts({ static: false, occlusion: true, atTop: false })));
        }
      }
      await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(60);
      // states
      if (pg === 'faq') { await p.evaluate(() => document.querySelectorAll('.acc-item button[aria-expanded=false]').forEach(b => b.click())); await p.waitForTimeout(250); add(size, pg, 'faq-all-open', await p.evaluate(audit, opts({ atTop: false }))); }
      if (pg === 'plan') for (const t of await p.$$('#plan-tabs [role=tab]')) { await t.click(); await p.waitForTimeout(150); add(size, pg, 'plan-tab', await p.evaluate(audit, opts({ atTop: false }))); }
      if (pg === 'product' && await p.isVisible('.mcap-chips')) for (const t of await p.$$('.mcap-chips [role=tab]')) { await t.click(); await p.waitForTimeout(120); add(size, pg, 'mcap-tab', await p.evaluate(audit, opts({ atTop: false }))); }
      if (pg === 'early-access' || pg === 'contact') { await p.evaluate(() => { const f = document.querySelector('.page.on form'); const s = f && f.querySelector('[type=submit],button:not([type=button])'); if (s) s.click(); }); await p.waitForTimeout(200); add(size, pg, 'form-errors', await p.evaluate(audit, opts({ atTop: false }))); }
    } catch (e) { issues.push({ size, page: pg, state: '-', type: 'sweep-error', sel: '-', txt: String(e.message).slice(0, 160) }); } }
    // menus
    try {
    await p.evaluate(h => { location.hash = '#home'; }, ''); await p.waitForTimeout(600);
    if (await p.isVisible('#burger')) {
      await p.click('#burger'); await p.waitForTimeout(400);
      add(size, 'menu', 'drawer-open', await p.evaluate(audit, opts({ scopes: ['#drawer'], atTop: false })));
      const dsub = await p.$('#dprod'); if (dsub && await dsub.isVisible()) { await dsub.click(); await p.waitForTimeout(300); add(size, 'menu', 'drawer-product-open', await p.evaluate(audit, opts({ scopes: ['#drawer'], atTop: false }))); }
      const reach = await p.evaluate(() => { const d = document.querySelector('#drawer'); const last = [...d.querySelectorAll('a,button')].filter(e => e.offsetParent).pop(); if (!last) return 'none'; last.scrollIntoView({ block: 'nearest' }); const r = last.getBoundingClientRect(); return r.bottom <= innerHeight + 1 ? 'ok' : 'last item unreachable ' + Math.round(r.bottom) + '>' + innerHeight; });
      if (reach !== 'ok') issues.push({ size, page: 'menu', state: 'drawer-open', type: 'drawer-unreachable', sel: '#drawer', txt: reach });
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    } else if (await p.isVisible('#dd-btn')) {
      await p.click('#dd-btn'); await p.waitForTimeout(350);
      add(size, 'menu', 'dropdown-open', await p.evaluate(audit, opts({ scopes: ['#dd-panel'], atTop: false })));
      const r = await p.evaluate(() => { const b = document.querySelector('#dd-panel').getBoundingClientRect(); return [b.left, b.right, b.bottom, innerWidth, innerHeight]; });
      if (r[0] < 0 || r[1] > r[3] || r[2] > r[4]) issues.push({ size, page: 'menu', state: 'dropdown-open', type: 'dropdown-offscreen', sel: '#dd-panel', txt: r.map(Math.round).join(',') });
      await p.keyboard.press('Escape');
    }
    } catch (e) { issues.push({ size, page: 'menu', state: '-', type: 'sweep-error', sel: '-', txt: String(e.message).slice(0, 160) }); }
    errs.forEach(m => issues.push({ size, page: '-', state: '-', type: 'page-error', sel: '-', txt: m }));
    await ctx.close();
    process.stdout.write(size + ' ');
  }
  fs.writeFileSync(OUT, issues.map(i => JSON.stringify(i)).join('\n'));
  await b.close(); console.log('\ndone', issues.length);
})();

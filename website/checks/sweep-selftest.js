// Plants one of each defect into the live page and checks the audit reports it.
const { chromium } = require('playwright');
const { audit } = require('./layout-sweep');
const { serve } = require('./serve');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); await serve(ctx, 'http://navi.test'); const p = await ctx.newPage();
  await p.goto('http://navi.test/#about'); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelectorAll('.pre').forEach(e => e.classList.remove('pre'));
    const pg = document.querySelector('.page.on'); const d = document.createElement('div'); d.style.cssText = 'margin-top:200px';
    d.innerHTML = `<div style="width:120px;height:40px;overflow:hidden;border-radius:30px;background:#eee"><p id="t1">This sentence is far too long for its little box</p></div>
      <p id="t2" style="white-space:nowrap">Runs off the right edge of the screen and keeps going on and on</p><div id="t2b" style="width:600px;height:20px;background:#ddd"></div>
      <div style="position:relative;height:60px"><span id="t3a" style="position:absolute;top:0">Overlap one</span><span id="t3b" style="position:absolute;top:4px;left:10px">Overlap two</span></div>
      <div style="display:grid;grid-template-rows:0fr;overflow:hidden"><div style="min-height:0"><a id="t4" href="#x">Invisible link</a></div></div>
      <div style="position:relative;height:60px"><p id="t5">Covered text here</p><div style="position:absolute;inset:0;background:#f00"></div></div>
      <div style="display:flex;flex-direction:column;height:60px"><input id="t7" style="flex:1;height:52px" placeholder="email"><button>B</button></div><button id="t6a" style="width:200px">A</button><button id="t6b" style="margin-top:-20px;margin-left:50px;width:200px;display:block">B</button>`;
    pg.prepend(d); d.scrollIntoView(); });
  await p.waitForTimeout(200);
  const opt = { scopes: ['.page.on'], vscrollOk: 'textarea', hscrollOk: '.none' };
  const st = await p.evaluate(audit, { ...opt, static: true, occlusion: false, atTop: false });
  const oc = await p.evaluate(audit, { ...opt, static: false, occlusion: true, atTop: false });
  const all = [...st, ...oc]; const has = (type, re) => all.some(i => i.type === type && re.test(i.sel + ' ' + (i.with || '')));
  const exp = [['text-clipped', /t1|div/], ['text-offscreen', /t2/], ["box-offscreen", /t2b/], ['text-overlap', /t3/], ['focusable-but-hidden', /t4/], ['text-covered', /t5/], ['control-overlap', /t6/], ['control-too-short', /t7/]];
  let missed = 0; for (const [t, re] of exp) { const c = has(t, re); if (!c) missed++; console.log(c ? 'CAUGHT ' : 'MISSED ', t); }
  process.exitCode = missed ? 1 : 0;
  await b.close();
})();

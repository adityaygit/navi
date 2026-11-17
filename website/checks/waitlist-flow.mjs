// Waitlist flow on the built website: POST /api/waitlist {email, website} (the contract of src/app/api/waitlist/route.ts),
// each server answer's message, and the preview behaviour off the real domain. The API is mocked; nothing is sent.
// usage: node website/checks/waitlist-flow.mjs
import { chromium } from '@playwright/test';
import { serve } from './serve.mjs';
const ok = (c, m) => { if (!c) process.exitCode = 1; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const b = await chromium.launch();
  for (const [origin, live] of [['https://www.meetnavi.app', true], ['https://preview.example', false]]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    await serve(ctx, origin);
    const p = await ctx.newPage();
    let mode = 200, bodies = [];
    await p.route('**/api/waitlist', async (r) => {
      bodies.push(r.request().postDataJSON());
      if (!live) return r.fulfill({ status: 404, body: 'Not found' });
      if (mode === 'net') return r.abort('failed');
      await new Promise(res => setTimeout(res, 150));
      r.fulfill({ status: mode, contentType: 'application/json', body: JSON.stringify(mode === 200 ? { ok: true } : mode === 400 ? { error: 'Enter a valid email address.' } : { error: 'x' }) });
    });
    await p.goto(origin + '/#early-access'); await p.waitForTimeout(900);
    const tag = live ? '[live] ' : '[preview] ';
    ok(await p.isVisible('.ea-signin') === live, tag + 'Already invited? Sign in shown only on the live domain');
    if (live) ok(await p.getAttribute('.ea-signin a', 'href') === '/login', tag + 'Sign in goes to /login');
    const f = '#ea-form';
    // browser validation blocks empty / malformed email before any request (as in the live form)
    await p.click(f + ' button[type=submit]'); await p.waitForTimeout(150);
    ok(bodies.length === 0, tag + 'empty email is blocked by the browser, nothing sent');
    await p.fill(f + ' input[name=email]', 'not-an-email'); await p.click(f + ' button[type=submit]'); await p.waitForTimeout(150);
    ok(bodies.length === 0, tag + 'malformed email is blocked by the browser, nothing sent');
    if (live) {
      for (const [m, expect] of [[500, 'Something went wrong on our side. Try again in a minute.'], ['net', 'Something went wrong on our side. Try again in a minute.'], [400, 'That email address doesn’t look right.']]) {
        mode = m; await p.fill(f + ' input[name=email]', 'maya@example.com'); await p.click(f + ' button[type=submit]'); await p.waitForTimeout(400);
        ok((await p.textContent(f + ' .wl-note')) === expect, tag + `response ${m} -> "${expect}"`);
        ok(!(await p.isDisabled(f + ' button[type=submit]')), tag + `can retry after ${m}`);
      }
      mode = 200; bodies = [];
      await p.fill(f + ' input[name=email]', 'maya@example.com');
      const click = p.click(f + ' button[type=submit]');
      await p.waitForTimeout(60);
      ok((await p.textContent(f + ' button[type=submit]')) === 'Sending…' && await p.isDisabled(f + ' button[type=submit]'), tag + 'button shows Sending… and is disabled while waiting');
      await click; await p.waitForTimeout(400);
      ok((await p.textContent(f + ' .wl-note')) === 'Check your inbox for a short application.', tag + 'success message matches the live site');
      ok((await p.textContent(f + ' button[type=submit]')) === 'Sent' && await p.isDisabled(f + ' input[name=email]'), tag + 'button says Sent, email locked');
      ok(JSON.stringify(bodies[0]) === JSON.stringify({ email: 'maya@example.com', website: '' }), tag + 'request body is exactly {email, website}: ' + JSON.stringify(bodies[0]));
      // honeypot: a bot filling the hidden field still posts it (the server drops it)
      await p.goto(origin + '/#home'); await p.waitForTimeout(700); bodies = [];
      await p.evaluate(() => { document.querySelector('#q-email').closest('form').website.value = 'spam.example'; });
      await p.fill('#q-email', 'bot@example.com'); await p.click('form:has(#q-email) button[type=submit]'); await p.waitForTimeout(400);
      ok(bodies[0] && bodies[0].website === 'spam.example', tag + 'home form posts the honeypot field too');
      ok((await p.textContent('form:has(#q-email) .wl-note')) === 'Check your inbox for a short application.', tag + 'home form shows the same success message');
    } else {
      await p.fill(f + ' input[name=email]', 'maya@example.com'); await p.click(f + ' button[type=submit]'); await p.waitForTimeout(400);
      ok((await p.textContent(f + ' .wl-note')) === 'Couldn’t reach Navi from this preview. Sign-up works on the live site.', tag + 'preview says sign-up works on the live site');
    }
    // contact page addresses
    await p.goto(origin + '/#contact'); await p.waitForTimeout(700);
    const mails = await p.$$eval('.page.on a[href^="mailto:"]', as => as.map(a => a.getAttribute('href')));
    ok(mails.includes('mailto:support@mail.meetnavi.app') && mails.includes('mailto:business@meetnavi.app'), tag + 'contact shows both addresses: ' + mails.join(', '));
    ok(!(await p.$('#c-form')), tag + 'unconnected message form removed');
  }
  await b.close();
})();

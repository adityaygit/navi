// Checks on the production bundle in dist/ (run `npm run build` first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
const textFiles = () => files(dist).filter((f) => /\.(html|js|css)$/.test(f));

test('bundle exists with relative asset paths', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  assert.match(html, /<title>Navi Life OS<\/title>/);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (m[1].startsWith('https://fonts.')) continue;
    assert.ok(m[1].startsWith('./'), `non-relative asset path: ${m[1]}`);
    assert.ok(existsSync(join(dist, m[1])), `missing asset: ${m[1]}`);
  }
});

test('every referenced image ships in the bundle', () => {
  const js = textFiles().map((f) => readFileSync(f, 'utf8')).join('\n');
  const imgs = new Set([...js.matchAll(/["'`]([\w-]+\.(?:jpg|png|webp))["'`]/g)].map((m) => m[1]));
  assert.ok(imgs.size >= 4);
  for (const i of imgs) assert.ok(existsSync(join(dist, 'img', i)), `missing image ${i}`);
});

test('no secrets or API endpoints leak into the bundle', () => {
  const env = existsSync(new URL('../.env.local', import.meta.url)) ? readFileSync(new URL('../.env.local', import.meta.url), 'utf8') : '';
  const key = /GEMINI_API_KEY=(.+)/.exec(env)?.[1]?.trim();
  for (const f of textFiles()) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/GEMINI_API_KEY|generativelanguage\.googleapis/.test(s), `secret marker in ${f}`);
    if (key) assert.ok(!s.includes(key), `API key found in ${f}`);
  }
});

test('no reference-brand names in shipped content', () => {
  for (const f of textFiles()) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/\bFey\b|Wealthsimple/.test(s), `reference brand name in ${f}`);
  }
});

// Generate original raster assets with Gemini (Nano Banana Pro).
// Usage: node scripts/gen-image.mjs <name> <aspect> <count> "<prompt>"
// Reads GEMINI_API_KEY from landing/.env.local. Never logs the key.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(join(root, '.env.local'), 'utf8');
const key = /GEMINI_API_KEY=(.+)/.exec(env)?.[1]?.trim();
if (!key) throw new Error('GEMINI_API_KEY missing from .env.local');

const [name, aspect = '16:9', count = '1', prompt] = process.argv.slice(2);
if (!name || !prompt) throw new Error('usage: gen-image.mjs <name> <aspect> <count> "<prompt>"');
const MODEL = 'gemini-3-pro-image';
const outDir = join(root, 'assets-src');
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call() {
  // Retry transient overload (503/429) with exponential backoff.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: '2K' } },
      }),
    });
    if ((res.status === 503 || res.status === 429) && attempt < 5) { await sleep(8000 * 2 ** attempt); continue; }
    return { res, json: await res.json() };
  }
}

const start = Number(process.env.START || 1);
for (let i = start; i < start + Number(count); i++) {
  const { res, json } = await call();
  if (!res.ok) { console.error(name, i, 'HTTP', res.status, json?.error?.message?.slice(0, 200)); continue; }
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) { console.error(name, i, 'no image part', JSON.stringify(json).slice(0, 200)); continue; }
  const ext = part.inlineData.mimeType.includes('png') ? 'png' : 'jpg';
  const file = join(outDir, `${name}-${i}.${ext}`);
  writeFileSync(file, Buffer.from(part.inlineData.data, 'base64'));
  appendFileSync(join(outDir, 'generation-log.txt'), `${new Date().toISOString()} ${MODEL} ${name}-${i}.${ext} aspect=${aspect}\n`);
  console.log('saved', file);
}

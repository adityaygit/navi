// Serves the built website (public/landing) to a Playwright browser context, the way the app does:
// "/" and the marketing paths get public/landing/index.html, /landing/* gets the files.
// No server needed; /api/waitlist is left to the test (mock it with context.route).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'landing');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const PAGES = ['/', '/about', '/terms', '/privacy-and-control', '/features', '/how-it-works', '/guides'];
async function serve(ctx, origin) {
  await ctx.route(origin + '/**', (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    if (p.startsWith('/api/')) return r.fallback();
    const f = PAGES.includes(p) ? path.join(DIR, 'index.html') : p.startsWith('/landing/') ? path.join(DIR, p.slice(9)) : null;
    if (!f || !f.startsWith(DIR) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: 'not found' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
  });
}
export { serve };

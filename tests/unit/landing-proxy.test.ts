import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

// The marketing website (public/landing, built by website/build.py) is shown at "/" to signed-out
// visitors and at the old marketing paths. It loads its files by relative path, so it must only
// ever be shown at a top-level path.

async function run(p: string, ua = "Mozilla/5.0") {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(p, "https://www.meetnavi.app"), { headers: { "user-agent": ua } }));
}
const rewrittenTo = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("marketing website routing", () => {
  it("shows the website at / and the top-level marketing paths, with the CSP", async () => {
    for (const p of ["/", "/about", "/terms", "/privacy-and-control", "/features", "/how-it-works", "/guides"]) {
      const res = await run(p);
      expect(rewrittenTo(res), p).toBe("https://www.meetnavi.app/landing/index.html");
      expect(res.headers.get("content-security-policy"), p).toMatch(/script-src 'self'/);
    }
  });

  it("sends nested marketing links to their section, so relative files still resolve", async () => {
    for (const [from, to] of [["/guides/review-inbox", "/guides"], ["/features/voice", "/features"], ["/about/team/x", "/about"]]) {
      const res = await run(from);
      expect(res.status, from).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname, from).toBe(to);
    }
  });

  it("serves the website's own files untouched, the page file included (the rewrite comes back through the proxy)", async () => {
    for (const p of ["/landing/index.html", "/landing/site.js", "/landing/fonts/figtree-latin-wght-normal.woff2"]) {
      const res = await run(p);
      expect(res.headers.get("location"), p).toBeNull();
      expect(rewrittenTo(res), p).toBeNull();
    }
  });

  it("still opens the desktop app on sign-in, never the website", async () => {
    const res = await run("/", "Mozilla/5.0 NaviDesktop/1.0");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("the deployed website build", () => {
  const dir = path.join(process.cwd(), "public", "landing");
  const page = fs.readFileSync(path.join(dir, "index.html"), "utf8");

  it("has no inline script (the CSP would block it) and no third-party files", () => {
    expect(page).not.toMatch(/<script>/);
    expect(page).toMatch(/<script src="landing\/site.js"><\/script>/);
    expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("has every file it refers to", () => {
    const refs = new Set([...page.matchAll(/(?:src|srcset|href)="(landing\/[^"]+)"|url\((landing\/[^)]+)\)/g)].map((m) => m[1] ?? m[2]));
    const js = fs.readFileSync(path.join(dir, "site.js"), "utf8");
    for (const k of new Set([...page.matchAll(/data-s="([^"]+)"/g)].flatMap((m) => m[1].split(",")))) refs.add(`landing/s/${k}.webp`);
    expect(js).toMatch(/'<img src="landing\/s\/'/);
    expect(refs.size).toBeGreaterThan(20);
    for (const r of refs) expect(fs.existsSync(path.join(dir, r.replace(/^landing\//, ""))), r).toBe(true);
  });

  it("signs people up through the existing waitlist API", () => {
    const js = fs.readFileSync(path.join(dir, "site.js"), "utf8");
    expect(js).toMatch(/fetch\("\/api\/waitlist", \{ method: "POST"/);
    expect(js).toMatch(/JSON\.stringify\(\{ email: f\.email\.value, website: f\.website\.value \}\)/);
    expect(page).toMatch(/name="website" tabindex="-1"/);
  });
});

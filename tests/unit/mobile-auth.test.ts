import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { bearerToken, corsHeaders, hasBearer, isAllowedOrigin, isCorsPath, MOBILE_ORIGINS } from "@/server/cors";

// The phone app's way in: CORS for its origins only, and a bearer token that
// the proxy lets through to the route (which verifies it) instead of
// redirecting or answering 401 for a missing cookie.

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

describe("CORS helpers", () => {
  it("allows exactly the app's origins, never a wildcard", () => {
    expect(MOBILE_ORIGINS).toEqual(["capacitor://localhost", "https://localhost", "http://localhost", "http://localhost:5173"]);
    for (const o of MOBILE_ORIGINS) expect(isAllowedOrigin(o)).toBe(true);
    for (const o of ["https://evil.example", "https://localhost.evil.example", "http://localhost:3000", "capacitor://evil", "null", "", null, undefined]) {
      expect(isAllowedOrigin(o)).toBe(false);
    }
  });

  it("applies to /api/m, chat, capture and voice only", () => {
    for (const p of ["/api/m/me", "/api/m/chats/abc/messages", "/api/chat", "/api/capture", "/api/voice/session", "/api/voice/turn"]) expect(isCorsPath(p)).toBe(true);
    for (const p of ["/api/account", "/api/export", "/api/push/subscribe", "/api/cron/tick", "/api/chatty", "/planner", "/api/mobile"]) expect(isCorsPath(p)).toBe(false);
  });

  it("echoes an allowed origin, with methods and headers on a preflight; no credentials", () => {
    expect(corsHeaders("capacitor://localhost")).toEqual({ "Access-Control-Allow-Origin": "capacitor://localhost", Vary: "Origin" });
    const pre = corsHeaders("https://localhost", true);
    expect(pre["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(pre["Access-Control-Allow-Headers"]).toMatch(/Authorization/);
    expect(pre["Access-Control-Allow-Headers"]).toMatch(/Content-Type/);
    expect(pre["Access-Control-Allow-Methods"]).toBe("GET, POST, PATCH, DELETE, OPTIONS");
    expect(pre).not.toHaveProperty("Access-Control-Allow-Credentials");
    expect(corsHeaders("https://evil.example", true)).toEqual({ Vary: "Origin" });
  });
});

describe("bearer tokens", () => {
  it("reads a JWT-shaped bearer token and nothing else", () => {
    expect(bearerToken(`Bearer ${JWT}`)).toBe(JWT);
    expect(bearerToken(`bearer   ${JWT}  `)).toBe(JWT);
    for (const h of [null, undefined, "", JWT, `Basic ${JWT}`, "Bearer ", "Bearer abc", "Bearer a.b", `Bearer ${JWT} extra`, "Bearer sb_publishable_abc", `Bearer ${JWT}.x`]) {
      expect(bearerToken(h)).toBeNull();
    }
  });

  it("counts any Bearer header as an attempt (so a junk token is signed out, not a cookie fallback)", () => {
    expect(hasBearer("Bearer junk")).toBe(true);
    expect(hasBearer(`Bearer ${JWT}`)).toBe(true);
    expect(hasBearer("Basic x")).toBe(false);
    expect(hasBearer(null)).toBe(false);
  });
});

describe("proxy and the phone app", () => {
  async function run(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(new URL(path, "https://www.meetnavi.app"), init));
  }

  it("answers a preflight from the app with 204 and CORS headers, before any auth", async () => {
    const res = await run("/api/m/tasks", { method: "OPTIONS", headers: { origin: "capacitor://localhost", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("gives a preflight from another site no CORS permission", async () => {
    const res = await run("/api/m/tasks", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("passes a bearer request through to the route (no redirect, no 401 for the missing cookie)", async () => {
    const res = await run("/api/m/me", { headers: { origin: "https://localhost", authorization: `Bearer ${JWT}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("still answers 401 JSON (readable by the app) when there's neither a cookie nor a token", async () => {
    const res = await run("/api/m/me", { headers: { origin: "capacitor://localhost" } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in" });
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });

  it("leaves the web unchanged: pages still redirect to /login and other APIs get no CORS headers", async () => {
    const page = await run("/planner", { headers: { authorization: `Bearer ${JWT}` } });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    const other = await run("/api/export", { headers: { origin: "capacitor://localhost", authorization: `Bearer ${JWT}` } });
    expect(other.status).toBe(401);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

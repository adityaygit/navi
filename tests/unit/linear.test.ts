import { beforeAll, describe, expect, it } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { authorizeUrl, checkState, codeChallenge, exchangeCode, InvalidGrantError, newOAuthState, refreshTokens, sealState } from "@/server/linear/oauth";
import { dueAtFor, linearValues, mapPriority, mapProjectStatus, mapStatus, taskPatch } from "@/server/linear/mapping";
import { freshTimestamp, verifyLinearSignature } from "@/server/linear/webhook";
import { LinearAuthError, LinearRateLimitError, linearGraphql, type LinearIssue } from "@/server/linear/api";
import { linearMissingConfig, linearRedirectUri } from "@/server/linear/config";

beforeAll(() => {
  process.env.NAVI_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

const cfg = { clientId: "client123", clientSecret: "shh-secret", redirectUri: "https://www.example.app/api/integrations/linear/callback" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("token encryption", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptSecret("lin_oauth_abc", "linear:access:1");
    expect(sealed).not.toContain("lin_oauth_abc");
    expect(decryptSecret(sealed, "linear:access:1")).toBe("lin_oauth_abc");
    expect(encryptSecret("x", "c")).not.toBe(encryptSecret("x", "c")); // random IV
  });
  it("refuses another context (a token copied to another row) and tampering", () => {
    const sealed = encryptSecret("tok", "linear:access:1");
    expect(() => decryptSecret(sealed, "linear:access:2")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    expect(() => decryptSecret(parts.join("."), "linear:access:1")).toThrow();
  });
  it("refuses a different key", () => {
    const sealed = encryptSecret("tok", "c");
    const old = process.env.NAVI_TOKEN_ENCRYPTION_KEY;
    process.env.NAVI_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    expect(() => decryptSecret(sealed, "c")).toThrow();
    process.env.NAVI_TOKEN_ENCRYPTION_KEY = old;
  });
});

describe("config", () => {
  it("names exactly what's missing and defaults the callback to the site", () => {
    const saved = { id: process.env.LINEAR_CLIENT_ID, secret: process.env.LINEAR_CLIENT_SECRET, redirect: process.env.LINEAR_REDIRECT_URL };
    delete process.env.LINEAR_CLIENT_ID;
    delete process.env.LINEAR_CLIENT_SECRET;
    delete process.env.LINEAR_REDIRECT_URL;
    expect(linearMissingConfig()).toEqual(["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"]);
    expect(linearRedirectUri()).toMatch(/\/api\/integrations\/linear\/callback$/);
    process.env.LINEAR_REDIRECT_URL = "https://example.app/api/integrations/linear/callback";
    expect(linearRedirectUri()).toBe("https://example.app/api/integrations/linear/callback");
    Object.assign(process.env, { LINEAR_CLIENT_ID: saved.id ?? "", LINEAR_CLIENT_SECRET: saved.secret ?? "", LINEAR_REDIRECT_URL: saved.redirect ?? "" });
  });
});

describe("OAuth state and PKCE", () => {
  it("builds Linear's authorize URL with read scope, state and S256 challenge, and no secret", () => {
    const s = newOAuthState("user-1");
    const url = new URL(authorizeUrl(cfg, s));
    expect(url.origin + url.pathname).toBe("https://linear.app/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "client123", redirect_uri: cfg.redirectUri, response_type: "code", scope: "read", state: s.state, code_challenge_method: "S256", prompt: "consent" });
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(s.verifier).digest("base64url"));
    expect(url.toString()).not.toContain("shh-secret");
    expect(url.toString()).not.toContain(s.verifier);
  });
  it("accepts only the matching state, for the same user, within 10 minutes", () => {
    const now = Date.now();
    const s = newOAuthState("user-1", now);
    const sealed = sealState(s);
    expect(sealed).not.toContain(s.verifier);
    expect(checkState(sealed, s.state, "user-1", now + 1000)).toEqual({ ok: true, verifier: s.verifier });
    expect(checkState(sealed, "forged", "user-1", now)).toEqual({ ok: false, reason: "mismatch" });
    expect(checkState(sealed, s.state, "user-2", now)).toEqual({ ok: false, reason: "other_user" });
    expect(checkState(sealed, s.state, "user-1", now + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
    expect(checkState(undefined, s.state, "user-1", now)).toEqual({ ok: false, reason: "missing" });
    expect(checkState(sealed, null, "user-1", now)).toEqual({ ok: false, reason: "missing" });
    expect(checkState(sealed.slice(0, -4) + "AAAA", s.state, "user-1", now)).toEqual({ ok: false, reason: "invalid" });
  });
  it("challenge is the base64url SHA-256 of the verifier", () => {
    expect(codeChallenge("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  });
});

describe("token endpoint", () => {
  it("exchanges a code server-side with secret + verifier and reads the token set", async () => {
    let sent: URLSearchParams | null = null;
    const f = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.linear.app/oauth/token");
      sent = new URLSearchParams(String(init.body));
      return json(200, { access_token: "AT", token_type: "Bearer", expires_in: 86399, scope: "read", refresh_token: "RT" });
    }) as unknown as typeof fetch;
    const t = await exchangeCode(cfg, "the-code", "the-verifier", f);
    expect(Object.fromEntries(sent!)).toEqual({ grant_type: "authorization_code", code: "the-code", redirect_uri: cfg.redirectUri, client_id: "client123", client_secret: "shh-secret", code_verifier: "the-verifier" });
    expect(t.accessToken).toBe("AT");
    expect(t.refreshToken).toBe("RT");
    expect(t.scopes).toEqual(["read"]);
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
  });
  it("classifies a revoked/expired refresh token as invalid_grant, without echoing the body", async () => {
    const f = (async () => json(400, { error: "invalid_grant", error_description: "token RT-123 revoked" })) as unknown as typeof fetch;
    const err = await refreshTokens(cfg, "RT-123", f).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidGrantError);
    expect(String(err.message)).not.toContain("RT-123");
  });
  it("other failures are ordinary errors (retry later)", async () => {
    const f = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const err = await refreshTokens(cfg, "RT", f).catch((e) => e);
    expect(err).not.toBeInstanceOf(InvalidGrantError);
    expect(err.message).toContain("502");
  });
});

describe("GraphQL errors", () => {
  it("401 / AUTHENTICATION_ERROR → auth error; RATELIMITED → rate limit", async () => {
    await expect(linearGraphql("t", "{viewer{id}}", {}, (async () => json(401, {})) as unknown as typeof fetch)).rejects.toBeInstanceOf(LinearAuthError);
    await expect(linearGraphql("t", "{viewer{id}}", {}, (async () => json(400, { errors: [{ message: "x", extensions: { code: "AUTHENTICATION_ERROR" } }] })) as unknown as typeof fetch)).rejects.toBeInstanceOf(LinearAuthError);
    await expect(linearGraphql("t", "{viewer{id}}", {}, (async () => json(400, { errors: [{ message: "slow", extensions: { code: "RATELIMITED" } }] })) as unknown as typeof fetch)).rejects.toBeInstanceOf(LinearRateLimitError);
  });
});

const issue = (over: Partial<LinearIssue> = {}): LinearIssue => ({
  id: "iss-1",
  identifier: "ENG-1",
  title: "Fix login",
  url: "https://linear.app/acme/issue/ENG-1",
  priority: 2,
  priorityLabel: "High",
  dueDate: "2026-11-20",
  estimate: 3,
  updatedAt: "2026-11-11T10:00:00.000Z",
  archivedAt: null,
  completedAt: null,
  canceledAt: null,
  trashed: false,
  description: "desc",
  assignee: { id: "me" },
  state: { id: "s", name: "In Progress", type: "started" },
  team: { id: "t", key: "ENG", name: "Engineering" },
  cycle: null,
  project: null,
  ...over,
});

describe("mapping", () => {
  it("maps workflow state types to Navi statuses", () => {
    expect(["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate", "weird"].map(mapStatus)).toEqual(["todo", "todo", "todo", "in_progress", "done", "cancelled", "cancelled", "todo"]);
  });
  it("maps priorities without parking Low work under Someday", () => {
    expect([0, 1, 2, 3, 4].map(mapPriority)).toEqual([3, 1, 2, 3, 3]);
  });
  it("a due date is due at 23:59 that day in the person's zone", () => {
    expect(dueAtFor("2026-11-20", "America/New_York")).toBe("2026-11-21T04:59:00.000Z");
    expect(dueAtFor(null, "UTC")).toBeNull();
    expect(dueAtFor("nonsense", "UTC")).toBeNull();
  });
  it("maps project statuses", () => {
    expect(["completed", "canceled", "paused", "started", "planned", undefined].map(mapProjectStatus)).toEqual(["done", "archived", "paused", "active", "active", "active"]);
  });
  it("Linear-owned fields always follow Linear; status only when Linear's status moved", () => {
    const prev = linearValues(issue(), "UTC", null);
    const task = { ...prev, status: "done" as const }; // the person finished it in Navi
    // Nothing changed in Linear: the local "done" stays.
    expect(taskPatch(task, prev, prev)).toEqual({});
    // Linear renamed it and changed priority: those follow Linear; status still untouched.
    const renamed = linearValues(issue({ title: "Fix login (SSO)", priority: 1 }), "UTC", null);
    expect(taskPatch(task, prev, renamed)).toEqual({ title: "Fix login (SSO)", priority: 1 });
    // Linear moved the status: Linear wins.
    const reopened = linearValues(issue({ state: { id: "s2", name: "Todo", type: "unstarted" } }), "UTC", null);
    expect(taskPatch(task, prev, reopened)).toEqual({ status: "todo" });
    // No snapshot yet (re-attached after reconnect): apply everything that differs.
    expect(taskPatch({ ...prev, status: "todo", due_at: null }, null, prev)).toEqual({ status: "in_progress", due_at: prev.due_at });
  });
});

describe("webhook verification", () => {
  it("checks the hex HMAC-SHA256 of the raw body, and the timestamp window", () => {
    const body = JSON.stringify({ type: "Issue", action: "update", organizationId: "org" });
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifyLinearSignature(body, sig, "whsec")).toBe(true);
    expect(verifyLinearSignature(body + " ", sig, "whsec")).toBe(false);
    expect(verifyLinearSignature(body, sig, "other")).toBe(false);
    expect(verifyLinearSignature(body, null, "whsec")).toBe(false);
    expect(verifyLinearSignature(body, "zz", "whsec")).toBe(false);
    const now = Date.now();
    expect(freshTimestamp(now - 30_000, now)).toBe(true);
    expect(freshTimestamp(now - 61_000, now)).toBe(false);
    expect(freshTimestamp("x", now)).toBe(false);
  });
});

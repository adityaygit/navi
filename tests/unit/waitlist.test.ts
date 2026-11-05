import { describe, expect, it } from "vitest";
import { applicationSchema, applyUrl, canDecide, canResend, emailSchema, hashIp, hashToken, isExpired, newToken, tokenExpiry, TOKEN_TTL_DAYS } from "@/server/waitlist";
import { applyEmail, approvedEmail, declinedEmail } from "@/server/email/templates";

describe("waitlist helpers", () => {
  it("normalises and validates email", () => {
    expect(emailSchema.parse("  Maya@Example.COM ")).toBe("maya@example.com");
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });
  it("stores only a hash of the token, and tokens are unguessable", () => {
    const a = newToken(), b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
  it("expires links after the TTL", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    const exp = tokenExpiry(now);
    expect(new Date(exp).getTime() - now.getTime()).toBe(TOKEN_TTL_DAYS * 86_400_000);
    expect(isExpired(exp, now)).toBe(false);
    expect(isExpired(exp, new Date(new Date(exp).getTime() + 1))).toBe(true);
    expect(isExpired(null, now)).toBe(true);
  });
  it("rate-limits re-sends with a cooldown", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(canResend(null, now)).toBe(true);
    expect(canResend("2026-11-05T11:55:00Z", now)).toBe(false);
    expect(canResend("2026-11-05T11:49:00Z", now)).toBe(true);
  });
  it("only allows decisions on applications (and re-approving a decline)", () => {
    expect(canDecide("applied", "approve")).toBe(true);
    expect(canDecide("applied", "decline")).toBe(true);
    expect(canDecide("declined", "approve")).toBe(true);
    expect(canDecide("requested", "approve")).toBe(false);
    expect(canDecide("approved", "decline")).toBe(false);
  });
  it("hashes IPs instead of storing them", () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp("203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.7")).not.toContain("203");
  });
  it("validates application answers", () => {
    const ok = { token: "x".repeat(43), name: "Maya", reason: "I keep dropping things.", use_case: "Planning my week around work.", timezone: "Europe/London" };
    expect(applicationSchema.parse(ok).referral).toBe("");
    expect(() => applicationSchema.parse({ ...ok, reason: "short" })).toThrow();
    expect(() => applicationSchema.parse({ ...ok, name: "" })).toThrow();
  });
  it("builds the application link on the site", () => {
    expect(applyUrl("abc_-1", "https://navi.example.com/")).toBe("https://navi.example.com/early-access/apply?token=abc_-1");
  });
});

describe("waitlist emails", () => {
  it("each email has a subject, HTML and plain text with the link", () => {
    const a = applyEmail("https://navi.example.com/early-access/apply?token=T");
    expect(a.subject).toBe("Tell us a little about you");
    expect(a.html).toContain("https://navi.example.com/early-access/apply?token=T");
    expect(a.text).toContain("https://navi.example.com/early-access/apply?token=T");
    const b = approvedEmail("https://navi.example.com/auth/confirm?token_hash=H", "https://navi.example.com");
    expect(b.html).toContain("Sign in to Navi");
    expect(b.text).toContain("navi.example.com with this email address");
    expect(declinedEmail().html).not.toContain("<a href");
  });
  it("escapes values placed into HTML", () => {
    const a = applyEmail('https://x.test/?a="><script>');
    expect(a.html).not.toContain("<script>");
  });
  it("keeps the black canvas on the table so clients don't drop it", () => {
    expect(applyEmail("https://x.test").html).toContain('bgcolor="#000000"');
  });
});

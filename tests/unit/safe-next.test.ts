import { describe, expect, it } from "vitest";
import { loginErrorMessage, safeNext } from "@/lib/safe-next";

const ORIGIN = "https://navi.example";

describe("safeNext (where to go after signing in)", () => {
  it.each([
    ["//evil.com", "/"],
    ["//evil.com/tasks", "/"],
    ["/\\evil.com", "/"],
    ["/\t/evil.com", "/"],
    ["/\n/evil.com", "/"],
    ["https://evil.com", "/"],
    ["https://navi.example.evil.com/", "/"],
    ["javascript:alert(1)", "/"],
    ["", "/"],
    [null, "/"],
    [undefined, "/"],
    ["tasks", "/"],
  ])("rejects %j", (next, expected) => {
    expect(safeNext(next as string | null | undefined, ORIGIN)).toBe(expected);
  });

  it.each([
    ["/", "/"],
    ["/tasks?x=1", "/tasks?x=1"],
    ["/projects/abc#notes", "/projects/abc#notes"],
    ["/a/../tasks", "/tasks"],
  ])("keeps same-site path %j", (next, expected) => {
    expect(safeNext(next, ORIGIN)).toBe(expected);
  });

  it("only ever returns a path, never an absolute URL", () => {
    for (const n of ["/tasks", "//evil.com", "/\\evil.com", "https://evil.com"]) expect(safeNext(n, ORIGIN).startsWith("/")).toBe(true);
  });
});

describe("login error messages", () => {
  it("maps codes to fixed text and never echoes what's in the URL", () => {
    expect(loginErrorMessage("link")).toMatch(/invalid or has expired/);
    expect(loginErrorMessage(null)).toBeNull();
    const attacker = "Your account is locked. Call +1 555 0100 to unlock it.";
    expect(loginErrorMessage(attacker)).toBe("Sign-in didn't complete. Try again.");
  });
});

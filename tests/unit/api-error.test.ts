import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, UserFacingError } from "@/server/http";

afterEach(() => vi.unstubAllEnvs());

describe("apiError", () => {
  it("doesn't send database or provider error text to clients in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = apiError(new Error('duplicate key value violates unique constraint "push_subscriptions_endpoint_key"'));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).not.toMatch(/duplicate key|constraint|push_subscriptions/);
    expect(body.error).toContain(body.code);
    // ...but it is logged server-side with the same reference.
    expect(String(spy.mock.calls[0][0])).toContain(body.code);
    spy.mockRestore();
  });

  it("still shows messages written for the user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = apiError(new UserFacingError("That email doesn't match this account."));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That email doesn't match this account.");
  });
});

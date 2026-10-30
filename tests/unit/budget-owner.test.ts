import { afterEach, describe, expect, it, vi } from "vitest";
import { canApproveBudgetOverride } from "@/server/ai/budget";

describe("budget override owner", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows only listed accounts when an owner list is set", () => {
    vi.stubEnv("NAVI_ADMIN_EMAILS", "Owner@Example.com, second@example.com");
    expect(canApproveBudgetOverride("owner@example.com")).toBe(true);
    expect(canApproveBudgetOverride("SECOND@example.com")).toBe(true);
    expect(canApproveBudgetOverride("friend@example.com")).toBe(false);
    expect(canApproveBudgetOverride(undefined)).toBe(false);
  });

  it("allows nobody in production when no owner is configured", () => {
    vi.stubEnv("NAVI_ADMIN_EMAILS", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(canApproveBudgetOverride("owner@example.com")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(canApproveBudgetOverride("owner@example.com")).toBe(true);
  });
});

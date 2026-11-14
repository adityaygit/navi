import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { routeList } from "@/server/mobile/router";

// docs/navi-1.5/mobile/API.md is the phone app's contract: every route the
// router serves must be listed there (method and path).

describe("mobile API docs", () => {
  it("list every /api/m route", () => {
    const doc = readFileSync("docs/navi-1.5/mobile/API.md", "utf8");
    const rows = new Set([...doc.matchAll(/^\| (GET|POST|PATCH|DELETE) \| `([^`?]+)(?:\?[^`]*)?` \|/gm)].map((m) => `${m[1]} ${m[2]}`));
    const routes = routeList();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.filter((r) => !rows.has(r))).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, ctxFor, userClient } from "./helpers";
import { saveNaviColor } from "@/app/(app)/settings/navi-color";

// Saving Navi's colour against the local database: it merges into the
// existing preferences, rejects unknown colours, and only touches the
// signed-in person's own profile.

let a: Awaited<ReturnType<typeof userClient>>;
let b: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  a = await userClient("navi-color-a@navi.test");
  b = await userClient("navi-color-b@navi.test");
  await admin().from("profiles").update({ preferences: { keep_me: 1, nested: { x: true } } }).eq("id", a.userId);
  await admin().from("profiles").update({ preferences: { navi_color: "pearl", other: "b" } }).eq("id", b.userId);
});

afterAll(async () => {
  await admin().from("profiles").update({ preferences: {} }).in("id", [a.userId, b.userId]);
});

const prefsOf = async (id: string) => (await admin().from("profiles").select("preferences").eq("id", id).single()).data!.preferences;

describe("saveNaviColor", () => {
  it("merges the colour into the person's existing preferences", async () => {
    expect(await saveNaviColor(ctxFor(a.db, a.userId), "rose")).toBe("rose");
    expect(await prefsOf(a.userId)).toEqual({ keep_me: 1, nested: { x: true }, navi_color: "rose" });
    await saveNaviColor(ctxFor(a.db, a.userId), "mint");
    expect(await prefsOf(a.userId)).toEqual({ keep_me: 1, nested: { x: true }, navi_color: "mint" });
  });

  it("rejects a colour that isn't in the palette and changes nothing", async () => {
    await expect(saveNaviColor(ctxFor(a.db, a.userId), "neon")).rejects.toThrow();
    expect((await prefsOf(a.userId)).navi_color).toBe("mint");
  });

  it("can't change someone else's profile", async () => {
    // A's session aimed at B's row: row-level security finds nothing to update.
    await expect(saveNaviColor(ctxFor(a.db, b.userId), "lime")).rejects.toThrow();
    expect(await prefsOf(b.userId)).toEqual({ navi_color: "pearl", other: "b" });
  });
});

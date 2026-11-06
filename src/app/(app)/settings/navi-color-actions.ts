"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { logActivity } from "@/server/domain/activity";
import { naviColor } from "@/lib/navi-colors";
import { saveNaviColor } from "./navi-color";

/** Saves Navi's colour for the signed-in person, then refreshes every view so Pebble follows. */
export async function setNaviColorAction(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireApiCtx();
    const color = await saveNaviColor(ctx, key);
    await logActivity(ctx, { action: "settings_updated", summary: `Changed Navi's colour to ${naviColor(color).name}` });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "That colour isn't one of Navi's colours." };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

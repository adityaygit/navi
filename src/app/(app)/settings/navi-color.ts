import { z } from "zod";
import { DEFAULT_NAVI_COLOR, NAVI_COLORS, type NaviColorKey } from "@/lib/navi-colors";
import type { Ctx } from "@/server/context";

// Navi's colour lives in profiles.preferences.navi_color, next to whatever
// else is kept in preferences. Saving it must never drop the other keys.

export const NaviColorKeySchema = z.enum(NAVI_COLORS.map((c) => c.key) as [NaviColorKey, ...NaviColorKey[]]);

/** The person's saved colour, or the default when none (or an unknown one) is stored. */
export function savedNaviColor(preferences: unknown): NaviColorKey {
  const parsed = NaviColorKeySchema.safeParse(asObject(preferences).navi_color);
  return parsed.success ? parsed.data : DEFAULT_NAVI_COLOR;
}

/** New preferences with navi_color set and every other key kept. Throws on an unknown colour. */
export function withNaviColor(preferences: unknown, key: unknown): Record<string, unknown> {
  const color = NaviColorKeySchema.parse(key);
  return { ...asObject(preferences), navi_color: color };
}

/** Reads the signed-in person's preferences, sets the colour, writes them back (their own row only). */
export async function saveNaviColor(ctx: Ctx, key: unknown): Promise<NaviColorKey> {
  const color = NaviColorKeySchema.parse(key);
  const { data, error } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
  if (error) throw new Error(`Could not load your settings: ${error.message}`);
  const preferences = withNaviColor(data?.preferences, color);
  const { data: saved, error: saveError } = await ctx.db.from("profiles").update({ preferences }).eq("id", ctx.userId).select("id");
  if (saveError) throw new Error(`Could not save Navi's colour: ${saveError.message}`);
  if (!saved?.length) throw new Error("Could not save Navi's colour.");
  return color;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

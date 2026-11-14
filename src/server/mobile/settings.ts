import "server-only";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import { compact, ProfileUpdate } from "@/server/domain/schemas";
import { logActivity } from "@/server/domain/activity";
import { isValidZone } from "@/lib/time";
import { NAVI_COLORS, naviColor, type NaviColorKey } from "@/lib/navi-colors";
import { UserFacingError } from "@/server/http";

// PATCH /api/m/settings: the phone's Settings screen. Profile columns go
// through the web's ProfileUpdate rules; the rest live in profiles.preferences
// (same keys the web uses: autonomy, navi_color, wake_time, bed_time) plus
// colour_follows_day, which only the app reads. Unknown keys are refused.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const colourKeys = NAVI_COLORS.map((c) => c.key) as [NaviColorKey, ...NaviColorKey[]];

export const MSettingsPatch = z
  .object({
    displayName: z.string().trim().max(120).nullable(),
    timezone: z.string().max(64),
    briefingsEnabled: z.boolean(),
    morning: hhmm,
    evening: hhmm,
    quietHours: z.object({ start: hhmm, end: hhmm }).nullable(),
    wakeBed: z.object({ wake: hhmm, bed: hhmm }).nullable(),
    autonomy: z.enum(["auto", "ask"]),
    naviColor: z.enum(colourKeys),
    colourFollowsDay: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export type MSettingsPatchInput = z.infer<typeof MSettingsPatch>;

/** What changed, in the person's words, for the activity log. */
function summary(p: MSettingsPatchInput): string {
  const parts: string[] = [];
  if (p.displayName !== undefined) parts.push("name");
  if (p.timezone) parts.push("time zone");
  if (p.briefingsEnabled !== undefined) parts.push(p.briefingsEnabled ? "briefings on" : "briefings off");
  if (p.morning) parts.push(`morning briefing ${p.morning}`);
  if (p.evening) parts.push(`evening review ${p.evening}`);
  if (p.quietHours !== undefined) parts.push(p.quietHours ? `quiet hours ${p.quietHours.start}–${p.quietHours.end}` : "quiet hours off");
  if (p.wakeBed !== undefined) parts.push(p.wakeBed ? `wake ${p.wakeBed.wake}, bed ${p.wakeBed.bed}` : "wake and bed times cleared");
  if (p.autonomy) parts.push(p.autonomy === "ask" ? "Navi asks before every change" : "Navi makes low-risk changes on its own");
  if (p.naviColor) parts.push(`Navi's colour ${naviColor(p.naviColor).name}`);
  if (p.colourFollowsDay !== undefined) parts.push(p.colourFollowsDay ? "colour follows the day" : "colour stays fixed");
  return `Updated settings from the app: ${parts.join(", ")}`;
}

export async function updateSettings(ctx: Ctx, input: unknown): Promise<void> {
  const p = MSettingsPatch.parse(input);
  if (p.timezone && !isValidZone(p.timezone)) throw new UserFacingError(`Unknown time zone: ${p.timezone}`, 400);

  const columns = compact(
    ProfileUpdate.parse({
      display_name: p.displayName === undefined ? undefined : p.displayName || null,
      timezone: p.timezone,
      briefings_enabled: p.briefingsEnabled,
      morning_briefing_time: p.morning,
      evening_review_time: p.evening,
      quiet_hours_start: p.quietHours === undefined ? undefined : (p.quietHours?.start ?? null),
      quiet_hours_end: p.quietHours === undefined ? undefined : (p.quietHours?.end ?? null),
    }),
  );

  const prefPatch: Record<string, unknown> = {};
  if (p.autonomy) prefPatch.autonomy = p.autonomy;
  if (p.naviColor) prefPatch.navi_color = p.naviColor;
  if (p.colourFollowsDay !== undefined) prefPatch.colour_follows_day = p.colourFollowsDay;
  if (p.wakeBed !== undefined) {
    prefPatch.wake_time = p.wakeBed?.wake ?? null;
    prefPatch.bed_time = p.wakeBed?.bed ?? null;
  }

  const update: Record<string, unknown> = { ...columns };
  if (Object.keys(prefPatch).length) {
    // Merge into what's there so other keys (planner flags, …) survive.
    const { data, error } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
    if (error) throw new Error(`Could not load your settings: ${error.message}`);
    const current = data?.preferences && typeof data.preferences === "object" && !Array.isArray(data.preferences) ? (data.preferences as Record<string, unknown>) : {};
    update.preferences = { ...current, ...prefPatch };
  }
  const { data: saved, error } = await ctx.db.from("profiles").update(update).eq("id", ctx.userId).select("id");
  if (error) throw new Error(`Could not save your settings: ${error.message}`);
  if (!saved?.length) throw new Error("Could not save your settings.");
  await logActivity(ctx, { action: "settings_updated", summary: summary(p) });
}

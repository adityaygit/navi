import "server-only";
import { z } from "zod";
import { getProfile, type Ctx } from "@/server/context";
import { nowIn } from "@/lib/time";

// On-demand briefings and reviews, shared by the web (actions.ts) and the
// phone app (/api/m).

export const BriefingKind = z.enum(["morning", "evening", "weekly"]);

/** Build today's briefing of this kind now; it replaces today's stored one of the same kind (data may have changed). */
export async function generateBriefing(ctx: Ctx, kind: z.infer<typeof BriefingKind>): Promise<{ title: string; body: string }> {
  const k = BriefingKind.parse(kind);
  const { buildBriefing } = await import("@/server/jobs/briefings");
  const profile = await getProfile(ctx);
  const date = nowIn(profile.timezone).toISODate()!;
  const b = await buildBriefing(ctx.db, profile, k, date);
  if ("week" in b && b.week) {
    const { learnFromWeek } = await import("@/server/domain/patterns");
    await learnFromWeek(ctx.db, ctx.userId, b.week);
  }
  const { error } = await ctx.db
    .from("briefings")
    .upsert({ user_id: ctx.userId, kind: k, local_date: date, title: b.title, body: b.body, data: b.data, generated_by: "rules", read_at: null }, { onConflict: "user_id,kind,local_date" });
  if (error) throw new Error(error.message);
  return { title: b.title, body: b.body };
}

export async function markBriefingRead(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.from("briefings").update({ read_at: new Date().toISOString() }).eq("id", id);
}

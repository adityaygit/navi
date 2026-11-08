"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DateTime } from "luxon";
import { requireApiCtx, getProfile } from "@/server/context";
import { logActivity } from "@/server/domain/activity";
import { getEntity } from "@/server/domain/entities";
import { planDays } from "@/server/planner/plan-v2";
import { occurrencesOn } from "@/server/planner/day-model";
import { plannerV2 } from "@/lib/planner-flag";
import type { CalendarEvent } from "@/lib/types";

// My day and Settings actions for the constraint-first planner (planner v2).

type Result = { ok: true; message: string } | { ok: false; error: string };
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(err: unknown): Result {
  return { ok: false, error: err instanceof z.ZodError ? "That isn't valid." : err instanceof Error ? err.message : String(err) };
}

async function v2Ctx() {
  const ctx = await requireApiCtx();
  const profile = await getProfile(ctx);
  if (!plannerV2(profile.preferences)) throw new Error("The new planner isn't on for this account.");
  return ctx;
}

/**
 * "Yes, I'm free then" / "No, I'm busy then" on an assumption My day shows.
 * Saved for that day only (undoable). Busy: the day is re-planned around it.
 */
export async function answerAssumptionAction(input: { date: string; start: string; end: string; free: boolean }): Promise<Result> {
  try {
    const ctx = await v2Ctx();
    const v = z.object({ date: DATE, start: HHMM, end: HHMM, free: z.boolean() }).parse(input);
    const { data, error } = await ctx.db
      .from("day_exceptions")
      .insert({ user_id: ctx.userId, date: v.date, kind: v.free ? "free" : "busy", start_time: v.start, end_time: v.end, note: v.free ? "free (confirmed)" : "busy", source: "ui" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "create", entityType: "day_exceptions", entityId: data.id, summary: `${v.free ? "Free" : "Busy"} ${v.start}–${v.end} on ${v.date} (you said)`, before: null, after: data, reversible: true });
    let message = v.free ? "Got it: that time is confirmed free." : "Got it: you're busy then.";
    if (!v.free) {
      const run = await planDays(ctx, [v.date], { trigger: "button" });
      message = `${message} ${run.summary}`;
    }
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (err) {
    return fail(err);
  }
}

/** "Skip this one": cancel one session of an event (the series stays), then re-plan that day. Undoable. */
export async function skipSessionAction(input: { eventId: string; date: string }): Promise<Result> {
  try {
    const ctx = await v2Ctx();
    const v = z.object({ eventId: z.string().uuid(), date: DATE }).parse(input);
    const ev = await getEntity<CalendarEvent>(ctx, "events", v.eventId);
    if (ev.external_ref) throw new Error("That event comes from a connected calendar; change it there.");
    if (!occurrencesOn(ev, v.date, ctx.timezone, []).length) throw new Error(`“${ev.title}” isn't on that day.`);
    const { data, error } = await ctx.db
      .from("event_occurrence_overrides")
      .upsert({ user_id: ctx.userId, event_id: ev.id, occurrence_date: v.date, status: "cancelled", starts_at: null, ends_at: null }, { onConflict: "event_id,occurrence_date" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const day = DateTime.fromISO(v.date, { zone: ctx.timezone }).toFormat("cccc");
    await logActivity(ctx, { action: "create", entityType: "event_occurrence_overrides", entityId: data.id, summary: `Skipped ${day}'s “${ev.title}” (the series stays)`, before: null, after: data, reversible: true });
    const run = await planDays(ctx, [v.date], { trigger: "event_change" });
    revalidatePath("/", "layout");
    return { ok: true, message: `Skipped ${day}'s “${ev.title}”. ${run.summary}` };
  } catch (err) {
    return fail(err);
  }
}

/** Settings: the new planner and its two preferences (D1 assumptions, D7 how full a day gets). */
export async function setPlannerPrefsAction(input: { planner_v2?: boolean; assume_free_time?: boolean; plan_load_cap?: number }): Promise<Result> {
  try {
    const ctx = await requireApiCtx();
    const v = z.object({ planner_v2: z.boolean().optional(), assume_free_time: z.boolean().optional(), plan_load_cap: z.number().min(0.1).max(1).optional() }).strict().parse(input);
    const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
    const before = (data?.preferences as Record<string, unknown> | null) ?? {};
    const preferences = { ...before, ...v };
    const { error } = await ctx.db.from("profiles").update({ preferences }).eq("id", ctx.userId);
    if (error) throw new Error(error.message);
    await logActivity(ctx, { action: "settings_updated", summary: `Planner settings: ${Object.entries(v).map(([k, x]) => `${k.replace(/_/g, " ")} ${x}`).join(", ")}` });
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return fail(err);
  }
}

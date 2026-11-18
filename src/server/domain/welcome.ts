import "server-only";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import { acceptMany } from "@/server/domain/proposals";
import { logActivity } from "@/server/domain/activity";
import { generateWeekPlan } from "@/server/planner/plan";
import { isValidZone } from "@/lib/time";
import { WELCOME_STEPS, type WelcomeStep } from "@/lib/onboarding";

// Setup (the /welcome flow on the web, onboarding on the phone): one place for
// what each step does to the account, so both surfaces behave the same. The
// step is saved on the account (profiles.preferences.onboarding_step), so it
// resumes on any device.

/** Remember the setup screen the person is on. */
export async function setWelcomeStep(ctx: Ctx, step: WelcomeStep | "done") {
  const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).single();
  const preferences = { ...((data?.preferences as Record<string, unknown> | null) ?? {}), onboarding_step: step };
  const { error } = await ctx.db.from("profiles").update({ preferences }).eq("id", ctx.userId);
  if (error) throw new Error(error.message);
}

export const WelcomeStepInput = z.enum([...WELCOME_STEPS, "done"]);

/** Move to a step. Starting to talk means setup is under way. */
export async function saveWelcomeStep(ctx: Ctx, step: string) {
  const s = WelcomeStepInput.parse(step);
  await setWelcomeStep(ctx, s);
  if (s === "talk") await ctx.db.from("profiles").update({ onboarding_status: "in_progress" }).eq("id", ctx.userId).in("onboarding_status", ["not_started"]);
}

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const BasicsInput = z.object({ display_name: z.string().trim().min(1).max(120), timezone: z.string().max(64), wake: HHMM, bed: HHMM });

/**
 * The basics: name, time zone, wake-up and bedtime. Wake/bed set quiet hours
 * (bedtime to wake-up), the morning briefing (at wake-up), and when Navi may
 * plan flexible work (between them). The evening briefing stays at 21:00.
 * `next`: the step after (the web goes on to talk; quick setup skips it).
 */
export async function saveBasics(ctx: Ctx, input: unknown, next: WelcomeStep = "talk") {
  const b = BasicsInput.parse(input);
  if (!isValidZone(b.timezone)) throw new Error(`Unknown time zone: ${b.timezone}`);
  const { data } = await ctx.db.from("profiles").select("preferences,onboarding_status").eq("id", ctx.userId).single();
  const preferences = { ...((data?.preferences as Record<string, unknown> | null) ?? {}), wake_time: b.wake, bed_time: b.bed, onboarding_step: next };
  // A bedtime after midnight: plan until the end of the day.
  const end = b.bed > b.wake ? b.bed : "23:59";
  const { error } = await ctx.db
    .from("profiles")
    .update({
      display_name: b.display_name,
      timezone: b.timezone,
      quiet_hours_start: b.bed,
      quiet_hours_end: b.wake,
      morning_briefing_time: b.wake,
      availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: b.wake, end }],
      preferences,
      ...(data?.onboarding_status === "not_started" ? { onboarding_status: "in_progress" } : {}),
    })
    .eq("id", ctx.userId);
  if (error) throw new Error(error.message);
  await logActivity(ctx, { action: "settings_updated", summary: `Setup basics: up at ${b.wake}, in bed by ${b.bed}, ${b.timezone}` });
}

/** "That's enough for now": open the review of what Navi picked up. */
export async function finishTalk(ctx: Ctx) {
  const { count } = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("batch", "onboarding").eq("status", "pending");
  if (!count) throw new Error("Nothing to review yet. Tell Navi a little about your week first, or choose “Do this later”.");
  await ctx.db.from("profiles").update({ onboarding_status: "reviewing" }).eq("id", ctx.userId);
  await setWelcomeStep(ctx, "review");
}

/** "Do this later": use the app now, finish setup any time. */
export async function skipWelcome(ctx: Ctx, step: string) {
  const s = WelcomeStepInput.parse(step);
  await setWelcomeStep(ctx, s);
  await ctx.db.from("profiles").update({ onboarding_status: "skipped" }).eq("id", ctx.userId).in("onboarding_status", ["not_started", "in_progress", "reviewing"]);
}

/** Back to talking (from the review, or to pick setup up again after "Later"). */
export async function restartOnboarding(ctx: Ctx) {
  await ctx.db.from("profiles").update({ onboarding_status: "in_progress" }).eq("id", ctx.userId);
}

/**
 * Finish: turn on the chosen items, keep the rest in the inbox for later,
 * build the first plan. Quick setup finishes with nothing chosen.
 */
export async function completeOnboarding(ctx: Ctx, acceptIds: string[]) {
  const results = await acceptMany(ctx, acceptIds);
  const failed = results.filter((r) => !r.ok);
  // Anything not accepted stays in the inbox (as pending) instead of disappearing.
  await ctx.db.from("proposals").update({ batch: null }).eq("batch", "onboarding").eq("status", "pending");
  await ctx.db.from("profiles").update({ onboarding_status: "completed" }).eq("id", ctx.userId);
  // Setup continues with "Stay in touch" and the first plan.
  await setWelcomeStep(ctx, "notify");
  const plan = await generateWeekPlan(ctx);
  await logActivity(ctx, { action: "onboarding_completed", summary: `Finished setup: ${results.length - failed.length} items activated` });
  return { accepted: results.length - failed.length, failed, plannedBlocks: plan.reduce((s, d) => s + d.blocks.length, 0) };
}

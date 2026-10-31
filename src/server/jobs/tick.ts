import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { atLocalTime } from "@/lib/time";
import { briefingUrl, saveBriefing, type BriefingKind } from "./briefings";
import { dispatchDue, queueNotification } from "./notify";
import { generateDayPlan } from "@/server/planner/plan";

// The scheduler tick. Run every 5–15 minutes server-side (Trigger.dev
// schedule or any cron hitting /api/cron/tick). It is idempotent: briefings
// and notifications are unique per user/day/key, so overlapping or repeated
// ticks never duplicate anything. Local times are recomputed each tick in the
// user's zone, so DST changes are handled automatically. No AI calls.

const CATCH_UP_HOURS = 3; // don't send a "morning" briefing in the afternoon after downtime

export function dueBriefings(profile: Profile, now: DateTime): { kind: BriefingKind; date: string }[] {
  if (!profile.briefings_enabled) return [];
  const local = now.setZone(profile.timezone);
  const date = local.toISODate()!;
  const out: { kind: BriefingKind; date: string }[] = [];
  const window = (time: string) => {
    const at = atLocalTime(date, time, profile.timezone);
    return local >= at && local < at.plus({ hours: CATCH_UP_HOURS });
  };
  if (window(profile.morning_briefing_time)) out.push({ kind: "morning", date });
  if (window(profile.evening_review_time)) {
    out.push({ kind: "evening", date });
    if (local.weekday % 7 === profile.weekly_review_day) out.push({ kind: "weekly", date });
  }
  return out;
}

export async function tickUser(db: SupabaseClient, profile: Profile, now = DateTime.now()) {
  const ctx = { db, userId: profile.id, actor: "system" as const, timezone: profile.timezone };
  const results: string[] = [];
  for (const { kind, date } of dueBriefings(profile, now)) {
    let plan: Awaited<ReturnType<typeof generateDayPlan>> | null = null;
    if (kind === "morning") {
      // Internal autonomy: plan today's flexible work if nothing is planned yet,
      // and say in the briefing what didn't fit or only fits after its deadline.
      const { count } = await db.from("plan_blocks").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("plan_date", date);
      const { count: briefed } = await db.from("briefings").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("kind", "morning").eq("local_date", date);
      if (!count && !briefed && profile.availability.length) plan = await generateDayPlan(ctx, date);
    }
    const b = await saveBriefing(db, profile, kind, date, { plan, now });
    if (b) {
      results.push(`${kind} briefing`);
      await queueNotification(db, profile, { kind, title: b.title, body: b.body.split("\n")[0], url: briefingUrl(kind, date), dedupeKey: `${kind}:${date}` });
    }
  }

  // Deadline reminders: hard deadlines 24h ahead, everything 2h ahead, overdue once.
  const { data: tasks } = await db
    .from("tasks")
    .select("id,title,due_at,due_is_hard")
    .eq("user_id", profile.id)
    .in("status", ["todo", "in_progress", "blocked"])
    .not("due_at", "is", null)
    .lte("due_at", now.plus({ hours: 24 }).toISO()!)
    .gte("due_at", now.minus({ days: 2 }).toISO()!);
  for (const t of tasks ?? []) {
    const due = DateTime.fromISO(t.due_at);
    const hours = due.diff(now, "hours").hours;
    const local = due.setZone(profile.timezone).toFormat("ccc h:mm a");
    if (hours < 0) {
      await queueNotification(db, profile, { kind: "overdue", title: "Overdue", body: `“${t.title}” was due ${local}. Do it, reschedule it, or drop it.`, url: "/tasks", dedupeKey: `overdue:${t.id}:${t.due_at}` });
    } else if (hours <= 2) {
      await queueNotification(db, profile, { kind: "deadline", title: "Due soon", body: `“${t.title}” is due ${local}.`, url: "/tasks", dedupeKey: `due2h:${t.id}:${t.due_at}`, expiresAt: due });
    } else if (t.due_is_hard) {
      const sameDay = due.setZone(profile.timezone).hasSame(now.setZone(profile.timezone), "day");
      await queueNotification(db, profile, { kind: "deadline", title: sameDay ? "Hard deadline today" : "Hard deadline tomorrow", body: `Hard deadline: “${t.title}” is due ${local}.`, url: "/tasks", dedupeKey: `due24h:${t.id}:${t.due_at}`, expiresAt: due });
    }
  }

  const delivered = await dispatchDue(db, profile);
  if (delivered) results.push(`${delivered} pushed`);
  return results;
}

export async function tickAll(db: SupabaseClient) {
  const { data: profiles, error } = await db.from("profiles").select("*").neq("onboarding_status", "not_started");
  if (error) throw new Error(error.message);
  const summary: Record<string, string[] | string> = {};
  for (const p of (profiles ?? []) as Profile[]) {
    try {
      summary[p.id.slice(0, 8)] = await tickUser(db, p);
    } catch (err) {
      // One user's failure must not stop the others; retry happens next tick.
      summary[p.id.slice(0, 8)] = `error: ${(err as Error).message}`;
    }
  }
  return summary;
}

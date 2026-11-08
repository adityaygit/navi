import "server-only";
import { DateTime, Interval } from "luxon";
import type { Ctx } from "@/server/context";
import type { CalendarEvent, OccurrenceOverride, PlanBlock, Routine } from "@/lib/types";
import { atLocalTime } from "@/lib/time";
import { occurrencesOn } from "./day-model";
import { protectionOf } from "./scheduler-v2";

/**
 * What a block placed at start–end on a local date would overlap that Navi
 * never moves: events (one-session changes applied), fixed routines, and
 * blocks that stay put (fixed, user-made, pinned, started). Navi's own open
 * blocks don't count: they're re-fitted around it. Null when it's clear.
 */
export async function fixedClash(ctx: Ctx, date: string, start: DateTime, end: DateTime, exceptBlockId?: string): Promise<string | null> {
  const zone = ctx.timezone;
  const [ev, ov, ro, bl] = await Promise.all([
    ctx.db.from("events").select("*").eq("user_id", ctx.userId).neq("status", "cancelled"),
    ctx.db.from("event_occurrence_overrides").select("*").eq("user_id", ctx.userId),
    ctx.db.from("routines").select("*").eq("user_id", ctx.userId).eq("active", true),
    ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).eq("plan_date", date).in("status", ["planned", "in_progress"]),
  ]);
  const iv = Interval.fromDateTimes(start, end);
  const overrides = (ov.data ?? []) as OccurrenceOverride[];
  for (const e of (ev.data ?? []) as CalendarEvent[]) if (occurrencesOn(e, date, zone, overrides).some((o) => o.overlaps(iv))) return e.title;
  const dow = DateTime.fromISO(date, { zone }).weekday % 7;
  for (const r of (ro.data ?? []) as Routine[]) {
    if (!r.start_time || !r.days.includes(dow) || protectionOf(r) !== "fixed") continue;
    const s = atLocalTime(date, r.start_time, zone);
    if (Interval.fromDateTimes(s, s.plus({ minutes: r.duration_minutes })).overlaps(iv)) return r.title;
  }
  for (const b of (bl.data ?? []) as PlanBlock[]) {
    if (b.id === exceptBlockId) continue;
    if (b.is_flexible && b.created_by === "navi" && !b.pinned && b.status === "planned") continue;
    if (Interval.fromDateTimes(DateTime.fromISO(b.starts_at), DateTime.fromISO(b.ends_at)).overlaps(iv)) return b.title;
  }
  return null;
}

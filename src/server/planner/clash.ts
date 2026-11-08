import "server-only";
import { DateTime, Interval } from "luxon";
import type { Ctx } from "@/server/context";
import type { CalendarEvent, OccurrenceOverride, PlanBlock, Routine } from "@/lib/types";
import { atLocalTime } from "@/lib/time";
import { occurrencesOn } from "./day-model";
import { protectionOf } from "./scheduler-v2";

export type FixedSpan = { title: string; start: DateTime; end: DateTime; blockId?: string };

/**
 * What Navi never moves on a local date: events (one-session changes
 * applied), fixed routines, and blocks that stay put (fixed, user-made,
 * pinned, started). Navi's own open blocks aren't included: they're
 * re-fitted around these.
 */
export async function fixedSpans(ctx: Ctx, date: string): Promise<FixedSpan[]> {
  const zone = ctx.timezone;
  const [ev, ov, ro, bl] = await Promise.all([
    ctx.db.from("events").select("*").eq("user_id", ctx.userId).neq("status", "cancelled"),
    ctx.db.from("event_occurrence_overrides").select("*").eq("user_id", ctx.userId),
    ctx.db.from("routines").select("*").eq("user_id", ctx.userId).eq("active", true),
    ctx.db.from("plan_blocks").select("*").eq("user_id", ctx.userId).eq("plan_date", date).in("status", ["planned", "in_progress"]),
  ]);
  const out: FixedSpan[] = [];
  const overrides = (ov.data ?? []) as OccurrenceOverride[];
  for (const e of (ev.data ?? []) as CalendarEvent[]) for (const o of occurrencesOn(e, date, zone, overrides)) out.push({ title: e.title, start: o.start!, end: o.end! });
  const dow = DateTime.fromISO(date, { zone }).weekday % 7;
  for (const r of (ro.data ?? []) as Routine[]) {
    if (!r.start_time || !r.days.includes(dow) || protectionOf(r) !== "fixed") continue;
    const s = atLocalTime(date, r.start_time, zone);
    out.push({ title: r.title, start: s, end: s.plus({ minutes: r.duration_minutes }) });
  }
  for (const b of (bl.data ?? []) as PlanBlock[]) {
    if (b.is_flexible && b.created_by === "navi" && !b.pinned && b.status === "planned") continue;
    out.push({ title: b.title, start: DateTime.fromISO(b.starts_at).setZone(zone), end: DateTime.fromISO(b.ends_at).setZone(zone), blockId: b.id });
  }
  return out;
}

/**
 * What a block placed at start–end on a local date would overlap that Navi
 * never moves (see fixedSpans). Null when it's clear.
 */
export async function fixedClash(ctx: Ctx, date: string, start: DateTime, end: DateTime, exceptBlockId?: string): Promise<string | null> {
  const iv = Interval.fromDateTimes(start, end);
  const hit = (await fixedSpans(ctx, date)).find((f) => (!exceptBlockId || f.blockId !== exceptBlockId) && Interval.fromDateTimes(f.start, f.end).overlaps(iv));
  return hit?.title ?? null;
}

import "server-only";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, PlanBlock, Profile, Routine, Task } from "@/lib/types";
import { eventOccurrence } from "@/server/planner/scheduler";
import { dayReview, weekInsights } from "@/server/domain/insights";
import { formatTime } from "@/lib/time";

// Briefings are generated deterministically from real data (no AI call), so
// they are cheap, reliable, and never invent progress. Each is stored once per
// user/kind/local date (unique constraint makes generation idempotent).

export type BriefingKind = "morning" | "evening" | "weekly";

async function fixedOn(db: SupabaseClient, userId: string, date: string, zone: string) {
  const [ev, ro] = await Promise.all([
    db.from("events").select("*").eq("user_id", userId).neq("status", "cancelled"),
    db.from("routines").select("*").eq("user_id", userId).eq("active", true),
  ]);
  const dow = DateTime.fromISO(date, { zone }).weekday % 7;
  const items = [
    ...((ev.data ?? []) as CalendarEvent[]).map((e) => ({ e, iv: eventOccurrence(e, date, zone) })).filter((x) => x.iv).map((x) => ({ title: x.e.title, start: x.iv!.start!, end: x.iv!.end! })),
    ...((ro.data ?? []) as Routine[]).filter((r) => r.start_time && r.days.includes(dow)).map((r) => {
      const s = DateTime.fromISO(`${date}T${r.start_time!.slice(0, 5)}`, { zone });
      return { title: r.title, start: s, end: s.plus({ minutes: r.duration_minutes }) };
    }),
  ].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const conflicts: string[] = [];
  for (let i = 1; i < items.length; i++) {
    if (items[i].start < items[i - 1].end) conflicts.push(`“${items[i - 1].title}” overlaps “${items[i].title}”`);
  }
  return { items, conflicts };
}

export async function buildBriefing(db: SupabaseClient, profile: Profile, kind: BriefingKind, date: string) {
  const zone = profile.timezone;
  const userId = profile.id;
  const dayEnd = DateTime.fromISO(date, { zone }).endOf("day");
  const lines: string[] = [];
  const data: Record<string, unknown> = {};

  if (kind === "morning") {
    const [{ items, conflicts }, blocksRes, dueRes, inboxRes, apprRes] = await Promise.all([
      fixedOn(db, userId, date, zone),
      db.from("plan_blocks").select("*").eq("user_id", userId).eq("plan_date", date).order("starts_at"),
      db.from("tasks").select("id,title,due_at,due_is_hard").eq("user_id", userId).in("status", ["todo", "in_progress", "blocked"]).lte("due_at", dayEnd.toISO()!).order("due_at"),
      db.from("proposals").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
      db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
    ]);
    const blocks = (blocksRes.data ?? []) as PlanBlock[];
    const due = (dueRes.data ?? []) as Task[];
    const overdue = due.filter((t) => t.due_at! < DateTime.now().toISO()!);
    const dueToday = due.filter((t) => !overdue.includes(t));
    lines.push(items.length ? `Fixed today: ${items.map((i) => `${i.title} at ${i.start.toFormat("h:mm a")}`).join("; ")}.` : "No fixed commitments today.");
    if (conflicts.length) lines.push(`⚠ Schedule conflict: ${conflicts.join("; ")}.`);
    lines.push(blocks.length ? `Planned work: ${blocks.map((b) => `${formatTime(b.starts_at, zone)} ${b.title}`).join("; ")}.` : profile.availability.length ? "No flexible work planned yet. Open Today to plan it." : "No flexible work planned: Navi doesn't know your availability yet.");
    if (dueToday.length) lines.push(`Due today: ${dueToday.map((t) => `${t.title}${t.due_is_hard ? " (hard)" : ""}`).join("; ")}.`);
    if (overdue.length) lines.push(`Overdue: ${overdue.map((t) => t.title).join("; ")}. Decide today: do it, reschedule it, or drop it.`);
    if ((inboxRes.count ?? 0) > 0) lines.push(`${inboxRes.count} item${inboxRes.count === 1 ? "" : "s"} waiting in your inbox.`);
    if ((apprRes.count ?? 0) > 0) lines.push(`${apprRes.count} approval${apprRes.count === 1 ? "" : "s"} waiting for you.`);
    Object.assign(data, { fixed: items.length, planned: blocks.length, dueToday: dueToday.length, overdue: overdue.length, conflicts });
    return { title: `Morning briefing · ${DateTime.fromISO(date).toFormat("ccc LLL d")}`, body: lines.join("\n"), data };
  }

  if (kind === "evening") {
    const review = await dayReview(db, userId, zone, date);
    const tomorrow = DateTime.fromISO(date, { zone }).plus({ days: 1 }).toISODate()!;
    const { items } = await fixedOn(db, userId, tomorrow, zone);
    const dueTomorrowRes = await db.from("tasks").select("title,due_is_hard").eq("user_id", userId).in("status", ["todo", "in_progress", "blocked"]).gt("due_at", dayEnd.toISO()!).lte("due_at", dayEnd.plus({ days: 1 }).toISO()!);
    lines.push(review.explanation);
    if (review.focusMinutes) lines.push(`Focused for ${review.focusMinutes} min; completed ${review.tasksCompleted} task${review.tasksCompleted === 1 ? "" : "s"}.`);
    else if (review.tasksCompleted) lines.push(`Completed ${review.tasksCompleted} task${review.tasksCompleted === 1 ? "" : "s"}.`);
    lines.push(...review.findings);
    if (review.carryOver.length) lines.push(`Still open (kept on your list): ${[...new Set(review.carryOver.map((c) => c.title))].join("; ")}.`);
    if (items.length) lines.push(`Tomorrow's fixed commitments: ${items.map((i) => `${i.title} ${i.start.toFormat("h:mm a")}`).join("; ")}.`);
    if ((dueTomorrowRes.data ?? []).length) lines.push(`Due tomorrow: ${(dueTomorrowRes.data ?? []).map((t) => t.title).join("; ")}.`);
    Object.assign(data, { review });
    return { title: `Evening review · ${DateTime.fromISO(date).toFormat("ccc LLL d")}`, body: lines.join("\n"), data };
  }

  const week = await weekInsights(db, userId, zone, date);
  lines.push(`Week ${week.start} → ${week.end}: ${week.tasksCompleted} tasks completed, ${week.focusMinutes} focus minutes.`);
  lines.push(...week.findings);
  Object.assign(data, { week: { ...week, days: week.days.map((d) => ({ date: d.date, completionRate: d.completionRate, planned: d.planned })) } });
  return { title: `Weekly review · week ending ${DateTime.fromISO(date).toFormat("LLL d")}`, body: lines.join("\n"), data };
}

/** Store a briefing once. Returns null if it already existed. */
export async function saveBriefing(db: SupabaseClient, profile: Profile, kind: BriefingKind, date: string) {
  const { data: existing } = await db.from("briefings").select("id").eq("user_id", profile.id).eq("kind", kind).eq("local_date", date).maybeSingle();
  if (existing) return null;
  const b = await buildBriefing(db, profile, kind, date);
  const { data, error } = await db
    .from("briefings")
    .insert({ user_id: profile.id, kind, local_date: date, title: b.title, body: b.body, data: b.data, generated_by: "rules" })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return null; // concurrent tick already created it
    throw new Error(error.message);
  }
  return data as { id: string; title: string; body: string };
}

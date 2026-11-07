import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import { dayFrom, loadSources } from "@/server/day";
import type { FocusSession } from "@/lib/focus";
import { FocusView, FocusPicker, type PickTask } from "@/components/focus/focus-view";

export const metadata = { title: "Focus · Navi" };

/**
 * Focus: one thing, a timer you can pause, and quiet. The Navi panel closes
 * on its own here and holds non-urgent things ("N waiting"); only a fixed
 * event within 10 minutes or a hard deadline today breaks through.
 */
export default async function FocusPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;

  const { data: open } = await ctx.db.from("focus_sessions").select("*, tasks(title, workspace_id, estimate_minutes)").is("ended_at", null).maybeSingle();
  if (open) {
    const session = open as FocusSession & { tasks: { title: string; workspace_id: string | null; estimate_minutes: number | null } | null };
    const [src, hardRes] = await Promise.all([
      loadSources(ctx, today, today),
      ctx.db.from("tasks").select("id,title,due_at").eq("due_is_hard", true).in("status", ["todo", "in_progress", "blocked"]).gte("due_at", now.startOf("day").toISO()!).lte("due_at", now.endOf("day").toISO()!),
    ]);
    const day = dayFrom(src, today);
    const space = session.tasks?.workspace_id ? src.spaces.get(session.tasks.workspace_id)?.name ?? null : null;
    return (
      <FocusView
        session={{ id: session.id, started_at: session.started_at, paused_at: session.paused_at, paused_seconds: session.paused_seconds ?? 0, planned_minutes: session.planned_minutes }}
        title={session.tasks?.title ?? "Focus"}
        space={space}
        fixedEvents={day.items.filter((i) => i.kind === "event" || (i.kind === "routine" && i.fixed)).map((i) => ({ id: i.id, title: i.title, startMs: i.startMs }))}
        hardDeadlines={((hardRes.data ?? []) as { id: string; title: string; due_at: string }[]).map((t) => ({ id: t.id, title: t.title, dueMs: Date.parse(t.due_at) }))}
        dayStartMs={now.startOf("day").toMillis()}
        dayEndMs={now.endOf("day").toMillis()}
        zone={zone}
      />
    );
  }

  // Just ended: what arrived while focusing, then back to work.
  let ended: { minutes: number | null; proposals: number; notes: { title: string; url: string }[] } | null = null;
  if (sp.ended) {
    const { data: last } = await ctx.db.from("focus_sessions").select("started_at,ended_at,actual_minutes").eq("id", sp.ended).maybeSingle();
    if (last?.ended_at) {
      const [p, n] = await Promise.all([
        ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").gte("created_at", last.started_at).lte("created_at", last.ended_at),
        ctx.db.from("notifications").select("title,url").gte("created_at", last.started_at).lte("created_at", last.ended_at).order("created_at").limit(5),
      ]);
      ended = { minutes: last.actual_minutes, proposals: p.count ?? 0, notes: (n.data ?? []) as { title: string; url: string }[] };
    }
  }

  // Pick what to focus on: today's and overdue open tasks first, then anything in progress.
  const { data: tasks } = await ctx.db
    .from("tasks")
    .select("id,title,estimate_minutes,due_at,status,workspace_id")
    .is("parent_task_id", null)
    .in("status", ["todo", "in_progress"])
    .or(`due_at.lte.${now.endOf("day").toUTC().toISO()},status.eq.in_progress`)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(8);
  return <FocusPicker tasks={(tasks ?? []) as PickTask[]} ended={ended} zone={zone} />;
}

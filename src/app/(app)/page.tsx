import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx, getProfile } from "@/server/context";
import type { Briefing, PlanBlock, Task } from "@/lib/types";
import { formatDay, formatDue, formatTime, nowIn } from "@/lib/time";
import { PlanBlockRow } from "@/components/plan-block";
import { FocusCard } from "@/components/focus";
import { RecoveryButton } from "@/components/recovery";
import { ActionButton } from "@/components/action-button";
import { completeTaskAction, markBriefingReadAction, planDayAction, startFocusAction } from "./actions";
import { buildDayAgenda } from "@/server/planner/agenda";
import type { CalendarEvent, Routine } from "@/lib/types";

export const metadata = { title: "Today · Navi" };

export default async function TodayPage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  if (["not_started", "in_progress", "reviewing"].includes(profile.onboarding_status)) redirect("/onboarding");

  const zone = profile.timezone;
  const now = nowIn(zone);
  const today = now.toISODate()!;
  const [blocksRes, tasksRes, focusRes, briefingRes, inboxRes, approvalsRes, eventsRes, routinesRes] = await Promise.all([
    ctx.db.from("plan_blocks").select("*").eq("plan_date", today).order("starts_at"),
    ctx.db.from("tasks").select("*").in("status", ["todo", "in_progress", "blocked"]).not("due_at", "is", null).lte("due_at", now.plus({ days: 3 }).toISO()!).order("due_at"),
    ctx.db.from("focus_sessions").select("id,started_at,planned_minutes,task_id,tasks(title)").is("ended_at", null).maybeSingle(),
    ctx.db.from("briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
  ]);
  const blocks = (blocksRes.data ?? []) as PlanBlock[];
  const dueSoon = (tasksRes.data ?? []) as Task[];
  const focus = focusRes.data as { id: string; started_at: string; planned_minutes: number | null; tasks: { title: string } | null } | null;
  const briefing = briefingRes.data as Briefing | null;
  // Events and timed routines; a routine's badge says whether its time is really fixed.
  const fixedToday = buildDayAgenda({ date: today, zone, events: (eventsRes.data ?? []) as CalendarEvent[], routines: (routinesRes.data ?? []) as Routine[], blocks: [], tasks: [] })
    .entries.filter((e) => e.start)
    .map((e) => ({ title: e.title, start: e.start!, end: e.end!, label: e.label }));
  const done = blocks.filter((b) => b.status === "done").length;
  const hour = now.hour;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="h1">{greeting}{profile.display_name ? `, ${profile.display_name.split(" ")[0]}` : ""}</h1>
          <p className="muted">{formatDay(today, zone)}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <ActionButton className="btn" action={planDayAction}>Re-plan today</ActionButton>
          <RecoveryButton />
        </div>
      </header>

      {focus && <FocusCard session={{ id: focus.id, started_at: focus.started_at, planned_minutes: focus.planned_minutes, task_title: focus.tasks?.title ?? null }} />}

      {((inboxRes.count ?? 0) > 0 || (approvalsRes.count ?? 0) > 0) && (
        <div className="flex flex-wrap gap-2">
          {(inboxRes.count ?? 0) > 0 && <Link href="/inbox" className="btn">Review inbox ({inboxRes.count})</Link>}
          {(approvalsRes.count ?? 0) > 0 && <Link href="/activity" className="btn">Approvals waiting ({approvalsRes.count})</Link>}
        </div>
      )}

      {briefing && !briefing.read_at && (
        <section className="card" aria-labelledby="briefing-title">
          <div className="flex items-start gap-2">
            <h2 id="briefing-title" className="h2">{briefing.title}</h2>
            <span className="badge ml-auto">{briefing.kind}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{briefing.body}</p>
          <div className="mt-3 flex gap-2">
            <ActionButton action={markBriefingReadAction} args={[briefing.id]}>Got it</ActionButton>
            <Link href="/insights" className="btn btn-sm btn-ghost">All reviews</Link>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="plan-title">
        <div className="flex items-center gap-2">
          <h2 id="plan-title" className="h2">Today's plan</h2>
          {blocks.length > 0 && <span className="muted text-sm">{done}/{blocks.length} done</span>}
          <Link href="/planner" className="btn btn-ghost btn-sm ml-auto">Week view</Link>
        </div>
        {blocks.length === 0 && (
          <p className="muted mt-3 text-sm">
            No flexible work is planned for today yet. Press “Re-plan today”, or tell Navi what you want to get done.
            {profile.availability.length === 0 && " Navi doesn't know when you're free yet, so set your availability in Settings or tell Navi."}
          </p>
        )}
        {(fixedToday.length > 0 || blocks.length > 0) && (
          // One timeline: fixed commitments and flexible blocks in time order.
          <ul className="mt-2 flex flex-col">
            {[
              ...fixedToday.map((f) => ({ at: Date.parse(f.start), fixed: f, block: null })),
              ...blocks.map((b) => ({ at: Date.parse(b.starts_at), fixed: null, block: b })),
            ]
              .sort((a, b) => a.at - b.at)
              .map(({ fixed: f, block: b }, i) =>
                f ? (
                  <li key={`f${i}`} className="my-1 flex gap-3 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
                    <span className="w-36 shrink-0 tabular-nums">{formatTime(f.start, zone)}–{formatTime(f.end, zone)}</span>
                    <span className="flex-1">{f.title}</span>
                    <span className="badge">{f.label}</span>
                  </li>
                ) : (
                  <PlanBlockRow key={b!.id} block={b!} time={`${formatTime(b!.starts_at, zone)}–${formatTime(b!.ends_at, zone)}`} canFocus={!focus} />
                ),
              )}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="due-title">
        <div className="flex items-center gap-2">
          <h2 id="due-title" className="h2">Due soon</h2>
          <Link href="/tasks" className="btn btn-ghost btn-sm ml-auto">All tasks</Link>
        </div>
        {dueSoon.length === 0 ? (
          <p className="muted mt-2 text-sm">Nothing due in the next 3 days.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {dueSoon.map((t) => {
              const overdue = t.due_at! < now.toISO()!;
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
                  <span className="min-w-0 flex-1">
                    {t.title}
                    <span className={`ml-2 text-xs ${overdue ? "text-danger" : "muted"}`}>
                      {overdue ? "overdue · " : ""}due {formatDue(t.due_at!, zone)}{t.due_is_hard ? " (hard)" : ""}
                    </span>
                  </span>
                  {!focus && <ActionButton action={startFocusAction} args={[{ task_id: t.id, planned_minutes: t.estimate_minutes }]}>Focus</ActionButton>}
                  <ActionButton action={completeTaskAction} args={[t.id]}>Done</ActionButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

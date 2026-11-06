import { Fragment } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine, Task } from "@/lib/types";
import { buildDayAgenda } from "@/server/planner/agenda";
import { deadlineRisks } from "@/server/planner/deadlines";
import { formatTime, minutesBetween, nowIn } from "@/lib/time";
import { ActionButton } from "@/components/action-button";
import { PlanBlockRow, type TimelineInfo, type TimelineKind } from "@/components/plan-block";
import { PlannerFixedRow, PlannerGapRow, PlannerNowRow, PlannerWeekStrip, type StripDay } from "@/components/planner-rows";
import { planDayAction, planWeekAction } from "../actions";
import { AddCommitment } from "./add-commitment";

export const metadata = { title: "Planner · Navi" };

type Area = { name: string; color: string | null };
type BlockRow = PlanBlock & { tasks: { workspace_id: string | null } | null; routines: { workspace_id: string | null; is_fixed: boolean } | null };
type DueTask = Pick<Task, "id" | "title" | "status" | "priority" | "due_at" | "due_is_hard" | "estimate_minutes" | "workspace_id">;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ start?: string; view?: string }> }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const sp = await searchParams;
  const now = nowIn(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const view = sp.view === "day" ? "day" : "week";
  const start = sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : today;
  const startDt = DateTime.fromISO(start, { zone });
  const days = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => startDt.plus({ days: i }).toISODate()!);
  // The strip shows the days on screen (week) or the Mon–Sun week around the chosen day.
  const stripStart = view === "week" ? startDt : startDt.minus({ days: (startDt.weekday + 6) % 7 });
  const stripDays = Array.from({ length: 7 }, (_, i) => stripStart.plus({ days: i }).toISODate()!);
  const from = [days[0], stripDays[0]].sort()[0];
  const to = [days[days.length - 1], stripDays[6]].sort()[1];
  const rangeEnd = DateTime.fromISO(to, { zone }).endOf("day");
  const horizon = Math.max(0, Math.ceil(rangeEnd.diff(now.startOf("day"), "days").days));

  const [blocksRes, eventsRes, routinesRes, focusRes, areasRes, dueRes, risks] = await Promise.all([
    ctx.db.from("plan_blocks").select("*, tasks(workspace_id), routines(workspace_id,is_fixed)").gte("plan_date", from).lte("plan_date", to).order("starts_at"),
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
    ctx.db.from("focus_sessions").select("id").is("ended_at", null).maybeSingle(),
    ctx.db.from("workspaces").select("id,name,color"),
    ctx.db
      .from("tasks")
      .select("id,title,status,priority,due_at,due_is_hard,estimate_minutes,workspace_id")
      .in("status", ["todo", "in_progress", "blocked"])
      .not("due_at", "is", null)
      .lte("due_at", rangeEnd.toUTC().toISO()!)
      .order("due_at"),
    rangeEnd > now ? deadlineRisks(ctx.db, ctx.userId, zone, DateTime.now(), horizon) : Promise.resolve([]),
  ]);
  const blockRows = (blocksRes.data ?? []) as BlockRow[];
  const blocks: PlanBlock[] = blockRows.map((row) => {
    const b: Partial<BlockRow> = { ...row };
    delete b.tasks;
    delete b.routines;
    return b as PlanBlock;
  });
  const events = (eventsRes.data ?? []) as CalendarEvent[];
  const routines = (routinesRes.data ?? []) as Routine[];
  const dueTasks = (dueRes.data ?? []) as DueTask[];
  const risk = new Map(risks.map((r) => [r.task_id, r]));
  const areas = new Map(((areasRes.data ?? []) as { id: string; name: string; color: string | null }[]).map((w) => [w.id, { name: w.name, color: w.color }]));
  const areaOf = (id: string | null | undefined): Area | null => (id ? (areas.get(id) ?? null) : null);
  const eventArea = new Map(events.map((e) => [e.id, e.workspace_id]));
  const routineArea = new Map(routines.map((r) => [r.id, r.workspace_id]));
  const step = view === "day" ? 1 : 7;
  const nav = (d: string, v = view) => `/planner?start=${d}&view=${v}`;

  const agendaFor = (d: string) => buildDayAgenda({ date: d, zone, events, routines, blocks, tasks: dueTasks as Task[] });
  const timeParts = (iso: string) => {
    const [t, m] = formatTime(iso, zone).split(" ");
    return { start: t, meridiem: m ?? "" };
  };
  const range = (s: string, e: string) => {
    const a = formatTime(s, zone);
    const b = formatTime(e, zone);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  };
  const blockKind = (b: BlockRow): { kind: TimelineKind; label: string } => {
    if (!b.is_flexible) return { kind: "fixed", label: "Fixed" };
    if (b.status === "rest") return { kind: "recovery", label: "Rest" };
    if (b.routine_id) return { kind: "recovery", label: b.routines?.is_fixed ? "Fixed routine" : "Routine" };
    return { kind: "flex", label: "Flexible" };
  };
  const overdue = dueTasks.filter((t) => Date.parse(t.due_at!) < nowMs);
  const isRisky = (t: DueTask) => Date.parse(t.due_at!) < nowMs || risk.has(t.id);

  // ---- Week strip ----
  const strip: StripDay[] = stripDays.map((d) => {
    const dt = DateTime.fromISO(d, { zone });
    const a = agendaFor(d);
    const fixed = a.entries.filter((e) => e.kind !== "block" && e.start).length;
    const flexible = a.entries.filter((e) => e.kind === "block").length;
    const due = a.due.length + (d === today ? overdue.length : 0);
    const riskDay = a.due.some((t) => isRisky(t as DueTask)) || (d === today && overdue.length > 0);
    const bits = [fixed && plural(fixed, "fixed commitment"), flexible && plural(flexible, "planned block"), due && `${due} due`, riskDay && "deadline at risk"].filter(Boolean);
    return {
      date: d,
      weekday: dt.toFormat("ccc"),
      dayNum: dt.toFormat("d"),
      label: `${dt.toFormat("cccc LLL d")}${d === today ? ", today" : ""}${bits.length ? `: ${bits.join(", ")}` : ": nothing scheduled"}`,
      href: nav(d, "day"),
      selected: view === "day" && d === start,
      today: d === today,
      fixed,
      flexible,
      due,
      risk: riskDay,
    };
  });

  // ---- Deadlines in view ----
  const inView = (t: DueTask) => days.includes(DateTime.fromISO(t.due_at!).setZone(zone).toISODate()!);
  const deadlines = [...(days.includes(today) ? overdue : []), ...dueTasks.filter((t) => Date.parse(t.due_at!) >= nowMs && inView(t))];
  const deadlineTitle = view === "week" ? "Deadlines this week" : start === today ? "Due today" : `Due ${startDt.toFormat("ccc LLL d")}`;

  const rangeLabel =
    view === "day"
      ? startDt.toFormat("cccc, LLLL d")
      : `${startDt.toFormat("LLL d")} – ${startDt.plus({ days: 6 }).toFormat(startDt.month === startDt.plus({ days: 6 }).month ? "d" : "LLL d")}`;

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <header className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-5">
          <div className="mr-auto flex flex-col gap-1.5">
            <h1 className="h1">Planner</h1>
            <p className="text-[17px] text-muted">{rangeLabel}{days.includes(today) && view === "day" ? " · today" : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="surf flex rounded-full p-1" role="group" aria-label="View">
              <Link href={nav(start, "day")} className={`btn btn-sm border-transparent ${view === "day" ? "btn-primary" : "bg-transparent"}`} aria-current={view === "day" ? "page" : undefined}>Day</Link>
              <Link href={nav(start, "week")} className={`btn btn-sm border-transparent ${view === "week" ? "btn-primary" : "bg-transparent"}`} aria-current={view === "week" ? "page" : undefined}>Week</Link>
            </div>
            <div className="flex gap-1">
              <Link href={nav(startDt.minus({ days: step }).toISODate()!)} className="btn btn-sm w-11 px-0" aria-label="Previous">←</Link>
              <Link href={nav(today)} className="btn btn-sm">Today</Link>
              <Link href={nav(startDt.plus({ days: step }).toISODate()!)} className="btn btn-sm w-11 px-0" aria-label="Next">→</Link>
            </div>
            {view === "day" ? (
              <ActionButton className="btn btn-primary btn-sm" action={planDayAction} args={[start]} showResult>Plan this day</ActionButton>
            ) : (
              <ActionButton className="btn btn-primary btn-sm" action={planWeekAction} showResult>Plan next 7 days</ActionButton>
            )}
          </div>
        </div>
        <PlannerWeekStrip days={strip} />
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr] lg:gap-x-10">
        {/* Deadlines first on a phone; beside the timeline on a wide screen. */}
        <section aria-labelledby="due-h" className="flex flex-col gap-3 lg:col-start-2 lg:row-start-1">
          <h2 id="due-h" className="eyebrow">{deadlineTitle}</h2>
          {deadlines.length === 0 ? (
            <p className="text-[15px] text-dim">No deadlines {view === "week" ? "in these 7 days" : "on this day"}.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {deadlines.map((t) => {
                const due = DateTime.fromISO(t.due_at!).setZone(zone);
                const late = Date.parse(t.due_at!) < nowMs;
                const r = risk.get(t.id);
                const alarm = late || (r && t.due_is_hard);
                const area = areaOf(t.workspace_id);
                const dayWord = due.toISODate() === today ? "Today" : due.toFormat("ccc");
                const withDay = view === "week" || late;
                const when = due.hour === 23 && due.minute === 59 ? (withDay ? `${dayWord}, end of day` : "End of day") : withDay ? `${dayWord} ${due.toFormat("h:mm a")}` : due.toFormat("h:mm a");
                return (
                  <li key={t.id} className={`flex items-start gap-3 rounded-[14px] border px-4 py-3 ${alarm ? "border-[1.5px] border-clash bg-[rgba(255,143,138,0.08)]" : "border-border bg-white/[0.02]"}`}>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Link href="/tasks" className="text-[16px] font-semibold leading-snug break-words hover:underline">{t.title}</Link>
                      <span className={`flex flex-wrap items-center gap-x-1.5 text-[13px] ${alarm ? "text-[#ffc2bd]" : "text-muted"}`}>
                        {area && <span className="dot h-[7px] w-[7px]" style={{ background: area.color ?? "#8b8e95" }} aria-hidden />}
                        {area && <span>{area.name} ·</span>}
                        <span className="num">{late ? `was due ${when}` : when}</span>
                        {t.due_is_hard && <span>· hard deadline</span>}
                      </span>
                      {r && !late && <span className="text-[13px] text-muted">Needs ~{r.shortMinutes} min more than is planned before then.</span>}
                    </div>
                    {late ? (
                      <span className="shrink-0 rounded-full bg-clash px-2.5 py-0.5 text-xs font-semibold text-[#060608]">Overdue</span>
                    ) : r ? (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.due_is_hard ? "bg-clash text-[#060608]" : "badge-warn"}`}>At risk</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {days.map((d) => {
            const dt = DateTime.fromISO(d, { zone });
            const isToday = d === today;
            const agenda = agendaFor(d);
            type Item =
              | { type: "fixed"; at: number; end: number; e: (typeof agenda.entries)[number] }
              | { type: "block"; at: number; end: number; b: BlockRow };
            const items: Item[] = [
              ...agenda.entries.filter((e) => e.kind !== "block" && e.start).map((e) => ({ type: "fixed" as const, at: Date.parse(e.start!), end: Date.parse(e.end!), e })),
              ...blockRows.filter((b) => b.plan_date === d).map((b) => ({ type: "block" as const, at: Date.parse(b.starts_at), end: Date.parse(b.ends_at), b })),
            ].sort((a, b) => a.at - b.at);
            const anyTime = agenda.entries.filter((e) => e.kind === "routine" && !e.start);
            const open = (i: Item) => i.type === "fixed" || i.b.status === "planned" || i.b.status === "in_progress";
            const current = isToday ? items.find((i) => open(i) && i.at <= nowMs && i.end > nowMs) ?? null : null;
            const next = isToday ? items.find((i) => open(i) && i.at > nowMs) ?? null : null;
            const fixedCount = items.filter((i) => i.type === "fixed").length;
            const blockCount = items.length - fixedCount;
            const doneCount = items.filter((i) => i.type === "block" && i.b.status === "done").length;
            const summary = [fixedCount && plural(fixedCount, "fixed"), blockCount && `${blockCount} planned${doneCount ? `, ${doneCount} done` : ""}`].filter(Boolean).join(" · ");

            const rows: { key: string; node: React.ReactNode }[] = [];
            let lastEnd: number | null = null;
            let nowPlaced = !isToday || current !== null || items.length === 0;
            const placeNow = () => {
              const t = timeParts(now.toISO()!);
              rows.push({ key: "now", node: <PlannerNowRow start={t.start} meridiem={t.meridiem} /> });
              nowPlaced = true;
            };
            items.forEach((i, idx) => {
              if (!nowPlaced && i.at > nowMs) placeNow();
              // A free stretch of 30+ minutes between two things (still ahead, on today).
              if (lastEnd !== null && d >= today && i.at - lastEnd >= 30 * 60000 && (!isToday || i.at > nowMs)) {
                const gapFrom = isToday ? Math.max(lastEnd, nowMs) : lastEnd;
                const mins = Math.round((i.at - gapFrom) / 60000);
                if (mins >= 30) {
                  const t = timeParts(new Date(gapFrom).toISOString());
                  rows.push({ key: `gap${idx}`, node: <PlannerGapRow start={t.start} meridiem={t.meridiem} minutes={mins} /> });
                }
              }
              lastEnd = Math.max(lastEnd ?? 0, i.end);
              const marker = i === current ? ("Now" as const) : i === next ? ("Next" as const) : null;
              if (i.type === "fixed") {
                const e = i.e;
                const kind: TimelineKind = e.fixed ? "fixed" : "recovery";
                const area = areaOf(e.kind === "event" ? eventArea.get(e.id) : routineArea.get(e.id));
                const timeline: TimelineInfo = { ...timeParts(e.start!), range: range(e.start!, e.end!), minutes: minutesBetween(e.start!, e.end!), area, marker, kind, kindLabel: e.label };
                rows.push({ key: `f${e.id}${idx}`, node: <PlannerFixedRow title={e.title} label={e.label} timeline={timeline} /> });
              } else {
                const b = i.b;
                const { kind, label } = blockKind(b);
                const area = areaOf(b.tasks?.workspace_id ?? b.routines?.workspace_id);
                const timeline: TimelineInfo = { ...timeParts(b.starts_at), range: range(b.starts_at, b.ends_at), minutes: minutesBetween(b.starts_at, b.ends_at), area, marker, kind, kindLabel: label };
                rows.push({
                  key: b.id,
                  node: <PlanBlockRow block={blocks[blockRows.indexOf(b)]} time={`${formatTime(b.starts_at, zone)}–${formatTime(b.ends_at, zone)}`} canFocus={!focusRes.data && isToday} timeline={timeline} />,
                });
              }
            });
            if (!nowPlaced) placeNow();

            if (view === "week" && items.length === 0 && anyTime.length === 0) {
              // An empty day stays one quiet line, so the busy days stand out.
              return (
                <section key={d} aria-label={dt.toFormat("cccc LLL d")} className="flex flex-wrap items-center gap-x-3 rounded-[14px] border border-border px-5 py-2 md:px-6">
                  <h2 className="text-[17px] font-semibold">
                    {dt.toFormat("cccc")}
                    <span className="font-normal text-muted">, {dt.toFormat("LLL d")}</span>
                  </h2>
                  <p className="text-[15px] text-dim">Nothing scheduled.</p>
                  <Link href={nav(d, "day")} className="btn btn-ghost btn-sm ml-auto" aria-label={`Open ${dt.toFormat("cccc LLL d")}`}>Open</Link>
                </section>
              );
            }
            return (
              <section key={d} className={view === "week" ? "card md:p-6" : ""} aria-label={dt.toFormat("cccc LLL d")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className={view === "week" ? "h2" : "sr-only"}>
                    {dt.toFormat("cccc")}
                    <span className="font-normal text-muted">, {dt.toFormat("LLL d")}</span>
                  </h2>
                  {view === "week" && isToday && <span className="rounded-full bg-[#f2f2f2] px-2.5 py-0.5 text-xs font-semibold text-[#060608]">Today</span>}
                  {summary && <span className="num text-sm text-dim">{summary}</span>}
                  {view === "week" && <Link href={nav(d, "day")} className="btn btn-ghost btn-sm ml-auto" aria-label={`Open ${dt.toFormat("cccc LLL d")}`}>Open</Link>}
                </div>
                {items.length === 0 ? (
                  <p className={`text-[15px] text-dim ${view === "week" ? "mt-2" : "mt-1 rounded-[14px] border border-dashed border-[#3a3c42] px-4 py-6 text-center"}`}>Nothing scheduled.</p>
                ) : (
                  // One timeline: fixed commitments and flexible blocks in time order.
                  <ul className="mt-4 flex flex-col gap-2.5">{rows.map((r) => <Fragment key={r.key}>{r.node}</Fragment>)}</ul>
                )}
                {anyTime.length > 0 && (
                  <p className="mt-3 text-sm text-muted">Any time: {anyTime.map((e) => e.title).join(", ")} <span className="text-dim">(routine{anyTime.length === 1 ? "" : "s"} with no set time)</span></p>
                )}
              </section>
            );
          })}
        </div>

        <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2" aria-label="About the planner">
          {profile.availability.length === 0 && (
            <p className="notice notice-warn text-sm">
              Navi won&apos;t invent free time. Set when you&apos;re available in <Link className="underline" href="/settings">Settings</Link> (or tell Navi) so it can schedule flexible work.
            </p>
          )}
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] text-muted" aria-label="What the colours mean">
            <li className="flex items-center gap-2"><span className="h-3.5 w-5 rounded-[5px] bg-fixed" aria-hidden />Fixed</li>
            <li className="flex items-center gap-2"><span className="h-3.5 w-5 rounded-[5px] border-[1.5px] border-flex" aria-hidden />Flexible</li>
            <li className="flex items-center gap-2"><span className="h-3.5 w-5 rounded-[5px] border-[1.5px] border-recovery" aria-hidden />Routine / rest</li>
            <li className="flex items-center gap-2"><span className="h-3.5 w-5 rounded-[5px] border border-dashed border-[#5a5c62]" aria-hidden />Free</li>
          </ul>
          <p className="text-[13px] leading-relaxed text-dim">Fixed commitments never move automatically. Flexible blocks are placed by Navi and can be re-planned any time. Due dates are deadlines, not scheduled times.</p>
          <AddCommitment zone={zone} defaultDate={start} />
        </aside>
      </div>
    </div>
  );
}


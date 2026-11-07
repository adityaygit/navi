import Link from "next/link";
import Image from "next/image";
import { Fragment } from "react";
import { redirect } from "next/navigation";
import { requireCtx, getProfile } from "@/server/context";
import type { Briefing, PlanBlock, Task } from "@/lib/types";
import { atLocalTime, formatDay, formatDue, formatTime, nowIn } from "@/lib/time";
import { PlanBlockRow, FixedEntryRow, type TimelineInfo, type TimelineKind } from "@/components/plan-block";
import { FocusCard } from "@/components/focus";
import { RecoveryButton } from "@/components/recovery";
import { ActionButton } from "@/components/action-button";
import { Pebble } from "@/components/pebble";
import { followThrough, statusWord } from "@/lib/follow-through";
import { weekInsights } from "@/server/domain/insights";
import { completeTaskAction, markBriefingReadAction, planDayAction, startFocusAction } from "./actions";
import { buildDayAgenda } from "@/server/planner/agenda";
import type { CalendarEvent, Routine } from "@/lib/types";

export const metadata = { title: "Today · Navi" };

type Area = { name: string; color: string | null };
type BlockRow = PlanBlock & { tasks: { workspace_id: string | null } | null; routines: { workspace_id: string | null } | null };
type FocusRow = { started_at: string; ended_at: string | null; actual_minutes: number | null; tasks: { workspace_id: string | null } | null };

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TONE_TEXT = { good: "text-focus", okay: "text-recovery", low: "text-clash", none: "text-muted" } as const;
const TONE_PILL = {
  good: "border-[rgba(95,211,154,0.4)] text-focus",
  okay: "border-[rgba(242,196,107,0.4)] text-recovery",
  low: "border-[rgba(255,143,138,0.45)] text-clash",
  none: "border-border-strong text-muted",
} as const;
const TONE_DOT = { good: "bg-focus", okay: "bg-recovery", low: "bg-clash", none: "bg-dim" } as const;
const RING_C = 2 * Math.PI * 26;
const BRIEFING_KIND = { morning: "Morning briefing", evening: "Evening recap", weekly: "Weekly review" } as const;

export default async function TodayPage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  if (["not_started", "in_progress", "reviewing"].includes(profile.onboarding_status)) redirect("/onboarding");

  const zone = profile.timezone;
  const now = nowIn(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const yesterday = now.minus({ days: 1 }).toISODate()!;
  const dayStart = now.startOf("day").toISO()!;
  const dayEnd = now.endOf("day").toISO()!;
  const [blocksRes, tasksRes, focusRes, briefingRes, inboxRes, approvalsRes, eventsRes, routinesRes, yesterdayRes, areasRes, focusTodayRes, week] = await Promise.all([
    ctx.db.from("plan_blocks").select("*, tasks(workspace_id), routines(workspace_id)").eq("plan_date", today).order("starts_at"),
    ctx.db.from("tasks").select("*").in("status", ["todo", "in_progress", "blocked"]).not("due_at", "is", null).lte("due_at", now.plus({ days: 3 }).toISO()!).order("due_at"),
    ctx.db.from("focus_sessions").select("id,started_at,planned_minutes,task_id,tasks(title)").is("ended_at", null).maybeSingle(),
    ctx.db.from("briefings").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", new Date().toISOString()),
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
    // Yesterday's blocks nobody said anything about: one compact prompt to mark them.
    ctx.db.from("plan_blocks").select("id", { count: "exact", head: true }).eq("plan_date", yesterday).in("status", ["planned", "in_progress"]),
    ctx.db.from("workspaces").select("id,name,color"),
    // Focus measured today, by area (focus session → task → area).
    ctx.db.from("focus_sessions").select("started_at,ended_at,actual_minutes,tasks(workspace_id)").gte("started_at", dayStart).lte("started_at", dayEnd),
    weekInsights(ctx.db, ctx.userId, zone, today),
  ]);
  const unmarkedYesterday = yesterdayRes.count ?? 0;
  const eveningNow = now >= atLocalTime(today, profile.evening_review_time, zone);
  const blockRows = (blocksRes.data ?? []) as BlockRow[];
  // Plain plan blocks for the client rows (without the joined area ids).
  const blocks: PlanBlock[] = blockRows.map((row) => {
    const b: Partial<BlockRow> = { ...row };
    delete b.tasks;
    delete b.routines;
    return b as PlanBlock;
  });
  const dueSoon = (tasksRes.data ?? []) as Task[];
  const focus = focusRes.data as { id: string; started_at: string; planned_minutes: number | null; tasks: { title: string } | null } | null;
  const briefing = briefingRes.data as Briefing | null;
  const unreadBriefing = briefing && !briefing.read_at ? briefing : null;
  const inboxCount = inboxRes.count ?? 0;
  const approvalsCount = approvalsRes.count ?? 0;
  const areas = new Map(((areasRes.data ?? []) as { id: string; name: string; color: string | null }[]).map((w) => [w.id, { name: w.name, color: w.color }]));
  const areaOf = (id: string | null | undefined): Area | null => (id ? (areas.get(id) ?? null) : null);
  const events = (eventsRes.data ?? []) as CalendarEvent[];
  const routines = (routinesRes.data ?? []) as Routine[];
  const eventArea = new Map(events.map((e) => [e.id, e.workspace_id]));
  const routineArea = new Map(routines.map((r) => [r.id, r.workspace_id]));
  const routineFixed = new Map(routines.map((r) => [r.id, r.is_fixed]));

  // Events and timed routines; a routine's badge says whether its time is really fixed.
  const fixedToday = buildDayAgenda({ date: today, zone, events, routines, blocks: [], tasks: [] })
    .entries.filter((e) => e.start)
    .map((e) => ({ id: e.id, kind: e.kind, title: e.title, start: e.start!, end: e.end!, label: e.label, fixed: e.fixed }));
  const done = blocks.filter((b) => b.status === "done").length;
  const isOpen = (b: PlanBlock) => b.status === "planned" || b.status === "in_progress";
  const hour = now.hour;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = profile.display_name ? profile.display_name.split(" ")[0] : "";

  // ---- One timeline: fixed commitments and plan blocks in time order, with free gaps. ----
  type Item =
    | { type: "fixed"; at: number; end: number; f: (typeof fixedToday)[number] }
    | { type: "block"; at: number; end: number; b: BlockRow };
  const items: Item[] = [
    ...fixedToday.map((f) => ({ type: "fixed" as const, at: Date.parse(f.start), end: Date.parse(f.end), f })),
    ...blockRows.map((b) => ({ type: "block" as const, at: Date.parse(b.starts_at), end: Date.parse(b.ends_at), b })),
  ].sort((a, b) => a.at - b.at);
  // What's happening now, and what's next (finished or marked blocks don't count).
  const pending = (i: Item) => i.type === "fixed" || isOpen(i.b);
  const current = items.find((i) => pending(i) && i.at <= nowMs && i.end > nowMs) ?? null;
  const next = items.find((i) => pending(i) && i.at > nowMs) ?? null;
  const titleOf = (i: Item) => (i.type === "fixed" ? i.f.title : i.b.title);
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
    if (b.routine_id) return { kind: "recovery", label: routineFixed.get(b.routine_id) ? "Fixed routine" : "Routine" };
    return { kind: "flex", label: "Flexible" };
  };
  type Row = { key: string; node: React.ReactNode };
  const rows: Row[] = [];
  let lastEnd: number | null = null;
  items.forEach((i, idx) => {
    // A free stretch of 30+ minutes between two things, still ahead of now.
    if (lastEnd !== null && i.at - lastEnd >= 30 * 60000 && i.at > nowMs) {
      const from = Math.max(lastEnd, nowMs);
      const mins = Math.round((i.at - from) / 60000);
      if (mins >= 30) {
        const t = timeParts(new Date(from).toISOString());
        rows.push({
          key: `gap${idx}`,
          node: (
            <li className="flex gap-3">
              <span className="num w-11 shrink-0 pt-3 text-right text-[13px] leading-tight text-dim md:w-14">{t.start}<span className="block text-[11px]">{t.meridiem}</span></span>
              <div className="flex min-h-11 flex-1 items-center rounded-[14px] border border-dashed border-[#3a3c42] px-3.5 text-[14px] text-muted">
                <span className="num">{dur(mins)} free</span>
              </div>
            </li>
          ),
        });
      }
    }
    lastEnd = Math.max(lastEnd ?? 0, i.end);
    const marker = i === current ? ("Now" as const) : i === next ? ("Next" as const) : null;
    if (i.type === "fixed") {
      const f = i.f;
      const kind: TimelineKind = f.fixed ? "fixed" : "recovery";
      const label = f.kind === "event" ? (f.label === "external" ? "External" : "Fixed") : f.fixed ? "Fixed routine" : "Routine";
      const area = areaOf(f.kind === "event" ? eventArea.get(f.id) : routineArea.get(f.id));
      rows.push({
        key: `f${f.id}${idx}`,
        node: <FixedEntryRow title={f.title} timeline={{ ...timeParts(f.start), range: range(f.start, f.end), minutes: minutesBetween(f.start, f.end), area, marker, kind, kindLabel: label }} />,
      });
    } else {
      const b = i.b;
      const { kind, label } = blockKind(b);
      const area = areaOf(b.tasks?.workspace_id ?? b.routines?.workspace_id);
      const plain = blocks[blockRows.indexOf(b)];
      const timeline: TimelineInfo = { ...timeParts(b.starts_at), range: range(b.starts_at, b.ends_at), minutes: minutesBetween(b.starts_at, b.ends_at), area, marker, kind, kindLabel: label };
      rows.push({
        key: b.id,
        node: <PlanBlockRow block={plain} time={`${formatTime(b.starts_at, zone)}–${formatTime(b.ends_at, zone)}`} canFocus={!focus} timeline={timeline} />,
      });
    }
  });

  // ---- Hero sentence, from the real plan. ----
  const openLeft = blocks.filter((b) => isOpen(b) && Date.parse(b.ends_at) > nowMs).length;
  const unmarkedPast = blocks.filter((b) => isOpen(b) && Date.parse(b.ends_at) <= nowMs).length;
  const lead =
    blocks.length === 0 && fixedToday.length === 0
      ? "Nothing is planned for today yet."
      : blocks.length > 0 && done === blocks.length
        ? "Every block today is done."
        : openLeft > 0
          ? `${plural(openLeft, "block")} left today.`
          : unmarkedPast > 0
            ? `${plural(unmarkedPast, "block")} still to mark.`
            : blocks.length === 0
              ? "No plan blocks yet today."
              : "No blocks left today.";

  // ---- Follow-through (last 7 days). ----
  const ft = followThrough(week);
  const ftWord = statusWord(ft.score);

  // ---- Deep work today: measured focus minutes by area. ----
  const byArea = new Map<string, number>();
  for (const s of (focusTodayRes.data ?? []) as unknown as FocusRow[]) {
    const mins = s.ended_at ? (s.actual_minutes ?? minutesBetween(s.started_at, s.ended_at)) : minutesBetween(s.started_at, now.toISO()!);
    const key = s.tasks?.workspace_id ?? "";
    byArea.set(key, (byArea.get(key) ?? 0) + mins);
  }
  const focusTotal = [...byArea.values()].reduce((s, m) => s + m, 0);
  const plannedWork = blocks.filter((b) => b.task_id).reduce((s, b) => s + minutesBetween(b.starts_at, b.ends_at), 0);
  const ringBase = Math.max(plannedWork, focusTotal);
  const ringParts = [...byArea.entries()]
    .filter(([, m]) => m > 0)
    .map(([id, m]) => ({ name: areaOf(id)?.name ?? "No area", color: areaOf(id)?.color ?? "#8b8e95", minutes: m }))
    .sort((a, b) => b.minutes - a.minutes);
  const ringSegments = ringParts.map((r, i) => {
    const len = (m: number) => (ringBase > 0 ? (m / ringBase) * RING_C : 0);
    return { ...r, len: len(r.minutes), offset: ringParts.slice(0, i).reduce((s, p) => s + len(p.minutes), 0) };
  });

  // ---- Blocks done today, with area dots. ----
  const doneList = blockRows.filter((b) => b.status === "done");
  const openList = blockRows.filter(isOpen);
  const preview = [...doneList.slice(-2), ...openList].slice(0, 3);

  const dateLine = `${now.toFormat("ccc, LLL d")} · ${now.toFormat("h:mm a")}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: full-bleed on phone, a rounded band on desktop. */}
      <section aria-labelledby="today-greeting" className="relative -mx-4 -mt-4 flex min-h-[420px] flex-col overflow-hidden md:mx-0 md:mt-0 md:min-h-[300px] md:rounded-[14px] md:border md:border-[#1d1e22]">
        <Image src="/img/horizon.jpg" alt="" fill priority sizes="(min-width: 1240px) 1240px, 100vw" className="object-cover object-[60%_50%]" />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.3)_0%,rgba(0,0,0,0)_30%,rgba(0,0,0,0.65)_70%,#060608_100%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0.35)_55%,rgba(0,0,0,0.15)_100%)]" />
        <div className="relative px-5 pt-5 md:hidden">
          <span className="glass num inline-flex h-10 items-center rounded-full px-4 text-[15px]">{dateLine}</span>
        </div>
        <div className="relative mt-auto flex flex-col gap-3.5 px-6 pb-5 md:flex-row md:flex-wrap md:items-end md:gap-7 md:px-9 md:pb-9">
          <Pebble size={112} mood="idle" glow float />
          <div className="flex min-w-0 flex-col gap-2.5 md:flex-1">
            <span className="num hidden text-base text-[#d8d9dc] md:block">{formatDay(today, zone)} · {now.toFormat("h:mm a")}</span>
            <h1 id="today-greeting" className="gh m-0 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[60px] md:leading-none md:tracking-[-0.04em]">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="m-0 text-[18px] text-[#d8d9dc] md:text-[19px]">
              {lead}
              {current && (
                <> {titleOf(current)} is on now, until <span className="num text-text">{formatTime(new Date(current.end).toISOString(), zone)}</span>.</>
              )}
              {!current && next && (
                <> {titleOf(next)} is next at <span className="num text-text">{formatTime(new Date(next.at).toISOString(), zone)}</span>.</>
              )}
            </p>
          </div>
          {/* One set of actions: under the greeting on phone, top-right of the band on desktop. */}
          <div className="flex flex-wrap items-start gap-2 pt-1 md:absolute md:top-6 md:right-8 md:justify-end md:pt-0">
            <ActionButton className="btn glass" action={planDayAction} showResult>Re-plan today</ActionButton>
            <RecoveryButton className="btn glass" />
          </div>
        </div>
      </section>

      {/* Main column + Navi's panel. On phone both columns dissolve into one ordered list. */}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:gap-5">
        <div className="contents md:flex md:min-w-0 md:flex-[999_1_520px] md:flex-col md:gap-5">
          {focus && (
            <div className="order-1 md:order-none">
              <FocusCard session={{ id: focus.id, started_at: focus.started_at, planned_minutes: focus.planned_minutes, task_title: focus.tasks?.title ?? null }} />
            </div>
          )}

          {(inboxCount > 0 || approvalsCount > 0) && (
            <div className="lg lg-ask order-2 flex flex-wrap items-center gap-3 p-4 md:order-none">
              <Pebble size={40} mood="ask" />
              <p className="m-0 min-w-0 flex-1 basis-[13rem] text-[15px]">
                {approvalsCount > 0 ? "Navi is waiting for your OK before acting." : "Navi found things to add. Nothing is added until you review it."}
              </p>
              <div className="flex flex-wrap gap-2">
                {inboxCount > 0 && <Link href="/inbox" className="btn btn-sm">Review inbox ({inboxCount})</Link>}
                {approvalsCount > 0 && <Link href="/activity" className="btn btn-sm btn-primary">Approvals waiting ({approvalsCount})</Link>}
              </div>
            </div>
          )}

          {unmarkedYesterday > 0 && (
            <p className="notice notice-warn order-3 m-0 flex flex-wrap items-center gap-2 text-sm md:order-none">
              <span className="flex-1">{unmarkedYesterday} block{unmarkedYesterday === 1 ? "" : "s"} from yesterday {unmarkedYesterday === 1 ? "isn't" : "aren't"} marked yet, so yesterday's review can't count {unmarkedYesterday === 1 ? "it" : "them"} fairly.</span>
              <Link href={`/review?date=${yesterday}`} className="btn btn-sm">Mark yesterday</Link>
            </p>
          )}

          {eveningNow && (
            <p className="notice order-3 m-0 flex flex-wrap items-center gap-2 text-sm md:order-none">
              <span className="flex-1">Evening review: say how today went, then plan tomorrow.</span>
              <Link href={`/review?date=${today}`} className="btn btn-sm">Review today</Link>
            </p>
          )}

          {/* Follow-through, deep work, blocks done. */}
          <div className="order-5 grid grid-cols-2 gap-3 md:order-none md:grid-cols-3 md:gap-3.5">
            <Link
              href="/insights"
              className="lg col-span-2 flex flex-col gap-4 p-5 no-underline md:col-span-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] text-muted">Follow-through</span>
                  {ft.score === null ? (
                    <span className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">Not enough days yet</span>
                  ) : (
                    <span className="gh num text-[64px] font-semibold leading-none tracking-[-0.045em] md:text-[56px]">{ft.score}</span>
                  )}
                </div>
                <span className={`pill-status shrink-0 ${TONE_PILL[ftWord.tone]}`}>
                  <span className={`dot h-1.5 w-1.5 ${TONE_DOT[ftWord.tone]}`} aria-hidden />
                  {ft.score === null ? "Last 7 days" : ftWord.word}
                </span>
              </div>
              {ft.score === null && <span className="-mt-2 text-[13px] text-muted">Keep marking blocks; the score appears once a few days are recorded.</span>}
              <div className="flex flex-col gap-3">
                {ft.parts.map((p) => {
                  const w = statusWord(p.value);
                  const filled = p.value === null ? 0 : Math.round(p.value / 10);
                  return (
                    <div key={p.key} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-2 text-[14px]">
                        <span className="text-muted">{p.label}</span>
                        <span className="num">
                          {p.value === null ? <span className="text-muted">No data</span> : <>{p.value} <span className={TONE_TEXT[w.tone]}>{w.word}</span></>}
                        </span>
                      </div>
                      <div className="grid grid-cols-10 gap-[3px]" aria-hidden>
                        {Array.from({ length: 10 }, (_, i) => (
                          <span key={i} className={`h-1.5 rounded-[2px] ${i >= filled ? "bg-[#1d1e22]" : i < 2 ? "bg-clash" : i < 5 ? "bg-recovery" : "bg-focus"}`} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Link>

            <div className="card flex min-h-[196px] flex-col justify-between gap-3 p-[18px]">
              <span className="text-[15px] text-muted">Deep work today</span>
              <svg width="62" height="62" viewBox="0 0 64 64" role="img" aria-label={ringParts.length ? `${ringParts.map((r) => `${r.name} ${r.minutes} minutes`).join(", ")}${plannedWork ? `, of ${dur(plannedWork)} planned` : ""}` : "No focus time yet today"}>
                <circle cx="32" cy="32" r="26" fill="none" stroke="#1d1e22" strokeWidth="8" />
                {ringSegments.map((r) => (
                  <circle key={r.name} cx="32" cy="32" r="26" fill="none" stroke={r.color} strokeWidth="8" strokeDasharray={`${r.len.toFixed(1)} ${RING_C.toFixed(1)}`} strokeDashoffset={(-r.offset).toFixed(1)} transform="rotate(-90 32 32)" />
                ))}
              </svg>
              <div className="flex flex-col">
                <span className="num text-[32px] font-semibold leading-tight tracking-[-0.03em]">{focusTotal ? dur(focusTotal) : "0m"}</span>
                <span className="text-[13px] text-muted">{plannedWork ? `of ${dur(plannedWork)} planned` : "No work blocks planned"}</span>
              </div>
            </div>

            <div className="card flex min-h-[196px] flex-col justify-between gap-3 p-[18px]">
              <span className="text-[15px] text-muted">Blocks done</span>
              {preview.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px]">
                  {preview.map((b) => {
                    const a = areaOf(b.tasks?.workspace_id ?? b.routines?.workspace_id);
                    const isDone = b.status === "done";
                    return (
                      <li key={b.id} className={`flex min-w-0 items-center gap-2 ${isDone ? "text-dim line-through" : ""}`}>
                        <span className="dot" style={{ background: a?.color ?? "#8b8e95" }} aria-hidden />
                        <span className="truncate">{b.title}</span>
                        {isDone && <span className="sr-only">(done)</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span className="text-[13px] text-muted">No plan blocks today yet.</span>
              )}
              <span className="num text-[32px] font-semibold leading-tight tracking-[-0.03em]">
                {done}<span className="text-dim">/{blocks.length}</span>
              </span>
            </div>
          </div>

          <section className="card order-6 flex flex-col gap-3 p-5 md:order-none md:p-[22px]" aria-labelledby="plan-title">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="plan-title" className="h2 text-[22px]">Today&apos;s plan</h2>
              {blocks.length > 0 && <span className="muted num text-sm">{done}/{blocks.length} done</span>}
              <span className="hidden items-center gap-3.5 text-[13px] text-muted lg:flex" aria-hidden>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#f0f0f0]" />Fixed</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-flex" />Flexible</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-recovery" />Routine / rest</span>
              </span>
              <Link href="/planner" className="btn btn-ghost btn-sm ml-auto text-muted">Week view</Link>
            </div>
            {blocks.length === 0 && (
              <p className="muted m-0 text-sm">
                No flexible work is planned for today yet. Press “Re-plan today”, or tell Navi what you want to get done.
                {profile.availability.length === 0 && " Navi doesn't know when you're free yet, so set your availability in Settings or tell Navi."}
              </p>
            )}
            {rows.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {rows.map((r) => (
                  <Fragment key={r.key}>{r.node}</Fragment>
                ))}
              </ul>
            )}
          </section>

          <Link href="/insights?report=1" className="order-9 relative flex h-[190px] flex-col justify-end overflow-hidden rounded-[14px] border border-[#1d1e22] no-underline md:order-none">
            <Image src="/img/wall-dawn.jpg" alt="" fill sizes="(min-width: 768px) 800px, 100vw" className="object-cover" />
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.8))]" />
            <span className="relative flex items-end justify-between gap-3 p-5">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] uppercase tracking-[0.08em] text-[#d8d9dc]">Weekly report</span>
                <span className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-text md:text-[24px]">Your last 7 days</span>
                <span className="num text-[14px] text-[#d8d9dc]">
                  {plural(week.tasksCompleted, "task")} done · {dur(week.focusMinutes)} focus
                </span>
              </span>
              <span className="inline-flex h-11 shrink-0 items-center rounded-full bg-[#f2f2f2] px-[18px] text-[15px] font-semibold whitespace-nowrap text-[#060608]">Open</span>
            </span>
          </Link>
        </div>

        <div className="contents md:flex md:min-w-0 md:max-w-[420px] md:flex-[1_1_340px] md:flex-col md:gap-5">
          {unreadBriefing && (
            <section aria-labelledby="briefing-title" className="lg order-4 flex flex-col overflow-hidden md:order-none">
              <div className="flex items-center gap-2.5 border-b border-[#1d1e22] px-5 pt-4 pb-3.5">
                <Pebble size={26} mood="idle" />
                <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-muted">{BRIEFING_KIND[unreadBriefing.kind] ?? unreadBriefing.kind}</span>
                <span className="num ml-auto text-[13px] text-dim">Written {formatTime(unreadBriefing.created_at, zone)}</span>
              </div>
              <div className="flex flex-col gap-2 px-5 pt-4">
                <h2 id="briefing-title" className="h2 text-[19px]">{unreadBriefing.title}</h2>
                <p className="m-0 whitespace-pre-wrap text-[16px] leading-[1.55] text-[#e6e7ea] md:text-[17px]">{unreadBriefing.body}</p>
              </div>
              <div className="flex flex-wrap gap-2 p-5 pt-4">
                <ActionButton className="btn btn-sm btn-primary" action={markBriefingReadAction} args={[unreadBriefing.id]}>Got it</ActionButton>
                {unreadBriefing.kind === "evening" && <Link href={`/review?date=${unreadBriefing.local_date}`} className="btn btn-sm">Open evening review</Link>}
                {unreadBriefing.kind === "weekly" && <Link href="/insights" className="btn btn-sm">Plan next week</Link>}
                <Link href="/insights" className="btn btn-sm btn-ghost text-muted">All reviews</Link>
              </div>
            </section>
          )}

          <section className="card order-7 md:order-none" aria-labelledby="due-title">
            <div className="flex items-center gap-2">
              <h2 id="due-title" className="h2">Due soon</h2>
              <Link href="/tasks" className="btn btn-ghost btn-sm ml-auto text-muted">All tasks</Link>
            </div>
            {dueSoon.length === 0 ? (
              <p className="muted mt-2 mb-0 text-sm">Nothing due in the next 3 days.</p>
            ) : (
              <ul className="m-0 mt-2 flex list-none flex-col p-0">
                {dueSoon.map((t) => {
                  const overdue = t.due_at! < now.toISO()!;
                  const area = areaOf(t.workspace_id);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border py-3 last:border-0">
                      <span className="flex min-w-0 flex-1 basis-[12rem] flex-col">
                        <span className="break-words">{t.title}</span>
                        <span className={`flex flex-wrap items-center gap-x-1.5 text-xs ${overdue ? "text-clash" : "muted"}`}>
                          {area && (
                            <>
                              <span className="dot h-1.5 w-1.5" style={{ background: area.color ?? "#8b8e95" }} aria-hidden />
                              <span className="muted">{area.name}</span>
                              <span aria-hidden className="muted">·</span>
                            </>
                          )}
                          <span>{overdue ? "overdue · " : ""}due {formatDue(t.due_at!, zone)}{t.due_is_hard ? " (hard)" : ""}</span>
                        </span>
                      </span>
                      <span className="flex gap-1">
                        {!focus && <ActionButton action={startFocusAction} args={[{ task_id: t.id, planned_minutes: t.estimate_minutes }]}>Focus</ActionButton>}
                        <ActionButton action={completeTaskAction} args={[t.id]}>Done</ActionButton>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import { awakeSpan, dayFrom, loadSources, wakeBed, zoneHelpers, type DayItem } from "@/server/day";
import { myDayHeadline, weekHeadline, type Line } from "@/lib/sentences";
import { freeStretches, isLongEvent, itemLooks, loadOpenWork, plannedSpans, roundUp5, weekSummary } from "@/server/day-view";
import { findFits, gridHours, weekOf, type FitCandidate } from "@/lib/day-layout";
import { ActionButton } from "@/components/action-button";
import { RecoveryButton } from "@/components/recovery";
import { DayTimeline, Legend, type TimelineEntry } from "@/components/day/timeline";
import { CalendarGrid, type CalendarDay } from "@/components/day/calendar";
import { PlaceIt } from "@/components/day/day-actions";
import { planDayAction, planWeekAction } from "../actions";
import { AddCommitment } from "./add-commitment";
import { plannerV2 } from "@/lib/planner-flag";
import { myDayV2 } from "@/server/planner/my-day-v2";
import { Assumptions, ProposedPlan } from "@/components/day/plan-v2";

export const metadata = { title: "My day · Navi" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type Search = { date?: string; start?: string; view?: string; span?: string };

function Sentence({ line }: { line: Line }) {
  return (
    <>
      {line.map((s, i) => (
        <span key={i} className={s.strong ? "text-text" : "text-[#8E8E96]"}>{s.text}</span>
      ))}
    </>
  );
}

function href(p: { date: string; view?: "calendar" | null; span?: "day" | "week" | null }) {
  const q = new URLSearchParams({ date: p.date });
  if (p.view === "calendar") q.set("view", "calendar");
  if (p.view === "calendar" && p.span === "day") q.set("span", "day");
  return `/planner?${q.toString()}`;
}

const chev = (dir: "l" | "r") => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={dir === "l" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} /></svg>
);
const roundBtn = "flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-[#C8C8CE] hover:bg-white/[0.1] hover:text-text";
const pillBtn = "flex h-9 items-center rounded-full bg-white/[0.06] px-3.5 text-[14px] text-[#C8C8CE] hover:bg-white/[0.1] hover:text-text";

function Segmented({ label, items }: { label: string; items: { label: string; href: string; on: boolean; strong?: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex rounded-[19px] bg-white/[0.06] p-[3px]">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          aria-current={i.on ? "page" : undefined}
          className={`flex h-8 items-center rounded-2xl px-4 text-[14px] ${i.on ? (i.strong ? "bg-text font-semibold text-black" : "bg-white/[0.14] font-semibold text-text") : "text-[#C8C8CE] hover:text-text"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * My day: the day as a timeline (default), or the calendar (week by default,
 * owner decision 2026-11-07). Every headline comes from the sentence builders
 * (src/lib/sentences.ts), so it only says what the rows say.
 */
export default async function MyDayPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const sp = await searchParams;
  const now = DateTime.now().setZone(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const requested = [sp.date, sp.start].find((d) => d && ISO.test(d) && DateTime.fromISO(d, { zone }).isValid);
  const date = requested ?? today;
  const view: "timeline" | "calendar" = sp.view === "calendar" ? "calendar" : "timeline";
  const span: "day" | "week" = view === "calendar" && sp.span === "day" ? "day" : "week";
  const week = weekOf(date, zone);
  const z = zoneHelpers(zone);

  const [src, focusRes, { openTasks, scheduled, steps }] = await Promise.all([
    loadSources(ctx, week[0], week[6]),
    ctx.db.from("focus_sessions").select("id").is("ended_at", null).maybeSingle(),
    loadOpenWork(ctx, today),
  ]);

  // Look, colour and space of each row, and what counts as planned: shared with the phone app (src/server/day-view.ts).
  const toEntry: (i: DayItem) => TimelineEntry = itemLooks(src);
  const wb = wakeBed(profile);
  const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  // ---- shared header bits
  const shiftDays = (n: number) => DateTime.fromISO(date, { zone }).plus({ days: n }).toISODate()!;
  const viewToggle = (
    <Segmented
      label="View"
      items={[
        { label: "Timeline", href: href({ date }), on: view === "timeline", strong: true },
        { label: "Calendar", href: href({ date, view: "calendar" }), on: view === "calendar", strong: true },
      ]}
    />
  );

  if (view === "calendar") {
    const days = span === "day" ? [date] : week;
    const step = span === "day" ? 1 : 7;
    const dayData = days.map((d) => dayFrom(src, d));
    const longEvent = isLongEvent;
    const dueByDay = new Map<string, typeof openTasks>();
    for (const t of openTasks) {
      if (!t.due_at) continue;
      const d = DateTime.fromISO(t.due_at, { zone }).toISODate()!;
      if (!days.includes(d)) continue;
      dueByDay.set(d, [...(dueByDay.get(d) ?? []), t]);
    }
    // All-day Canvas events (holidays, "no class") don't block planning time, so they
    // aren't events rows; they show in the all-day strip from the imported items.
    const { data: allDayRows } = await ctx.db
      .from("external_items")
      .select("id,title,all_day_date,course:external_courses(excluded)")
      .eq("kind", "event")
      .eq("all_day", true)
      .eq("state", "active")
      .eq("hidden", false)
      .neq("source_status", "cancelled")
      .gte("all_day_date", days[0])
      .lte("all_day_date", days[days.length - 1]);
    const externalAllDay = new Map<string, { id: string; title: string }[]>();
    for (const r of (allDayRows ?? []) as unknown as { id: string; title: string; all_day_date: string; course: { excluded: boolean } | null }[]) {
      if (r.course?.excluded) continue;
      externalAllDay.set(r.all_day_date, [...(externalAllDay.get(r.all_day_date) ?? []), r]);
    }
    const calDays: CalendarDay[] = dayData.map((dd) => ({
      date: dd.date,
      entries: dd.items.filter((i) => !longEvent(i)).map(toEntry),
      allDay: [
        ...dd.items.filter(longEvent).map((i) => {
          const e = toEntry(i);
          return { key: `e${i.id}`, label: i.title, kind: "event" as const, color: e.color, href: href({ date: dd.date }) };
        }),
        ...(dueByDay.get(dd.date) ?? []).map((t) => ({ key: `t${t.id}`, label: t.title, kind: "due" as const, color: "", href: `/tasks?open=${t.id}` })),
        ...(externalAllDay.get(dd.date) ?? []).map((x) => ({ key: `x${x.id}`, label: x.title, kind: "event" as const, color: "#C8C8CE", href: "/settings/canvas" })),
      ],
    }));
    const allMinutes = calDays.flatMap((d) => d.entries.map((e) => ({ start: z.minuteOfDay(e.startMs), end: z.minuteOfDay(e.endMs) || 24 * 60 })));
    const hours = gridHours(wb ? { wakeMinute: toMinute(wb.wake), bedMinute: toMinute(wb.bed) } : null, allMinutes);
    const headline =
      span === "week"
        ? weekHeadline(weekSummary(dayData, zone))
        : myDayHeadline(plannedSpans(dayData[0].items.filter((i) => !longEvent(i))), awakeSpan(profile, date, zone), z.fmtHour, z.minuteOfDay);
    const first = DateTime.fromISO(days[0], { zone });
    const last = DateTime.fromISO(days[days.length - 1], { zone });
    const title = span === "day" ? (date === today ? "Today" : first.toFormat("cccc")) : week.includes(today) ? "This week" : `Week of ${first.toFormat("LLL d")}`;
    const range = span === "day" ? first.toFormat("LLLL d") : `${first.toFormat("LLL d")} – ${last.toFormat(first.month === last.month ? "d" : "LLL d")}`;
    const unit = span === "day" ? "day" : "week";

    return (
      <div className="flex flex-col pt-1">
        <header className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[32px] font-bold tracking-[-0.03em]">{title}</h1>
          <span className="ml-1 text-[15px] text-dim">{range}</span>
          <span className="flex-1" />
          <Link href={href({ date: shiftDays(-step), view: "calendar", span })} className={roundBtn} aria-label={`Previous ${unit}`}>{chev("l")}</Link>
          <Link href={href({ date: shiftDays(step), view: "calendar", span })} className={roundBtn} aria-label={`Next ${unit}`}>{chev("r")}</Link>
          <Link href={href({ date: today, view: "calendar", span })} className={pillBtn}>Today</Link>
          <Segmented
            label="Range"
            items={[
              { label: "Day", href: href({ date, view: "calendar", span: "day" }), on: span === "day" },
              { label: "Week", href: href({ date, view: "calendar" }), on: span === "week" },
            ]}
          />
          {viewToggle}
        </header>
        <p className="mt-2 text-[17px] font-medium tracking-[-0.01em]"><Sentence line={headline} /></p>
        <div className="mt-[18px]">
          <CalendarGrid days={calDays} zone={zone} today={today} nowMs={nowMs} hours={hours} />
        </div>
      </div>
    );
  }

  // ---- Timeline
  const day = dayFrom(src, date);
  const entries = day.items.map(toEntry);
  const isToday = date === today;
  const isPast = date < today;
  const awake = awakeSpan(profile, date, zone);
  const headline = myDayHeadline(plannedSpans(day.items), awake, z.fmtHour, z.minuteOfDay);

  // Free stretches still ahead (whole day for future days), between everything on the line.
  const v2 = plannerV2(profile.preferences) ? await myDayV2(ctx, date, src.blocks, isToday ? roundUp5(nowMs) : 0) : null;
  const busySpans = entries.map((e) => ({ start: e.startMs, end: e.endMs }));
  // Planner v2 (B4): the same free time the planner uses (confirmed or assumed, never unknown), not a 7 AM–11 PM guess.
  const gaps = freeStretches({ date, zone, nowMs, isToday, isPast, awake, busy: busySpans, capacity: v2 ? v2.capacity : null });
  const unscheduled = openTasks.filter((t) => !scheduled.has(t.id));
  const candidates: FitCandidate[] = unscheduled.map((t) => ({ id: t.id, title: t.title, estimate: t.estimate_minutes, dueMs: t.due_at ? Date.parse(t.due_at) : null }));
  const fits = findFits(gaps, candidates);

  // Week strip: each day with dots for the spaces it touches.
  const strip = week.map((d) => {
    const items = dayFrom(src, d).items;
    const colors = [...new Set(items.map((i) => toEntry(i)).filter((e) => e.spaceName).map((e) => e.color))].slice(0, 3);
    return { d, colors, dt: DateTime.fromISO(d, { zone }) };
  });

  const needsTime = unscheduled.slice(0, 5);
  const dayWord = isToday ? "today" : `on ${DateTime.fromISO(date, { zone }).toFormat("cccc")}`;
  const dueWord = (iso: string) => {
    const d = DateTime.fromISO(iso, { zone });
    return d.toISODate() === today ? "today" : d.toISODate() === shiftDays(1) && isToday ? "tomorrow" : d.toFormat("cccc");
  };

  return (
    <div className="flex flex-col pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="This week" className="flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1">
          {strip.map(({ d, colors, dt }) => {
            const on = d === date;
            const isT = d === today;
            return (
              <Link
                key={d}
                href={href({ date: d })}
                aria-current={on ? "date" : undefined}
                className={`relative flex h-16 w-[54px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[20px] ${isT ? "bg-text text-black" : "bg-white/[0.05] text-[#C8C8CE] hover:bg-white/[0.08]"} ${on && !isT ? "ring-1 ring-white/40" : ""}`}
              >
                <span className="sr-only">{`${dt.toFormat("cccc, LLLL d")}${isT ? ", today" : ""}`}</span>
                <span className="text-[12px] opacity-75" aria-hidden="true">{dt.toFormat("ccc")}</span>
                <span className="text-[17px] font-semibold" aria-hidden="true">{dt.toFormat("d")}</span>
                <span className="flex h-1 gap-0.5" aria-hidden="true">{colors.map((c) => <span key={c} className="h-1 w-1 rounded-full" style={{ background: c }} />)}</span>
              </Link>
            );
          })}
        </nav>
        <span className="flex-1" />
        <Link href={href({ date: shiftDays(-1) })} className={roundBtn} aria-label="Previous day">{chev("l")}</Link>
        <Link href={href({ date: shiftDays(1) })} className={roundBtn} aria-label="Next day">{chev("r")}</Link>
        {!isToday && <Link href={href({ date: today })} className={pillBtn}>Today</Link>}
        {viewToggle}
      </div>

      <div className="mt-[22px] flex flex-col gap-1.5">
        <h1 className="text-[32px] font-bold tracking-[-0.03em]">
          {DateTime.fromISO(date, { zone }).toFormat("cccc")}
          {!isToday && <span className="ml-2 text-[17px] font-medium text-dim">{DateTime.fromISO(date, { zone }).toFormat("LLLL d")}</span>}
        </h1>
        <p className="text-[17px] font-medium tracking-[-0.01em]"><Sentence line={headline} /></p>
      </div>

      <div className="mt-[18px] flex flex-col gap-7 lg:flex-row">
        <section aria-label="Timeline" className="min-w-0 flex-1">
          <h2 className="sr-only">Timeline</h2>
          {v2 && !isPast && (v2.proposals.length > 0 || v2.assumptions.length > 0 || v2.unknown.length > 0) && (
            <div className="mb-4 flex flex-col gap-2.5">
              {v2.proposals.map((p) => <ProposedPlan key={p.id} {...p} />)}
              <Assumptions date={date} items={v2.assumptions} />
              {v2.unknown.length > 0 && (
                <p className="px-1 text-[13px] text-dim">
                  Navi doesn&apos;t know if you&apos;re free {v2.unknown.map((u) => u.text).join(", ")}, so it won&apos;t plan there. Tell Navi if you are.
                </p>
              )}
            </div>
          )}
          <DayTimeline entries={entries} fits={fits} zone={zone} nowMs={nowMs} isToday={isToday} isPast={isPast} focusOpen={!!focusRes.data} v2={v2 ? { date } : null} />
          {day.untimed.length > 0 && (
            <p className="mt-3 text-[13px] text-dim">Any time: {day.untimed.map((e) => e.title).join(", ")} (routines with no set time)</p>
          )}
        </section>

        <aside className="flex w-full flex-col gap-2.5 lg:w-[290px] lg:shrink-0" aria-labelledby="needs-time">
          <h2 id="needs-time" className="px-1 pb-0.5 pt-2 text-[13px] font-semibold text-[#8E8E96]">Still needs a time</h2>
          {needsTime.length === 0 ? (
            <p className="px-1 text-[14px] text-dim">Everything open has a time.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {needsTime.map((t) => {
                const n = steps.get(t.id) ?? 0;
                return (
                  <li key={t.id} className="flex items-start gap-2 rounded-[18px] border border-white/[0.07] bg-white/[0.05] px-3.5 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Link href={`/tasks?open=${t.id}`} className="font-semibold hover:underline">{t.title}</Link>
                      <span className="text-[13px] text-[#8E8E96]">
                        {t.estimate_minutes ? `${t.estimate_minutes} min` : n ? `${n} step${n === 1 ? "" : "s"}` : "no estimate"}
                        {" · "}
                        {t.due_at ? <>before <span className="text-due">{dueWord(t.due_at)}</span></> : "whenever"}
                      </span>
                    </div>
                    {!isPast && <PlaceIt title={t.title} dayLabel={dayWord} />}
                  </li>
                );
              })}
            </ul>
          )}
          {!isPast && needsTime.length > 0 && <p className="px-1 text-[12.5px] text-dim">Put one in a free stretch, or ask Navi to place it.</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!isPast && <ActionButton className="btn btn-sm" action={planDayAction} args={[date]} showResult>Plan {isToday ? "my day" : "this day"}</ActionButton>}
            {!isPast && <ActionButton className="btn btn-sm btn-ghost" action={planWeekAction} args={[date]} showResult>Plan next 7 days</ActionButton>}
            {isToday && <RecoveryButton className="btn btn-sm btn-ghost" />}
          </div>
          {profile.availability.length === 0 && !v2 && (
            <p className="text-[13px] text-dim">
              Navi won&apos;t invent free time. Set when you&apos;re available in <Link className="underline" href="/settings">Settings</Link> so it can plan flexible work.
            </p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer px-1 text-[13px] text-dim hover:text-text">Add a fixed commitment</summary>
            <div className="mt-2"><AddCommitment zone={zone} defaultDate={date} /></div>
          </details>
          <div className="mt-3"><Legend /></div>
        </aside>
      </div>
    </div>
  );
}

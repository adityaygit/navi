import { DateTime } from "luxon";
import type { DayItem } from "@/server/day";
import type { PlanBlock } from "@/lib/types";
import type { Fit } from "@/lib/day-layout";
import { partOf, hoursText, type DayPart } from "@/lib/sentences";
import { BlockOutcome, PutItThere, StartBlock } from "./day-actions";
import { SkipSession } from "./plan-v2";

export type Kind = "fixed" | "flex" | "routine";
export type TimelineEntry = DayItem & { look: Kind; color: string; spaceName: string | null; block: PlanBlock | null };

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "item"; key: string; at: number; e: TimelineEntry; now: boolean; highlight: boolean }
  | { type: "free"; key: string; at: number; label: string; now: boolean; fit: Fit | null };

/** "30 free minutes", "1½ hours free". */
export function freeText(minutes: number): string {
  return minutes < 60 ? `${minutes} free minute${minutes === 1 ? "" : "s"}` : `${hoursText(minutes)} free`;
}

const PART_LABEL: Record<DayPart, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

/**
 * The day as a vertical line: what's fixed, what you set aside, and the free
 * stretches between (with the one task that fits, if any). Built only from
 * the day's rows; nothing here is invented.
 */
export function DayTimeline({
  entries,
  fits,
  zone,
  nowMs,
  isToday,
  isPast,
  focusOpen,
  v2,
}: {
  /** Planner v2: blocks in assumed time are drawn dashed, and an event's session can be skipped. */
  v2?: { date: string } | null;
  entries: TimelineEntry[];
  /** Free stretches of 30+ minutes still ahead, with the task that fits each. */
  fits: Fit[];
  zone: string;
  nowMs: number;
  isToday: boolean;
  isPast: boolean;
  focusOpen: boolean;
}) {
  const t = (ms: number) => DateTime.fromMillis(ms, { zone });
  const clock = (ms: number) => t(ms).toFormat("h:mm");
  const full = (ms: number) => t(ms).toFormat("h:mm a");
  const minuteOfDay = (ms: number) => t(ms).hour * 60 + t(ms).minute;
  const isOpen = (e: TimelineEntry) => !e.block || e.block.status === "planned" || e.block.status === "in_progress";

  const current = isToday ? (entries.find((e) => e.startMs <= nowMs && e.endMs > nowMs && isOpen(e)) ?? null) : null;
  // The block to start next: the current or next open plan block with a task.
  const startable = isToday ? (entries.find((e) => e.block?.task_id && isOpen(e) && e.endMs > nowMs) ?? null) : null;

  const rows: Row[] = [
    ...entries.map((e) => ({ type: "item" as const, key: `${e.kind}${e.id}${e.startMs}`, at: e.startMs, e, now: e === current, highlight: e === startable })),
    ...fits.map((f) => ({ type: "free" as const, key: `gap${f.gap.start}`, at: f.gap.start, label: "", now: false, fit: f })),
  ];
  // "Now" when nothing is happening: a free row at the current time.
  if (isToday && !current) {
    const next = entries.find((e) => e.startMs > nowMs);
    const fitNow = fits.find((f) => f.gap.start <= nowMs + 60000 && f.gap.end > nowMs);
    if (fitNow) {
      const row = rows.find((r) => r.type === "free" && r.fit === fitNow) as Extract<Row, { type: "free" }>;
      row.now = true;
      row.at = nowMs;
    } else {
      rows.push({ type: "free", key: "now", at: nowMs, label: next ? `Now — free until ${full(next.startMs)}` : "Now — nothing else planned today", now: true, fit: null });
    }
  }
  rows.sort((a, b) => ("at" in a ? a.at : 0) - ("at" in b ? b.at : 0));
  const withHeaders: Row[] = [];
  let part: DayPart | null = null;
  for (const r of rows) {
    if (r.type === "header") continue;
    const p = partOf(minuteOfDay(r.at));
    if (p !== part) {
      withHeaders.push({ type: "header", key: `h${p}`, label: PART_LABEL[p] });
      part = p;
    }
    withHeaders.push(r);
  }

  if (entries.length === 0 && fits.length === 0) {
    return <p className="rounded-[18px] border border-dashed border-white/15 px-5 py-8 text-center text-[15px] text-dim">Nothing planned{isPast ? " on this day" : " yet"}.</p>;
  }

  return (
    <ol className="relative flex flex-col" aria-label="Timeline">
      <span aria-hidden="true" className="absolute bottom-0 left-[83px] top-[30px] w-0.5 bg-white/[0.07]" />
      {withHeaders.map((r) => {
        if (r.type === "header") {
          return (
            <li key={r.key} className="flex h-[34px] items-center pl-1 text-[13px] font-semibold text-[#8E8E96]">
              <h3>{r.label}</h3>
            </li>
          );
        }
        if (r.type === "free") {
          const f = r.fit;
          const freeFrom = r.now ? nowMs : (f?.gap.start ?? r.at);
          const freeMinutes = f ? Math.round((f.gap.end - freeFrom) / 60000) : 0;
          const label = f
            ? `${r.now ? "Now — " : ""}${freeText(freeMinutes)}${f.task ? ` — “${f.task.title}” fits here.` : r.now ? ` until ${full(f.gap.end)}` : ""}`
            : r.label;
          return (
            <li key={r.key} className="flex min-h-11 items-center" aria-current={r.now ? "time" : undefined}>
              <span className={`w-16 shrink-0 text-[13px] tabular-nums ${r.now ? "font-semibold text-text" : "text-[#8E8E96]"}`}>{clock(freeFrom)}</span>
              <span className="relative z-[1] flex w-10 shrink-0 justify-center" aria-hidden="true">
                <span className={`h-3 w-3 rounded-full ${r.now ? "bg-text shadow-[0_0_0_5px_rgba(255,255,255,0.12)]" : "bg-white/[0.18]"}`} />
              </span>
              <span className="ml-3.5 flex-1 py-2 text-[14px] text-[#8E8E96]">{label}</span>
              {f?.task && !isPast && <PutItThere taskId={f.task.id} title={f.task.title} startsAt={new Date(Math.max(freeFrom, f.gap.start)).toISOString()} minutes={f.task.estimate!} />}
            </li>
          );
        }
        const e = r.e;
        const open = isOpen(e);
        const done = e.block?.status === "done";
        const finished = !open;
        const minutes = Math.round((e.endMs - e.startMs) / 60000);
        const sub =
          e.kind === "event"
            ? `Until ${full(e.endMs)}${e.spaceName ? ` · ${e.spaceName}` : ""}`
            : `${minutes} min${e.spaceName ? ` · ${e.spaceName}` : ""}${finished && e.block ? ` · ${e.block.status === "partial" ? "partly done" : e.block.status.replace("_", " ")}` : ""}`;
        const assumed = !!v2 && e.block?.basis === "inferred" && open;
        const bubble =
          e.look === "fixed"
            ? { background: `color-mix(in srgb, ${e.color} 85%, transparent)`, color: "#000" }
            : { border: `1.5px ${e.look === "routine" || assumed ? "dashed" : "solid"} ${e.color}`, color: e.color };
        return (
          <li key={r.key} className={`flex items-center ${r.highlight ? "min-h-[70px]" : "min-h-14"} ${finished ? "opacity-45" : ""}`} aria-current={r.now ? "time" : undefined}>
            <span className="w-16 shrink-0 text-[13px] tabular-nums text-[#8E8E96]">{clock(e.startMs)}</span>
            <span className="relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={bubble} aria-hidden="true">
              {done ? "✓" : ""}
            </span>
            <div className={`my-1 ml-3.5 flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-[18px] border px-3.5 py-2.5 ${r.highlight || r.now ? "border-[color-mix(in_srgb,var(--navi-text)_25%,transparent)] bg-[color-mix(in_srgb,var(--navi-text)_7%,transparent)]" : "border-transparent bg-white/[0.04]"}`}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`text-[15px] font-semibold ${done ? "line-through" : ""}`}>
                  <span className="sr-only">{`${full(e.startMs)} to ${full(e.endMs)}: `}</span>
                  {e.title}
                  {r.now && <span className="ml-2 rounded-full bg-text px-2 py-0.5 align-middle text-[11px] font-semibold text-black">Now</span>}
                </span>
                <span className="text-[13px] text-[#8E8E96]">
                  {sub}
                  {assumed && " · in time Navi assumed is free"}
                  {v2 && e.block?.pinned && open && " · pinned"}
                  <span className="sr-only">{e.look === "fixed" ? " (fixed)" : e.look === "routine" ? " (routine)" : " (flexible)"}</span>
                </span>
              </div>
              {v2 && e.kind === "event" && !isPast && e.recurring && <SkipSession eventId={e.id} date={v2.date} title={e.title} />}
              {e.block && (
                <span className="ml-auto flex items-center gap-3">
                  {r.highlight && open && !focusOpen && e.block.task_id && <StartBlock blockId={e.block.id} taskId={e.block.task_id} minutes={Math.max(5, Math.min(480, minutes))} primary />}
                  {(isToday || isPast) && <BlockOutcome blockId={e.block.id} title={e.title} open={open} />}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Legend() {
  return (
    <ul className="flex flex-col gap-2.5 rounded-[20px] bg-white/[0.035] px-4 py-3.5 text-[13px] text-muted" aria-label="What the circles mean">
      <li className="flex items-center gap-2.5"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/[0.12] text-[9px] text-text" aria-hidden="true">●</span>Fixed — class, shifts, plans with people</li>
      <li className="flex items-center gap-2.5"><span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-[var(--navi-text)]" aria-hidden="true" />Flexible — time you set aside</li>
      <li className="flex items-center gap-2.5"><span className="h-[18px] w-[18px] rounded-full border-[1.5px] border-dashed border-[#6E6E77]" aria-hidden="true" />Routine — the shape of your day</li>
    </ul>
  );
}

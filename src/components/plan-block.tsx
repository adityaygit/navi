"use client";
import { useState } from "react";
import { ActionButton } from "./action-button";
import { blockOutcomeAction, startFocusAction } from "@/app/(app)/client-actions";
import type { PlanBlock } from "@/lib/types";
import { OUTCOMES } from "@/lib/outcomes";

const STATUS_BADGE: Record<string, string> = {
  done: "badge-ok",
  partial: "badge-accent",
  in_progress: "badge-accent",
  skipped: "badge-warn",
  missed: "badge-danger",
  interrupted: "badge-warn",
  rest: "",
  planned: "",
};

/** How a timeline card reads: fixed is solid light, flexible is outlined blue, recovery/routine outlined yellow. */
export type TimelineKind = "fixed" | "flex" | "recovery";

/** Extra, already-formatted data for the Today timeline look. Without it the row keeps its plain list look (planner). */
export type TimelineInfo = {
  /** Start time, e.g. "7:30" and "PM", shown in the left time column. */
  start: string;
  meridiem: string;
  /** "7:30–8:30 PM" */
  range: string;
  minutes: number;
  area: { name: string; color: string | null } | null;
  marker: "Next" | "Now" | null;
  kind: TimelineKind;
  kindLabel: string;
};

export const durationText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

const CARD: Record<TimelineKind, string> = {
  fixed: "bg-[#f0f0f0] text-[#060608]",
  flex: "border-[1.5px] border-flex bg-[rgba(143,184,255,0.06)]",
  recovery: "border-[1.5px] border-recovery bg-[rgba(242,196,107,0.06)]",
};
const KIND_TEXT: Record<TimelineKind, string> = { fixed: "text-[#3a3b40]", flex: "text-flex", recovery: "text-recovery" };
// Buttons on the light "fixed" card need dark ink to stay readable.
const DARK_BTN = "btn btn-sm border-black/25 bg-transparent text-[#060608] hover:bg-black/5";

/** The left time column and the card shell shared by every timeline entry. */
export function TimelineShell({ start, meridiem, children }: { start: string; meridiem: string; children: React.ReactNode }) {
  return (
    <>
      <span className="num w-11 shrink-0 pt-3 text-right text-[13px] leading-tight text-dim md:w-14">
        {start}
        <span className="block text-[11px]">{meridiem}</span>
      </span>
      {children}
    </>
  );
}

export function AreaMeta({ area, rest, dark = false }: { area: TimelineInfo["area"]; rest: string; dark?: boolean }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-1.5 text-[13px] ${dark ? "text-[#3a3b40]" : "text-muted"}`}>
      {area && (
        <>
          <span className="dot h-[7px] w-[7px]" style={{ background: area.color ?? "#8b8e95" }} aria-hidden />
          <span>{area.name}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <span className="num">{rest}</span>
    </span>
  );
}

export function PlanBlockRow({ block, time, canFocus, timeline }: { block: PlanBlock; time: string; canFocus: boolean; timeline?: TimelineInfo }) {
  const [why, setWhy] = useState(false);
  const open = block.status === "planned" || block.status === "in_progress";
  const dark = timeline?.kind === "fixed";
  const btn = dark ? DARK_BTN : "btn btn-sm";
  const statusBadge = block.status !== "planned" && (
    <span className={`badge ${dark ? "bg-black/10 text-[#060608]" : (STATUS_BADGE[block.status] ?? "")}`}>{block.status.replace("_", " ")}</span>
  );
  const whyButton = block.reason && (
    <button
      type="button"
      className={`inline-flex items-center text-left text-xs underline-offset-2 hover:underline pointer-coarse:min-h-11 ${dark ? "text-[#3a3b40]" : "muted"}`}
      onClick={() => setWhy(!why)}
      aria-expanded={why}
    >
      {why ? block.reason : "Why here?"}
    </button>
  );
  const note = block.outcome_reason && <div className={`text-xs ${dark ? "text-[#3a3b40]" : "muted"}`}>Note: {block.outcome_reason}</div>;
  const actions = open ? (
    <div className="flex flex-wrap gap-1">
      {canFocus && block.task_id && (
        <ActionButton className={dark ? DARK_BTN : "btn btn-sm"} action={() => startFocusAction({ task_id: block.task_id, block_id: block.id, planned_minutes: Math.round((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60000) })}>
          Focus
        </ActionButton>
      )}
      <ActionButton className={btn} action={() => blockOutcomeAction(block.id, "done")}>Done</ActionButton>
      <ActionButton className={btn} action={() => blockOutcomeAction(block.id, "partial", "Made progress")}>Partly</ActionButton>
      <SkipButton id={block.id} btn={btn} />
    </div>
  ) : (
    <div className="self-start sm:self-auto">
      <ActionButton className={`${btn} btn-ghost border-transparent`} action={() => blockOutcomeAction(block.id, "planned")}>Undo</ActionButton>
    </div>
  );

  if (timeline) {
    const finished = !open;
    return (
      <li className="flex gap-3">
        <TimelineShell start={timeline.start} meridiem={timeline.meridiem}>
          <div className={`flex min-w-0 flex-1 flex-col gap-2 rounded-[14px] p-3.5 ${finished && !dark ? "border border-border-strong bg-white/[0.02]" : CARD[timeline.kind]}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-medium uppercase tracking-[0.06em] ${finished && !dark ? "text-dim" : KIND_TEXT[timeline.kind]}`}>{timeline.kindLabel}</span>
              <span className="ml-auto flex items-center gap-1.5">
                {statusBadge}
                {timeline.marker && open && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${dark ? "bg-[#060608] text-fixed" : "bg-[#f0f0f0] text-[#060608]"}`}>{timeline.marker}</span>
                )}
              </span>
            </div>
            <div className="flex min-w-0 items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`text-[17px] font-semibold leading-snug break-words ${finished && !dark ? "text-muted" : ""}`}>{block.title}</span>
                <AreaMeta area={timeline.area} rest={`${timeline.range} · ${durationText(timeline.minutes)}`} dark={dark} />
              </div>
              {/* A marked block only needs Undo: keep it on the title line so the card stays compact. */}
              {finished && <div className="-mt-1 -mr-1 shrink-0">{actions}</div>}
            </div>
            {(whyButton || note) && (
              <div className="flex flex-col">
                {whyButton}
                {note}
              </div>
            )}
            {open && actions}
          </div>
        </TimelineShell>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center">
      <div className="w-36 shrink-0 text-sm tabular-nums muted">{time}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{block.title}</span>
          {!block.is_flexible && <span className="badge">fixed</span>}
          {statusBadge}
        </div>
        {whyButton}
        {note}
      </div>
      {actions}
    </li>
  );
}

/** A fixed commitment (event or timed routine) on the Today timeline: not a plan block, so no outcome buttons. */
export function FixedEntryRow({ title, timeline }: { title: string; timeline: TimelineInfo }) {
  const dark = timeline.kind === "fixed";
  return (
    <li className="flex gap-3">
      <TimelineShell start={timeline.start} meridiem={timeline.meridiem}>
        <div className={`flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3.5 py-3 ${CARD[timeline.kind]}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[16px] font-semibold leading-snug break-words">{title}</span>
            <AreaMeta area={timeline.area} rest={`${timeline.range} · ${durationText(timeline.minutes)}`} dark={dark} />
          </div>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {timeline.marker && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${dark ? "bg-[#060608] text-fixed" : "bg-[#f0f0f0] text-[#060608]"}`}>{timeline.marker}</span>}
            <span className={`text-[11px] font-medium uppercase tracking-[0.06em] ${KIND_TEXT[timeline.kind]}`}>{timeline.kindLabel}</span>
          </span>
        </div>
      </TimelineShell>
    </li>
  );
}

function SkipButton({ id, btn = "btn btn-sm" }: { id: string; btn?: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className={btn} onClick={() => setOpen(true)}>Skip…</button>;
  // Asking why keeps accountability fair: rest and interruptions aren't failures.
  return (
    <span className="flex flex-wrap gap-1" role="group" aria-label="Why skip?">
      <ActionButton className={btn} action={() => blockOutcomeAction(id, OUTCOMES.rest.status, OUTCOMES.rest.reason)}>Resting</ActionButton>
      <ActionButton className={btn} action={() => blockOutcomeAction(id, OUTCOMES.interrupted.status, OUTCOMES.interrupted.reason)}>Interrupted</ActionButton>
      <ActionButton className={btn} action={() => blockOutcomeAction(id, OUTCOMES.missing_info.status, OUTCOMES.missing_info.reason)}>Blocked/missing info</ActionButton>
      <ActionButton className={btn} action={() => blockOutcomeAction(id, OUTCOMES.estimate.status, OUTCOMES.estimate.reason)}>Took longer than estimated</ActionButton>
      <ActionButton className={btn} action={() => blockOutcomeAction(id, OUTCOMES.avoided.status, OUTCOMES.avoided.reason)}>Just didn&apos;t</ActionButton>
      <button type="button" className={`${btn} btn-ghost border-transparent`} onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

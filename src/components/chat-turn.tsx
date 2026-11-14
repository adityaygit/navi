"use client";
import { useId, useState } from "react";
import Link from "next/link";
import type { Message, ToolEvent } from "@/lib/types";
import { readStepsLine } from "@/lib/tool-labels";
import { planCard, type Step } from "@/lib/plan-card";
import type { StepView } from "@/lib/tool-events";
import { Pebble, type PebbleMood } from "./pebble";
import { Stone } from "./shell/stone";
import type { ActionView } from "@/lib/actions";
import { ActionCard, UndoButton, useActions } from "./action-card";
import { replyView } from "@/lib/reply-view";

// How one turn of the conversation looks: the person's words in a light
// bubble; Navi's reply under the small Navi stone with its steps as hairline rows
// and anything that needs the person's OK as an inline action card. Each row
// is one plain line (the step's `display`, never the model's summary). All the
// plan changes of one reply share ONE row ("Updated your plan") with one Undo
// for all of them; the individual moves sit behind a disclosure arrow, and
// work that didn't fit is one line with its options behind another. A live
// turn is drawn from stream events (see src/lib/chat-stream.ts) and is
// swapped for the saved message when the turn finishes.

/** A live step. Undo appears once the reply is saved (live rows are hidden from screen readers, so they hold no controls). */
export type LiveStep = { kind: "step"; id: string; name: string; label: string; readOnly: boolean; status: "running" | "ok" | "failed"; doneLabel?: string; action?: ActionView } & StepView;
export type LiveText = { kind: "text"; segment: number; chunks: { id: number; text: string }[] };
export type LiveItem = LiveStep | LiveText;

/** Models sometimes use **bold** despite being asked not to; show it as bold, not asterisks. */
export function withBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

export function UserBubble({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[84%] whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-[#f2f2f2] px-4 py-3 text-[16px] leading-[1.45] text-[#060608] md:max-w-[64%] md:text-[17px]">
        {message.content}
      </div>
      {message.modality === "voice" && <span className="badge">voice</span>}
    </div>
  );
}

function NaviHeader({ mood, voice }: { mood: PebbleMood; voice?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Stone size={24} lit={mood !== "quiet"} />
      <span className="text-[15px] font-semibold">Navi</span>
      {voice && <span className="badge">voice</span>}
    </div>
  );
}

function Check({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${ok ? "bg-[rgba(95,211,154,0.14)] text-focus" : "bg-[rgba(255,143,138,0.14)] text-clash"}`}
    >
      {ok ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      )}
    </span>
  );
}

/** A small "show more" arrow: a real button that says whether its list is open. */
function Disclosure({ label, children, interactive = true }: { label: string; children: React.ReactNode; interactive?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!interactive) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="muted -ml-1 inline-flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[13px] hover:text-[#e6e7ea]"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="m9 6 6 6-6 6" />
        </svg>
        {label}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

function DetailList({ lines }: { lines: string[] }) {
  return (
    <ul className="muted flex flex-col gap-0.5 pl-4 text-[14px] leading-snug">
      {lines.map((l, i) => (
        <li key={i} className="[overflow-wrap:anywhere]">{l}</li>
      ))}
    </ul>
  );
}

/** "13 things didn't fit tonight", its options behind an arrow, and a link to My day. */
function Leftover({ leftover, interactive }: { leftover: NonNullable<StepView["leftover"]>; interactive: boolean }) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <span className="text-[14px] text-recovery">{leftover.line}</span>
      {interactive && (
        <div className="flex flex-wrap items-start gap-x-4">
          <Disclosure label="Options">
            <DetailList lines={leftover.options} />
          </Disclosure>
          <Link href="/planner" className="muted py-0.5 text-[13px] underline underline-offset-2">See My day</Link>
        </div>
      )}
    </div>
  );
}

/** A finished step: ✓ or ✕, what kind of action it was, one plain line, and Undo when it changed something on its own. */
function StepRow({ ok, label, display, detail, leftover, animate = false, undo, interactive = true }: { ok: boolean; label: string; display: string; detail?: string[]; leftover?: StepView["leftover"]; animate?: boolean; undo?: string[]; interactive?: boolean }) {
  const { undone, markUndone } = useActions();
  // Most lines already say what happened ("Added “Essay”"); then the label would just repeat it.
  const showLabel = !display || !ok;
  return (
    <li className={`flex items-start gap-3 py-3 ${animate ? "step-in" : ""}`}>
      <Check ok={ok} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {showLabel && <span className={`text-[13px] ${ok ? "dim" : "text-clash"}`}>{label}</span>}
        {display && <span className="text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{display}</span>}
        {detail && detail.length > 0 && (
          <Disclosure label={detail.length === 1 ? "Details" : `${detail.length} changes`} interactive={interactive}>
            <DetailList lines={detail} />
          </Disclosure>
        )}
        {leftover && <Leftover leftover={leftover} interactive={interactive} />}
      </div>
      {interactive && ok && undo && undo.length > 0 && <UndoButton ids={undo} done={undo.every((id) => undone.has(id))} onDone={() => markUndone(undo)} label="Undo" />}
    </li>
  );
}

function PlanRow({ steps, animate = false, interactive = true }: { steps: Step[]; animate?: boolean; interactive?: boolean }) {
  const card = planCard(steps);
  return <StepRow ok label="Updated your plan" display={card.display} detail={card.detail} leftover={card.leftover} undo={card.undo} animate={animate} interactive={interactive} />;
}

function QuietRow({ text, running }: { text: string; running: boolean }) {
  return (
    <li className="step-in flex items-center gap-3 py-3">
      <span aria-hidden="true" className="w-6 flex-none text-center text-dim">{running ? "◌" : "○"}</span>
      <span className={`flex-1 text-[15px] ${running ? "shimmer-text" : "muted"}`}>{text}</span>
    </li>
  );
}

function RunningRow({ label }: { label: string }) {
  return (
    <li className="step-in flex items-center gap-3 py-3">
      <Pebble size={24} mood="working" />
      <span className="shimmer-text flex-1 text-[15px]">{label}…</span>
    </li>
  );
}

function StepsBox({ children }: { children: React.ReactNode }) {
  return <ul className="well divide-hair px-4">{children}</ul>;
}

/** A saved reply, in the order it streamed: the actions it took as ✓/✕ rows, its text, then the cards waiting on (or showing the outcome of) the person's OK. */
export function NaviMessage({ message }: { message: Message }) {
  const { actions, latest } = useActions();
  const events: ToolEvent[] = message.tool_events ?? [];
  // Rows and cards as the phone app gets them too (src/lib/reply-view.ts).
  const { rows, cardIds, unlinked } = replyView(events, actions);
  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      <NaviHeader mood="idle" voice={message.modality === "voice"} />
      {rows.length > 0 && (
        <StepsBox>
          {rows.map((r, i) => (
            <StepRow key={i} ok={r.ok} label={r.label} display={r.display} detail={r.detail} leftover={r.leftover} undo={r.undo} />
          ))}
        </StepsBox>
      )}
      {message.content && <p className="whitespace-pre-wrap text-[16px] leading-[1.5] text-[#e6e7ea] md:text-[17px]">{withBold(message.content)}</p>}
      {cardIds.map((id) => (
        <ActionCard key={id} view={actions[id]} compact={latest.get(id) !== message.id} />
      ))}
      {unlinked && (
        <Link href="/activity" className="muted text-[13px] underline underline-offset-2">See approvals in Activity</Link>
      )}
    </div>
  );
}

/**
 * The reply being written. Steps appear as they start and flip in place to
 * ✓/✕; consecutive read-only looks collapse into one quiet line; text fades in
 * a few words at a time. Hidden from screen readers: the saved message that
 * replaces it is announced once instead of every piece.
 */
export function LiveNavi({ items }: { items: LiveItem[] }) {
  const { actions } = useActions();
  // Cards go after the reply text, as in the saved message.
  const cards: React.ReactNode[] = [];
  const working = items.some((i) => i.kind === "step" && i.status === "running");
  // Text in a pass that went on to run tools is narration; the last pass is the reply.
  const lastStepAt = items.map((i) => i.kind).lastIndexOf("step");
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (item.kind === "text") {
      const narration = i < lastStepAt;
      blocks.push(
        <p key={`t${item.segment}-${i}`} className={`whitespace-pre-wrap leading-[1.5] ${narration ? "muted text-[15px]" : "text-[16px] text-[#e6e7ea] md:text-[17px]"}`}>
          {item.chunks.map((c) => (
            <span key={c.id} className="stream-chunk">{c.text}</span>
          ))}
        </p>,
      );
      i++;
      continue;
    }
    // A run of steps shares one box.
    const run: LiveStep[] = [];
    while (i < items.length && items[i].kind === "step") run.push(items[i++] as LiveStep);
    const rows: React.ReactNode[] = [];
    for (let j = 0; j < run.length; ) {
      if (run[j].readOnly) {
        const reads: LiveStep[] = [];
        while (j < run.length && run[j].readOnly) reads.push(run[j++]);
        const running = reads.some((r) => r.status === "running");
        rows.push(<QuietRow key={`r${reads[0].id}`} running={running} text={readStepsLine(reads.map((r) => r.name), running)} />);
        continue;
      }
      const s = run[j++];
      if (s.action) {
        // A step that became a card: the card stands on its own, between the rows around it.
        if (rows.length) blocks.push(<StepsBox key={`s${s.id}-before`}>{rows.splice(0)}</StepsBox>);
        cards.push(<ActionCard key={`c${s.id}`} view={actions[s.action.id] ?? s.action} />);
        continue;
      }
      if (s.status === "ok" && s.plan) {
        // Finished plan changes in a row share one line, as in the saved reply.
        const group: LiveStep[] = [s];
        while (j < run.length && run[j].status === "ok" && run[j].plan && !run[j].action) group.push(run[j++]);
        rows.push(<PlanRow key={s.id} animate interactive={false} steps={group.map((g) => ({ ...g, summary: "", ok: true }))} />);
        continue;
      }
      rows.push(
        s.status === "running" ? (
          <RunningRow key={s.id} label={s.label} />
        ) : (
          <StepRow key={s.id} animate interactive={false} ok={s.status === "ok"} label={s.doneLabel ?? s.label} display={s.display ?? ""} detail={s.detail} leftover={s.leftover} />
        ),
      );
    }
    if (rows.length) blocks.push(<StepsBox key={`s${run[0].id}`}>{rows}</StepsBox>);
  }
  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      <div className="flex flex-col gap-3" aria-hidden="true">
        <NaviHeader mood={items.length === 0 || working ? "working" : "speaking"} />
        {items.length === 0 ? <p className="shimmer-text text-[16px]">Thinking…</p> : blocks}
      </div>
      {/* Cards can be tapped while the reply is still being written, so they stay reachable. */}
      {cards}
    </div>
  );
}

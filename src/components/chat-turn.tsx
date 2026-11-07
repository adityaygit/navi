"use client";
import Link from "next/link";
import type { Message, ToolEvent } from "@/lib/types";
import { readStepsLine, stepDone } from "@/lib/tool-labels";
import { Pebble, type PebbleMood } from "./pebble";
import type { ActionView } from "@/lib/actions";
import { ActionCard, UndoButton, useActions } from "./action-card";

// How one turn of the conversation looks: the person's words in a light
// bubble; Navi's reply under a small Pebble with its steps as hairline rows
// (each change it made on its own can be undone right there) and anything that
// needs the person's OK as an inline action card. A live turn is
// drawn from stream events (see src/lib/chat-stream.ts) and is swapped for the
// saved message when the turn finishes.

/** A live step. Undo appears once the reply is saved (live rows are hidden from screen readers, so they hold no controls). */
export type LiveStep = { kind: "step"; id: string; name: string; label: string; readOnly: boolean; status: "running" | "ok" | "failed"; doneLabel?: string; summary?: string; action?: ActionView };
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
      <Pebble size={28} mood={mood} />
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

/** A finished step: ✓ or ✕, what kind of action it was, the tool's own summary, and Undo when it changed something on its own. */
function StepRow({ ok, label, summary, animate = false, undo }: { ok: boolean; label: string; summary: string; animate?: boolean; undo?: string[] }) {
  const { undone, markUndone } = useActions();
  // Most summaries already say what happened ("Added task “Essay”"); then the label would just repeat it.
  const firstWord = (t: string) => t.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const showLabel = !summary || !ok || firstWord(summary) !== firstWord(label);
  return (
    <li className={`flex items-start gap-3 py-3 ${animate ? "step-in" : ""}`}>
      <Check ok={ok} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {showLabel && <span className={`text-[13px] ${ok ? "dim" : "text-clash"}`}>{label}</span>}
        {summary && <span className="text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{summary}</span>}
      </div>
      {ok && undo && undo.length > 0 && <UndoButton ids={undo} done={undo.every((id) => undone.has(id))} onDone={() => markUndone(undo)} label="Undo" />}
    </li>
  );
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
  const cards = events.flatMap((e) => (e.action_id && actions[e.action_id] ? [actions[e.action_id]] : []));
  const rows = events.filter((e) => !(e.action_id && actions[e.action_id]));
  // Older messages from before cards were linked: the request is still in Activity.
  const unlinked = rows.some((e) => !e.action_id && /approv/i.test(e.summary));
  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      <NaviHeader mood="idle" voice={message.modality === "voice"} />
      {rows.length > 0 && (
        <StepsBox>
          {rows.map((e, i) => (
            <StepRow key={i} ok={e.ok} label={stepDone(e.name, e.ok)} summary={e.summary} undo={e.undo} />
          ))}
        </StepsBox>
      )}
      {message.content && <p className="whitespace-pre-wrap text-[16px] leading-[1.5] text-[#e6e7ea] md:text-[17px]">{withBold(message.content)}</p>}
      {cards
        .filter((c, i) => cards.findIndex((x) => x.id === c.id) === i)
        .map((c) => (
          <ActionCard key={c.id} view={c} compact={latest.get(c.id) !== message.id} />
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
      rows.push(
        s.status === "running" ? (
          <RunningRow key={s.id} label={s.label} />
        ) : (
          <StepRow key={s.id} animate ok={s.status === "ok"} label={s.doneLabel ?? s.label} summary={s.summary ?? ""} />
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

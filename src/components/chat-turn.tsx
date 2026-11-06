"use client";
import Link from "next/link";
import type { Message, ToolEvent } from "@/lib/types";
import { readStepsLine, stepDone } from "@/lib/tool-labels";
import { Pebble, type PebbleMood } from "./pebble";
import { ActionButton } from "./action-button";
import { decideApprovalAction } from "@/app/(app)/actions";

// How one turn of the conversation looks: the person's words in a light
// bubble; Navi's reply under a small Pebble with its steps as hairline rows
// and anything that needs the person's OK as a glowing card. A live turn is
// drawn from stream events (see src/lib/chat-stream.ts) and is swapped for the
// saved message when the turn finishes.

export type PendingApproval = { id: string; summary: string; action_type: string };

export type LiveStep = { kind: "step"; id: string; name: string; label: string; readOnly: boolean; status: "running" | "ok" | "failed"; doneLabel?: string; summary?: string };
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

/** A finished step: ✓ or ✕, what kind of action it was, and the tool's own summary. */
function StepRow({ ok, label, summary, animate = false }: { ok: boolean; label: string; summary: string; animate?: boolean }) {
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

/** A request for the person's OK on something outside Navi (from request_external_action). */
function ApprovalCard({ approval }: { approval: PendingApproval }) {
  return (
    <div className="lg lg-ask flex flex-col gap-4 p-4 md:flex-row md:flex-wrap md:items-center md:p-5">
      <div className="flex flex-1 items-start gap-3 md:min-w-[260px]">
        <Pebble size={40} mood="ask" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="eyebrow">Needs your OK</span>
          <span className="text-[16px] font-semibold leading-snug [overflow-wrap:anywhere]">{approval.summary}</span>
          <span className="muted text-[13px]">Nothing happens outside Navi until you approve.</span>
        </div>
      </div>
      <div className="flex gap-2.5">
        <ActionButton className="btn btn-primary min-w-28 flex-1" action={decideApprovalAction} args={[approval.id, "approve"]}>Approve</ActionButton>
        <ActionButton className="btn min-w-28 flex-1" action={decideApprovalAction} args={[approval.id, "reject"]}>Decline</ActionButton>
      </div>
    </div>
  );
}

const APPROVAL_REF = /Approval requested \(([0-9a-f]{8})\)/;

/** A saved reply, in the order it streamed: the actions it took as ✓/✕ rows, its text, then any open approvals. */
export function NaviMessage({ message, approvals }: { message: Message; approvals: PendingApproval[] }) {
  const events: ToolEvent[] = message.tool_events ?? [];
  const asks = events
    .map((e) => (e.name === "request_external_action" && e.ok ? approvals.find((a) => a.id.startsWith(e.summary.match(APPROVAL_REF)?.[1] ?? "-")) : undefined))
    .filter((a): a is PendingApproval => !!a);
  const rows = events.filter((e) => !(e.name === "request_external_action" && asks.some((a) => e.summary.includes(a.id.slice(0, 8)))));
  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      <NaviHeader mood="idle" voice={message.modality === "voice"} />
      {rows.length > 0 && (
        <StepsBox>
          {rows.map((e, i) => (
            <StepRow key={i} ok={e.ok} label={stepDone(e.name, e.ok)} summary={e.summary} />
          ))}
        </StepsBox>
      )}
      {message.content && <p className="whitespace-pre-wrap text-[16px] leading-[1.5] text-[#e6e7ea] md:text-[17px]">{withBold(message.content)}</p>}
      {asks.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
      ))}
      {events.some((e) => e.name === "request_external_action") && asks.length === 0 && (
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
      rows.push(
        s.status === "running" ? (
          <RunningRow key={s.id} label={s.label} />
        ) : (
          <StepRow key={s.id} animate ok={s.status === "ok"} label={s.doneLabel ?? s.label} summary={s.summary ?? ""} />
        ),
      );
    }
    blocks.push(<StepsBox key={`s${run[0].id}`}>{rows}</StepsBox>);
  }
  return (
    <div className="flex max-w-[720px] flex-col gap-3" aria-hidden="true">
      <NaviHeader mood={items.length === 0 || working ? "working" : "speaking"} />
      {items.length === 0 ? <p className="shimmer-text text-[16px]">Thinking…</p> : blocks}
    </div>
  );
}

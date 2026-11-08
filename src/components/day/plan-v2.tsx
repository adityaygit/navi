"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideApprovalAction } from "@/app/(app)/client-actions";
import { answerAssumptionAction, skipSessionAction } from "@/app/(app)/planner/plan-actions";
import { announceChange } from "@/lib/offline-queue";
import { connectionError } from "@/lib/connection";

// My day pieces for the constraint-first planner (planner v2): the
// assumptions a plan relies on (confirm or correct them in one tap), a plan
// Navi proposed (apply it or not), and skipping one session of an event.

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      setNote(null);
      let r: { ok: boolean; error?: string; message?: string };
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: connectionError() };
      }
      setNote(r.ok ? (r.message ?? null) : (r.error ?? "That didn't work."));
      if (r.ok) {
        announceChange();
        router.refresh();
      }
    });
  return { pending, note, run };
}

export type AssumptionItem = { start: string; end: string; label: string; reason: string | null };

/** "I assumed you're free 4–6 PM. Right?" with Yes / No for each (at most two). */
export function Assumptions({ date, items }: { date: string; items: AssumptionItem[] }) {
  const { pending, note, run } = useRun();
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[18px] border border-dashed border-white/15 px-3.5 py-3" aria-label="Navi's assumptions">
      {items.map((a) => (
        <div key={a.start} className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="min-w-0 flex-1 text-[#C8C8CE]">
            I assumed you&apos;re free <span className="font-semibold text-text">{a.label}</span>
            {a.reason ? <span className="text-dim"> ({a.reason})</span> : null}.
          </span>
          <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(() => answerAssumptionAction({ date, start: a.start, end: a.end, free: true }))} aria-label={`Yes, I'm free ${a.label}`}>
            Yes, free
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(() => answerAssumptionAction({ date, start: a.start, end: a.end, free: false }))} aria-label={`No, I'm busy ${a.label}`}>
            No, busy
          </button>
        </div>
      ))}
      <p role="status" className={note ? "text-[13px] text-dim" : "sr-only"}>{note ?? ""}</p>
    </div>
  );
}

/** A plan Navi proposed (nothing has changed yet): Apply or Not now. */
export function ProposedPlan({ id, revision, title, lines }: { id: string; revision: number; title: string; lines: { label: string; value: string; from?: string }[] }) {
  const { pending, note, run } = useRun();
  return (
    <section aria-label="Proposed plan" className="flex flex-col gap-2 rounded-[18px] border border-[color-mix(in_srgb,var(--navi-text)_30%,transparent)] bg-[color-mix(in_srgb,var(--navi-text)_6%,transparent)] px-3.5 py-3">
      <h3 className="text-[14px] font-semibold">Navi suggests: {title}</h3>
      <p className="text-[12.5px] text-dim">Nothing has changed yet.</p>
      <ul className="flex flex-col gap-1 text-[13px]">
        {lines.map((l, i) => (
          <li key={i}>
            <span className="text-[#C8C8CE]">{l.label}</span> <span className="text-text">{l.value}</span>
            {l.from ? <span className="text-dim"> (was {l.from})</span> : null}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(async () => {
          const r = await decideApprovalAction(id, "approve", revision);
          if (!r.ok) return r;
          const status = r.data?.status;
          return { ok: status === "completed", error: r.data?.error ?? `This plan is ${status ?? "out of date"}.`, message: "Applied. You can undo it from the chat or Activity." };
        })}>
          Apply
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(async () => {
          const r = await decideApprovalAction(id, "reject");
          return r.ok ? { ok: true, message: "Kept your plan as it is." } : r;
        })}>
          Not now
        </button>
      </div>
      <p role="status" className={note ? "text-[13px] text-dim" : "sr-only"}>{note ?? ""}</p>
    </section>
  );
}

/** Cancel just this session of an event (the weekly series stays) and re-plan the day. */
export function SkipSession({ eventId, date, title }: { eventId: string; date: string; title: string }) {
  const { pending, note, run } = useRun();
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => run(() => skipSessionAction({ eventId, date }))} aria-label={`Skip this ${title} only`}>
        Skip this one
      </button>
      <span role="status" className={note ? "text-[12px] text-dim" : "sr-only"}>{note ?? ""}</span>
    </span>
  );
}

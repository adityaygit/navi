"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockOutcomeAction, startFocusAction } from "@/app/(app)/client-actions";
import { placeTaskAction } from "@/app/(app)/planner/actions";
import { usePanel } from "../shell/panel-context";
import { announceChange } from "@/lib/offline-queue";
import { connectionError } from "@/lib/connection";
import { OUTCOMES } from "@/lib/outcomes";

type Result = { ok: true } | { ok: false; error: string };

/** Runs an action, refreshes the views on success, and shows a failure in place. */
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result | { ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      let r: { ok: boolean; error?: string };
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: connectionError() };
      }
      if (!r.ok) return setError(r.error ?? "That didn't work.");
      announceChange();
      if (after) after();
      else router.refresh();
    });
  return { pending, error, run };
}

const pill = "inline-flex h-[34px] items-center rounded-[17px] px-3.5 text-[14px] font-semibold disabled:opacity-50";

/** "Start" on a planned block: focus on its task for the block's length. */
export function StartBlock({ blockId, taskId, minutes, primary }: { blockId: string; taskId: string; minutes: number; primary?: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className={`${pill} ${primary ? "bg-text text-black" : "bg-white/[0.08] text-text"}`}
        onClick={() => run(() => startFocusAction({ task_id: taskId, block_id: blockId, planned_minutes: minutes }), () => router.push("/focus"))}
      >
        {pending ? "Starting…" : "Start"}
      </button>
      {error && <span role="alert" className="text-[12px] text-clash">{error}</span>}
    </span>
  );
}

/** Marking how a planned block went. Skipping asks why: rest and interruptions aren't failures. */
export function BlockOutcome({ blockId, title, open }: { blockId: string; title: string; open: boolean }) {
  const { pending, error, run } = useRun();
  const [menu, setMenu] = useState<"closed" | "open" | "skip">("closed");
  const small = "inline-flex h-8 items-center rounded-full bg-white/[0.07] px-3 text-[13px] text-text hover:bg-white/[0.12] disabled:opacity-50";
  if (!open) {
    return (
      <button type="button" className="text-[13px] text-dim hover:text-text disabled:opacity-50" disabled={pending} onClick={() => run(() => blockOutcomeAction(blockId, "planned"))} aria-label={`Undo the mark on ${title}`}>
        Undo
      </button>
    );
  }
  if (menu === "closed") {
    return (
      <button type="button" className="text-[13px] text-dim hover:text-text" onClick={() => setMenu("open")} aria-label={`Mark how “${title}” went`} aria-expanded="false">
        Mark
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5" role="group" aria-label={`How did “${title}” go?`}>
      {menu === "open" ? (
        <>
          <button type="button" className={small} disabled={pending} onClick={() => run(() => blockOutcomeAction(blockId, "done"))}>Done</button>
          <button type="button" className={small} disabled={pending} onClick={() => run(() => blockOutcomeAction(blockId, "partial", "Made progress"))}>Partly</button>
          <button type="button" className={small} onClick={() => setMenu("skip")}>Skipped…</button>
        </>
      ) : (
        (["rest", "interrupted", "missing_info", "estimate", "avoided"] as const).map((k) => (
          <button key={k} type="button" className={small} disabled={pending} onClick={() => run(() => blockOutcomeAction(blockId, OUTCOMES[k].status, OUTCOMES[k].reason))}>
            {{ rest: "Resting", interrupted: "Interrupted", missing_info: "Missing info", estimate: "Took longer", avoided: "Just didn't" }[k]}
          </button>
        ))
      )}
      <button type="button" className="px-1 text-[13px] text-dim hover:text-text" onClick={() => setMenu("closed")}>Cancel</button>
      {error && <span role="alert" className="w-full text-right text-[12px] text-clash">{error}</span>}
    </span>
  );
}

/** "Put it there": places the task in this free stretch (a flexible block you made). */
export function PutItThere({ taskId, title, startsAt, minutes }: { taskId: string; title: string; startsAt: string; minutes: number }) {
  const { pending, error, run } = useRun();
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        className="pr-1.5 text-[14px] font-semibold text-[var(--navi-text)] hover:underline disabled:opacity-50"
        aria-label={`Put “${title}” here`}
        onClick={() => run(() => placeTaskAction({ taskId, startsAt, minutes }))}
      >
        {pending ? "Placing…" : "Put it there"}
      </button>
      {error && <span role="alert" className="text-[12px] text-clash">{error}</span>}
    </span>
  );
}

/** "Place it" on a task that still needs a time: Navi finds the slot (and says what it did). */
export function PlaceIt({ title, dayLabel }: { title: string; dayLabel: string }) {
  const panel = usePanel();
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-[13px] font-semibold text-[var(--navi-text)] hover:underline"
      aria-label={`Ask Navi to find a time for “${title}”`}
      onClick={() => {
        const ask = `Find a time ${dayLabel} for “${title}”`;
        // Phones have no side panel: continue in the chat page.
        if (window.matchMedia("(max-width: 767.98px)").matches) {
          try { localStorage.setItem("navi:chat-draft:chat:new", ask); } catch {}
          router.push("/chat?new=1");
          return;
        }
        panel.ask(ask);
      }}
    >
      Place it
    </button>
  );
}

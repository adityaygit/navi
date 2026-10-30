"use client";
import { useState } from "react";
import { ActionButton } from "./action-button";
import { blockOutcomeAction, startFocusAction } from "@/app/(app)/actions";
import type { PlanBlock } from "@/lib/types";

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

export function PlanBlockRow({ block, time, canFocus }: { block: PlanBlock; time: string; canFocus: boolean }) {
  const [why, setWhy] = useState(false);
  const open = block.status === "planned" || block.status === "in_progress";
  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center">
      <div className="w-36 shrink-0 text-sm tabular-nums muted">{time}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{block.title}</span>
          {!block.is_flexible && <span className="badge">fixed</span>}
          {block.status !== "planned" && <span className={`badge ${STATUS_BADGE[block.status] ?? ""}`}>{block.status.replace("_", " ")}</span>}
        </div>
        {block.reason && (
          <button type="button" className="muted inline-flex items-center text-left text-xs underline-offset-2 hover:underline pointer-coarse:min-h-11" onClick={() => setWhy(!why)} aria-expanded={why}>
            {why ? block.reason : "Why here?"}
          </button>
        )}
        {block.outcome_reason && <div className="muted text-xs">Note: {block.outcome_reason}</div>}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1">
          {canFocus && block.task_id && (
            <ActionButton action={() => startFocusAction({ task_id: block.task_id, block_id: block.id, planned_minutes: Math.round((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60000) })}>
              Focus
            </ActionButton>
          )}
          <ActionButton action={() => blockOutcomeAction(block.id, "done")}>Done</ActionButton>
          <ActionButton action={() => blockOutcomeAction(block.id, "partial", "Made progress")}>Partly</ActionButton>
          <SkipButton id={block.id} />
        </div>
      )}
      {!open && (
        <div className="self-start sm:self-auto">
          <ActionButton className="btn btn-ghost btn-sm" action={() => blockOutcomeAction(block.id, "planned")}>Undo</ActionButton>
        </div>
      )}
    </li>
  );
}

function SkipButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Skip…</button>;
  // Asking why keeps accountability fair: rest and interruptions aren't failures.
  return (
    <span className="flex flex-wrap gap-1" role="group" aria-label="Why skip?">
      <ActionButton action={() => blockOutcomeAction(id, "rest", "Chose to rest")}>Resting</ActionButton>
      <ActionButton action={() => blockOutcomeAction(id, "interrupted", "Interrupted")}>Interrupted</ActionButton>
      <ActionButton action={() => blockOutcomeAction(id, "skipped", "Missing information")}>Blocked/missing info</ActionButton>
      <ActionButton action={() => blockOutcomeAction(id, "skipped", "Avoided it")}>Just didn't</ActionButton>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

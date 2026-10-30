// Block outcomes and how accountability reads them. Shared by the UI (plan
// blocks, focus, evening review), the planner (recovery) and the reviews, so
// a reason recorded in one place is scored the same everywhere. No migration:
// the reason lives in plan_blocks.outcome_reason next to the status.

export type OutcomeChoice = "done" | "partial" | "rest" | "interrupted" | "missing_info" | "estimate" | "avoided";

/** Status + the reason text that marks its category. A user note is appended after ": ". */
export const OUTCOMES: Record<Exclude<OutcomeChoice, "done" | "partial">, { status: "rest" | "interrupted" | "skipped"; reason: string; label: string }> = {
  rest: { status: "rest", reason: "Chose to rest", label: "Rest" },
  interrupted: { status: "interrupted", reason: "Interrupted", label: "Interrupted" },
  missing_info: { status: "skipped", reason: "Missing information", label: "Missing info" },
  estimate: { status: "skipped", reason: "Took longer than estimated", label: "Took longer than estimated" },
  avoided: { status: "skipped", reason: "Avoided it", label: "Just didn't" },
};

/** Reason for a focus session stopped without saying why: an unexcused skip. */
export const STOPPED_NO_REASON = "Stopped the focus session without a reason";

export function withNote(reason: string, note?: string | null): string {
  const n = note?.trim();
  return (n ? `${reason}: ${n}` : reason).slice(0, 300);
}

export type BlockCategory = "done" | "partial" | "rest" | "interrupted" | "missing_info" | "estimate" | "avoided" | "missed" | "unmarked";

/**
 * Category of a skipped block from its reason. The prefix the app writes wins
 * (so a note like "Avoided it: blocked by nerves" stays avoidance); otherwise
 * older free-text reasons are read by keyword.
 */
export function skipCategory(reason: string | null | undefined): "missing_info" | "estimate" | "avoided" {
  const r = (reason ?? "").trim();
  if (r.startsWith(OUTCOMES.avoided.reason) || r.startsWith(STOPPED_NO_REASON)) return "avoided";
  if (r.startsWith(OUTCOMES.estimate.reason)) return "estimate";
  if (r.startsWith(OUTCOMES.missing_info.reason)) return "missing_info";
  if (/\blonger than (estimated|planned)\b/i.test(r)) return "estimate";
  if (/missing|blocked/i.test(r)) return "missing_info";
  return "avoided";
}

export function blockCategory(b: { status: string; outcome_reason: string | null }): BlockCategory {
  switch (b.status) {
    case "done":
    case "partial":
    case "rest":
    case "interrupted":
    case "missed":
      return b.status;
    case "skipped":
      return skipCategory(b.outcome_reason);
    default:
      return "unmarked"; // planned / in_progress: nobody said what happened
  }
}

export const DISRUPTION_LABELS: Record<string, string> = {
  interruption: "interruption",
  rest: "rest",
  missing_info: "missing information",
  estimate: "took longer than estimated",
  external: "external change",
  other: "other",
};

export function describeDisruptions(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${DISRUPTION_LABELS[k] ?? k}`)
    .join(", ");
}

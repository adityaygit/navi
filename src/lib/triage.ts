// Overdue imported work (Canvas and other feeds) is held for the person's
// decision instead of being treated as today's work. Calendar feeds don't say
// whether something was handed in, so an assignment past its deadline is as
// likely finished as not: Navi never plans it, nags about it or reports it as
// "doesn't fit" on its own. The person decides once: handed in (done), still
// to do (plan it / give it a day), or not needed (drop). Nothing is deleted,
// completed or discarded automatically; the deadline, course and ids stay.

export type TriageTask = {
  status: string;
  source?: string | null;
  external_ref?: string | null;
  due_at: string | null;
  commitment?: string | null;
};

const OPEN = new Set(["todo", "in_progress", "blocked"]);

/** Linked to a live feed item: the feed owns its title and due date. */
export function isFeedOwned(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith("ext:");
}

/**
 * Provenance kept on a task after its feed is disconnected ("keep my items"):
 * the task is the person's to edit, and reconnecting the same calendar
 * re-links it instead of importing the assignment a second time.
 */
export function provenanceRef(provider: string, host: string, externalId: string): string {
  return `was:${provider}:${host.toLowerCase()}:${externalId}`;
}

/** Came from an external feed (Canvas): Navi can't see whether it was submitted. */
export function isImported(t: Pick<TriageTask, "source" | "external_ref">): boolean {
  return t.source === "external" || (!!t.external_ref && t.external_ref.startsWith("ext:"));
}

/**
 * Imported, still open, and past its deadline: waits for the person's
 * decision. `chosen` = the person picked it (focus, scope, a block they
 * placed); must-complete work they marked themselves is theirs too.
 */
export function awaitingTriage(t: TriageTask, nowMs: number, chosen = false): boolean {
  if (chosen || t.commitment === "must") return false;
  if (!isImported(t) || !OPEN.has(t.status) || !t.due_at) return false;
  return Date.parse(t.due_at) < nowMs;
}

/** "was due Tue Oct 20" vs "is due today" for a task whose deadline is on or before the planned day. */
export function dueWording(dueIsoLocalDate: string, planDate: string, dueLabel: string): string {
  return dueIsoLocalDate < planDate ? `was due ${dueLabel} (overdue)` : "is due today";
}

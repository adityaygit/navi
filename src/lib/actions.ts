// What the person sees of an action Navi proposed: the state machine and the
// card view. Shared by the server (which builds views) and the chat UI.
//
//   proposed → approved → executing → completed | failed
//   proposed → declined | expired
//
// Only the server moves an action between states, each move is a conditional
// update on the current state, and only the move approved → executing runs
// anything, so an action can run at most once however often it is approved.

export type ActionStatus = "proposed" | "approved" | "executing" | "completed" | "declined" | "failed" | "expired";

/** States that still hold the action's idempotency key (one open action per key). */
export const OPEN_STATUSES: readonly ActionStatus[] = ["proposed", "approved", "executing"];

export type ActionField = { label: string; value: string; from?: string };

export type ActionView = {
  id: string;
  status: ActionStatus;
  /** "Create task", "Cancel task", "Email"… */
  verb: string;
  /** What it acts on: the task's title, the event's name… */
  subject: string;
  /** The exact details that will be used, e.g. Due / Estimate (with the old value when it changes). */
  fields: ActionField[];
  /** Why Navi asked first, in plain words ("it changes a hard deadline"). */
  reason: string | null;
  external: boolean;
  /** What actually happened, once it ran. */
  result: string | null;
  error: string | null;
  /** Activity-log entries that undo a completed action (empty: it can't be undone here). */
  undo: string[];
  undone: boolean;
  /** Bumped each time the person changes it by talking to Navi. */
  revision: number;
  expiresAt: string;
};

export function isOpen(status: ActionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Navi's autonomy setting (profiles.preferences.autonomy). */
export type Autonomy = "auto" | "ask";

export function autonomyFrom(preferences: unknown): Autonomy {
  const v = preferences && typeof preferences === "object" ? (preferences as Record<string, unknown>).autonomy : undefined;
  return v === "ask" ? "ask" : "auto";
}

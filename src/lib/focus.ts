// Focus sessions, shared by the server and the timer on screen.

export type FocusSession = {
  id: string;
  user_id: string;
  task_id: string | null;
  block_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number | null;
  actual_minutes: number | null;
  outcome: "completed" | "progress" | "interrupted" | "abandoned" | null;
  note: string | null;
  /** Set while the session is paused: when the pause began. */
  paused_at: string | null;
  /** Seconds spent in pauses that have ended. */
  paused_seconds: number;
  created_at: string;
};

/**
 * Seconds of actual focus at `now` (ms): time since the start, minus finished
 * pauses, minus the pause in progress. Matches the database's own count
 * (public.focus_elapsed_seconds), which is what an ended session records.
 */
export function focusElapsedSeconds(s: Pick<FocusSession, "started_at" | "paused_at"> & { paused_seconds?: number | null }, now: number): number {
  const current = s.paused_at ? Math.max(0, now - Date.parse(s.paused_at)) / 1000 : 0;
  return Math.max(0, Math.floor((now - Date.parse(s.started_at)) / 1000 - (s.paused_seconds ?? 0) - current));
}

/**
 * Follow-through: one explainable 0–100 number for a week, made of three parts
 * that each come straight from recorded data (no guesses, no letter grades).
 *
 * - Done: average completion rate of the days that had counted blocks
 *   (the same rating the daily review already shows).
 * - Focus: measured focus minutes as a share of planned block minutes (capped at 100).
 * - On time: tasks finished by their due date, out of tasks finished this week that had one.
 *
 * A part is null when there's nothing to measure it from. The overall score is the
 * average of the parts that exist, and is null unless the week has enough data.
 */
export type FollowThroughPart = { key: "done" | "focus" | "onTime"; label: string; value: number | null; how: string };
export type FollowThrough = { score: number | null; enoughData: boolean; parts: FollowThroughPart[] };

export type FollowThroughInput = {
  avgCompletion: number | null;
  minutes: { planned: number; focus: number };
  dueCompletions: number;
  lateCompletions: number;
  enoughData: boolean;
};

export function followThrough(w: FollowThroughInput): FollowThrough {
  const done = w.avgCompletion === null ? null : Math.round(w.avgCompletion * 100);
  const focus = w.minutes.planned > 0 ? Math.min(100, Math.round((w.minutes.focus / w.minutes.planned) * 100)) : null;
  const onTime = w.dueCompletions > 0 ? Math.round(((w.dueCompletions - w.lateCompletions) / w.dueCompletions) * 100) : null;
  const parts: FollowThroughPart[] = [
    { key: "done", label: "Done", value: done, how: "Average share of each day's counted plan blocks you marked done. Rest you chose and interruptions you couldn't control aren't counted." },
    { key: "focus", label: "Focus", value: focus, how: "Minutes measured in focus sessions, as a share of the minutes you planned in work blocks." },
    { key: "onTime", label: "On time", value: onTime, how: "Tasks you finished by their due date, out of the tasks with a due date you finished this week." },
  ];
  const present = parts.map((p) => p.value).filter((v): v is number => v !== null);
  const score = w.enoughData && present.length ? Math.round(present.reduce((s, v) => s + v, 0) / present.length) : null;
  return { score, enoughData: w.enoughData, parts };
}

/** Plain word for a 0–100 value: the same scale everywhere. */
export function statusWord(value: number | null): { word: string; tone: "good" | "okay" | "low" | "none" } {
  if (value === null) return { word: "Not enough data", tone: "none" };
  if (value >= 80) return { word: "Great", tone: "good" };
  if (value >= 60) return { word: "Okay", tone: "okay" };
  return { word: "Needs care", tone: "low" };
}

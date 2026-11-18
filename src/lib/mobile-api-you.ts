// The phone app's Progress and "You" screens (M6 step 4): GET /api/m/progress,
// memory, notes, activity and spaces. Kept apart from mobile-api-types.ts so the
// planner work there and this can change independently. Types only.

/** One card of a told-back story: `a` + *`b`* (italic) + `c`. */
export type MStoryCard = { a: string; b: string; c: string };

/** GET /api/m/progress — the 7 days ending today, computed by the same code as Insights. */
export type MProgress = {
  from: string;
  to: string;
  /** The headline, with the one part that matters in `b`. */
  headline: MStoryCard;
  /**
   * Kept: things you planned for yourself (plan blocks) marked done, out of
   * those that count. Rest, interruptions, missing info and overruns don't
   * count against you; fixed events aren't plan blocks. null: nothing planned.
   */
  kept: { done: number; of: number } | null;
  focusedMinutes: number;
  /** Skipped 3+ times in three weeks without an outside reason, or a hard deadline within two days. */
  slipping: { id: string; title: string; why: string }[];
  /** Time in plan blocks you did (partly done counts half), by space. */
  hours: { name: string; color: string | null; minutes: number }[];
  hoursTotal: number;
  /** One thing worth thinking about, from the week's findings. */
  question: string | null;
  /** The week told back (3–4 cards). */
  week: MStoryCard[];
  /** Today told back, when anything was planned today (for the evening wrap-up). */
  today: MStoryCard[];
};

export type MMemory = {
  id: string;
  kind: "profile" | "project" | "episodic" | "behavioral";
  content: string;
  /** stated: you said it or confirmed it; otherwise Navi's guess. */
  guess: boolean;
  /** Where it came from, in a few words ("You said this · Nov 3", "Navi noticed"). */
  source: string;
};
/** GET /api/m/memory */
export type MMemoryList = { guesses: MMemory[]; known: MMemory[] };
/** POST /api/m/memory · PATCH /api/m/memory/:id (a correction replaces it) */
export type MMemoryWrite = { content: string };

export type MNote = { id: string; title: string | null; body: string; source: string };
/** GET /api/m/notes */
export type MNoteList = { notes: MNote[] };
/** POST /api/m/notes · PATCH /api/m/notes/:id. `id` on create: a uuid made once so a retry doesn't add it twice. */
export type MNoteWrite = { id?: string; title?: string | null; body: string };

export type MActivity = {
  id: string;
  who: "You" | "Navi" | "Scheduler";
  summary: string;
  at: string;
  /** Undo is offered only when it can really be undone (POST /api/m/activity/:id/revert). */
  canUndo: boolean;
  undone: boolean;
};
/** GET /api/m/activity — newest first, grouped by local day. */
export type MActivityList = { days: { label: string; entries: MActivity[] }[] };

export type MSpace = { id: string; name: string; color: string | null; openTasks: number; projects: string[] };
/** GET /api/m/spaces */
export type MSpaceList = { spaces: MSpace[] };
/** PATCH /api/m/spaces/:id */
export type MSpaceWrite = { name?: string; color?: string | null };

// Request and response shapes of the phone app's JSON API (/api/m/*), the one
// source of truth for both sides. Plain TypeScript with NO imports, so the
// app in mobile/ can import this file directly. The server's builders
// (src/server/mobile/*) are typed against these, so a server change that
// breaks the contract fails the typecheck. See docs/navi-1.5/mobile/API.md.
//
// Conventions: database rows (tasks, proposals, messages, focus sessions,
// briefings) keep their column names (snake_case), exactly as the web app and
// /api/chat use them; shapes built for a screen are camelCase. Times are ISO
// 8601 strings (UTC unless named "local"), dates are "YYYY-MM-DD" in the
// person's time zone, "HH:MM" are local clock times.

// ---- errors ------------------------------------------------------------------

/** Every failure: an HTTP status ≥ 400 and this body. 401 = sign in again. */
export type MApiError = {
  error: string;
  /** Machine-readable reason where there is one (e.g. "turn_in_progress"), or a reference for a server error. */
  code?: string;
  [extra: string]: unknown;
};

export type MOk = { ok: true; message?: string };

// ---- shared pieces ------------------------------------------------------------

export type MSeg = { text: string; strong?: boolean };
/** A sentence in parts: strong parts are drawn brighter. */
export type MLine = MSeg[];

export type MSpace = { id: string; name: string; color: string };

export type MActionStatus = "proposed" | "approved" | "executing" | "completed" | "declined" | "failed" | "expired";
export type MActionField = { label: string; value: string; from?: string };

/** An action Navi proposed that waits for (or shows the result of) the person's OK. */
export type MActionView = {
  id: string;
  status: MActionStatus;
  verb: string;
  subject: string;
  fields: MActionField[];
  reason: string | null;
  /** Leaves Navi (an email, a message to someone): always needs an OK. */
  external: boolean;
  result: string | null;
  error: string | null;
  /** Activity ids that undo a completed action; empty: can't be undone here. */
  undo: string[];
  undone: boolean;
  /** Send it back with a decision so a card Navi changed since isn't approved blind. */
  revision: number;
  expiresAt: string;
};

export type MUpdateResult<T> = { kind: "updated"; row: T } | { kind: "approval_requested"; approvalId: string; reason: string };

// ---- me --------------------------------------------------------------------------

export type MNaviColorKey = "amber" | "rose" | "lilac" | "sky" | "mint" | "lime" | "peach" | "pearl";
export type MOnboardingStatus = "not_started" | "in_progress" | "reviewing" | "completed" | "skipped";

/** GET /api/m/me */
export type MMe = {
  id: string;
  email: string | null;
  displayName: string | null;
  timezone: string;
  naviColor: { key: MNaviColorKey; name: string; light: string; mid: string; dark: string; ink: string; text: string };
  /** "auto": low-risk changes happen at once (with Undo); "ask": every change waits for an OK. */
  autonomy: "auto" | "ask";
  onboarding: { status: MOnboardingStatus; done: boolean };
  plannerV2: boolean;
  briefings: { enabled: boolean; morning: string; evening: string };
  quietHours: { start: string; end: string } | null;
  wakeBed: { wake: string; bed: string } | null;
  /** Counts for badges. */
  waiting: { proposals: number; approvals: number };
};

// ---- chats -------------------------------------------------------------------------

/** GET /api/m/chats */
export type MChatSummary = { id: string; title: string | null; created_at: string; updated_at: string };
export type MChatList = { chats: MChatSummary[] };
/** POST /api/m/chats */
export type MChatCreated = { id: string };
/** PATCH /api/m/chats/:id */
export type MChatRename = { title: string };

export type MToolEvent = {
  name: string;
  ok: boolean;
  summary: string;
  display?: string;
  detail?: string[];
  plan?: boolean;
  leftover?: { line: string; options: string[] };
  irreversible?: boolean;
  unchanged?: boolean;
  action_id?: string;
  undo?: string[];
};

/** One receipt row under a reply (see src/lib/reply-view.ts). Show Undo when ok and undo is non-empty. */
export type MReceiptRow = {
  ok: boolean;
  label: string;
  display: string;
  detail?: string[];
  leftover?: { line: string; options: string[] };
  undo?: string[];
  plan?: true;
};

export type MMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  modality: "text" | "voice";
  tool_events: MToolEvent[];
  created_at: string;
  client_id?: string | null;
  /** Assistant messages: the steps as rows, plan changes merged into one. */
  receipts: MReceiptRow[];
  /** Assistant messages: action cards to draw after the text (look them up in `actions`). */
  cardIds: string[];
};

/** GET /api/m/chats/:id/messages. `undone`: activity ids already undone (show their Undo as done). */
export type MChatHistory = {
  id: string;
  title: string | null;
  messages: MMessage[];
  actions: Record<string, MActionView>;
  undone: string[];
};

// ---- day and week --------------------------------------------------------------------

export type MBlockStatus = "planned" | "in_progress" | "done" | "partial" | "skipped" | "missed" | "rest" | "interrupted";

/** One thing on the day's line. */
export type MDayItem = {
  /** The event, routine or plan block id (an event repeats: id + start is unique). */
  id: string;
  key: string;
  kind: "event" | "routine" | "block";
  /** How it looks: fixed (filled), flex (time set aside), routine (dashed). */
  look: "fixed" | "flex" | "routine";
  title: string;
  start: string;
  end: string;
  minutes: number;
  /** Plan blocks only; null for events and routines. */
  status: MBlockStatus | null;
  /** Still to come or under way (events and routines always are). */
  open: boolean;
  done: boolean;
  /** Happening at this moment (today only). */
  now: boolean;
  space: MSpace | null;
  color: string;
  taskId: string | null;
  /** Planner v2: planned in time Navi assumed is free. */
  assumed: boolean;
  pinned: boolean;
  recurring: boolean;
  /** Why Navi put it there ("You put it here.", …). */
  reason: string | null;
  /** Keys of other items on the line that overlap this one. */
  overlaps: string[];
};

/** Two things at the same time (amber in the designs). */
export type MOverlap = { a: string; b: string; titles: [string, string]; start: string; end: string; minutes: number };

/** A free stretch still ahead, with the one task that fits it, if any. */
export type MFreeStretch = { start: string; end: string; minutes: number; fits: { taskId: string; title: string; estimate: number } | null };

export type MNeedsTime = {
  id: string;
  title: string;
  estimate_minutes: number | null;
  due_at: string | null;
  due_is_hard: boolean;
  steps: number;
  space: MSpace | null;
};

export type MBriefing = {
  id: string;
  kind: "morning" | "evening" | "weekly";
  local_date: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

/** GET /api/m/day?date=YYYY-MM-DD (default today) */
export type MDay = {
  date: string;
  timezone: string;
  now: string;
  isToday: boolean;
  isPast: boolean;
  headline: MLine;
  items: MDayItem[];
  /** Today only: what already ended ("This morning · 2 done"). Keys of items. */
  earlier: { keys: string[]; done: number } | null;
  overlaps: MOverlap[];
  free: MFreeStretch[];
  /** Open tasks with no time yet (at most 5, soonest due first). */
  needsTime: MNeedsTime[];
  needsTimeTotal: number;
  /** Routines with no set time that day. */
  untimed: { id: string; title: string }[];
  /** Planner v2 only: assumptions the plan relies on, time Navi doesn't know about, plans waiting for an OK. */
  plan: {
    assumptions: { start: string; end: string; label: string; reason: string | null }[];
    unknown: { text: string }[];
    proposals: { id: string; revision: number; title: string; lines: { label: string; value: string; from?: string }[] }[];
  } | null;
  /** Today's newest unread briefing, if any. */
  briefing: MBriefing | null;
  /** The running focus session's id, if one is running. */
  focusSessionId: string | null;
};

/** GET /api/m/week?start=YYYY-MM-DD (any date in the week; default this week) */
export type MWeek = {
  start: string;
  end: string;
  timezone: string;
  headline: MLine;
  days: {
    date: string;
    isToday: boolean;
    items: MDayItem[];
    /** Planned time (events and plan blocks, overlaps counted once), minutes. */
    plannedMinutes: number;
    overlaps: number;
    /** Open tasks due that day. */
    due: { id: string; title: string; due_at: string; due_is_hard: boolean }[];
  }[];
};

// ---- tasks ------------------------------------------------------------------------------

export type MTaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";

export type MTask = {
  id: string;
  title: string;
  notes: string | null;
  status: MTaskStatus;
  priority: 1 | 2 | 3 | 4;
  due_at: string | null;
  due_is_hard: boolean;
  estimate_minutes: number | null;
  actual_minutes: number;
  commitment?: "must" | "normal" | "optional";
  not_before?: string | null;
  remind_at?: string | null;
  recurrence: { freq: "daily" | "weekly"; days?: number[] } | null;
  workspace_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  parent_task_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MTaskItem = MTask & {
  space: MSpace | null;
  steps: { total: number; done: number };
  /** Its next planned time from today on, if any. */
  next: { blockId: string; start: string; end: string } | null;
};

/**
 * GET /api/m/tasks
 * today: open, with a time today or due by the end of today (overdue first);
 * needsTime: open, not today, nothing planned, not parked for someday;
 * later: open, not today, planned for a later day or parked (priority 4);
 * doneToday: finished today.
 */
export type MTaskGroups = { today: MTaskItem[]; needsTime: MTaskItem[]; later: MTaskItem[]; doneToday: MTaskItem[] };

/** POST /api/m/tasks. `id`: a uuid made once per submit so a retry doesn't add it twice. */
export type MTaskCreate = {
  id?: string;
  title: string;
  notes?: string | null;
  priority?: 1 | 2 | 3 | 4;
  due_at?: string | null;
  due_is_hard?: boolean;
  estimate_minutes?: number | null;
  workspace_id?: string | null;
  project_id?: string | null;
  goal_id?: string | null;
  parent_task_id?: string | null;
  recurrence?: { freq: "daily" | "weekly"; days?: number[] } | null;
  remind_at?: string | null;
  commitment?: "must" | "normal" | "optional";
  not_before?: string | null;
};
/** PATCH /api/m/tasks/:id (any MTaskCreate field but id, plus status). */
export type MTaskUpdate = Partial<Omit<MTaskCreate, "id">> & { status?: MTaskStatus };
export type MTaskResult = { task: MTask };
export type MTaskChange = { result: MUpdateResult<MTask> };
/** POST /api/m/tasks/:id/place */
export type MPlaceTask = { startsAt: string; minutes: number };
/** POST /api/m/plan/day, /api/m/plan/week: one plain sentence about what was planned. */
export type MPlanResult = { message: string };
/** POST /api/m/blocks/:id/outcome */
export type MBlockOutcome = { status: MBlockStatus; reason?: string | null };

// ---- inbox ------------------------------------------------------------------------------

export type MProposalKind = "workspace" | "project" | "goal" | "routine" | "event" | "task" | "reminder" | "note" | "question" | "memory" | "preference";

export type MProposal = {
  id: string;
  capture_id: string | null;
  conversation_id: string | null;
  kind: MProposalKind;
  payload: Record<string, unknown>;
  source_excerpt: string | null;
  /** stated: the person said it (solid card); inferred: Navi's guess (dashed). */
  origin: "stated" | "inferred";
  confidence: number;
  rationale: string | null;
  status: "pending" | "accepted" | "rejected" | "deferred" | "merged";
  created_at: string;
  /** One-line title for the card. */
  title: string;
  /** The life area it would land in, when it says. */
  area: { name: string; color: string | null } | null;
};

export type MCapture = { id: string; raw_text: string; status: string; source: string; captured_at: string };

/** GET /api/m/inbox */
export type MInbox = {
  /** Pending suggestions grouped by where they came from (a capture, chats, other). */
  groups: { key: string; label: string; capture: MCapture | null; proposals: MProposal[] }[];
  /** "Later" pile. */
  deferred: MProposal[];
  /** Action cards waiting for an OK (newest first). */
  approvals: MActionView[];
  /** For "Merge into…". */
  openTasks: { id: string; title: string }[];
  counts: { proposals: number; approvals: number; stated: number };
};

/** POST /api/m/proposals/:id/accept */
export type MAcceptProposal = { edits?: Record<string, unknown> };
/** POST /api/m/proposals/accept */
export type MAcceptMany = { ids: string[] };
export type MAcceptManyResult = { results: { id: string; ok: boolean; title?: string; error?: string }[]; message: string };
/** POST /api/m/proposals/:id/status */
export type MProposalStatus = { status: "rejected" | "deferred" | "pending" };
/** PATCH /api/m/proposals/:id */
export type MEditProposal = { payload: Record<string, unknown> };
/** POST /api/m/proposals/:id/merge */
export type MMergeProposal = { taskId: string };
export type MProposalResult = { proposal: MProposal };

/** POST /api/m/approvals/:id/decide */
export type MDecide = { decision: "approve" | "decline"; revision?: number };
export type MDecideResult = { action: MActionView; message: string };

/** POST /api/m/undo */
export type MUndo = { activityIds: string[] };
export type MUndoResult = { undone: number; message: string };

// ---- focus ------------------------------------------------------------------------------

export type MFocusSession = {
  id: string;
  task_id: string | null;
  block_id: string | null;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number | null;
  actual_minutes: number | null;
  outcome: "completed" | "progress" | "interrupted" | "abandoned" | null;
  note: string | null;
  paused_at: string | null;
  paused_seconds: number;
};

/** GET /api/m/focus: the running session (null when none) with what it's on. */
export type MFocusCurrent = {
  session: (MFocusSession & { title: string; space: MSpace | null; elapsedSeconds: number }) | null;
};
/** POST /api/m/focus/start */
export type MFocusStart = { taskId?: string | null; blockId?: string | null; plannedMinutes?: number | null };
/** POST /api/m/focus/:id/end */
export type MFocusEnd = {
  outcome: "completed" | "progress" | "interrupted" | "abandoned";
  note?: string | null;
  reason?: "rest" | "missing_info" | "estimate" | null;
  /** Planner v2: it needs this many more minutes. */
  moreMinutes?: number | null;
};
export type MFocusResult = { session: MFocusSession };

// ---- briefings ------------------------------------------------------------------------------

/** POST /api/m/briefings/generate */
export type MBriefingGenerate = { kind: "morning" | "evening" | "weekly" };
export type MBriefingGenerated = { title: string; body: string };

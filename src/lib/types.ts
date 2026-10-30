// Row shapes for the tables in supabase/migrations. Kept by hand and small on
// purpose; columns not used by the app are omitted.

export type Profile = {
  id: string;
  display_name: string | null;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_briefing_time: string;
  evening_review_time: string;
  weekly_review_day: number;
  briefings_enabled: boolean;
  availability: AvailabilityWindow[];
  preferences: Record<string, unknown>;
  onboarding_status: "not_started" | "in_progress" | "reviewing" | "completed" | "skipped";
  onboarding_conversation_id: string | null;
};

export type AvailabilityWindow = { days: number[]; start: string; end: string };

export type Workspace = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  status: "active" | "archived";
  sort_order: number;
};

export type Goal = {
  id: string;
  workspace_id: string | null;
  title: string;
  why: string | null;
  measure: string | null;
  target_date: string | null;
  status: "active" | "paused" | "achieved" | "dropped";
  created_at: string;
};

export type Project = {
  id: string;
  workspace_id: string | null;
  goal_id: string | null;
  name: string;
  objective: string | null;
  notes: string | null;
  links: { label?: string; url: string }[];
  due_date: string | null;
  status: "active" | "paused" | "done" | "archived";
  created_at: string;
};

export type Milestone = {
  id: string;
  project_id: string | null;
  goal_id: string | null;
  title: string;
  due_date: string | null;
  done_at: string | null;
};

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";

export type Task = {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  milestone_id: string | null;
  parent_task_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4;
  due_at: string | null;
  due_is_hard: boolean;
  estimate_minutes: number | null;
  actual_minutes: number;
  recurrence: { freq: "daily" | "weekly"; days?: number[] } | null;
  blocker: string | null;
  source: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Routine = {
  id: string;
  workspace_id: string | null;
  goal_id: string | null;
  title: string;
  days: number[];
  start_time: string | null;
  duration_minutes: number;
  is_fixed: boolean;
  active: boolean;
};

export type CalendarEvent = {
  id: string;
  workspace_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  recurrence: { freq: "weekly"; days: number[]; until?: string | null } | null;
  location: string | null;
  notes: string | null;
  source: string;
  external_ref: string | null;
  status: "confirmed" | "tentative" | "cancelled";
};

export type BlockStatus =
  | "planned"
  | "in_progress"
  | "done"
  | "partial"
  | "skipped"
  | "missed"
  | "rest"
  | "interrupted";

export type PlanBlock = {
  id: string;
  task_id: string | null;
  routine_id: string | null;
  title: string;
  plan_date: string;
  starts_at: string;
  ends_at: string;
  is_flexible: boolean;
  status: BlockStatus;
  outcome_reason: string | null;
  created_by: "navi" | "user";
  reason: string | null;
};

export type ProposalKind =
  | "workspace"
  | "project"
  | "goal"
  | "routine"
  | "event"
  | "task"
  | "reminder"
  | "note"
  | "question"
  | "memory"
  | "preference";

export type Proposal = {
  id: string;
  capture_id: string | null;
  conversation_id: string | null;
  batch: string | null;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  ref_key: string | null;
  source_excerpt: string | null;
  origin: "stated" | "inferred";
  confidence: number;
  rationale: string | null;
  status: "pending" | "accepted" | "rejected" | "deferred" | "merged";
  result_table: string | null;
  result_id: string | null;
  decided_at: string | null;
  created_at: string;
};

export type Memory = {
  id: string;
  kind: "profile" | "project" | "episodic" | "behavioral";
  content: string;
  project_id: string | null;
  origin: "stated" | "inferred" | "observed";
  confidence: number;
  status: "active" | "superseded" | "rejected";
  evidence: unknown[];
  superseded_by?: string | null;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  title: string | null;
  body: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  modality: "text" | "voice";
  tool_events: ToolEvent[];
  created_at: string;
};

export type ToolEvent = { name: string; ok: boolean; summary: string };

export type Approval = {
  id: string;
  action_type: string;
  summary: string;
  details: Record<string, unknown>;
  idempotency_key: string;
  status: "pending" | "approved" | "rejected" | "executing" | "executed" | "failed" | "expired";
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
};

export type ActivityEntry = {
  id: string;
  actor: "user" | "navi" | "system";
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  reversible: boolean;
  reverted_at: string | null;
  created_at: string;
};

export type Briefing = {
  id: string;
  kind: "morning" | "evening" | "weekly";
  local_date: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  generated_by: "rules" | "ai";
  read_at: string | null;
  created_at: string;
};

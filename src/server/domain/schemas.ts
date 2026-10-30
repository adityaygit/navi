import { z } from "zod";

// Input schemas shared by server actions, API routes and AI tools. AI tool
// JSON Schemas are generated from these, so the model and the UI are held to
// exactly the same validation.

const uuid = z.string().uuid();
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date-time");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "must be HH:MM");
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export const TaskCreate = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).nullish(),
  priority: z.number().int().min(1).max(4).nullish().describe("1 = highest, 4 = lowest; default 3"),
  due_at: isoDateTime.nullish().describe("Deadline as ISO date-time with offset. Distinct from when work is scheduled."),
  due_is_hard: z.boolean().nullish().describe("True only for real external deadlines"),
  estimate_minutes: z.number().int().min(1).max(1440).nullish(),
  workspace_id: uuid.nullish(),
  project_id: uuid.nullish(),
  goal_id: uuid.nullish(),
  parent_task_id: uuid.nullish(),
  recurrence: z
    .object({ freq: z.enum(["daily", "weekly"]), days: weekdays.nullish() })
    .nullish(),
});
export type TaskCreate = z.infer<typeof TaskCreate>;

export const TaskUpdate = TaskCreate.partial().extend({
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).nullish(),
  blocker: z.string().max(1000).nullish(),
});
export type TaskUpdate = z.infer<typeof TaskUpdate>;

export const WorkspaceCreate = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
});

export const GoalCreate = z.object({
  title: z.string().min(1).max(300),
  why: z.string().max(2000).nullish(),
  measure: z.string().max(500).nullish().describe("How progress is measured"),
  target_date: isoDate.nullish(),
  workspace_id: uuid.nullish(),
});

export const ProjectCreate = z.object({
  name: z.string().min(1).max(200),
  objective: z.string().max(2000).nullish(),
  notes: z.string().max(10000).nullish(),
  due_date: isoDate.nullish(),
  workspace_id: uuid.nullish(),
  goal_id: uuid.nullish(),
});

export const MilestoneCreate = z.object({
  title: z.string().min(1).max(300),
  due_date: isoDate.nullish(),
  project_id: uuid.nullish(),
  goal_id: uuid.nullish(),
});

export const RoutineCreate = z.object({
  title: z.string().min(1).max(200),
  days: weekdays.describe("0 = Sunday ... 6 = Saturday"),
  start_time: hhmm.nullish().describe("Local start time; omit if it can float within the day"),
  duration_minutes: z.number().int().min(1).max(1440),
  is_fixed: z.boolean().nullish().describe("True when the time cannot move (e.g. practice at 4pm)"),
  workspace_id: uuid.nullish(),
  goal_id: uuid.nullish(),
});

export const EventCreate = z.object({
  title: z.string().min(1).max(300),
  starts_at: isoDateTime,
  ends_at: isoDateTime,
  location: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  workspace_id: uuid.nullish(),
  recurrence: z
    .object({ freq: z.literal("weekly"), days: weekdays, until: isoDate.nullish() })
    .nullish()
    .describe("Weekly repetition for fixed commitments like classes"),
});

export const NoteCreate = z.object({
  title: z.string().max(300).nullish(),
  body: z.string().trim().min(1, "can't be empty").max(20000),
  workspace_id: uuid.nullish(),
  project_id: uuid.nullish(),
});

export const MemoryCreate = z.object({
  kind: z.enum(["profile", "project", "episodic", "behavioral"]),
  content: z.string().min(1).max(2000),
  origin: z.enum(["stated", "inferred", "observed"]),
  confidence: z.number().min(0).max(1).nullish(),
  project_id: uuid.nullish(),
});

export const ProfileUpdate = z.object({
  display_name: z.string().max(120).nullish(),
  timezone: z.string().max(64).nullish(),
  quiet_hours_start: hhmm.nullish(),
  quiet_hours_end: hhmm.nullish(),
  morning_briefing_time: hhmm.nullish(),
  evening_review_time: hhmm.nullish(),
  weekly_review_day: z.number().int().min(0).max(6).nullish(),
  briefings_enabled: z.boolean().nullish(),
  availability: z
    .array(z.object({ days: weekdays, start: hhmm, end: hhmm }))
    .max(14)
    .nullish()
    .describe("When flexible work may be scheduled"),
});

/** Drop undefined/null-ish keys the caller didn't intend to set (nullish -> omit). */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

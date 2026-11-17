import { z } from "zod";

// The scheduling commands: one contract for Navi's tools, the web and the
// phone app (and the future manual planner). Times are local "HH:MM" (on
// `date`, default today), "now", or ISO date-times; Navi's code resolves them.

const id = z.string().uuid();
const day = z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/, "YYYY-MM-DD, 'today' or 'tomorrow'");
const start = z.string().min(3).max(40);
const mins = z.number().int().min(5).max(480);

export const CommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule_task"), task_id: id, start, date: day.nullish(), minutes: mins.nullish() }),
  z.object({ kind: z.literal("move_block"), block_id: id, start, date: day.nullish() }),
  z.object({ kind: z.literal("resize_block"), block_id: id, minutes: mins }),
  /** Several blocks moved in one change (sessions move as a unit). */
  z.object({ kind: z.literal("move_many"), moves: z.array(z.object({ block_id: id, start, date: day.nullish(), minutes: mins.nullish() })).min(1).max(30) }),
  z.object({
    kind: z.literal("swap"),
    place_task_id: id.nullish(), place_block_id: id.nullish(), start: start.nullish(), minutes: mins.nullish(),
    remove_task_id: id.nullish(), remove_block_id: id.nullish(), date: day.nullish(),
  }),
  z.object({ kind: z.literal("split_task"), task_id: id, sessions: z.array(z.object({ start, date: day.nullish(), minutes: mins })).min(1).max(8) }),
  z.object({ kind: z.literal("unschedule"), date: day.nullish(), task_ids: z.array(id).max(30).nullish(), block_ids: z.array(id).max(30).nullish(), keep_off: z.boolean().nullish() }),
  z.object({ kind: z.literal("clear_day"), date: day.nullish(), include_locked: z.boolean().nullish() }),
  z.object({ kind: z.literal("lock"), block_ids: z.array(id).min(1).max(30), locked: z.boolean() }),
  z.object({ kind: z.literal("set_scope"), date: day.nullish(), mode: z.enum(["only", "include", "exclude", "clear"]), task_ids: z.array(id).min(1).max(40) }),
  z.object({ kind: z.literal("group_session"), task_ids: z.array(id).min(2).max(8), start, date: day.nullish(), minutes: z.array(mins).max(8).nullish(), title: z.string().max(200).nullish() }),
  z.object({
    kind: z.literal("replan"),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(7),
    focus_task_ids: z.array(id).max(10).nullish(),
    exceptions: z.array(z.object({ date: z.string().nullish(), kind: z.enum(["busy", "free", "capacity"]), start_time: z.string().nullish(), end_time: z.string().nullish(), minutes: z.number().int().nullish(), note: z.string().max(200).nullish() })).max(12).nullish(),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;

/** How a command runs. */
export type CommandOptions = {
  /** "preview": work it out and show it as one card (an offer); nothing changes. Default "apply". */
  mode?: "apply" | "preview";
  /** Consequence keys the person explicitly authorized (from a preview), with their own words this turn. */
  authorize?: string[] | null;
  userQuote?: string | null;
  /** The person explicitly allowed overlapping a fixed commitment. */
  allowOverlap?: boolean;
  /** Same key = same request: it runs at most once. */
  idempotencyKey?: string | null;
  /** The person reaffirmed after Navi's one challenge (accountability). */
  reaffirmed?: boolean;
  /** The reason they gave, if any. */
  reason?: string | null;
};

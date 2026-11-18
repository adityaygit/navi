import "server-only";
import { z } from "zod";
import { DateTime } from "luxon";
import { fixedClash, fixedSpans } from "@/server/planner/clash";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import { createProposals, proposalProblem } from "@/server/domain/proposals";
import { createTask, completeTask, updateTask } from "@/server/domain/tasks";
import { deleteEntity, getEntity, updateEntity, type EntityTable } from "@/server/domain/entities";
import { logActivity, revertActivities, revertActivity, sameValue } from "@/server/domain/activity";
import { plannerV2, plannerCommands } from "@/lib/planner-flag";
import { createHash } from "node:crypto";
import { executeCommand, confirmChange, type Command, type CommandOptions, type CommandResult } from "@/server/planner/commands";
import { addPlanningRule, changePlanningRule, describeRule, listPlanningRules } from "@/server/domain/planning-rules";
import { quoteIsTheirs } from "@/server/planner/commands/authorize";
import { atLocalTime } from "@/lib/time";
import { wakeBed } from "@/server/day";
import { isWakeBedDefault, occurrencesOn, type DayModel } from "@/server/planner/day-model";
import { scheduleDayV2 } from "@/server/planner/scheduler-v2";
import { loadDayModels, planDays } from "@/server/planner/plan-v2";
import { routineRule } from "@/server/planner/agenda";
import { addMemory, relevantMemories } from "@/server/domain/memory";
import { decideApproval, requestApproval, reviseApproval } from "@/server/domain/approvals";
import { autonomyFrom } from "@/lib/actions";
import { READ_ONLY_TOOLS } from "@/lib/tool-names";
import { generateDayPlan, generateWeekPlan, recoverPlan } from "@/server/planner/plan";
import { ProfileUpdate, TaskCreate, TaskUpdate, compact } from "@/server/domain/schemas";
import { ENTITY_PATCHES } from "@/server/domain/schemas";
import { formatDue, formatTime, nowIn } from "@/lib/time";
import { awaitingTriage, isImported } from "@/lib/triage";
import { integrations } from "@/server/integrations";
import { resolveTriage } from "@/server/domain/triage";
import type { CalendarEvent, OccurrenceOverride, PlanBlock, Proposal, Routine, Task, ToolEvent } from "@/lib/types";
import { buildDayAgenda, describeDayAgenda, type AgendaEntry } from "@/server/planner/agenda";
import { proposalTitle } from "@/server/domain/proposals";
import { fixWeekdayNumbering, guardInventedTimes } from "./time-guard";
import { dayReview, weekInsights, type DayReview } from "@/server/domain/insights";
import { changeLine, planView, summarizeDayPlan, summarizeWeekPlan, type PlanChange } from "@/lib/plan-summary";
import { clockFor, dayWord, fieldWords, legacyDisplay, partOfDay, PLAN_TOOLS, q, shortTitle, things } from "@/lib/plain-text";
import { resolveClock, resolveDay, shiftTimes } from "@/lib/time-words";
import type { StepView } from "@/lib/tool-events";

// The tools Navi can use. The same registry backs text chat, real-time voice
// and onboarding, and every tool calls the same domain functions the
// dashboard uses, with the user's own database permissions.

/**
 * `summary`: exact, for the model (it's all later turns see of the action).
 * `display` (+ `detail`, `leftover`): what the person sees, in plain words
 * (src/lib/plain-text.ts); never the summary. `plan`: it changed the plan, so
 * the chat groups it with the reply's other plan changes under one Undo.
 * `actionId`: the step proposed (or changed) an action that waits for the
 * person's OK; the chat shows it as a card. `undo`: activity entries that undo
 * what the step changed on its own.
 */
/**
 * If Navi created this task earlier in the current chat (one of this chat's
 * replies carries the creation's undo id) and nothing has changed it since
 * (same values, no plan blocks, no steps), undo that creation and return the
 * title. Anything else returns null and goes the normal way (a card).
 * Found by the real-model stress test C3 (2026-11-17): "add a task to call
 * grandma" → "actually forget what I just said" made a deletion card.
 */
async function undoOwnCreation(ctx: Ctx, taskId: string): Promise<string | null> {
  if (!ctx.conversationId) return null;
  const { data: msgs } = await ctx.db.from("messages").select("tool_events").eq("conversation_id", ctx.conversationId).eq("role", "assistant").order("created_at", { ascending: false }).limit(12);
  const ids = ((msgs ?? []) as { tool_events: ToolEvent[] | null }[]).flatMap((m) => (m.tool_events ?? []).filter((e) => e.name === "create_task").flatMap((e) => e.undo ?? []));
  if (!ids.length) return null;
  const { data: entry } = await ctx.db.from("activity_log").select("id,after,actor").in("id", ids).eq("entity_type", "tasks").eq("entity_id", taskId).is("before", null).is("reverted_at", null).eq("reversible", true).maybeSingle();
  if (!entry || entry.actor !== "navi") return null;
  const [{ data: task }, { count: blocks }, { count: steps }, { count: later }] = await Promise.all([
    ctx.db.from("tasks").select("*").eq("id", taskId).maybeSingle(),
    ctx.db.from("plan_blocks").select("id", { count: "exact", head: true }).eq("task_id", taskId),
    ctx.db.from("tasks").select("id", { count: "exact", head: true }).eq("parent_task_id", taskId),
    ctx.db.from("activity_log").select("id", { count: "exact", head: true }).eq("entity_id", taskId).neq("id", entry.id).eq("reversible", true).is("reverted_at", null),
  ]);
  if (!task || blocks || steps || later) return null;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  if (Object.entries(after).some(([k, v]) => k in task && k !== "updated_at" && !sameValue((task as Record<string, unknown>)[k], v))) return null;
  try {
    await revertActivity(ctx, entry.id);
  } catch {
    return null;
  }
  return (task as { title: string }).title;
}

export type ToolResult = { ok: boolean; summary: string; data?: unknown; mutated?: boolean; actionId?: string; undo?: string[] } & StepView;

/** What a tool says when its change became a card instead of running. */
const WAITING = "It's shown to the user as a card with Approve and Decline; nothing has changed yet. Don't ask them to confirm in text.";

export type NaviTool<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: S;
  run: (ctx: Ctx, input: z.infer<S>) => Promise<ToolResult>;
};

function tool<S extends z.ZodTypeAny>(t: NaviTool<S>): NaviTool<S> {
  return t;
}

const ProposalItem = z.object({
  kind: z.enum(["workspace", "project", "goal", "routine", "event", "task", "reminder", "note", "question", "memory", "preference"]),
  payload: z
    .record(z.string(), z.unknown())
    .describe(
      "Fields for the item. workspace:{name,description}; goal:{title,why,measure,target_date,workspace_ref}; project:{name,objective,due_date,workspace_ref,goal_ref}; routine:{title,days[0-6],start_time HH:MM|null,duration_minutes,is_fixed,workspace_ref,goal_ref}; event:{title,starts_at,ends_at,recurrence{freq:'weekly',days,until}|null,location,workspace_ref}; task/reminder:{title,notes,priority 1-4,due_at,due_is_hard,estimate_minutes,workspace_ref,project_ref,goal_ref}; note:{title,body}; question:{question}; memory:{kind:profile|project|episodic|behavioral,content,origin:'stated'|'inferred'}; preference:{display_name (what the user wants to be called),timezone,quiet_hours_start,quiet_hours_end,morning_briefing_time,evening_review_time,availability[{days,start,end}]}. Use *_ref to point at another proposal's ref_key in the same call, or at an existing item's id. Weekday numbers everywhere (days, recurrence.days, availability days): 0=Sunday, 1=Monday ... 6=Saturday; weekdays = [1,2,3,4,5]. Date-times are local wall-clock time with the user's UTC offset (8 AM in New York in winter = ...T08:00:00-05:00), never Z unless the user's time zone is UTC.",
    ),
  ref_key: z.string().max(60).nullish().describe("Short unique key so other proposals can reference this one, e.g. 'ws_school'"),
  source_excerpt: z.string().max(1000).nullish().describe("The user's exact words this came from"),
  origin: z.enum(["stated", "inferred"]).describe("stated = the user said it explicitly; inferred = your interpretation"),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(500).nullish().describe("Why you propose this, briefly"),
});

/** Lowercase letters and digits only, single-spaced: quoting differences don't matter. */
function normalizeWords(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const DONE_WORDS = /\b(done|finish\w*|complet\w*|submit\w*|sent|did|handed in|turned in|wrapped up|paid|booked|called|emailed|texted|bought|fixed|cleaned|check\w* (it )?off|tick\w* (it )?off|\w{3,}ed)\b/;

/**
 * Did the person's own message this turn say the work is finished? The
 * quoted statement must appear in it (ignoring case, spacing and punctuation)
 * and read like a completion.
 */
const sameTitle = (t: string) => t.replace(/\s*\[[^[\]]*\]\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * An open task the person would call "the same one": same title (ignoring a
 * trailing "[Course]", case and punctuation). An imported assignment counts
 * when no due date was given or it's due within 36 hours of the new one.
 */
export async function findSameTask(ctx: Ctx, title: string, dueAt: string | null) {
  const key = sameTitle(title);
  if (!key) return null;
  const { data } = await ctx.db.from("tasks").select("id,title,status,due_at,source,external_ref,created_at").in("status", ["todo", "in_progress", "blocked"]).order("created_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as Pick<Task, "id" | "title" | "status" | "due_at" | "source" | "external_ref">[];
  return rows.find((t) => {
    if (sameTitle(t.title) !== key) return false;
    if (!isImported(t) || !dueAt || !t.due_at) return true;
    return Math.abs(Date.parse(t.due_at) - Date.parse(dueAt)) <= 36 * 3600_000;
  }) ?? null;
}

export function userSaidItsDone(userMessage: string | undefined, statement: string): boolean {
  if (!userMessage) return false;
  const said = normalizeWords(userMessage);
  const quoted = normalizeWords(statement);
  if (quoted.length < 3 || !` ${said} `.includes(` ${quoted} `)) return false;
  return DONE_WORDS.test(quoted);
}

const ENTITY_TABLES = ["projects", "goals", "workspaces", "routines", "events", "milestones", "plan_blocks", "notes"] as const;

/** The columns update_item may change, per table; anything else is refused with the allowed list. */
function parseEntityPatch(table: (typeof ENTITY_TABLES)[number], patch: Record<string, unknown>): { ok: true; patch: Record<string, unknown> } | { ok: false; summary: string } {
  const schema = ENTITY_PATCHES[table];
  const allowed = Object.keys(schema.shape);
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    return { ok: false, summary: `Can't change ${unknown.join(", ")} on ${table}. Fields you can change: ${allowed.join(", ")}.` };
  }
  const parsed = schema.safeParse(patch);
  if (!parsed.success) return { ok: false, summary: `Invalid change: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const clean = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) return { ok: false, summary: "Nothing to change: the patch was empty." };
  return { ok: true, patch: clean };
}

/** Everything that can appear on the local days from `first` to `last` (inclusive). */
async function loadAgendaInputs(ctx: Ctx, zone: string, first: string, last: string) {
  const from = DateTime.fromISO(first, { zone }).startOf("day").toUTC().toISO()!;
  const to = DateTime.fromISO(last, { zone }).endOf("day").toUTC().toISO()!;
  const [events, routines, blocks, tasks, overrides] = await Promise.all([
    // Weekly events are stored once with their first occurrence, so they're expanded per date.
    ctx.db.from("events").select("*").neq("status", "cancelled").limit(500),
    ctx.db.from("routines").select("*").eq("active", true),
    ctx.db.from("plan_blocks").select("*").gte("plan_date", first).lte("plan_date", last).order("starts_at"),
    ctx.db.from("tasks").select("*").in("status", ["todo", "in_progress", "blocked"]).gte("due_at", from).lte("due_at", to).order("due_at"),
    // One-session changes (planner v2); empty for everyone else.
    ctx.db.from("event_occurrence_overrides").select("*").gte("occurrence_date", DateTime.fromISO(first).minus({ days: 7 }).toISODate()!).lte("occurrence_date", last),
  ]);
  return {
    events: (events.data ?? []) as CalendarEvent[],
    routines: (routines.data ?? []) as Routine[],
    blocks: (blocks.data ?? []) as PlanBlock[],
    tasks: (tasks.data ?? []) as Task[],
    overrides: (overrides.data ?? []) as OccurrenceOverride[],
  };
}

/** Is the constraint-first planner on for this person? */
export async function plannerV2For(ctx: Ctx): Promise<boolean> {
  if (ctx.plannerV2 !== undefined) return ctx.plannerV2;
  const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
  return plannerV2(data?.preferences);
}

/** Is the scheduling-command layer on for this person? */
export async function plannerCommandsFor(ctx: Ctx): Promise<boolean> {
  if (ctx.plannerCommands !== undefined) return ctx.plannerCommands;
  const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
  return plannerCommands(data?.preferences);
}

/** Options every scheduling-command tool takes (authorization of high-impact consequences, previews, the one challenge). */
const CommandControls = {
  mode: z.enum(["apply", "preview"]).nullish().describe("'preview' = show it as one card (an offer) and change nothing; default 'apply' (Navi's code still turns high-impact changes into a card)"),
  authorize: z.array(z.string().max(200)).max(20).nullish().describe("Consequence keys from an earlier result that the user explicitly agreed to in their own words this turn; pass with user_quote"),
  user_quote: z.string().max(300).nullish().describe("The user's exact words this turn that authorize those consequences"),
  reaffirmed: z.boolean().nullish().describe("true only after Navi challenged once and the user still wants it"),
  allow_overlap: z.boolean().nullish().describe("true only when the user explicitly said it may overlap a fixed commitment"),
};
type Controls = { mode?: "apply" | "preview" | null; authorize?: string[] | null; user_quote?: string | null; reaffirmed?: boolean | null; allow_overlap?: boolean | null };

/** Run a scheduling command for a tool call: same request in the same turn runs once. */
async function runCommand(ctx: Ctx, tool: string, cmd: Command, c: Controls = {}): Promise<ToolResult> {
  const key = ctx.turnId ? createHash("sha256").update(`${ctx.turnId}:${tool}:${JSON.stringify(cmd)}:${JSON.stringify(c)}`).digest("hex").slice(0, 40) : null;
  const opts: CommandOptions = { mode: c.mode ?? undefined, authorize: c.authorize ?? null, userQuote: c.user_quote ?? null, reaffirmed: !!c.reaffirmed, allowOverlap: !!c.allow_overlap, idempotencyKey: key };
  return commandToolResult(await executeCommand(ctx, cmd, opts));
}

/** A command's outcome as a tool result: what the model needs to act on, and what the person sees. */
export function commandToolResult(r: CommandResult): ToolResult {
  const data = {
    status: r.status,
    change_id: r.changesetId,
    consequences: r.impact?.consequences.map((c) => ({ key: c.key, level: c.level, text: c.text })) ?? [],
    checks: r.verification?.checks ?? [],
    alternatives: r.alternatives ?? [],
  };
  const changed = r.status === "applied" || r.status === "proposed";
  return {
    ok: r.ok || r.status === "proposed" || r.status === "unchanged" || r.status === "duplicate" || r.status === "challenged",
    mutated: changed,
    summary: r.status === "proposed" ? `${r.summary} ${WAITING}` : r.summary,
    data,
    ...(r.status === "challenged" ? { display: "" } : r.view),
    ...(r.status === "infeasible" || r.status === "stale" ? { display: r.view.display } : {}),
  };
}

const hours = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`);

/** Planner v2: what Navi knows about a day's free time, for the model (it never computes this itself). */
function capacityLine(m: DayModel, free: { confirmed: number; inferred: number }, zone: string): string {
  const t = (iso: string) => formatTime(iso, zone);
  const parts = [`about ${hours(free.confirmed + free.inferred)} free after fixed plans (${hours(free.confirmed)} confirmed by the user, ${hours(free.inferred)} assumed by Navi)`];
  if (m.unknown.length) parts.push(`unknown, never planned without asking: ${m.unknown.map((u) => `${t(u.starts_at)}–${t(u.ends_at)} (${u.label})`).join(", ")}`);
  if (m.busy.length) parts.push(`busy: ${m.busy.map((b) => `${b.title} ${t(b.starts_at)}–${t(b.ends_at)}${b.kind === "exception" ? " (just this day)" : " (usual)"}`).join(", ")}`);
  if (m.capacityLimitMinutes != null) parts.push(`the user said at most ${m.capacityLimitMinutes} min of work this day`);
  if (m.clarification) parts.push(`Navi knows nothing about this day yet; if planning it matters, ask: “${m.clarification}”`);
  return `  Free time: ${parts.join("; ")}.`;
}

async function capacityLines(ctx: Ctx, zone: string, dates: string[], inputs: Awaited<ReturnType<typeof loadAgendaInputs>>): Promise<Map<string, string>> {
  const models = await loadDayModels(ctx, dates);
  const out = new Map<string, string>();
  for (const d of dates) {
    const m = models.get(d)!;
    const kept = inputs.blocks.filter((b) => b.plan_date === d && (!b.is_flexible || b.created_by === "user" || b.pinned || b.status !== "planned"));
    const r = scheduleDayV2({ date: d, zone, now: DateTime.now().setZone(zone), model: m, events: inputs.events, overrides: inputs.overrides, routines: inputs.routines, tasks: [], keptBlocks: kept, loadCap: 1 });
    out.set(d, capacityLine(m, r.freeByBasis, zone));
  }
  return out;
}

function dates(zone: string, first: string, days: number): string[] {
  const start = DateTime.fromISO(first, { zone });
  return Array.from({ length: days }, (_, i) => start.plus({ days: i }).toISODate()!);
}

function entryLine(e: AgendaEntry, zone: string): string {
  const time = e.start ? `${formatTime(e.start, zone)}–${formatTime(e.end!, zone)}` : "any time";
  const kind = e.kind === "block" ? `${e.status}${e.fixed ? ", fixed" : ""}` : e.kind === "routine" ? (e.fixed ? "routine, fixed" : "routine, can move") : e.label === "external" ? "external event" : "fixed event";
  return `${time} ${e.title} (${kind}) [${e.id}]`;
}

/** The plan for one or more local dates, as text for the model. */
async function planText(ctx: Ctx, date: string | null | undefined, days: number): Promise<string> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const today = nowIn(zone).toISODate()!;
  const first = !date || date === "today" ? today : date === "tomorrow" ? DateTime.fromISO(today, { zone }).plus({ days: 1 }).toISODate()! : date;
  if (!DateTime.fromISO(first, { zone }).isValid) throw new Error(`Not a valid date: ${first}`);
  const list = dates(zone, first, days);
  const inputs = await loadAgendaInputs(ctx, zone, list[0], list[list.length - 1]);
  const v2 = plannerV2(profile.preferences);
  const caps = v2 ? await capacityLines(ctx, zone, list, inputs) : null;
  const body = list.map((d) => describeDayAgenda(buildDayAgenda({ date: d, zone, ...inputs }), zone, today, { v2 }) + (caps ? `\n${caps.get(d)}` : "")).join("\n");
  const noAvailability = !v2 && profile.availability.length === 0 ? " No availability is set, so Navi hasn't scheduled flexible work." : "";
  return `Times are in ${zone}. Today is ${DateTime.fromISO(today, { zone }).toFormat("cccc, LLL d yyyy")}.${noAvailability}\n${body}`;
}

const pct = (r: number | null) => (r === null ? null : Math.round(r * 100));

function dayFacts(d: DayReview) {
  return {
    date: d.date,
    completion_percent: pct(d.completionRate),
    explanation: d.explanation,
    planned_blocks: d.planned,
    done: d.done,
    partly_done: d.partial,
    rest: d.rest,
    interrupted: d.interrupted,
    blocked_on_missing_info: d.skippedMissingInfo,
    took_longer_than_estimated: d.overran,
    skipped_without_outside_reason: d.avoided,
    missed: d.missed,
    not_marked_yet: d.unmarked,
    focus_minutes: d.focusMinutes,
    tasks_completed: d.tasksCompleted,
    plan_broke: d.disruptions,
    findings: d.findings,
  };
}

/**
 * The computed review (same code as the Insights page, evening review and
 * briefings) plus recently stored briefings, so the model quotes real
 * numbers instead of working them out.
 */
async function reviewData(ctx: Ctx, kind: "day" | "week", date: string | null | undefined) {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const today = nowIn(zone).toISODate()!;
  const d = !date || date === "today" ? today : date === "yesterday" ? DateTime.fromISO(today, { zone }).minus({ days: 1 }).toISODate()! : date;
  if (!DateTime.fromISO(d, { zone }).isValid) throw new Error(`Not a valid date: ${d}`);
  if (d > today) throw new Error("That day hasn't happened yet; use get_plan for future days.");
  const { data: stored } = await ctx.db
    .from("briefings")
    .select("kind,local_date,title,body")
    .eq("user_id", ctx.userId)
    .lte("local_date", d)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(4);
  const stored_reviews = (stored ?? []).map((b) => ({ kind: b.kind, date: b.local_date, title: b.title, text: b.body.length > 1200 ? `${b.body.slice(0, 1200)}…` : b.body }));
  const note = "Computed by Navi's code from recorded events. Quote these numbers and findings; don't recompute or estimate statistics. Stored reviews were saved earlier and may be older than the computed review; the computed review is current.";
  if (kind === "day") return { note, timezone: zone, is_today: d === today, review: dayFacts(await dayReview(ctx.db, ctx.userId, zone, d)), stored_reviews };
  const w = await weekInsights(ctx.db, ctx.userId, zone, d);
  return {
    note,
    timezone: zone,
    week: {
      from: w.start,
      to: w.end,
      enough_data_for_trends: w.enoughData,
      average_completion_percent: pct(w.avgCompletion),
      days: w.days.map((x) => ({ date: x.date, completion_percent: pct(x.completionRate), planned_blocks: x.planned, done: x.done, partly_done: x.partial, skipped_without_outside_reason: x.avoided, not_marked_yet: x.unmarked })),
      tasks_completed: w.tasksCompleted,
      minutes: { in_planned_blocks: w.minutes.planned, in_blocks_marked_done: w.minutes.done, in_blocks_partly_done: w.minutes.partial, measured_focus: w.minutes.focus },
      estimates: { finished_tasks_with_estimates: w.estimate.samples, median_actual_to_estimate: w.estimate.medianRatio === null ? null : Math.round(w.estimate.medianRatio * 100) / 100 },
      repeatedly_avoided: w.repeatedlyAvoided.map((a) => ({ title: a.title, times_skipped_in_3_weeks: a.times })),
      blocks_that_took_longer_than_estimated: w.overran,
      plan_broke: w.disruptions,
      interruptions_by_time_of_day_3_weeks: w.interruptionsByPart,
      late_completions: w.lateCompletions,
      progress: w.progress.map((p) => ({ kind: p.kind, name: p.name, finished_this_week: p.completed, still_open: p.open })),
      next_7_days: {
        from: w.nextWeek.from,
        to: w.nextWeek.to,
        deadlines: w.nextWeek.deadlines.map((x) => ({ title: x.title, due: DateTime.fromISO(x.due_at).setZone(zone).toFormat("ccc LLL d h:mm a"), hard: x.due_is_hard })),
        work_due_minutes: w.nextWeek.loadMinutes,
        tasks_without_estimate: w.nextWeek.unestimated,
        free_minutes: w.nextWeek.freeMinutes,
        overloaded: w.nextWeek.overloaded,
      },
      findings: w.findings,
    },
    stored_reviews,
  };
}

/**
 * When a recent task was added, as provenance for the snapshot: without it a
 * task Navi created one turn earlier read as "already on the list at the start
 * of this turn", and on "did you actually do that?" the model retracted a true
 * "Added" (real-model stress test A1, 2026-11-17).
 */
function addedAgo(t: Task, now: DateTime): string {
  const created = (t as Task & { created_at?: string }).created_at;
  if (!created) return "";
  const min = Math.floor((now.toMillis() - Date.parse(created)) / 60000);
  if (min < 0 || min >= 360) return "";
  return `, added ${min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`}`;
}

async function overview(ctx: Ctx): Promise<string> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = nowIn(zone);
  const today = now.toISODate()!;
  const week = dates(zone, today, 7);
  const [inbox, projects, goals, approvals, workspaces, routines, agendaInputs] = await Promise.all([
    ctx.db.from("proposals").select("kind,payload,source_excerpt", { count: "exact" }).eq("status", "pending").order("created_at", { ascending: false }).limit(8),
    ctx.db.from("projects").select("id,name,status,due_date").eq("status", "active"),
    ctx.db.from("goals").select("id,title,status,target_date").eq("status", "active"),
    ctx.db.from("approvals").select("id,summary,revision").eq("status", "proposed").gt("expires_at", new Date().toISOString()).order("created_at"),
    ctx.db.from("workspaces").select("id,name").eq("status", "active"),
    ctx.db.from("routines").select("*").eq("active", true),
    loadAgendaInputs(ctx, zone, today, week[1]),
  ]);
  const agenda = (d: string) => buildDayAgenda({ date: d, zone, ...agendaInputs });
  const dayLine = (d: string) => agenda(d).entries.map((e) => entryLine(e, zone)).join("; ") || "nothing planned";
  const weekEvents = week.flatMap((d) =>
    agendaInputs.events.flatMap((e) => {
      const a = buildDayAgenda({ date: d, zone, events: [e], routines: [], blocks: [], tasks: [] }).entries[0];
      return a ? [`${e.title} ${DateTime.fromISO(a.start!).setZone(zone).toFormat("ccc LLL d h:mm a")}${e.recurrence ? " (weekly)" : ""} [${e.id}]`] : [];
    }),
  );
  const lines: string[] = [];
  const later = now.plus({ days: 7 });
  const offsets = `UTC offset ${now.toFormat("ZZ")}${later.offset !== now.offset ? `, ${later.toFormat("ZZ")} from ${week.find((d) => DateTime.fromISO(d, { zone }).endOf("day").offset !== now.offset) ?? later.toISODate()}` : ""}`;
  const v2 = plannerV2(profile.preferences);
  const commands = plannerCommands(profile.preferences);
  const wb = wakeBed(profile);
  const usual = v2
    ? `Usual times: ${wb ? `up ${wb.wake}, bed ${wb.bed}` : "wake-up/bedtime unknown"}; free times they set: ${isWakeBedDefault(profile.availability, wb) ? "none (only the setup default)" : JSON.stringify(profile.availability)}. Navi's planner works out free time itself (confirmed / assumed / unknown, see Free time lines); never ask the user to set availability.`
    : `Availability: ${JSON.stringify(profile.availability)}.`;
  lines.push(`Now: ${now.toFormat("cccc, LLL d yyyy, h:mm a")} (${zone}, ${offsets}). ${usual} Quiet hours: ${profile.quiet_hours_start ?? "not set"}–${profile.quiet_hours_end ?? "not set"}. Name: ${profile.display_name ?? "not set"}.`);
  lines.push(`Workspaces: ${(workspaces.data ?? []).map((w) => `${w.name} [${w.id}]`).join("; ") || "none"}`);
  lines.push(`Active goals: ${(goals.data ?? []).map((g) => `${g.title}${g.target_date ? ` (by ${g.target_date})` : ""} [${g.id}]`).join("; ") || "none"}`);
  lines.push(`Active projects: ${(projects.data ?? []).map((p) => `${p.name}${p.due_date ? ` (due ${p.due_date})` : ""} [${p.id}]`).join("; ") || "none"}`);
  const routineText = (r: Routine) =>
    v2 ? `${r.title} days=${r.days.join(",")} ${r.start_time ? r.start_time : "no set time"} ${r.duration_minutes}m (${routineRule(r)}) [${r.id}]` : `${r.title} days=${r.days.join(",")} ${r.start_time ? `${r.start_time}${r.is_fixed ? " fixed" : " preferred, can move"}` : "no set time"} ${r.duration_minutes}m [${r.id}]`;
  lines.push(`Routines: ${((routines.data ?? []) as Routine[]).map(routineText).join("; ") || "none"}`);
  lines.push(`Fixed events, next 7 days: ${weekEvents.slice(0, 30).join("; ") || "none"}`);
  const caps = v2 ? await capacityLines(ctx, zone, [today, week[1]], agendaInputs) : null;
  lines.push(`Today's plan: ${dayLine(today)}${caps ? `\n${caps.get(today)}` : ""}`);
  lines.push(`Tomorrow's plan (${week[1]}): ${dayLine(week[1])}. For any other date, call get_plan.${caps ? `\n${caps.get(week[1])}` : ""}`);
  let open: Task[] = [];
  let triageLine = "";
  {
    // Every open task is considered (not the first 40 by due date: a backlog
    // of overdue imports used to push the person's own undated tasks out of
    // Navi's sight, so it "didn't see" a task it had just created and made it
    // again). The person's own and chosen work first; overdue imported work is
    // summarised as waiting for a decision.
    const [{ data: all, error: allErr }, scopeRes] = await Promise.all([
      // estimate_source exists only with the planner commands migration (20261117000001).
      ctx.db.from("tasks").select(`id,title,status,priority,due_at,due_is_hard,estimate_minutes,project_id,blocker,commitment,source,external_ref,created_at${commands ? ",estimate_source" : ""}`).in("status", ["todo", "in_progress", "blocked"]).order("created_at", { ascending: false }).limit(400),
      commands ? ctx.db.from("day_plan_scope").select("task_id,mode").eq("date", today) : Promise.resolve({ data: [] as { task_id: string; mode: string }[] }),
    ]);
    if (allErr) throw new Error(`Could not read open tasks: ${allErr.message}`);
    const rows = (all ?? []) as unknown as (Task & { created_at: string })[];
    const scope = (scopeRes.data ?? []) as { task_id: string; mode: string }[];
    const chosen = new Set(scope.filter((x) => x.mode !== "exclude").map((x) => x.task_id));
    const offToday = new Set(scope.filter((x) => x.mode === "exclude").map((x) => x.task_id));
    const nowMs = Date.now();
    const overdueImported = rows.filter((t) => awaitingTriage(t, nowMs, chosen.has(t.id)));
    const recent = (t: { created_at: string }) => nowMs - Date.parse(t.created_at) < 6 * 3600_000;
    const rank = (t: Task & { created_at: string }) => (chosen.has(t.id) ? 0 : t.commitment === "must" ? 1 : recent(t) ? 2 : !isImported(t) ? 3 : 4);
    open = rows.filter((t) => !overdueImported.includes(t)).sort((a, b) => rank(a) - rank(b) || (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")).slice(0, 60)
      .map((t) => ({ ...t, title: `${t.title}${chosen.has(t.id) ? " [chosen for today]" : offToday.has(t.id) ? " [kept off today]" : ""}${isImported(t) ? " (Canvas)" : ""}` }));
    const shown = rows.length - overdueImported.length;
    if (shown > open.length) triageLine += `\n(${shown - open.length} more open tasks not listed; call search_items before creating anything that may already exist.)`;
    if (overdueImported.length) {
      triageLine += `\nOverdue imported (Canvas) work, NOT planned automatically and waiting for the user's decision (the feed can't show whether it was handed in): ${overdueImported.length} item${overdueImported.length === 1 ? "" : "s"}`
        + (commands ? " (call get_backlog for the list)." : `: ${overdueImported.slice(0, 40).map((t) => `${t.title} (was due ${formatDue(t.due_at!, zone)}) [${t.id}]`).join("; ")}${overdueImported.length > 40 ? "; …" : ""}.`)
        + " Don't call them failures to fit or \"due today\", don't plan them unless the user chooses them, and when the user says they're handed in, mark them done.";
    }
  }
  lines.push(
    `Open tasks: ${open.map((t) => `${t.title} (${v2 && t.commitment === "must" ? "MUST-COMPLETE, " : v2 && t.commitment === "optional" ? "optional, " : ""}P${t.priority}, ${t.status}${t.due_at ? `, due ${formatDue(t.due_at, zone)}${t.due_is_hard ? " HARD" : ""}` : ", no due date"}${t.estimate_minutes ? `, ~${t.estimate_minutes}m${commands && t.estimate_source === "user" ? " (user's estimate)" : ""}` : ""}${t.blocker ? `, blocked: ${t.blocker}` : ""}${addedAgo(t, now)}) [${t.id}]`).join("; ") || "none"}${triageLine}`,
  );
  const pending = (inbox.data ?? []) as Pick<Proposal, "kind" | "payload" | "source_excerpt">[];
  lines.push(
    `Review inbox: ${inbox.count ?? 0} pending${pending.length ? ` (newest: ${pending.map((p) => `${proposalTitle(p).slice(0, 60)} (${p.kind})`).join("; ")})` : ""}; get_inbox has details and recent captures. Actions waiting for the user's OK on a card (change one with revise_action, drop one with decline_action): ${(approvals.data ?? []).map((a) => `${a.summary}${a.revision > 1 ? " (changed)" : ""} [${a.id}]`).join("; ") || "none"}.`,
  );
  return lines.join("\n");
}

const DAY_WORDS = /\b(today|tonight|tomorrow|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?|weekend|next week)\b/i;

/** Exactly what a created task's dates are, so the reply can't overstate it. */
function taskDateSummary(t: Pick<Task, "due_at" | "due_is_hard">, zone: string, userCommand: string): string {
  if (t.due_at) {
    const due = DateTime.fromISO(t.due_at).setZone(zone);
    const when = due.hour === 23 && due.minute === 59 ? due.toFormat("cccc LLL d") : due.toFormat("cccc LLL d, h:mm a");
    return `${t.due_is_hard ? "hard deadline" : "soft due date"} ${when}. It is not scheduled at a set time; tasks have no do-date, only a due date (plan_day can place it in that day's free time)`;
  }
  const said = userCommand.match(DAY_WORDS)?.[0];
  return `no due date${said ? `. The request mentions “${said}” but no date was set, so don't say it's on ${said}; set due_at with update_task if they meant that day` : ""}`;
}

/** A task's due date plus the work blocks already planned for it, stated exactly. */
async function taskScheduleSummary(ctx: Ctx, t: Pick<Task, "id" | "due_at" | "due_is_hard">): Promise<string> {
  const zone = ctx.timezone;
  const due = t.due_at
    ? (() => {
        const d = DateTime.fromISO(t.due_at).setZone(zone);
        return `${t.due_is_hard ? "hard deadline" : "soft due date"} ${d.hour === 23 && d.minute === 59 ? d.toFormat("cccc LLL d") : d.toFormat("cccc LLL d, h:mm a")}`;
      })()
    : "no due date";
  const { data } = await ctx.db.from("plan_blocks").select("starts_at").eq("task_id", t.id).in("status", ["planned", "in_progress"]).gte("ends_at", new Date().toISOString()).order("starts_at").limit(5);
  const blocks = (data ?? []).map((b) => DateTime.fromISO(b.starts_at).setZone(zone).toFormat("ccc LLL d h:mm a"));
  return `${due}; ${blocks.length ? `work already planned in blocks at ${blocks.join(", ")}` : "no work block planned yet"}`;
}

async function inboxText(ctx: Ctx): Promise<string> {
  const zone = ctx.timezone;
  const [pending, captures, activity] = await Promise.all([
    ctx.db.from("proposals").select("*").in("status", ["pending", "deferred"]).order("created_at", { ascending: false }).limit(30),
    ctx.db.from("captures").select("id,raw_text,source,status,captured_at").order("captured_at", { ascending: false }).limit(5),
    ctx.db.from("activity_log").select("actor,summary,created_at").order("created_at", { ascending: false }).limit(12),
  ]);
  const caps = captures.data ?? [];
  const { data: fromCaptures } = caps.length ? await ctx.db.from("proposals").select("*").in("capture_id", caps.map((c) => c.id)) : { data: [] };
  const made = ((fromCaptures ?? []) as Proposal[]).filter((p) => p.result_table === "tasks" && p.result_id).map((p) => p.result_id!);
  const { data: madeTasks } = made.length ? await ctx.db.from("tasks").select("id,title,status").in("id", made) : { data: [] };
  const taskById = new Map((madeTasks ?? []).map((t) => [t.id, t]));
  const when = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("ccc LLL d, h:mm a");
  const describe = (p: Proposal) => {
    const pl = p.payload as Record<string, unknown>;
    const due = typeof pl.due_at === "string" ? `, due ${formatDue(pl.due_at, zone)}` : "";
    let state: string = p.status;
    if (p.status === "accepted" || p.status === "merged") {
      const t = p.result_id ? taskById.get(p.result_id) : undefined;
      state = `${p.status}${p.result_table ? ` → ${p.result_table.replace(/s$/, "")}${t ? ` “${t.title}” (now ${t.status})` : ""}` : ""}${p.result_id ? ` [${p.result_id}]` : ""}`;
    }
    return `${p.kind} “${proposalTitle(p).slice(0, 100)}”${due} — ${state}`;
  };
  const lines: string[] = [];
  const list = (pending.data ?? []) as Proposal[];
  lines.push(`Review inbox (pending/deferred, newest first): ${list.length ? "" : "empty"}`);
  for (const p of list) lines.push(`  - ${describe(p)}${p.batch === "onboarding" ? " (setup review)" : ""}, added ${when(p.created_at)} [${p.id}]`);
  lines.push(`Recent captures (newest first): ${caps.length ? "" : "none"}`);
  for (const c of caps) {
    const items = ((fromCaptures ?? []) as Proposal[]).filter((p) => p.capture_id === c.id);
    lines.push(`  - ${when(c.captured_at)} via ${c.source}, ${c.status}: “${c.raw_text.slice(0, 300)}”`);
    lines.push(items.length ? items.map((p) => `      · ${describe(p)}`).join("\n") : "      · no items extracted yet");
  }
  lines.push("Recent activity (newest first):");
  for (const a of activity.data ?? []) lines.push(`  - ${when(a.created_at)} by ${a.actor}: ${a.summary}`);
  return lines.join("\n");
}

// ---- planner v2 helpers -------------------------------------------------------

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM, 24-hour local time");

function resolveDate(date: string | null | undefined, zone: string): string {
  const today = nowIn(zone).toISODate()!;
  if (!date || date === "today") return today;
  if (date === "tomorrow") return DateTime.fromISO(today, { zone }).plus({ days: 1 }).toISODate()!;
  if (!DateTime.fromISO(date, { zone }).isValid) throw new Error(`Not a valid date: ${date}`);
  return date;
}

/** Insert one of the person's planning facts and log it so it can be undone. */
async function createRow(ctx: Ctx, table: "day_exceptions" | "availability_rules" | "event_occurrence_overrides" | "task_dependencies", values: Record<string, unknown>, summary: string) {
  const { data, error } = await ctx.db.from(table).insert({ ...values, user_id: ctx.userId }).select().single();
  if (error) throw new Error(`Could not save that: ${error.message}`);
  await logActivity(ctx, { action: "create", entityType: table, entityId: data.id, summary, before: null, after: data, reversible: true });
  return data as Record<string, unknown>;
}

/** A one-day fact (day_exceptions), in words for the reply. */
async function addException(ctx: Ctx, x: { date: string; kind: "busy" | "free" | "capacity"; start_time?: string | null; end_time?: string | null; minutes?: number | null; note?: string | null }): Promise<string> {
  const words = x.kind === "capacity" ? `at most ${x.minutes} min of work` : `${x.kind === "busy" ? (x.note && x.note !== "Busy" ? x.note : "busy") : "free"} ${x.start_time}–${x.end_time}`;
  await createRow(ctx, "day_exceptions", { date: x.date, kind: x.kind, start_time: x.start_time ?? null, end_time: x.end_time ?? null, minutes: x.minutes ?? null, note: x.note ?? null, source: "chat" }, `For ${x.date} only: ${words}`);
  return words;
}

/** Replace a task's prerequisites (refusing a loop). */
async function setDependencies(ctx: Ctx, taskId: string, dependsOn: string[]): Promise<string> {
  const ids = [...new Set(dependsOn)].filter((d) => d !== taskId);
  const { data: all } = await ctx.db.from("task_dependencies").select("task_id,depends_on_task_id");
  const edges = (all ?? []) as { task_id: string; depends_on_task_id: string }[];
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean =>
    from === target || edges.filter((e) => e.task_id === from && !seen.has(e.depends_on_task_id)).some((e) => (seen.add(e.depends_on_task_id), reaches(e.depends_on_task_id, target, seen)));
  if (ids.some((d) => reaches(d, taskId))) return "Didn't set that order: it would make tasks wait for each other in a loop.";
  const { data: names } = ids.length ? await ctx.db.from("tasks").select("id,title").in("id", ids) : { data: [] };
  if ((names ?? []).length !== ids.length) return "Didn't set the order: one of those tasks wasn't found.";
  const current = edges.filter((e) => e.task_id === taskId);
  for (const e of current.filter((c) => !ids.includes(c.depends_on_task_id))) {
    const { data: row } = await ctx.db.from("task_dependencies").select("id").eq("task_id", taskId).eq("depends_on_task_id", e.depends_on_task_id).maybeSingle();
    if (row) {
      await ctx.db.from("task_dependencies").delete().eq("id", row.id);
      await logActivity(ctx, { action: "delete", entityType: "task_dependencies", entityId: row.id, summary: "Removed a task order" });
    }
  }
  for (const d of ids.filter((x) => !current.some((c) => c.depends_on_task_id === x))) {
    await createRow(ctx, "task_dependencies", { task_id: taskId, depends_on_task_id: d }, `Set to wait for “${(names ?? []).find((n) => n.id === d)?.title ?? "a task"}”`);
  }
  return ids.length ? `It now waits for ${(names ?? []).map((n) => `“${n.title}”`).join(", ")}.` : "It no longer waits for other tasks.";
}

/** Planner v2's extra facts about a planned day, for the model. */
function v2Data(r: object) {
  const x = r as Partial<{ assumptions: string[]; tradeoffs: string[]; clarification: string | null; conflicts: string[]; unplacedRoutines: unknown[]; blockedTasks: unknown[]; waiting: unknown[]; heldBackMinutes: number }>;
  if (!x.assumptions) return {};
  return {
    assumptions: x.assumptions, options: x.tradeoffs, ask_this: x.clarification, conflicts: x.conflicts,
    routines_not_fitted: x.unplacedRoutines, blocked_not_planned: x.blockedTasks, waiting: x.waiting, minutes_kept_free: x.heldBackMinutes,
  };
}

/**
 * What a planning result looks like in the chat. A proposal is its card;
 * an old-planner run can't be undone, so its card offers no Undo.
 */
function runView(rs: Parameters<typeof planView>[0], zone: string, run: { status: string; changes: PlanChange[] } | undefined, opts: { recovered?: boolean; changes?: PlanChange[] } = {}): StepView {
  if (run?.status === "proposed") return { plan: true };
  const view = planView(rs, zone, { changes: opts.changes ?? run?.changes, recovered: opts.recovered, unchanged: run?.status === "unchanged" });
  return { ...view, ...(run ? {} : { irreversible: true }) };
}

/** A date the person named as a word Navi says ("Monday", "tomorrow"). */
const dayName = (date: string, zone: string) => dayWord(date, zone, DateTime.now(), false).replace("tonight", "today");

/** The plan tool through the scheduling-command pipeline: one-day facts, focus and the re-plan in ONE change set. */
async function planViaCommand(ctx: Ctx, first: string, input: { days?: number | null; mode?: "apply" | "propose" | null; focus_task_ids?: string[] | null; capacity_minutes?: number | null; free?: { start: string; end: string }[] | null; busy?: { start: string; end: string; title?: string | null }[] | null; start_from?: string | null }): Promise<ToolResult> {
  const zone = ctx.timezone;
  const today = nowIn(zone).toISODate()!;
  const exceptions: { date: string; kind: "busy" | "free" | "capacity"; start_time?: string | null; end_time?: string | null; minutes?: number | null; note?: string | null }[] = [];
  const facts: string[] = [];
  if (input.capacity_minutes != null) { exceptions.push({ date: first, kind: "capacity", minutes: input.capacity_minutes, note: `at most ${input.capacity_minutes} min of work` }); facts.push(`at most ${input.capacity_minutes} min of work`); }
  for (const f of input.free ?? []) { exceptions.push({ date: first, kind: "free", start_time: f.start, end_time: f.end, note: "free" }); facts.push(`free ${f.start}–${f.end}`); }
  for (const b of input.busy ?? []) { exceptions.push({ date: first, kind: "busy", start_time: b.start, end_time: b.end, note: b.title ?? "Busy" }); facts.push(`${b.title ?? "busy"} ${b.start}–${b.end}`); }
  let from: DateTime | undefined;
  if (input.start_from === "now") { if (first === today) from = resolveClock("now", first, zone, nowIn(zone))!; }
  else if (input.start_from) {
    if (first === today) from = DateTime.max(atLocalTime(first, input.start_from, zone), nowIn(zone));
    else { exceptions.push({ date: first, kind: "busy", start_time: "00:00", end_time: input.start_from, note: `not free before ${input.start_from}` }); facts.push(`not free before ${input.start_from}`); }
  }
  const days = Array.from({ length: input.days ?? 1 }, (_, i) => DateTime.fromISO(first, { zone }).plus({ days: i }).toISODate()!);
  const key = ctx.turnId ? createHash("sha256").update(`${ctx.turnId}:plan:${JSON.stringify(input)}`).digest("hex").slice(0, 40) : null;
  const r = await executeCommand(ctx, { kind: "replan", dates: days, focus_task_ids: input.focus_task_ids ?? null, exceptions }, { mode: input.mode === "propose" ? "preview" : "apply", idempotencyKey: key }, { trigger: "chat", from });
  const out = commandToolResult(r);
  const lead = facts.length ? `Saved for ${DateTime.fromISO(first, { zone }).toFormat("cccc")} only: ${facts.join("; ")}. ` : "";
  const rs = r.run?.results ?? [];
  const view = r.status === "proposed" ? { plan: true } : runView(rs, zone, r.run ? { status: r.run.status, changes: r.run.changes } : undefined);
  return {
    ...out, summary: `${lead}${out.summary}`, ...view,
    ...(facts.length && view.detail ? { detail: [...facts.map((f) => `Just ${dayName(first, zone)}: ${f}`), ...view.detail] } : {}),
    data: { ...(out.data as object), days: rs.map((x) => ({ date: x.date, blocks: x.blocks.map((b) => ({ title: b.title, start: b.starts_at, end: b.ends_at, assumed: b.basis === "inferred" })), ...v2Data(x) })) },
  };
}

export const TOOLS = [
  tool({
    name: "get_overview",
    description: "Read the user's current state: time, availability, workspaces, goals, projects, routines, fixed events for the next 7 days, today's and tomorrow's plan, open tasks (with ids), inbox and approvals. Call this before acting on existing items.",
    schema: z.object({}),
    run: async (ctx) => ({ ok: true, summary: "Read overview", data: await overview(ctx) }),
  }),
  tool({
    name: "get_plan",
    description:
      "Read what's on any day or range of days, in the user's time zone: fixed events (weekly ones included), routines that occur that day, planned work blocks with their status, and tasks due that day. Read-only. Use for questions like 'what's on tomorrow?', 'am I free Saturday?', 'what's my week look like?'.",
    schema: z.object({
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/, "YYYY-MM-DD, 'today' or 'tomorrow'").nullish().describe("First local date: YYYY-MM-DD, 'today' or 'tomorrow' (default today)"),
      days: z.number().int().min(1).max(14).nullish().describe("Number of days starting at date (default 1, max 14)"),
    }),
    run: async (ctx, { date, days }) => ({ ok: true, summary: `Read the plan for ${date ?? "today"}${days && days > 1 ? ` (+${days - 1} days)` : ""}`, data: await planText(ctx, date, days ?? 1) }),
  }),
  tool({
    name: "get_inbox",
    description:
      "Read the review inbox (pending and deferred items), the user's most recent quick captures with what became of each extracted item (pending, accepted into a task, rejected, merged), and the recent activity log (what changed and who did it). Read-only. Quick captures and dashboard edits are NOT in chat history, so call this for questions about captures, the inbox, or what changed.",
    schema: z.object({}),
    run: async (ctx) => ({ ok: true, summary: "Read the inbox, recent captures and activity", data: await inboxText(ctx) }),
  }),
  tool({
    name: "get_review",
    description:
      "Read how the user did, computed by Navi's code from what was recorded: kind 'day' gives a day's completion rating with its explanation, counts (done, partly done, rest, interrupted, missing info, took longer than estimated, skipped without an outside reason, not marked yet), focus minutes, findings and plan disruptions; kind 'week' gives the 7 days ending on date: average and per-day completion, estimate accuracy, repeatedly avoided tasks, project/goal progress, planned vs done minutes, disruptions, next week's deadlines and work vs free time, and findings. Also returns recently stored briefings and reviews. Read-only. Use it for 'how did I do today/yesterday/this week?', ratings, streaks or patterns, and quote its numbers.",
    schema: z.object({
      kind: z.enum(["day", "week"]).describe("'day' for one day, 'week' for the 7 days ending on date"),
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|yesterday)$/, "YYYY-MM-DD, 'today' or 'yesterday'").nullish().describe("Local date (default today); for 'week', the last day of the week"),
    }),
    run: async (ctx, { kind, date }) => ({ ok: true, summary: `Read the ${kind === "day" ? "day" : "week"} review${date ? ` for ${date}` : ""}`, data: await reviewData(ctx, kind, date) }),
  }),
  tool({
    name: "search_items",
    description: "Find tasks (any status, including done), projects, goals, events, routines, saved notes (title or text) and review-inbox items matching a query. Use it before creating a task to avoid duplicates, to check an item's current status, and to look up what the user noted down.",
    schema: z.object({ query: z.string().min(1).max(200) }),
    run: async (ctx, { query }) => {
      const q = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      const [t, p, g, e, r, inbox, nt, nb] = await Promise.all([
        ctx.db.from("tasks").select("id,title,status,due_at,due_is_hard,priority").ilike("title", q).order("updated_at", { ascending: false }).limit(10),
        ctx.db.from("projects").select("id,name,status,objective").ilike("name", q).limit(5),
        ctx.db.from("goals").select("id,title,status").ilike("title", q).limit(5),
        ctx.db.from("events").select("id,title,starts_at,recurrence").ilike("title", q).limit(5),
        ctx.db.from("routines").select("id,title,days,start_time,is_fixed,active").ilike("title", q).limit(5),
        ctx.db.from("proposals").select("id,kind,payload,source_excerpt,status,created_at").in("status", ["pending", "deferred"]).order("created_at", { ascending: false }).limit(100),
        ctx.db.from("notes").select("id,title,body,updated_at").ilike("title", q).order("updated_at", { ascending: false }).limit(10),
        ctx.db.from("notes").select("id,title,body,updated_at").ilike("body", q).order("updated_at", { ascending: false }).limit(10),
      ]);
      const noteRows = new Map([...(nt.data ?? []), ...(nb.data ?? [])].map((n) => [n.id, n]));
      const notes = [...noteRows.values()].slice(0, 10).map((n) => ({ id: n.id, title: n.title, text: n.body.length > 400 ? `${n.body.slice(0, 400)}…` : n.body, updated_at: n.updated_at }));
      const needle = query.toLowerCase();
      const inboxHits = ((inbox.data ?? []) as Proposal[])
        .filter((x) => `${proposalTitle(x)} ${x.source_excerpt ?? ""}`.toLowerCase().includes(needle))
        .slice(0, 10)
        .map((x) => ({ id: x.id, kind: x.kind, title: proposalTitle(x), status: x.status }));
      return { ok: true, summary: `Searched for “${query}”`, data: { tasks: t.data, projects: p.data, goals: g.data, events: e.data, routines: r.data, notes, inbox_items_not_yet_accepted: inboxHits } };
    },
  }),
  tool({
    name: "propose_items",
    description:
      "Put NEW items you inferred from what the user said into their review inbox (they become real only when the user accepts them). Use this for anything from brain dumps, casual mentions, or onboarding. Preserve the user's words in source_excerpt and be honest about origin and confidence.",
    schema: z.object({ items: z.array(ProposalItem).min(1).max(40), batch: z.enum(["onboarding", "capture"]).nullish() }),
    run: async (ctx, { items: proposed, batch }) => {
      // A memory's origin is often given only once, on the item (Gemini Live did
      // this and retried a dozen times); the item's own origin is the answer.
      let items = fixWeekdayNumbering(
        proposed.map((i) => (i.kind === "memory" ? { ...i, payload: { kind: "profile", ...i.payload, origin: i.payload.origin ?? i.origin } } : i)),
        ctx.timezone,
      );
      if (ctx.captureId) {
        // Captures: a time of day the user never said isn't invented (checked against their words).
        const { data: capture } = await ctx.db.from("captures").select("raw_text").eq("id", ctx.captureId).maybeSingle();
        if (capture?.raw_text) items = guardInventedTimes(items, { sourceText: capture.raw_text, zone: ctx.timezone, now: DateTime.now() });
      }
      const problems = items.flatMap((i, n) => {
        const p = proposalProblem(i.kind, i.payload as Record<string, unknown>);
        return p ? [`item ${n + 1} (${i.kind} “${proposalTitle({ kind: i.kind, payload: i.payload, source_excerpt: i.source_excerpt ?? null }).slice(0, 60)}”): ${p}`] : [];
      });
      if (problems.length) {
        return {
          ok: false,
          summary: `Nothing added yet: ${problems.length} item${problems.length === 1 ? "" : "s"} incomplete`,
          data: {
            problems,
            fix: "Call propose_items again with ALL the items, these ones fixed. If a detail such as an end time is unknown, use a sensible default (e.g. 1 hour) and say it's assumed in rationale.",
          },
        };
      }
      if (batch === "onboarding") {
        // A new onboarding draft replaces the previous unreviewed one instead of duplicating it.
        await ctx.db.from("proposals").delete().eq("user_id", ctx.userId).eq("batch", "onboarding").eq("status", "pending");
      }
      const created = await createProposals(ctx, items.map((i) => ({ ...i, payload: i.payload as Record<string, unknown> })), {
        conversationId: ctx.conversationId ?? null,
        captureId: ctx.captureId ?? null,
        batch: batch === "onboarding" ? "onboarding" : null,
      });
      return { ok: true, mutated: true, summary: `Added ${created.length} item${created.length === 1 ? "" : "s"} to the review inbox`, display: batch === "onboarding" ? `Picked up ${things(created.length)}` : `Put ${things(created.length)} in your inbox to review` };
    },
  }),
  tool({
    name: "create_task",
    description:
      "Create a committed task immediately. ONLY when the user directly and explicitly commands it right now (e.g. 'add a task to email Ms. Lee'). For anything inferred or mentioned in passing, use propose_items instead. Check search_items first so you don't duplicate an existing task or inbox item. Tasks have no 'do on' date, only a due date: if the user names a day ('call mom on Sunday'), set due_at to the end of that day (23:59 local) with due_is_hard=false unless they say it's a real deadline. Don't write dates into notes. Tell the user exactly what the result says was set (e.g. 'due Sunday, not a hard deadline'); never say it's scheduled or planned for a day unless a plan block was actually made.",
    schema: TaskCreate.extend({
      user_command: z.string().min(3).max(300).describe("The user's explicit instruction, quoted"),
      allow_duplicate: z.boolean().nullish().describe("Only when the user explicitly wants a second, separate task with the same name as an existing open one"),
      schedule: z.object({ start: z.string().max(40).describe("Local HH:MM or 'now'"), date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), minutes: z.number().int().min(5).max(480).nullish() }).nullish()
        .describe("Only when the user explicitly said when to do it ('schedule the pamphlet at 4'): also puts it on the plan at that time (scheduling commands only)"),
    }),
    run: async (ctx, input) => {
      const { user_command, schedule, ...rest } = input;
      const task = { ...rest };
      delete task.allow_duplicate;
      if (ctx.autonomy === "ask") {
        // The person asked Navi to check with them before changing things.
        const values = { ...compact(TaskCreate.parse(task)), title: task.title };
        await requestApproval(ctx, {
          actionType: "internal.create.tasks",
          summary: `Create task “${values.title.slice(0, 80)}”`,
          details: { op: "create", table: "tasks", values, subject: values.title, reason: "you chose to approve every change", user_command },
        });
        return { ok: true, mutated: true, summary: `Not created yet: the task “${values.title}” is waiting for the user's Approve tap. ${WAITING}` };
      }
      // Never the same task twice: an open task with the same title (the
      // person's own, or an imported assignment due around the same time) is
      // the one they mean. The model can't always see every task, and a
      // "did you add it?" used to create a second copy.
      if (ctx.actor === "navi" && !input.allow_duplicate) {
        const existing = await findSameTask(ctx, task.title, task.due_at ?? null);
        if (existing) {
          const where = isImported(existing) ? " (imported from Canvas)" : "";
          if (schedule && (await plannerCommandsFor(ctx))) {
            const placed = await runCommand(ctx, "create_task", { kind: "schedule_task", task_id: existing.id, start: schedule.start, date: schedule.date ?? null, minutes: schedule.minutes ?? null });
            return { ...placed, summary: `NOT created again: “${existing.title}” is already on the list${where} [${existing.id}]. Scheduling that one: ${placed.summary}`, data: { id: existing.id, existing: true, ...(placed.data as object) } };
          }
          return {
            ok: true, mutated: false,
            summary: `NOT created again: “${existing.title}” is already on the list${where}, ${existing.status}${existing.due_at ? `, due ${formatDue(existing.due_at, ctx.timezone)}` : ", no due date"} [${existing.id}]. Tell the user it already exists; use update_task to change it. Only if they explicitly want a second separate copy, call create_task with allow_duplicate=true.`,
            display: `${q(existing.title)} is already on your list`,
            data: { id: existing.id, existing: true },
          };
        }
      }
      const t = await createTask(ctx, task);
      await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: t.id, summary: `Added at your request: “${user_command.slice(0, 120)}”` });
      if (schedule && (await plannerCommandsFor(ctx))) {
        const placed = await runCommand(ctx, "create_task", { kind: "schedule_task", task_id: t.id, start: schedule.start, date: schedule.date ?? null, minutes: schedule.minutes ?? null });
        return { ...placed, ok: true, mutated: true, summary: `Created task “${t.title}” (${taskDateSummary(t, ctx.timezone, user_command)}). Scheduling it: ${placed.summary}`, display: placed.ok && (placed.data as { status?: string })?.status === "applied" ? `Added ${q(t.title)}; ${String(placed.display ?? "").replace(/^Put /, "put it ")}` : `Added ${q(t.title)}`, data: { id: t.id, ...(placed.data as object) } };
      }
      return { ok: true, mutated: true, summary: `Created task “${t.title}”: ${taskDateSummary(t, ctx.timezone, user_command)}`, display: `Added ${q(t.title)}${t.due_at ? `, due ${dayWord(DateTime.fromISO(t.due_at).setZone(ctx.timezone).toISODate()!, ctx.timezone, DateTime.now(), false).replace("tonight", "today")}` : ""}`, data: { id: t.id, due_at: t.due_at, due_is_hard: t.due_is_hard } };
    },
  }),
  tool({
    name: "update_task",
    description:
      "Change an existing task (title, notes, priority, estimate, due date, status other than done, blocker, links, commitment, not_before, depends_on). commitment 'must' = the user called it non-negotiable / must-complete (planned first); only lower it if they say so (that becomes a card). depends_on = ids of tasks that must be done first (replaces the list). Just call it: hard-deadline changes and cancelling automatically become a card the user approves with one tap.",
    schema: TaskUpdate.omit({ status: true }).extend({
      id: z.string().uuid(),
      status: z.enum(["todo", "in_progress", "blocked", "cancelled"]).nullish(),
      depends_on: z.array(z.string().uuid()).max(5).nullish().describe("Task ids this task waits for (replaces the current list; [] clears it)"),
    }),
    run: async (ctx, { id, depends_on, ...patch }) => {
      let deps = "";
      if (depends_on) deps = await setDependencies(ctx, id, depends_on);
      if (!Object.keys(compact(patch)).length) return { ok: true, mutated: true, summary: deps || "Nothing to change", display: deps ? "Changed what it waits for" : "" };
      const r = await updateTask(ctx, id, patch);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `${deps ? `${deps} ` : ""}That change needs the user's OK because ${r.reason}. ${WAITING}` };
      // A priority/commitment change isn't a time: say whether it's actually planned (R2).
      const dates = "due_at" in patch || "due_is_hard" in patch || "commitment" in patch || "priority" in patch ? `: ${await taskScheduleSummary(ctx, r.row)}${"commitment" in patch && patch.commitment === "must" ? ". Must-do means planned first, NOT placed at a time; to put it at a time use schedule_task" : ""}` : "";
      const changed = Object.keys(compact(patch));
      const display = r.row.due_at && "due_at" in patch
        ? `${q(r.row.title)} is now due ${DateTime.fromISO(r.row.due_at).setZone(ctx.timezone).toFormat("cccc")}`
        : changed.length === 1 && changed[0] === "commitment" && patch.commitment === "must"
          ? `Made ${q(r.row.title)} a must-do`
          : `Updated ${q(r.row.title)}`;
      return { ok: true, mutated: true, summary: `Updated task “${r.row.title}”${dates}${deps ? `. ${deps}` : ""}`, display };
    },
  }),
  tool({
    name: "complete_task",
    description:
      "Mark a task done ONLY when the user explicitly says, in their latest message, that they finished it. user_statement must quote their own words from that message exactly (e.g. 'I finished the essay'). Never infer completion. If their message doesn't say it, the user gets a one-tap confirmation instead.",
    schema: z.object({ id: z.string().uuid(), user_statement: z.string().min(3).max(300), actual_minutes: z.number().int().min(1).max(1440).nullish() }),
    run: async (ctx, { id, user_statement, actual_minutes }) => {
      // The authority is what the user actually said this turn (held by the
      // server), not the model's claim about it.
      if (ctx.actor === "navi" && !userSaidItsDone(ctx.userMessage, user_statement)) {
        const { data: task } = await ctx.db.from("tasks").select("title,status").eq("id", id).maybeSingle();
        if (!task) return { ok: false, summary: "That task doesn't exist (or isn't yours)" };
        if (task.status === "done") return { ok: true, summary: `“${task.title}” is already done`, display: `${q(String(task.title))} was already done` };
        await requestApproval(ctx, {
          actionType: "internal.complete.tasks",
          summary: `Mark “${String(task.title).slice(0, 80)}” done`,
          details: { op: "complete", table: "tasks", id, actual_minutes: actual_minutes ?? null, subject: String(task.title), reason: "only you can say your work is finished" },
        });
        return {
          ok: true,
          mutated: true,
          summary: `Not marked done: the user's message doesn't say they finished it, so it waits for their tap. ${WAITING}`,
        };
      }
      const r = await completeTask({ ...ctx, actor: "user" }, id, actual_minutes);
      await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: id, summary: `Marked done because you said: “${user_statement.slice(0, 120)}”` });
      return { ok: true, mutated: true, summary: r.kind === "updated" ? `Marked “${r.row.title}” done` : "Sent for approval", display: r.kind === "updated" ? `Marked ${q(r.row.title)} done` : "" };
    },
  }),
  tool({
    name: "update_item",
    description:
      "Change an existing project, goal, workspace, routine, event, milestone, plan block or note by id. Only these fields can be patched: " +
      Object.entries(ENTITY_PATCHES).map(([t, sch]) => `${t}: ${Object.keys(sch.shape).join(", ")}`).join("; ") +
      ". Just call it: changing events, fixed routines or fixed blocks, marking a project done / goal achieved / milestone done, or dropping goals/projects automatically becomes a card the user approves with one tap.",
    schema: z.object({ table: z.enum(ENTITY_TABLES), id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }),
    run: async (ctx, { table, id, patch }) => {
      const checked = parseEntityPatch(table, patch);
      if (!checked.ok) return { ok: false, summary: checked.summary };
      const clean = checked.patch;
      if (table === "plan_blocks" && ("starts_at" in clean || "ends_at" in clean || "plan_date" in clean || "pinned" in clean) && (await plannerCommandsFor(ctx))) {
        // Moves, resizes and locks go through the scheduling commands (preview, impact, verify).
        const b = await getEntity<PlanBlock>(ctx, "plan_blocks", id);
        if ("pinned" in clean && !("starts_at" in clean) && !("ends_at" in clean)) return runCommand(ctx, "update_item", { kind: "lock", block_ids: [id], locked: !!clean.pinned });
        const start = typeof clean.starts_at === "string" ? clean.starts_at : b.starts_at;
        const end = typeof clean.ends_at === "string" ? clean.ends_at : DateTime.fromISO(start).plus({ milliseconds: Date.parse(b.ends_at) - Date.parse(b.starts_at) }).toISO()!;
        return runCommand(ctx, "update_item", { kind: "move_many", moves: [{ block_id: id, start, minutes: Math.max(5, Math.round((Date.parse(end) - Date.parse(start)) / 60000)) }] });
      }
      // A routine's protection and the old planner's is_fixed say the same thing.
      if (table === "routines" && typeof clean.protection === "string") clean.is_fixed = clean.protection === "fixed";
      const r = await updateEntity(ctx, table as EntityTable, id, clean);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `That change needs the user's OK because ${r.reason}. ${WAITING}` };
      // Say exactly what changed: the summary is all later turns see of this action.
      const row = r.row as Record<string, unknown>;
      const name = String(row.title ?? row.name ?? "");
      const changes = Object.entries(clean).map(([k, v]) => `${k} → ${String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 40)}`).join(", ");
      const summary = `Updated ${table.replace(/s$/, "").replace("_", " ")} “${name}”: ${changes}`;
      if (table === "plan_blocks" && typeof clean.starts_at === "string") {
        // A moved piece of the plan: grouped with the reply's other plan changes.
        return { ok: true, mutated: true, summary, display: `Moved ${q(name)}`, detail: [changeLine({ kind: "move", title: name, at: String(row.starts_at) }, ctx.timezone, nowIn(ctx.timezone).toISODate()!)], plan: true };
      }
      return { ok: true, mutated: true, summary, display: `Changed ${q(name)}'s ${fieldWords(Object.keys(clean))}`, plan: table === "plan_blocks" };
    },
  }),
  tool({
    name: "plan_day",
    description: "Re-plan flexible work for a date (default today) around fixed commitments and the user's availability. Deterministic; returns what was placed and what didn't fit.",
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (ctx, { date }) => {
      const r = await generateDayPlan(ctx, date ?? undefined, { trigger: "chat" });
      return {
        ok: true,
        mutated: true,
        summary: r.run?.summary ?? summarizeDayPlan(r, ctx.timezone),
        ...runView([r], ctx.timezone, r.run),
        data: { blocks: r.blocks.map((b) => ({ title: b.title, start: b.starts_at, end: b.ends_at, why: b.reason })), moved: r.moved, unscheduled: r.unscheduled, only_after_deadline: r.afterDeadline, warnings: r.warnings, freeMinutes: r.freeMinutes, ...v2Data(r) },
      };
    },
  }),
  tool({
    name: "plan_week",
    description: "Re-plan the next 7 days of flexible work.",
    schema: z.object({}),
    run: async (ctx) => {
      const days = await generateWeekPlan(ctx, null, { trigger: "chat" });
      return {
        ok: true,
        mutated: true,
        summary: days[0]?.run?.summary ?? summarizeWeekPlan(days, ctx.timezone),
        ...runView(days, ctx.timezone, days[0]?.run),
        data: days.map((d) => ({ date: d.date, blocks: d.blocks.length, moved: d.moved, unscheduled: d.unscheduled.map((u) => u.title), only_after_deadline: d.afterDeadline.map((a) => a.title), warnings: d.warnings })),
      };
    },
  }),
  tool({
    name: "recover_plan",
    description: "The user's plan broke (interruption, needed rest, missing info, bad estimate, external change). Records what happened, keeps unfinished work, and re-plans the rest of today.",
    schema: z.object({
      description: z.string().min(3).max(500),
      category: z.enum(["interruption", "rest", "missing_info", "estimate", "external", "other"]),
      available_from: z.string().nullish().describe("When the user is free again: a local time HH:MM as they said it (e.g. '14:05'), or 'now'. Navi's code reads it against the real clock; don't compute it."),
      since: z.string().nullish().describe("When the disruption started, if earlier than now: local HH:MM (only planned work from then until available_from is marked)"),
    }),
    run: async (ctx, input) => {
      const r = await recoverPlan(ctx, { description: input.description, category: input.category, availableFrom: input.available_from, since: input.since });
      const view = runView([r.plan], ctx.timezone, r.plan.run, { recovered: true, changes: r.changes });
      const left = r.notPlaced.length ? { line: `${things(r.notPlaced.length)} didn't fit today or tomorrow`, options: [`${r.notPlaced.length > 3 ? `Includes ${r.notPlaced.slice(0, 3).map((u) => q(u.title, 30)).join(", ")} and ${r.notPlaced.length - 3} more` : r.notPlaced.map((u) => q(u.title, 30)).join(", ")}. They stay on your list; nothing was dropped.`, "Tell me what can wait, or move a due date, and I'll re-plan."] } : undefined;
      return { ok: true, mutated: true, summary: r.summary, ...view, leftover: left, data: { moved_to_tomorrow: r.movedToTomorrow, not_scheduled: r.notPlaced, warnings: r.plan.warnings } };
    },
  }),
  // ---- Planner v2 (constraint-first) tools: offered only when it's on (toolsFor). ----
  tool({
    name: "plan",
    description:
      "Plan or re-plan flexible work for a day (or up to 7 days) with Navi's deterministic planner. It works out free time itself from everything Navi knows (events, routines, sleep, school/work hours, one-day facts) and labels what it assumes, so never compute free time or ask the user to set availability. Use for 'plan my day', 'build tomorrow from what you know', 'rework the rest of my day', 'I only have two hours today', 'I'm free from 3', 'I'm behind on X'. Facts the user just stated about this day go in capacity_minutes / free / busy / start_from (saved for that day only, undoable, never their usual settings). focus_task_ids = tasks they want prioritised now. mode 'propose' shows the plan as one card to approve instead of applying it (use when they ask what you'd suggest). The result says what was placed, moved and assumed, what didn't fit, up to 3 options and at most one question: say the assumptions and ask only that question.",
    schema: z.object({
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/, "YYYY-MM-DD, 'today' or 'tomorrow'").nullish().describe("First day (default today)"),
      days: z.number().int().min(1).max(7).nullish().describe("How many days (default 1)"),
      mode: z.enum(["apply", "propose"]).nullish(),
      focus_task_ids: z.array(z.string().uuid()).max(10).nullish(),
      capacity_minutes: z.number().int().min(0).max(1440).nullish().describe("The user's TOTAL work time for the whole first day ('I only have 2 hours today'). NOT for 'work on X for the next hour': that is focus_task_ids=[X] with start_from='now' (or schedule_task when offered)"),
      free: z.array(z.object({ start: HHMM, end: HHMM })).max(6).nullish().describe("Local times the user said they're free on the first day"),
      busy: z.array(z.object({ start: HHMM, end: HHMM, title: z.string().max(120).nullish() })).max(6).nullish().describe("Local times the user said they're busy on the first day (one-off, e.g. 'karate tonight 6–7:30')"),
      start_from: z.union([HHMM, z.literal("now")]).nullish().describe("Plan the first day from this local time (e.g. 'I'm free from 15:00'), or 'now' ('start now'). Navi's code reads 'now' from the real clock; never compute the current time yourself."),
    }),
    run: async (ctx, input) => {
      const zone = ctx.timezone;
      const first = resolveDate(input.date, zone);
      if (await plannerCommandsFor(ctx)) return planViaCommand(ctx, first, input);
      const facts: string[] = [];
      if (input.capacity_minutes != null) facts.push(await addException(ctx, { date: first, kind: "capacity", minutes: input.capacity_minutes, note: `at most ${input.capacity_minutes} min of work` }));
      for (const f of input.free ?? []) facts.push(await addException(ctx, { date: first, kind: "free", start_time: f.start, end_time: f.end, note: "free" }));
      for (const b of input.busy ?? []) facts.push(await addException(ctx, { date: first, kind: "busy", start_time: b.start, end_time: b.end, note: b.title ?? "Busy" }));
      const today = nowIn(zone).toISODate()!;
      let from: DateTime | undefined;
      if (input.start_from === "now") {
        if (first === today) from = resolveClock("now", first, zone, nowIn(zone))!;
      } else if (input.start_from) {
        if (first === today) from = DateTime.max(atLocalTime(first, input.start_from, zone), nowIn(zone));
        else facts.push(await addException(ctx, { date: first, kind: "busy", start_time: "00:00", end_time: input.start_from, note: `not free before ${input.start_from}` }));
      }
      const days = Array.from({ length: input.days ?? 1 }, (_, i) => DateTime.fromISO(first, { zone }).plus({ days: i }).toISODate()!);
      const run = await planDays(ctx, days, { trigger: "chat", mode: input.mode ?? undefined, from, focusTaskIds: input.focus_task_ids ?? undefined });
      const lead = facts.length ? `Saved for ${DateTime.fromISO(first, { zone }).toFormat("cccc")} only: ${facts.join("; ")}. ` : "";
      const summary = run.status === "unchanged" ? `${lead}Nothing changed: the planner found no better arrangement (this is not a success if what the user asked for isn't placed; check the result). ${run.summary}` : `${lead}${run.summary}${run.status === "applied" ? " (The user can undo this.)" : run.status === "proposed" ? ` ${WAITING}` : ""}`;
      const view = runView(run.results, zone, run);
      // What the person asked to prioritise must actually be on the plan; say plainly when it isn't.
      const focus = input.focus_task_ids ?? [];
      const placedIds = new Set(run.results.flatMap((r) => r.blocks.map((b) => b.task_id)).filter(Boolean));
      if (focus.length) {
        const { data: kept } = await ctx.db.from("plan_blocks").select("task_id").in("task_id", focus).in("plan_date", days).in("status", ["planned", "in_progress"]);
        for (const k of kept ?? []) placedIds.add(k.task_id);
      }
      const missing = focus.filter((id) => !placedIds.has(id));
      let missingNote = "";
      if (missing.length) {
        const { data: rows } = await ctx.db.from("tasks").select("id,title").in("id", missing);
        const names = (rows ?? []).map((t) => `“${t.title}”`);
        missingNote = ` NOT on the plan (what the user asked for is unmet; say so plainly and offer a concrete option): ${names.join(", ") || `${missing.length} task(s)`}.`;
      }
      const changed = run.status !== "unchanged" || facts.length > 0;
      return {
        ok: true, mutated: changed, summary: `${summary}${missingNote}`, ...view,
        ...(missing.length ? { display: `Couldn't fit ${missing.length === 1 ? "what you asked for" : `${missing.length} things you asked for`}` } : {}),
        ...(facts.length && view.detail ? { detail: [...facts.map((f) => `Just ${dayName(first, zone)}: ${f}`), ...view.detail] } : {}),
        data: run.results.map((r) => ({ date: r.date, blocks: r.blocks.map((b) => ({ title: b.title, start: b.starts_at, end: b.ends_at, assumed: b.basis === "inferred" })), ...v2Data(r) })),
      };
    },
  }),
  tool({
    name: "set_day_exception",
    description: "Save a one-day fact without planning: busy or free for a stretch, or at most N minutes of work that day. Only that date changes; usual settings never do. Undoable. Usually use plan with busy/free/capacity_minutes instead, which saves the fact and re-plans in one step.",
    schema: z.object({
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(),
      kind: z.enum(["busy", "free", "capacity"]),
      start: HHMM.nullish(),
      end: HHMM.nullish(),
      minutes: z.number().int().min(0).max(1440).nullish(),
      note: z.string().max(200).nullish(),
    }),
    run: async (ctx, i) => {
      if (i.kind === "capacity" && i.minutes == null) return { ok: false, summary: "A capacity fact needs minutes." };
      if (i.kind !== "capacity" && (!i.start || !i.end)) return { ok: false, summary: "Busy or free needs start and end (HH:MM)." };
      const date = resolveDate(i.date, ctx.timezone);
      const said = await addException(ctx, { date, kind: i.kind, start_time: i.start ?? null, end_time: i.end ?? null, minutes: i.minutes ?? null, note: i.note ?? null });
      const zone = ctx.timezone;
      const display =
        i.kind === "capacity"
          ? `Noted: at most ${i.minutes! >= 60 ? `${Math.round((i.minutes! / 60) * 10) / 10} hours` : `${i.minutes} min`} of work ${dayName(date, zone)}`
          : `Noted: you're ${i.kind} ${partOfDay(atLocalTime(date, i.start!, zone), nowIn(zone))}`;
      return { ok: true, mutated: true, summary: `Saved for ${DateTime.fromISO(date, { zone }).toFormat("cccc LLL d")} only: ${said}. Call plan to re-plan around it.`, display, detail: [`Just ${dayName(date, zone)}: ${said}`] };
    },
  }),
  tool({
    name: "skip_occurrence",
    description:
      "Cancel or move ONE session of the user's own recurring (or one-off) event, e.g. 'karate is cancelled tonight', 'practice moved to 6 today'. The series is unchanged. Runs right away with Undo when the user said it. For the whole series use update_item (a card). Then call plan to use the freed time.",
    schema: z.object({
      event_id: z.string().uuid(),
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(),
      action: z.enum(["cancel", "move"]),
      start: HHMM.nullish().describe("New local start time when moving"),
      end: HHMM.nullish().describe("New local end time when moving"),
      note: z.string().max(200).nullish(),
    }),
    run: async (ctx, i) => {
      const zone = ctx.timezone;
      const date = resolveDate(i.date, zone);
      const ev = await getEntity<CalendarEvent>(ctx, "events", i.event_id);
      if (ev.external_ref) return { ok: false, summary: "That event belongs to a connected calendar; it has to be changed there (or with request_external_action)." };
      if (!occurrencesOn(ev, date, zone, []).length) return { ok: false, summary: `“${ev.title}” isn't on ${DateTime.fromISO(date, { zone }).toFormat("cccc LLL d")}.` };
      if (i.action === "move" && (!i.start || !i.end)) return { ok: false, summary: "Moving a session needs start and end (HH:MM)." };
      const values = {
        event_id: ev.id, occurrence_date: date, status: i.action === "cancel" ? "cancelled" : "moved",
        starts_at: i.action === "move" ? atLocalTime(date, i.start!, zone).toISO() : null,
        ends_at: i.action === "move" ? atLocalTime(date, i.end!, zone).toISO() : null,
        note: i.note ?? null,
      };
      const what = i.action === "cancel" ? `Cancelled just ${DateTime.fromISO(date, { zone }).toFormat("cccc's")} “${ev.title}”` : `Moved just ${DateTime.fromISO(date, { zone }).toFormat("cccc's")} “${ev.title}” to ${i.start}–${i.end}`;
      const { data: existing } = await ctx.db.from("event_occurrence_overrides").select("*").eq("event_id", ev.id).eq("occurrence_date", date).maybeSingle();
      if (existing) {
        const { error } = await ctx.db.from("event_occurrence_overrides").update(values).eq("id", existing.id);
        if (error) return { ok: false, summary: error.message };
        await logActivity(ctx, { action: "update", entityType: "event_occurrence_overrides", entityId: existing.id, summary: what, before: { status: existing.status, starts_at: existing.starts_at, ends_at: existing.ends_at, note: existing.note }, after: { status: values.status, starts_at: values.starts_at, ends_at: values.ends_at, note: values.note }, reversible: true });
      } else {
        await createRow(ctx, "event_occurrence_overrides", values, what);
      }
      const day = dayName(date, zone);
      const display = i.action === "cancel" ? `Skipped ${q(ev.title)} just ${day}` : `Moved ${q(ev.title)} just ${day}`;
      return { ok: true, mutated: true, summary: `${what} (the weekly event is unchanged). Call plan for that day to use the time.`, display, detail: [i.action === "cancel" ? `${shortTitle(ev.title)}: off just ${day} (the usual one stays)` : `${shortTitle(ev.title)} → ${clockFor(values.starts_at!, zone)} just ${day}`] };
    },
  }),
  tool({
    name: "move_block",
    description:
      "Move planned work blocks to new times and pin them there (re-plans then leave them alone), e.g. 'move my studying earlier', 'put Chemistry at 4'. Get block ids from get_plan. The rest of that day is re-fitted around them automatically. Never moves fixed things; a fixed block becomes a card.",
    schema: z.object({ moves: z.array(z.object({ block_id: z.string().uuid(), start: z.string().describe("New start: local HH:MM on the block's day (as the user said it), 'now', or an ISO date-time with the user's offset. 'now' is read from the real clock by Navi's code.") })).min(1).max(6) }),
    run: async (ctx, { moves }) => {
      if (await plannerCommandsFor(ctx)) return runCommand(ctx, "move_block", { kind: "move_many", moves: moves.map((m) => ({ block_id: m.block_id, start: m.start })) });
      const zone = ctx.timezone;
      const done: string[] = [];
      const problems: string[] = [];
      const dates = new Set<string>();
      const changes: PlanChange[] = [];
      let waiting = false;
      for (const m of moves) {
        const b = await getEntity<PlanBlock>(ctx, "plan_blocks", m.block_id);
        const start = resolveClock(m.start, b.plan_date, zone, nowIn(zone)) ?? DateTime.fromISO(m.start, { setZone: true }).setZone(zone);
        if (!start.isValid) {
          problems.push(`“${b.title}”: not a valid time`);
          continue;
        }
        const end = start.plus({ milliseconds: Date.parse(b.ends_at) - Date.parse(b.starts_at) });
        const date = start.toISODate()!;
        const clash = await fixedClash(ctx, date, start, end, b.id);
        if (clash) {
          problems.push(`“${b.title}” would overlap “${clash}”, which Navi doesn't move`);
          continue;
        }
        const r = await updateEntity(ctx, "plan_blocks", b.id, { starts_at: start.toISO(), ends_at: end.toISO(), plan_date: date, pinned: true }, { summary: `Moved “${b.title}” to ${start.toFormat("ccc h:mm a")}` });
        if (r.kind === "approval_requested") waiting = true;
        else {
          done.push(`“${b.title}” → ${start.toFormat("ccc h:mm a")}`);
          changes.push({ kind: "move", title: b.title, at: start.toISO()!, from: b.starts_at });
          dates.add(date);
          if (b.plan_date !== date) dates.add(b.plan_date);
        }
      }
      let refit = "";
      let refitView: StepView = {};
      if (dates.size) {
        const run = await planDays(ctx, [...dates], { trigger: "chat" });
        refit = run.status === "unchanged" ? " Nothing else needed to move." : ` Re-fitted the rest: ${run.summary}`;
        if (run.status === "applied") refitView = runView(run.results, zone, run);
      }
      const parts = [done.length ? `Moved and pinned ${done.join(", ")}.${refit}` : "", problems.length ? `Not moved: ${problems.join("; ")}.` : "", waiting ? `A fixed block needs the user's OK. ${WAITING}` : ""].filter(Boolean);
      const display = changes.length === 1 ? `Moved ${q(changes[0].title)}` : changes.length ? `Moved ${things(changes.length)}` : "";
      const detail = [...changes.map((c) => changeLine(c, zone, nowIn(zone).toISODate()!)), ...(refitView.detail ?? []).filter((l) => !changes.some((c) => l.startsWith(shortTitle(c.title))))];
      return { ok: done.length > 0 || waiting, mutated: done.length > 0 || waiting, summary: parts.join(" "), display, detail, plan: true, ...(refitView.leftover ? { leftover: refitView.leftover } : {}), ...(problems.length && !done.length ? { display: "Couldn't move it there" } : {}) };
    },
  }),
  tool({
    name: "undo_plan",
    description: "Undo the most recent planning change (a re-plan, recovery or applied plan) when the user says 'undo that' about the plan. All of it goes back at once, or nothing if they edited it since.",
    schema: z.object({}),
    run: async (ctx) => {
      const { data } = await ctx.db.from("activity_log").select("id,summary").eq("action", "plan_applied").is("reverted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!data) return { ok: false, summary: "There's no recent plan change to undo." };
      await revertActivities(ctx, [data.id]);
      return { ok: true, mutated: true, summary: `Undid the last plan change (${String(data.summary).slice(0, 160)}).`, display: "Put your plan back the way it was" };
    },
  }),
  tool({
    name: "set_usual_time",
    description: "Save a USUAL weekly time the user says they're free or busy (e.g. 'I'm always free after 4 on weekdays', 'I work Saturdays 9–1'). Confirmed from then on; undoable. Never use it for one day (use plan or set_day_exception).",
    schema: z.object({
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7).describe("0 = Sunday ... 6 = Saturday"),
      start: HHMM,
      end: HHMM,
      free: z.boolean().describe("true = free then; false = busy then"),
      note: z.string().max(200).nullish(),
    }),
    run: async (ctx, i) => {
      const what = `${i.free ? "Usually free" : "Usually busy"} ${i.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join("/")} ${i.start}–${i.end}${i.note ? ` (${i.note})` : ""}`;
      await createRow(ctx, "availability_rules", { days: i.days, start_time: i.start, end_time: i.end, kind: i.free ? "free" : "busy", basis: "confirmed", source: "chat", note: i.note ?? null }, what);
      return { ok: true, mutated: true, summary: `Saved: ${what}.`, display: `Saved when you're usually ${i.free ? "free" : "busy"}`, detail: [what] };
    },
  }),
  tool({
    name: "keep_off_until",
    description:
      "Keep tasks off the plan until a day, when the user says so ('keep the Module 3 items off until Monday', 'don't plan the essay before Friday'). Navi won't plan them before then, every later re-plan respects it, and the days they were already on are re-fitted now. until: a weekday name ('monday' = the next Monday, never today), 'tomorrow', or YYYY-MM-DD; Navi's code works out the date. until null lets them be planned again. The tasks stay on the list; nothing is dropped.",
    schema: z.object({
      task_ids: z.array(z.string().uuid()).min(1).max(30),
      until: z.string().max(20).nullable().describe("'monday' … 'sunday', 'tomorrow', YYYY-MM-DD, or null to allow planning again"),
    }),
    run: async (ctx, { task_ids, until }) => {
      const zone = ctx.timezone;
      const now = nowIn(zone);
      const date = until === null ? null : resolveDay(until, zone, now);
      if (until !== null && !date) return { ok: false, summary: `Not a day Navi understands: “${until}”. Use a weekday name, 'tomorrow' or YYYY-MM-DD.` };
      const notBefore = date ? DateTime.fromISO(date, { zone }).startOf("day").toISO()! : null;
      const kept: string[] = [];
      let waiting = 0;
      for (const id of [...new Set(task_ids)]) {
        const r = await updateTask(ctx, id, { not_before: notBefore });
        if (r.kind === "approval_requested") waiting++;
        else kept.push(r.row.title);
      }
      // The days they're already planned on before then are re-fitted now.
      const today = now.toISODate()!;
      const { data: planned } = await ctx.db.from("plan_blocks").select("plan_date").in("task_id", task_ids).eq("status", "planned").eq("is_flexible", true).gte("plan_date", today);
      const dates = [...new Set(((planned ?? []) as { plan_date: string }[]).map((b) => b.plan_date).filter((d) => !date || d < date))].sort();
      let refit = "";
      let view: StepView = {};
      if (kept.length && dates.length) {
        if (await plannerV2For(ctx)) {
          const run = await planDays(ctx, dates, { trigger: "chat" });
          refit = ` Re-fitted ${dates.join(", ")}: ${run.summary}`;
          if (run.status === "applied") view = runView(run.results, zone, run);
        } else {
          const rs = [];
          for (const d of dates) rs.push(await generateDayPlan(ctx, d, { trigger: "chat" }));
          refit = ` Re-planned ${dates.join(", ")}: ${rs.map((r) => summarizeDayPlan(r, zone)).join(" ")}`;
          view = { irreversible: true, detail: planView(rs, zone).detail };
        }
      }
      const when = date ? dayName(date, zone) : null;
      const summary = `${kept.length ? `${date ? `Kept off the plan until ${DateTime.fromISO(date, { zone }).toFormat("cccc LLL d")} (not_before set)` : "Allowed to be planned again (not_before cleared)"}: ${kept.map((t) => `“${t}”`).join(", ")}.` : ""}${waiting ? ` ${waiting} change${waiting === 1 ? "" : "s"} need the user's OK. ${WAITING}` : ""}${refit}`.trim();
      return {
        ok: kept.length > 0 || waiting > 0,
        mutated: kept.length > 0 || waiting > 0,
        summary,
        display: kept.length ? (when ? `Kept ${kept.length === 1 ? q(kept[0]) : things(kept.length)} off your plan until ${when}` : `${kept.length === 1 ? q(kept[0]) : things(kept.length)} can be planned again`) : "",
        detail: [...(kept.length > 1 ? kept.map((t) => shortTitle(t)) : []), ...(view.detail ?? [])],
        plan: true,
        ...(view.irreversible ? { irreversible: true } : {}),
      };
    },
  }),
  tool({
    name: "shift_blocks",
    description:
      "Move the rest of a day's planned work later or earlier, computed by Navi's code from the real clock (never work out the current time or new times yourself). 'Leave me free until 2:05' / 'nothing before 2:05' → start_at '14:05'; 'start now' → start_at 'now'; 'push everything 30 min' → minutes 30 ('15 min earlier' → -15). Work planned from `from` (default now) on moves; order is kept, fixed things are stepped over, and anything that would run past midnight stays put. One card, one Undo.",
    schema: z.object({
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish().describe("Default today"),
      start_at: z.union([HHMM, z.literal("now")]).nullish().describe("Nothing starts before this local time (or 'now'); later work moves only as needed"),
      minutes: z.number().int().min(-480).max(480).nullish().describe("Move everything by this many minutes (negative = earlier)"),
      from: z.union([HHMM, z.literal("now")]).nullish().describe("Only work planned from this local time on moves (default now)"),
    }),
    run: async (ctx, i) => {
      const zone = ctx.timezone;
      const now = nowIn(zone);
      const date = resolveDate(i.date, zone);
      if ((i.start_at == null) === (i.minutes == null)) return { ok: false, summary: "Give exactly one of start_at or minutes." };
      const from = resolveClock(i.from ?? "now", date, zone, now)!;
      const startAt = i.start_at ? resolveClock(i.start_at, date, zone, now) : null;
      const { data } = await ctx.db.from("plan_blocks").select("*").eq("plan_date", date).eq("status", "planned").eq("is_flexible", true).gte("starts_at", (from < now ? now : from).minus({ minutes: 1 }).toUTC().toISO()!);
      const blocks = ((data ?? []) as PlanBlock[]).filter((b) => DateTime.fromISO(b.starts_at) >= from.minus({ minutes: 1 }));
      if (!blocks.length) return { ok: true, summary: `Nothing planned on ${date} from ${from.toFormat("h:mm a")} on, so nothing moved.`, display: "Nothing planned then, so nothing moved", plan: true, unchanged: true };
      const movingIds = new Set(blocks.map((b) => b.id));
      const busy = (await fixedSpans(ctx, date)).filter((f) => !f.blockId || !movingIds.has(f.blockId));
      const spans = blocks.map((b) => ({ id: b.id, start: DateTime.fromISO(b.starts_at).setZone(zone), end: DateTime.fromISO(b.ends_at).setZone(zone) }));
      // "Start now": the next thing moves up to now and the rest come along by the same amount.
      const firstStart = DateTime.min(...spans.map((s) => s.start))!;
      const pullIn = i.start_at === "now" && startAt && firstStart > startAt ? -Math.round(firstStart.diff(startAt, "minutes").minutes) : null;
      const { moves, stuck } = shiftTimes(spans, busy, { startAt: pullIn ? null : startAt, minutes: pullIn ?? i.minutes ?? null, earliest: now, dayEnd: DateTime.fromISO(date, { zone }).endOf("day") });
      if (await plannerCommandsFor(ctx)) {
        if (!moves.length) return { ok: true, summary: "Nothing needed to move.", display: "Nothing needed to move", plan: true, unchanged: true };
        const r = await runCommand(ctx, "shift_blocks", { kind: "move_many", moves: moves.map((m) => ({ block_id: m.id, start: m.start.toISO()! })) });
        const stuckTitles = stuck.map((id) => blocks.find((b) => b.id === id)!.title);
        return stuckTitles.length ? { ...r, summary: `${r.summary} Left where they were (would run past midnight): ${stuckTitles.map((t) => `“${t}”`).join(", ")}.` } : r;
      }
      const v2 = await plannerV2For(ctx);
      const changes: PlanChange[] = [];
      let waiting = false;
      for (const m of moves) {
        const b = blocks.find((x) => x.id === m.id)!;
        const r = await updateEntity(ctx, "plan_blocks", b.id, { starts_at: m.start.toISO(), ends_at: m.end.toISO(), ...(v2 ? { pinned: true } : {}) }, { summary: `Moved “${b.title}” to ${m.start.toFormat("ccc h:mm a")}` });
        if (r.kind === "approval_requested") waiting = true;
        else changes.push({ kind: "move", title: b.title, at: m.start.toISO()!, from: b.starts_at });
      }
      const stuckTitles = stuck.map((id) => blocks.find((b) => b.id === id)!.title);
      const summary = [
        changes.length ? `Moved ${changes.map((c) => `“${c.title}” → ${DateTime.fromISO(c.at!).setZone(zone).toFormat("h:mm a")}`).join(", ")}${v2 ? " (pinned)" : ""}.` : "Nothing needed to move.",
        stuckTitles.length ? `Left where they were (would run past midnight): ${stuckTitles.map((t) => `“${t}”`).join(", ")}.` : "",
        waiting ? `Some moves need the user's OK. ${WAITING}` : "",
      ].filter(Boolean).join(" ");
      const display = !changes.length
        ? "Nothing needed to move"
        : startAt
          ? i.start_at === "now" ? `Moved ${things(changes.length)} to start now` : "Cleared your time until then"
          : `Moved ${things(changes.length)} ${Math.abs(i.minutes!)} min ${i.minutes! > 0 ? "later" : "earlier"}`;
      return {
        ok: true,
        mutated: changes.length > 0 || waiting,
        summary,
        display,
        detail: changes.map((c) => changeLine(c, zone, date)),
        plan: true,
        ...(changes.length ? {} : { unchanged: true }),
        ...(stuckTitles.length ? { leftover: { line: `${things(stuckTitles.length)} wouldn't fit ${dayName(date, zone)}`, options: [`${stuckTitles.slice(0, 3).map((t) => q(t, 30)).join(", ")}${stuckTitles.length > 3 ? ` and ${stuckTitles.length - 3} more` : ""} stayed where ${stuckTitles.length === 1 ? "it was" : "they were"}.`, "Tell me what can wait and I'll make room."] } } : {}),
      };
    },
  }),
  // ---- Scheduling commands (planner reliability): offered only when they're on (toolsFor). ----
  tool({
    name: "schedule_task",
    description:
      "Put a task on the plan at a specific time ('put Navi work at 2 PM', 'do the pamphlet at 4 tomorrow'). The success condition is a saved block at that time: Navi's code checks it and the result says exactly what was saved. Other flexible work on that day moves to make room; fixed things never move (if the time overlaps one, nothing changes and the result gives free times instead). This is NOT the same as marking a task must-do (that only changes priority).",
    schema: z.object({ task_id: z.string().uuid(), start: z.string().max(40).describe("Local HH:MM as the user said it, or 'now'"), date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), minutes: z.number().int().min(5).max(480).nullish().describe("Default: the task's estimate"), ...CommandControls }),
    run: async (ctx, { task_id, start, date, minutes, ...c }) => runCommand(ctx, "schedule_task", { kind: "schedule_task", task_id, start, date: date ?? null, minutes: minutes ?? null }, c),
  }),
  tool({
    name: "swap_work",
    description:
      "Swap planned work in one change: put a task (or block) in, take another off that day ('put Navi work where Algebra is and take Algebra off today'). Without start, the new work takes the removed work's slot. The removed task stays on the list and later re-plans keep it off that day. Verified after saving.",
    schema: z.object({
      put_task_id: z.string().uuid().nullish(), put_block_id: z.string().uuid().nullish(), start: z.string().max(40).nullish(), minutes: z.number().int().min(5).max(480).nullish(),
      take_off_task_id: z.string().uuid().nullish(), take_off_block_id: z.string().uuid().nullish(), date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), ...CommandControls,
    }),
    run: async (ctx, i) => runCommand(ctx, "swap_work", { kind: "swap", place_task_id: i.put_task_id ?? null, place_block_id: i.put_block_id ?? null, start: i.start ?? null, minutes: i.minutes ?? null, remove_task_id: i.take_off_task_id ?? null, remove_block_id: i.take_off_block_id ?? null, date: i.date ?? null }, i),
  }),
  tool({
    name: "change_block",
    description: "Move and/or resize one planned block ('move my study block to 5', 'make it 30 minutes'). A grouped work session moves and resizes as a whole; each task keeps its own part. The rest of the day re-fits; fixed things never move.",
    schema: z.object({ block_id: z.string().uuid(), start: z.string().max(40).nullish().describe("New local HH:MM or 'now'"), minutes: z.number().int().min(5).max(480).nullish(), ...CommandControls }),
    run: async (ctx, { block_id, start, minutes, ...c }) => {
      if (!start && !minutes) return { ok: false, summary: "Give start and/or minutes." };
      if (!start) return runCommand(ctx, "change_block", { kind: "resize_block", block_id, minutes: minutes! }, c);
      const b = await getEntity<PlanBlock>(ctx, "plan_blocks", block_id);
      if (b.session_id && minutes) {
        const moved = await runCommand(ctx, "change_block", { kind: "move_block", block_id, start }, c);
        if (!moved.ok) return moved;
        return runCommand(ctx, "change_block", { kind: "resize_block", block_id, minutes }, c);
      }
      return runCommand(ctx, "change_block", { kind: "move_many", moves: [{ block_id, start, minutes: minutes ?? null }] }, c);
    },
  }),
  tool({
    name: "remove_work",
    description:
      "Take work off the plan without deleting tasks: specific tasks or blocks for a day ('take Algebra off today'), or the whole day's flexible work (whole_day true: 'clear my schedule today'). Fixed events and locked or hand-placed blocks stay unless include_locked. Tasks stay on the list, later re-plans keep them off that day, and it's one change with one Undo. High-impact cases (must-do work, a hard deadline within the risk window) become ONE card with the consequences.",
    schema: z.object({
      date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), task_ids: z.array(z.string().uuid()).max(30).nullish(), block_ids: z.array(z.string().uuid()).max(30).nullish(),
      whole_day: z.boolean().nullish(), include_locked: z.boolean().nullish(), ...CommandControls,
    }),
    run: async (ctx, i) =>
      i.whole_day
        ? runCommand(ctx, "remove_work", { kind: "clear_day", date: i.date ?? null, include_locked: !!i.include_locked }, i)
        : runCommand(ctx, "remove_work", { kind: "unschedule", date: i.date ?? null, task_ids: i.task_ids ?? null, block_ids: i.block_ids ?? null }, i),
  }),
  tool({
    name: "lock_block",
    description: "Lock planned blocks where they are (re-plans leave them alone) or unlock them so Navi may move them again.",
    schema: z.object({ block_ids: z.array(z.string().uuid()).min(1).max(30), locked: z.boolean() }),
    run: async (ctx, { block_ids, locked }) => runCommand(ctx, "lock_block", { kind: "lock", block_ids, locked }),
  }),
  tool({
    name: "set_day_scope",
    description:
      "Say what a day's plan may contain, then re-plan it. scope_mode 'only': plan only these tasks that day ('today is a recovery day: only the things I listed; old Canvas items can wait'). 'include': plan these too (e.g. chosen overdue Canvas work). 'exclude': keep these off that day. 'clear': back to normal. It sticks for every re-plan of that day (buttons, chat, the morning plan) until changed. Tasks stay on the list.",
    schema: z.object({ date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), scope_mode: z.enum(["only", "include", "exclude", "clear"]), task_ids: z.array(z.string().uuid()).min(1).max(40), ...CommandControls }),
    run: async (ctx, { date, scope_mode, task_ids, ...c }) => runCommand(ctx, "set_day_scope", { kind: "set_scope", date: date ?? null, mode: scope_mode, task_ids }, c),
  }),
  tool({
    name: "group_session",
    description: "Plan related tasks as one work session, back to back, without merging them ('do the PBL sketch, CAD and isometric sketch as one engineering session at 3'). Each task keeps its own block, status and links; the session moves and resizes as a unit.",
    schema: z.object({ task_ids: z.array(z.string().uuid()).min(2).max(8), start: z.string().max(40), date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), minutes: z.array(z.number().int().min(5).max(480)).max(8).nullish().describe("Minutes per task, in order (default: each estimate)"), title: z.string().max(200).nullish(), ...CommandControls }),
    run: async (ctx, { task_ids, start, date, minutes, title, ...c }) => runCommand(ctx, "group_session", { kind: "group_session", task_ids, start, date: date ?? null, minutes: minutes ?? null, title: title ?? null }, c),
  }),
  tool({
    name: "split_task",
    description: "Plan one task as several sessions at given times ('do the essay in two 45-minute sessions, at 3 and at 7').",
    schema: z.object({ task_id: z.string().uuid(), sessions: z.array(z.object({ start: z.string().max(40), date: z.string().regex(/^(\d{4}-\d{2}-\d{2}|today|tomorrow)$/).nullish(), minutes: z.number().int().min(5).max(480) })).min(1).max(8), ...CommandControls }),
    run: async (ctx, { task_id, sessions, ...c }) => runCommand(ctx, "split_task", { kind: "split_task", task_id, sessions: sessions.map((x) => ({ start: x.start, date: x.date ?? null, minutes: x.minutes })) }, c),
  }),
  tool({
    name: "confirm_change",
    description:
      "The user said yes in words to a plan change that is waiting on a card in this chat (one you proposed in an earlier reply, consequences shown). Navi's code checks their message is a clear yes and that exactly one such change is waiting (or the one you name with change_id); otherwise nothing is approved and you ask which one. Never use it for anything else.",
    schema: z.object({ change_id: z.string().uuid().nullish() }),
    run: async (ctx, { change_id }) => {
      const r = await confirmChange(ctx, change_id ?? null);
      return { ok: r.ok, mutated: r.ok, summary: r.summary, display: r.display, plan: true };
    },
  }),
  tool({
    name: "get_backlog",
    description: "Read overdue imported (Canvas) work that Navi holds for the user's decision instead of planning it on its own, with ids and due dates, plus how much future imported work there is. Read-only.",
    schema: z.object({}),
    run: async (ctx) => {
      const { data } = await ctx.db.from("tasks").select("id,title,due_at,estimate_minutes,commitment,status,source,external_ref").eq("source", "external").in("status", ["todo", "in_progress", "blocked"]).order("due_at");
      const rows = (data ?? []) as Pick<Task, "id" | "title" | "due_at" | "estimate_minutes" | "commitment" | "status" | "source" | "external_ref">[];
      const now = Date.now();
      const overdue = rows.filter((t) => awaitingTriage(t, now));
      return {
        ok: true, summary: `Read the imported backlog: ${overdue.length} overdue, ${rows.length - overdue.length} upcoming`,
        data: {
          note: "Overdue items are NOT failures to fit; the user decides: plan some (plan with focus_task_ids, or schedule_task / set_day_scope when offered), set a later day (keep_off_until), say they're handed in (resolve_overdue_imports handed_in, quoting them), or say they aren't needed (resolve_overdue_imports not_needed). Canvas doesn't report submissions.",
          overdue: overdue.slice(0, 60).map((t) => ({ id: t.id, title: t.title, was_due: t.due_at ? formatDue(t.due_at, ctx.timezone) : null, estimate_minutes: t.estimate_minutes })),
          upcoming_count: rows.length - overdue.length,
        },
      };
    },
  }),
  tool({
    name: "resolve_overdue_imports",
    description:
      "Record the user's decision about overdue imported (Canvas) work held for triage: 'handed_in' marks them done (the user handed them in), 'not_needed' sets them aside (hidden from Navi, kept in Canvas settings, reversible). Use only when the user's latest message says so; user_statement must quote their own words from that message exactly (e.g. 'those old canvas ones are all turned in'). task_ids from get_backlog or the overview, or all_overdue=true for every overdue imported item. To work on one instead, plan it (focus_task_ids) or give it a time. The result reports what was actually changed (read back).",
    schema: z.object({
      decision: z.enum(["handed_in", "not_needed"]),
      task_ids: z.array(z.string().uuid()).max(200).nullish(),
      all_overdue: z.boolean().nullish(),
      user_statement: z.string().min(3).max(300),
    }),
    run: async (ctx, { decision, task_ids, all_overdue, user_statement }) => {
      // The authority is what the person said this turn (held by the server).
      if (ctx.actor === "navi" && !quoteIsTheirs(ctx.userMessage, user_statement)) {
        return { ok: false, summary: "Nothing changed: user_statement isn't the user's own words from their latest message. Ask them which items are handed in (or not needed)." };
      }
      if (decision === "handed_in" && ctx.actor === "navi" && !userSaidItsDone(ctx.userMessage, user_statement)) {
        return { ok: false, summary: "Nothing changed: the user's words don't say the work was handed in or finished. Ask them." };
      }
      const r = await resolveTriage(ctx, decision, { ids: task_ids, all: all_overdue });
      const { changed, notChanged, unknown } = r;
      if (!r.asked) return { ok: false, summary: `Nothing changed: no open imported tasks matched${unknown.length ? ` (${unknown.length} id${unknown.length === 1 ? "" : "s"} not found or already closed)` : ""}.` };
      const wanted = { length: r.asked };
      await logActivity(ctx, { action: "explicit_command", summary: `${decision === "handed_in" ? "Marked handed in" : "Set aside"} ${changed.length} overdue imported item${changed.length === 1 ? "" : "s"} because you said: “${user_statement.slice(0, 120)}”` });
      const verb = decision === "handed_in" ? "Marked done (handed in)" : "Set aside (not needed)";
      return {
        ok: notChanged.length === 0,
        mutated: changed.length > 0,
        summary: `${verb}: ${changed.length} of ${wanted.length}${changed.length ? ` (${changed.slice(0, 8).map((t) => `“${t.title}”`).join(", ")}${changed.length > 8 ? ", …" : ""})` : ""}.${notChanged.length ? ` NOT changed: ${notChanged.slice(0, 8).map((t) => `“${t.title}”`).join(", ")}.` : ""}${unknown.length ? ` ${unknown.length} id${unknown.length === 1 ? "" : "s"} not found or already closed.` : ""}`,
        display: `${verb}: ${things(changed.length)}`,
      };
    },
  }),
  tool({
    name: "learn_planning_rule",
    description:
      "Save a planning preference Navi applies from now on, only when the user says it's how things USUALLY go ('ELA work always takes me 50% longer', 'never fill more than 60% of my weekday afternoons'). kind estimate_scale (factor 0.5–3, scope task/project/workspace/global) or daily_load_cap (cap 0.1–1, optional days). origin 'stated' needs user_quote (their exact words this turn) and applies at once; anything you infer is 'inferred' and stays a suggestion until they confirm. A one-time correction is NOT a rule: change that task's estimate or that day instead. expires_on makes it temporary.",
    schema: z.object({
      kind: z.enum(["estimate_scale", "daily_load_cap"]),
      scope: z.enum(["task", "project", "workspace", "global"]),
      scope_id: z.string().uuid().nullish(),
      factor: z.number().min(0.5).max(3).nullish(),
      cap: z.number().min(0.1).max(1).nullish(),
      days: z.array(z.number().int().min(0).max(6)).max(7).nullish(),
      origin: z.enum(["stated", "inferred"]),
      user_quote: z.string().max(300).nullish(),
      confidence: z.number().min(0).max(1).nullish(),
      note: z.string().max(300).nullish(),
      expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
    run: async (ctx, i) => {
      // "Stated" is checked against what the person actually said; otherwise it's only a suggestion.
      const stated = i.origin === "stated" && quoteIsTheirs(ctx.userMessage, i.user_quote);
      const r = await addPlanningRule(ctx, {
        kind: i.kind, scope: i.scope, scope_id: i.scope_id ?? null, params: i.kind === "estimate_scale" ? { factor: i.factor } : { cap: i.cap, days: i.days ?? undefined },
        source: stated ? "stated" : "inferred", confidence: i.confidence ?? null, note: i.note ?? null, expires_on: i.expires_on ?? null,
      });
      return { ok: true, mutated: true, summary: `Saved: ${describeRule(r)}${i.origin === "stated" && !stated ? ". Saved as a suggestion only: the quote isn't in the user's message this turn." : ""} [${r.id}]`, display: r.status === "active" ? "Saved how you plan" : "Noted as a suggestion (not applied until you confirm)" };
    },
  }),
  tool({
    name: "list_planning_rules",
    description: "Read the planning preferences Navi applies or has suggested, with where each came from, its scope and status. Read-only. Use for 'what have you learned about how I plan?'.",
    schema: z.object({}),
    run: async (ctx) => {
      const rules = await listPlanningRules(ctx);
      return { ok: true, summary: `Read ${rules.length} planning rule${rules.length === 1 ? "" : "s"}`, data: rules.map((r) => ({ id: r.id, rule: describeRule(r), kind: r.kind, scope: r.scope, scope_id: r.scope_id, params: r.params, source: r.source, confidence: r.confidence, status: r.status })) };
    },
  }),
  tool({
    name: "update_planning_rule",
    description: "Change a planning rule when the user asks: confirm a suggestion, pause, resume, remove, or edit its numbers or end date.",
    schema: z.object({ id: z.string().uuid(), action: z.enum(["confirm", "pause", "resume", "remove", "edit"]), factor: z.number().min(0.5).max(3).nullish(), cap: z.number().min(0.1).max(1).nullish(), expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (ctx, i) => {
      const params = i.factor != null ? { factor: i.factor } : i.cap != null ? { cap: i.cap } : undefined;
      const said = await changePlanningRule(ctx, i.id, { action: i.action, params, expires_on: i.expires_on });
      return { ok: true, mutated: true, summary: said, display: i.action === "remove" ? "Removed that planning rule" : "Updated how you plan" };
    },
  }),
  tool({
    name: "remember",
    description: "Save something worth remembering across sessions. origin=stated only when the user said it explicitly; inferred patterns must be origin=inferred with honest confidence.",
    schema: z.object({
      kind: z.enum(["profile", "project", "episodic", "behavioral"]),
      content: z.string().min(3).max(1000),
      origin: z.enum(["stated", "inferred"]),
      confidence: z.number().min(0).max(1),
      project_id: z.string().uuid().nullish(),
    }),
    run: async (ctx, input) => {
      const m = await addMemory(ctx, { ...input, confidence: input.origin === "inferred" ? Math.min(input.confidence, 0.8) : input.confidence });
      return { ok: true, mutated: true, summary: `Remembered: ${m.content.slice(0, 80)}`, display: `Remembered: ${m.content.length > 70 ? `${m.content.slice(0, 67).replace(/\s+\S*$/, "")}…` : m.content}` };
    },
  }),
  tool({
    name: "recall",
    description: "Look up stored memories relevant to a topic (preferences, project decisions, past events, patterns).",
    schema: z.object({ query: z.string().min(1).max(200) }),
    run: async (ctx, { query }) => {
      const mems = await relevantMemories(ctx, query, 15);
      return { ok: true, summary: `Recalled ${mems.length} memories`, data: mems.map((m) => ({ kind: m.kind, content: m.content, origin: m.origin, confidence: m.confidence, updated: m.updated_at })) };
    },
  }),
  tool({
    name: "update_settings",
    description: "Change the user's settings when they explicitly ask or tell you: display_name (what to call them, e.g. 'I'm Alex'), timezone (IANA), quiet hours, briefing times, weekly review day, availability windows for flexible work.",
    schema: ProfileUpdate,
    run: async (ctx, input) => {
      const patch = compact(ProfileUpdate.parse(input));
      if (patch.timezone && !DateTime.now().setZone(patch.timezone).isValid) return { ok: false, summary: `Unknown time zone ${patch.timezone}` };
      if (ctx.autonomy === "ask") {
        await requestApproval(ctx, {
          actionType: "internal.settings.profile",
          summary: `Change settings: ${Object.keys(patch).map((k) => k.replace(/_/g, " ")).join(", ")}`,
          details: { op: "settings", patch, subject: "Your settings", reason: "you chose to approve every change" },
        });
        return { ok: true, mutated: true, summary: `Not changed yet: the settings change is waiting for the user's Approve tap. ${WAITING}` };
      }
      const v2 = await plannerV2For(ctx);
      const { data: prior } = v2 ? await ctx.db.from("profiles").select(Object.keys(patch).join(",")).eq("id", ctx.userId).single() : { data: null };
      const { error } = await ctx.db.from("profiles").update(patch).eq("id", ctx.userId);
      if (error) return { ok: false, summary: error.message };
      // Planner v2 (B6): a settings change, availability included, can be undone.
      await logActivity(ctx, v2 ? { action: "settings_updated", entityType: "profiles", entityId: ctx.userId, summary: `Updated settings: ${Object.keys(patch).join(", ")}`, before: prior, after: patch, reversible: true } : { action: "settings_updated", summary: `Updated settings: ${Object.keys(patch).join(", ")}` });
      return { ok: true, mutated: true, summary: `Updated ${Object.keys(patch).join(", ")}${v2 && "availability" in patch ? " (usual free times; the user can undo this)" : ""}`, display: `Updated your ${fieldWords(Object.keys(patch))}` };
    },
  }),
  tool({
    name: "request_external_action",
    description: `Ask the user to approve an action that affects other people or outside systems (send a message/email, change a connected calendar, submit work, spend money). Describe EXACTLY what would happen. Connected services: ${integrations.filter((i) => i.isConnected()).map((i) => i.id).join(", ") || "none"}. Never claim the action happened.`,
    schema: z.object({
      service: z.string().max(40),
      action: z.string().max(60),
      exact_description: z.string().min(10).max(1000),
      parameters: z.record(z.string(), z.unknown()),
    }),
    run: async (ctx, input) => {
      await requestApproval(ctx, {
        actionType: `external.${input.service}.${input.action}`,
        summary: input.exact_description,
        details: input.parameters,
      });
      const connected = integrations.find((i) => i.id === input.service)?.isConnected();
      return {
        ok: true,
        mutated: true,
        summary: `Waiting for the user's approval. Nothing has been sent or changed. ${WAITING}${connected ? "" : ` Note: ${input.service} isn't connected, so even if approved it can't run yet; say so.`}`,
      };
    },
  }),
  tool({
    name: "delete_item",
    description: "Delete a task, project, goal, area (workspace), routine, event, milestone, plan block or note by id when the user asks. Deleting can't be undone, so it always becomes a card the user approves with one tap; just call it, don't ask first in text.",
    schema: z.object({ table: z.enum(["tasks", ...ENTITY_TABLES]), id: z.string().uuid() }),
    run: async (ctx, { table, id }) => {
      // Taking a block off the plan isn't deleting anything: its task stays (one change, with Undo).
      if (table === "plan_blocks" && (await plannerCommandsFor(ctx))) return runCommand(ctx, "delete_item", { kind: "unschedule", block_ids: [id] });
      // "Actually forget what I just said": a task Navi added in this chat and
      // nothing has touched since is taken back as an undo, not a deletion card.
      if (table === "tasks") {
        const undone = await undoOwnCreation(ctx, id);
        if (undone) return { ok: true, mutated: true, summary: `Took back “${undone}”: Navi had added it earlier in this chat and nothing had changed it since, so it's removed (undone, no card needed).`, display: `Removed ${q(undone)}` };
      }
      const r = await deleteEntity(ctx, table as EntityTable, id);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `Deleting needs the user's OK. ${WAITING}` };
      return { ok: true, mutated: true, summary: `Deleted the ${table.replace(/s$/, "")}`, display: "Deleted it" };
    },
  }),
  tool({
    name: "revise_action",
    description:
      "Change an action that is still waiting for the user's OK, whenever what they say means its details should be different before they approve (any field, several at once). The same card updates in place; never propose a second action for the same thing. action_id comes from the overview or an earlier tool result. changes uses the same fields as the original tool (e.g. due_at, due_is_hard, title, priority, estimate_minutes, notes for tasks; the item's own fields for other changes; for an outside action give parameters plus exact_description, the full new description).",
    schema: z.object({ action_id: z.string().uuid(), changes: z.record(z.string(), z.unknown()) }),
    run: async (ctx, { action_id, changes }) => {
      const a = await reviseApproval(ctx, action_id, changes);
      return { ok: true, mutated: true, summary: `Changed the waiting action: ${a.summary}. The card now shows the new details and still needs the user's tap.`, display: "Updated the card" };
    },
  }),
  tool({
    name: "decline_action",
    description: "Drop an action that is waiting for the user's OK when they don't want it, or before replacing it with a different action. Nothing runs. Approving only happens by the user's own tap on the card, never through you.",
    schema: z.object({ action_id: z.string().uuid() }),
    run: async (ctx, { action_id }) => {
      const a = await decideApproval(ctx, action_id, "reject");
      if (a.status === "declined") return { ok: true, mutated: true, summary: `Dropped: ${a.summary}. Nothing was done.`, display: "Dropped it; nothing changed" };
      return { ok: false, summary: `That action is already ${a.status}, so it couldn't be dropped.` };
    },
  }),
  tool({
    name: "mark_onboarding_ready",
    description: "Onboarding only: call after proposing the user's initial setup with propose_items(batch='onboarding') so the review screen opens.",
    schema: z.object({ summary: z.string().max(1000) }),
    run: async (ctx, { summary }) => {
      await ctx.db.from("profiles").update({ onboarding_status: "reviewing" }).eq("id", ctx.userId);
      await logActivity(ctx, { action: "onboarding_ready", summary: `Proposed initial setup: ${summary.slice(0, 200)}` });
      return { ok: true, mutated: true, summary: "Setup is ready for the user to review", display: "Your setup is ready to review" };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export function toolByName(name: string): NaviTool | undefined {
  return (TOOLS as readonly NaviTool[]).find((t) => t.name === name);
}

/** JSON Schema for a tool, shared by the Anthropic and Gemini adapters. */
export function jsonSchemaFor(t: NaviTool): Record<string, unknown> {
  const schema = z.toJSONSchema(t.schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Validate and run a tool; errors become a result the model can read. */
export async function runTool(ctx: Ctx, name: string, rawInput: unknown): Promise<ToolResult> {
  const t = toolByName(name);
  if (!t) return { ok: false, summary: `Unknown tool ${name}` };
  const parsed = t.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, summary: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  // Collect what this step changed (for Undo) and any action it proposed (for its card).
  const undo: string[] = [];
  const actions: string[] = [];
  let autonomy = ctx.autonomy;
  let v2 = ctx.plannerV2;
  if ((ctx.actor === "navi" && !autonomy && !READ_ONLY_TOOLS.includes(name)) || (v2 === undefined && PLANNER_V2_TOOLS.includes(name))) {
    const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
    if (ctx.actor === "navi" && !autonomy) autonomy = autonomyFrom(data?.preferences);
    v2 = plannerV2(data?.preferences);
  }
  if (PLANNER_V2_TOOLS.includes(name) && !v2) return { ok: false, summary: `${name} isn't available: the new planner isn't on for this account.` };
  let commands = ctx.plannerCommands;
  if (commands === undefined && PLANNER_COMMAND_TOOLS.includes(name)) {
    const { data } = await ctx.db.from("profiles").select("preferences").eq("id", ctx.userId).maybeSingle();
    commands = plannerCommands(data?.preferences);
  }
  if (PLANNER_COMMAND_TOOLS.includes(name) && !commands) return { ok: false, summary: `${name} isn't available: the scheduling commands aren't on for this account.` };
  const stepCtx: Ctx = {
    ...ctx,
    autonomy,
    plannerV2: v2,
    ...(commands !== undefined ? { plannerCommands: commands } : {}),
    onActivity: (e) => {
      if (e.reversible) undo.push(e.id);
      ctx.onActivity?.(e);
    },
    onAction: (id) => {
      actions.push(id);
      ctx.onAction?.(id);
    },
  };
  try {
    const result = await t.run(stepCtx, parsed.data);
    const actionId = actions.at(-1);
    // People see `display`; a tool that didn't set one gets a cleaned line from its summary.
    const display = result.display ?? (result.ok ? legacyDisplay({ name, ok: result.ok, summary: result.summary }) : "");
    const plan = result.plan ?? PLAN_TOOLS.includes(name);
    return { ...result, display, ...(plan ? { plan } : {}), ...(actionId ? { actionId } : {}), ...(undo.length ? { undo } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Anything this step already saved before the error stays undoable and is said plainly.
    if (undo.length) return { ok: false, mutated: true, summary: `Partly done before an error: ${undo.length} change${undo.length === 1 ? " was" : "s were"} saved (the user can undo ${undo.length === 1 ? "it" : "them"}), then: ${message}`, display: "Only part of that went through", undo, ...(actions.at(-1) ? { actionId: actions.at(-1) } : {}) };
    return { ok: false, summary: message, display: "", ...(actions.at(-1) ? { actionId: actions.at(-1) } : {}) };
  }
}

/** Tools that only exist with the constraint-first planner (planner v2). */
export const PLANNER_V2_TOOLS: readonly string[] = ["plan", "set_day_exception", "skip_occurrence", "move_block", "undo_plan", "set_usual_time"];

/** Tools that only exist with the scheduling-command layer (planner_commands). */
export const PLANNER_COMMAND_TOOLS: readonly string[] = ["schedule_task", "swap_work", "change_block", "remove_work", "lock_block", "set_day_scope", "group_session", "split_task", "confirm_change", "learn_planning_rule", "list_planning_rules", "update_planning_rule"];

export function toolsFor(mode: "chat" | "onboarding" | "capture" | "voice", opts: { plannerV2?: boolean; plannerCommands?: boolean } = {}): NaviTool[] {
  const all = (TOOLS as readonly NaviTool[]).filter((t) => (opts.plannerV2 || !PLANNER_V2_TOOLS.includes(t.name)) && (opts.plannerCommands || !PLANNER_COMMAND_TOOLS.includes(t.name)));
  if (mode === "capture") return all.filter((t) => ["get_overview", "get_plan", "propose_items"].includes(t.name));
  if (mode === "onboarding") return all.filter((t) => ["get_overview", "propose_items", "remember", "mark_onboarding_ready", "update_settings"].includes(t.name));
  return all.filter((t) => t.name !== "mark_onboarding_ready");
}

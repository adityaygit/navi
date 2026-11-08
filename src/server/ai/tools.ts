import "server-only";
import { z } from "zod";
import { DateTime } from "luxon";
import { fixedClash } from "@/server/planner/clash";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import { createProposals, proposalProblem } from "@/server/domain/proposals";
import { createTask, completeTask, updateTask } from "@/server/domain/tasks";
import { deleteEntity, getEntity, updateEntity, type EntityTable } from "@/server/domain/entities";
import { logActivity, revertActivities } from "@/server/domain/activity";
import { plannerV2 } from "@/lib/planner-flag";
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
import { integrations } from "@/server/integrations";
import type { CalendarEvent, OccurrenceOverride, PlanBlock, Proposal, Routine, Task } from "@/lib/types";
import { buildDayAgenda, describeDayAgenda, type AgendaEntry } from "@/server/planner/agenda";
import { proposalTitle } from "@/server/domain/proposals";
import { fixWeekdayNumbering, guardInventedTimes } from "./time-guard";
import { dayReview, weekInsights, type DayReview } from "@/server/domain/insights";
import { summarizeDayPlan, summarizeWeekPlan } from "@/lib/plan-summary";

// The tools Navi can use. The same registry backs text chat, real-time voice
// and onboarding, and every tool calls the same domain functions the
// dashboard uses, with the user's own database permissions.

/**
 * `actionId`: the step proposed (or changed) an action that waits for the
 * person's OK; the chat shows it as a card. `undo`: activity entries that undo
 * what the step changed on its own.
 */
export type ToolResult = { ok: boolean; summary: string; data?: unknown; mutated?: boolean; actionId?: string; undo?: string[] };

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

async function overview(ctx: Ctx): Promise<string> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = nowIn(zone);
  const today = now.toISODate()!;
  const week = dates(zone, today, 7);
  const [tasks, inbox, projects, goals, approvals, workspaces, routines, agendaInputs] = await Promise.all([
    ctx.db.from("tasks").select("id,title,status,priority,due_at,due_is_hard,estimate_minutes,project_id,blocker,commitment").in("status", ["todo", "in_progress", "blocked"]).order("due_at", { ascending: true, nullsFirst: false }).limit(40),
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
  lines.push(
    `Open tasks: ${((tasks.data ?? []) as Task[]).map((t) => `${t.title} (${v2 && t.commitment === "must" ? "MUST-COMPLETE, " : v2 && t.commitment === "optional" ? "optional, " : ""}P${t.priority}, ${t.status}${t.due_at ? `, due ${formatDue(t.due_at, zone)}${t.due_is_hard ? " HARD" : ""}` : ", no due date"}${t.estimate_minutes ? `, ~${t.estimate_minutes}m` : ""}${t.blocker ? `, blocked: ${t.blocker}` : ""}) [${t.id}]`).join("; ") || "none"}`,
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
      return { ok: true, mutated: true, summary: `Added ${created.length} item${created.length === 1 ? "" : "s"} to the review inbox` };
    },
  }),
  tool({
    name: "create_task",
    description:
      "Create a committed task immediately. ONLY when the user directly and explicitly commands it right now (e.g. 'add a task to email Ms. Lee'). For anything inferred or mentioned in passing, use propose_items instead. Check search_items first so you don't duplicate an existing task or inbox item. Tasks have no 'do on' date, only a due date: if the user names a day ('call mom on Sunday'), set due_at to the end of that day (23:59 local) with due_is_hard=false unless they say it's a real deadline. Don't write dates into notes. Tell the user exactly what the result says was set (e.g. 'due Sunday, not a hard deadline'); never say it's scheduled or planned for a day unless a plan block was actually made.",
    schema: TaskCreate.extend({ user_command: z.string().min(3).max(300).describe("The user's explicit instruction, quoted") }),
    run: async (ctx, input) => {
      const { user_command, ...task } = input;
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
      const t = await createTask(ctx, task);
      await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: t.id, summary: `Added at your request: “${user_command.slice(0, 120)}”` });
      return { ok: true, mutated: true, summary: `Created task “${t.title}”: ${taskDateSummary(t, ctx.timezone, user_command)}`, data: { id: t.id, due_at: t.due_at, due_is_hard: t.due_is_hard } };
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
      if (!Object.keys(compact(patch)).length) return { ok: true, mutated: true, summary: deps || "Nothing to change" };
      const r = await updateTask(ctx, id, patch);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `${deps ? `${deps} ` : ""}That change needs the user's OK because ${r.reason}. ${WAITING}` };
      const dates = "due_at" in patch || "due_is_hard" in patch ? `: ${await taskScheduleSummary(ctx, r.row)}` : "";
      return { ok: true, mutated: true, summary: `Updated task “${r.row.title}”${dates}${deps ? `. ${deps}` : ""}` };
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
        if (task.status === "done") return { ok: true, summary: `“${task.title}” is already done` };
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
      return { ok: true, mutated: true, summary: r.kind === "updated" ? `Marked “${r.row.title}” done` : "Sent for approval" };
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
      // A routine's protection and the old planner's is_fixed say the same thing.
      if (table === "routines" && typeof clean.protection === "string") clean.is_fixed = clean.protection === "fixed";
      const r = await updateEntity(ctx, table as EntityTable, id, clean);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `That change needs the user's OK because ${r.reason}. ${WAITING}` };
      // Say exactly what changed: the summary is all later turns see of this action.
      const row = r.row as Record<string, unknown>;
      const changes = Object.entries(clean).map(([k, v]) => `${k} → ${String(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 40)}`).join(", ");
      return { ok: true, mutated: true, summary: `Updated ${table.replace(/s$/, "").replace("_", " ")} “${String(row.title ?? row.name ?? "")}”: ${changes}` };
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
      available_from: z.string().nullish().describe("ISO time the user is free again, if known"),
      since: z.string().nullish().describe("ISO time the disruption started, if earlier than now (only blocks from then until available_from are marked)"),
    }),
    run: async (ctx, input) => {
      const r = await recoverPlan(ctx, { description: input.description, category: input.category, availableFrom: input.available_from, since: input.since });
      return { ok: true, mutated: true, summary: r.summary, data: { moved_to_tomorrow: r.movedToTomorrow, not_scheduled: r.notPlaced, warnings: r.plan.warnings } };
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
      capacity_minutes: z.number().int().min(0).max(1440).nullish().describe("At most this much work on the first day, as the user said"),
      free: z.array(z.object({ start: HHMM, end: HHMM })).max(6).nullish().describe("Local times the user said they're free on the first day"),
      busy: z.array(z.object({ start: HHMM, end: HHMM, title: z.string().max(120).nullish() })).max(6).nullish().describe("Local times the user said they're busy on the first day (one-off, e.g. 'karate tonight 6–7:30')"),
      start_from: HHMM.nullish().describe("Plan the first day from this local time (e.g. 'I'm free from 15:00')"),
    }),
    run: async (ctx, input) => {
      const zone = ctx.timezone;
      const first = resolveDate(input.date, zone);
      const facts: string[] = [];
      if (input.capacity_minutes != null) facts.push(await addException(ctx, { date: first, kind: "capacity", minutes: input.capacity_minutes, note: `at most ${input.capacity_minutes} min of work` }));
      for (const f of input.free ?? []) facts.push(await addException(ctx, { date: first, kind: "free", start_time: f.start, end_time: f.end, note: "free" }));
      for (const b of input.busy ?? []) facts.push(await addException(ctx, { date: first, kind: "busy", start_time: b.start, end_time: b.end, note: b.title ?? "Busy" }));
      const today = nowIn(zone).toISODate()!;
      let from: DateTime | undefined;
      if (input.start_from) {
        if (first === today) from = DateTime.max(atLocalTime(first, input.start_from, zone), nowIn(zone));
        else facts.push(await addException(ctx, { date: first, kind: "busy", start_time: "00:00", end_time: input.start_from, note: `not free before ${input.start_from}` }));
      }
      const days = Array.from({ length: input.days ?? 1 }, (_, i) => DateTime.fromISO(first, { zone }).plus({ days: i }).toISODate()!);
      const run = await planDays(ctx, days, { trigger: "chat", mode: input.mode ?? undefined, from, focusTaskIds: input.focus_task_ids ?? undefined });
      const lead = facts.length ? `Saved for ${DateTime.fromISO(first, { zone }).toFormat("cccc")} only: ${facts.join("; ")}. ` : "";
      const summary = run.status === "unchanged" ? `${lead}The plan already fits: nothing to change. ${run.summary}` : `${lead}${run.summary}${run.status === "applied" ? " (The user can undo this.)" : run.status === "proposed" ? ` ${WAITING}` : ""}`;
      return { ok: true, mutated: true, summary, data: run.results.map((r) => ({ date: r.date, blocks: r.blocks.map((b) => ({ title: b.title, start: b.starts_at, end: b.ends_at, assumed: b.basis === "inferred" })), ...v2Data(r) })) };
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
      return { ok: true, mutated: true, summary: `Saved for ${DateTime.fromISO(date, { zone: ctx.timezone }).toFormat("cccc LLL d")} only: ${said}. Call plan to re-plan around it.` };
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
      return { ok: true, mutated: true, summary: `${what} (the weekly event is unchanged). Call plan for that day to use the time.` };
    },
  }),
  tool({
    name: "move_block",
    description:
      "Move planned work blocks to new times and pin them there (re-plans then leave them alone), e.g. 'move my studying earlier', 'put Chemistry at 4'. Get block ids from get_plan. The rest of that day is re-fitted around them automatically. Never moves fixed things; a fixed block becomes a card.",
    schema: z.object({ moves: z.array(z.object({ block_id: z.string().uuid(), start: z.string().describe("New start, ISO date-time with the user's offset") })).min(1).max(6) }),
    run: async (ctx, { moves }) => {
      const zone = ctx.timezone;
      const done: string[] = [];
      const problems: string[] = [];
      const dates = new Set<string>();
      let waiting = false;
      for (const m of moves) {
        const b = await getEntity<PlanBlock>(ctx, "plan_blocks", m.block_id);
        const start = DateTime.fromISO(m.start, { setZone: true }).setZone(zone);
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
          dates.add(date);
          if (b.plan_date !== date) dates.add(b.plan_date);
        }
      }
      let refit = "";
      if (dates.size) {
        const run = await planDays(ctx, [...dates], { trigger: "chat" });
        refit = run.status === "unchanged" ? " Nothing else needed to move." : ` Re-fitted the rest: ${run.summary}`;
      }
      const parts = [done.length ? `Moved and pinned ${done.join(", ")}.${refit}` : "", problems.length ? `Not moved: ${problems.join("; ")}.` : "", waiting ? `A fixed block needs the user's OK. ${WAITING}` : ""].filter(Boolean);
      return { ok: done.length > 0 || waiting, mutated: done.length > 0 || waiting, summary: parts.join(" ") };
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
      return { ok: true, mutated: true, summary: `Undid the last plan change (${String(data.summary).slice(0, 160)}).` };
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
      return { ok: true, mutated: true, summary: `Saved: ${what}.` };
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
      return { ok: true, mutated: true, summary: `Remembered: ${m.content.slice(0, 80)}` };
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
      return { ok: true, mutated: true, summary: `Updated ${Object.keys(patch).join(", ")}${v2 && "availability" in patch ? " (usual free times; the user can undo this)" : ""}` };
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
      const r = await deleteEntity(ctx, table as EntityTable, id);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `Deleting needs the user's OK. ${WAITING}` };
      return { ok: true, mutated: true, summary: `Deleted the ${table.replace(/s$/, "")}` };
    },
  }),
  tool({
    name: "revise_action",
    description:
      "Change an action that is still waiting for the user's OK, whenever what they say means its details should be different before they approve (any field, several at once). The same card updates in place; never propose a second action for the same thing. action_id comes from the overview or an earlier tool result. changes uses the same fields as the original tool (e.g. due_at, due_is_hard, title, priority, estimate_minutes, notes for tasks; the item's own fields for other changes; for an outside action give parameters plus exact_description, the full new description).",
    schema: z.object({ action_id: z.string().uuid(), changes: z.record(z.string(), z.unknown()) }),
    run: async (ctx, { action_id, changes }) => {
      const a = await reviseApproval(ctx, action_id, changes);
      return { ok: true, mutated: true, summary: `Changed the waiting action: ${a.summary}. The card now shows the new details and still needs the user's tap.` };
    },
  }),
  tool({
    name: "decline_action",
    description: "Drop an action that is waiting for the user's OK when they don't want it, or before replacing it with a different action. Nothing runs. Approving only happens by the user's own tap on the card, never through you.",
    schema: z.object({ action_id: z.string().uuid() }),
    run: async (ctx, { action_id }) => {
      const a = await decideApproval(ctx, action_id, "reject");
      if (a.status === "declined") return { ok: true, mutated: true, summary: `Dropped: ${a.summary}. Nothing was done.` };
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
      return { ok: true, mutated: true, summary: "Setup is ready for the user to review" };
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
  const stepCtx: Ctx = {
    ...ctx,
    autonomy,
    plannerV2: v2,
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
    return { ...result, ...(actionId ? { actionId } : {}), ...(undo.length ? { undo } : {}) };
  } catch (err) {
    return { ok: false, summary: err instanceof Error ? err.message : String(err) };
  }
}

/** Tools that only exist with the constraint-first planner (planner v2). */
export const PLANNER_V2_TOOLS: readonly string[] = ["plan", "set_day_exception", "skip_occurrence", "move_block", "undo_plan", "set_usual_time"];

export function toolsFor(mode: "chat" | "onboarding" | "capture" | "voice", opts: { plannerV2?: boolean } = {}): NaviTool[] {
  const all = (TOOLS as readonly NaviTool[]).filter((t) => opts.plannerV2 || !PLANNER_V2_TOOLS.includes(t.name));
  if (mode === "capture") return all.filter((t) => ["get_overview", "get_plan", "propose_items"].includes(t.name));
  if (mode === "onboarding") return all.filter((t) => ["get_overview", "propose_items", "remember", "mark_onboarding_ready", "update_settings"].includes(t.name));
  return all.filter((t) => t.name !== "mark_onboarding_ready");
}

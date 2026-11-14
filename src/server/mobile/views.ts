import "server-only";
import { DateTime } from "luxon";
import { getProfile, type Ctx } from "@/server/context";
import { UserFacingError } from "@/server/http";
import { awakeSpan, dayFrom, loadSources, wakeBed, zoneHelpers, type DayItem } from "@/server/day";
import { freeStretches, isLongEvent, itemLooks, loadOpenWork, plannedSpans, roundUp5, weekSummary, type LookedItem } from "@/server/day-view";
import { myDayV2 } from "@/server/planner/my-day-v2";
import { listConversations } from "@/server/ai/chat";
import { loadChat } from "@/server/chat-view";
import { loadInbox } from "@/server/domain/inbox";
import { proposalTitle } from "@/server/domain/proposals";
import { actionViews } from "@/server/domain/approvals";
import { myDayHeadline, weekHeadline } from "@/lib/sentences";
import { findFits, weekOf } from "@/lib/day-layout";
import { plannerV2 } from "@/lib/planner-flag";
import { naviColor } from "@/lib/navi-colors";
import { autonomyFrom } from "@/lib/actions";
import { needsOnboarding } from "@/lib/onboarding";
import { replyView } from "@/lib/reply-view";
import { spaceColor } from "@/lib/space-color";
import { focusElapsedSeconds, type FocusSession } from "@/lib/focus";
import type { Briefing, Message, PlanBlock, Proposal, Task } from "@/lib/types";
import type {
  MBriefing,
  MChatHistory,
  MChatList,
  MDay,
  MDayItem,
  MFocusCurrent,
  MFocusSession,
  MInbox,
  MMe,
  MMessage,
  MNaviColorKey,
  MOverlap,
  MProposal,
  MSpace,
  MTask,
  MTaskGroups,
  MTaskItem,
  MWeek,
} from "@/lib/mobile-api-types";

// Read models for the phone app's screens (/api/m/*). Every number and line
// comes from the same loaders and helpers the web pages use; this file only
// shapes them into the contract in src/lib/mobile-api-types.ts.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_STATUSES = ["todo", "in_progress", "blocked"];

/** A valid local date, or null. */
function dateParam(v: string | null | undefined, zone: string): string | null {
  return v && ISO_DATE.test(v) && DateTime.fromISO(v, { zone }).isValid ? v : null;
}

// ---- me -----------------------------------------------------------------------------

export async function meView(ctx: Ctx): Promise<MMe> {
  const nowIso = new Date().toISOString();
  const [profile, claims, proposals, approvals] = await Promise.all([
    getProfile(ctx),
    ctx.db.auth.getClaims(),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending").is("batch", null),
    ctx.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed").gt("expires_at", nowIso),
  ]);
  const color = naviColor(profile.preferences?.navi_color);
  return {
    id: ctx.userId,
    email: (claims.data?.claims?.email as string | undefined) ?? null,
    displayName: profile.display_name,
    timezone: profile.timezone,
    naviColor: { key: color.key as MNaviColorKey, name: color.name, light: color.light, mid: color.mid, dark: color.dark, ink: color.ink, text: color.text },
    autonomy: autonomyFrom(profile.preferences),
    onboarding: { status: profile.onboarding_status, done: !needsOnboarding(profile.onboarding_status) },
    plannerV2: plannerV2(profile.preferences),
    briefings: { enabled: profile.briefings_enabled, morning: profile.morning_briefing_time.slice(0, 5), evening: profile.evening_review_time.slice(0, 5) },
    quietHours: profile.quiet_hours_start && profile.quiet_hours_end ? { start: profile.quiet_hours_start.slice(0, 5), end: profile.quiet_hours_end.slice(0, 5) } : null,
    wakeBed: wakeBed(profile),
    waiting: { proposals: proposals.count ?? 0, approvals: approvals.count ?? 0 },
  };
}

// ---- chats ----------------------------------------------------------------------------

export async function chatListView(ctx: Ctx): Promise<MChatList> {
  return { chats: await listConversations(ctx) };
}

export async function chatHistoryView(ctx: Ctx, id: string, limit?: number): Promise<MChatHistory> {
  const chat = await loadChat(ctx, id, limit);
  if (chat.missing || !chat.id) throw new UserFacingError("That chat doesn't exist (or isn't yours).", 404);
  return {
    id: chat.id,
    title: chat.title,
    messages: chat.messages.map((m) => messageView(m, chat.actions)),
    actions: chat.actions,
    undone: chat.undone,
  };
}

function messageView(m: Message, actions: MChatHistory["actions"]): MMessage {
  if (m.role !== "assistant") return { ...m, tool_events: m.tool_events ?? [], receipts: [], cardIds: [] };
  const { rows, cardIds } = replyView(m.tool_events ?? [], actions);
  return { ...m, tool_events: m.tool_events ?? [], receipts: rows, cardIds };
}

// ---- day and week -----------------------------------------------------------------------

function itemView(e: LookedItem, opts: { nowMs: number; isToday: boolean; v2: boolean; overlaps: string[] }): MDayItem {
  const block: PlanBlock | null = e.block;
  const open = !block || block.status === "planned" || block.status === "in_progress";
  return {
    id: e.id,
    key: itemKey(e),
    kind: e.kind,
    look: e.look,
    title: e.title,
    start: new Date(e.startMs).toISOString(),
    end: new Date(e.endMs).toISOString(),
    minutes: Math.round((e.endMs - e.startMs) / 60000),
    status: block?.status ?? null,
    open,
    done: block?.status === "done",
    now: opts.isToday && open && e.startMs <= opts.nowMs && e.endMs > opts.nowMs,
    space: e.space,
    color: e.color,
    taskId: e.taskId,
    assumed: opts.v2 && block?.basis === "inferred" && open,
    pinned: !!block?.pinned,
    recurring: !!e.recurring,
    reason: block?.reason ?? null,
    overlaps: opts.overlaps,
  };
}

/** Unique per row: a weekly event repeats its id, so the start is part of it (as on the web timeline). */
function itemKey(i: DayItem): string {
  return `${i.kind}${i.id}${i.startMs}`;
}

/** Pairs of things on the line at the same time (all-day events aside). */
function overlapsOf(items: DayItem[]): MOverlap[] {
  const timed = items.filter((i) => !isLongEvent(i));
  const out: MOverlap[] = [];
  for (let x = 0; x < timed.length; x++) {
    for (let y = x + 1; y < timed.length; y++) {
      const a = timed[x];
      const b = timed[y];
      const start = Math.max(a.startMs, b.startMs);
      const end = Math.min(a.endMs, b.endMs);
      if (end <= start) continue;
      out.push({ a: itemKey(a), b: itemKey(b), titles: [a.title, b.title], start: new Date(start).toISOString(), end: new Date(end).toISOString(), minutes: Math.round((end - start) / 60000) });
    }
  }
  return out;
}

function overlapIndex(overlaps: MOverlap[]): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const o of overlaps) {
    by.set(o.a, [...(by.get(o.a) ?? []), o.b]);
    by.set(o.b, [...(by.get(o.b) ?? []), o.a]);
  }
  return by;
}

function briefingView(b: Briefing | null): MBriefing | null {
  return b ? { id: b.id, kind: b.kind, local_date: b.local_date, title: b.title, body: b.body, read_at: b.read_at, created_at: b.created_at } : null;
}

export async function dayView(ctx: Ctx, requested?: string | null): Promise<MDay> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const date = dateParam(requested, zone) ?? today;
  const isToday = date === today;
  const isPast = date < today;
  const z = zoneHelpers(zone);

  const [src, focusRes, work, briefingRes] = await Promise.all([
    loadSources(ctx, date, date),
    ctx.db.from("focus_sessions").select("id").is("ended_at", null).maybeSingle(),
    loadOpenWork(ctx, today),
    isToday ? ctx.db.from("briefings").select("*").is("read_at", null).eq("local_date", today).order("created_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const look = itemLooks(src);
  const day = dayFrom(src, date);
  const awake = awakeSpan(profile, date, zone);
  const v2 = plannerV2(profile.preferences);
  const v2Day = v2 ? await myDayV2(ctx, date, src.blocks, isToday ? roundUp5(nowMs) : 0) : null;

  const overlaps = overlapsOf(day.items);
  const byKey = overlapIndex(overlaps);
  const items = day.items.map((i) => itemView(look(i), { nowMs, isToday, v2, overlaps: byKey.get(itemKey(i)) ?? [] }));

  const busy = day.items.map((i) => ({ start: i.startMs, end: i.endMs }));
  const gaps = freeStretches({ date, zone, nowMs, isToday, isPast, awake, busy, capacity: v2Day ? v2Day.capacity : null });
  const unscheduled = work.openTasks.filter((t) => !work.scheduled.has(t.id));
  const fits = findFits(gaps, unscheduled.map((t) => ({ id: t.id, title: t.title, estimate: t.estimate_minutes, dueMs: t.due_at ? Date.parse(t.due_at) : null })));

  const earlierItems = isToday ? items.filter((i) => Date.parse(i.end) <= nowMs) : [];
  return {
    date,
    timezone: zone,
    now: new Date(nowMs).toISOString(),
    isToday,
    isPast,
    headline: myDayHeadline(plannedSpans(day.items), awake, z.fmtHour, z.minuteOfDay),
    items,
    earlier: isToday ? { keys: earlierItems.map((i) => i.key), done: earlierItems.filter((i) => i.done).length } : null,
    overlaps,
    free: fits.map((f) => ({
      start: new Date(f.gap.start).toISOString(),
      end: new Date(f.gap.end).toISOString(),
      minutes: f.minutes,
      fits: f.task && f.task.estimate ? { taskId: f.task.id, title: f.task.title, estimate: f.task.estimate } : null,
    })),
    needsTime: unscheduled.slice(0, 5).map((t) => ({
      id: t.id,
      title: t.title,
      estimate_minutes: t.estimate_minutes,
      due_at: t.due_at,
      due_is_hard: t.due_is_hard,
      steps: work.steps.get(t.id) ?? 0,
      space: spaceOf(src.spaces, t.workspace_id),
    })),
    needsTimeTotal: unscheduled.length,
    untimed: day.untimed.map((e) => ({ id: e.id, title: e.title })),
    plan: v2Day ? { assumptions: v2Day.assumptions, unknown: v2Day.unknown, proposals: v2Day.proposals } : null,
    briefing: briefingView((briefingRes.data as Briefing | null) ?? null),
    focusSessionId: (focusRes.data?.id as string | undefined) ?? null,
  };
}

export async function weekView(ctx: Ctx, requested?: string | null): Promise<MWeek> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const week = weekOf(dateParam(requested, zone) ?? today, zone);
  const [src, work] = await Promise.all([loadSources(ctx, week[0], week[6]), loadOpenWork(ctx, today)]);
  const look = itemLooks(src);
  const v2 = plannerV2(profile.preferences);
  const dayData = week.map((d) => dayFrom(src, d));
  const summary = weekSummary(dayData, zone);
  return {
    start: week[0],
    end: week[6],
    timezone: zone,
    headline: weekHeadline(summary),
    days: dayData.map((dd, n) => {
      const overlaps = overlapsOf(dd.items);
      const byKey = overlapIndex(overlaps);
      return {
        date: dd.date,
        isToday: dd.date === today,
        items: dd.items.map((i) => itemView(look(i), { nowMs, isToday: dd.date === today, v2, overlaps: byKey.get(itemKey(i)) ?? [] })),
        plannedMinutes: Math.round(summary[n].minutes),
        overlaps: overlaps.length,
        due: work.openTasks
          .filter((t) => t.due_at && DateTime.fromISO(t.due_at, { zone }).toISODate() === dd.date)
          .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at!, due_is_hard: t.due_is_hard })),
      };
    }),
  };
}

function spaceOf(spaces: Map<string, { id: string; name: string; color: string | null }>, id: string | null): MSpace | null {
  const s = id ? spaces.get(id) : undefined;
  return s ? { id: s.id, name: s.name, color: spaceColor(s) } : null;
}

// ---- tasks -------------------------------------------------------------------------------

/** A task row as the app gets it (the columns in MTask). */
export function taskView(t: Task): MTask {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    due_is_hard: t.due_is_hard,
    estimate_minutes: t.estimate_minutes,
    actual_minutes: t.actual_minutes,
    commitment: t.commitment,
    not_before: t.not_before ?? null,
    remind_at: t.remind_at ?? null,
    recurrence: t.recurrence,
    workspace_id: t.workspace_id,
    project_id: t.project_id,
    goal_id: t.goal_id,
    parent_task_id: t.parent_task_id,
    completed_at: t.completed_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

export async function taskGroupsView(ctx: Ctx): Promise<MTaskGroups> {
  const zone = ctx.timezone;
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;
  const dayStart = now.startOf("day");
  const dayEnd = now.endOf("day").toMillis();
  const [openRes, doneRes, blocksRes, spacesRes] = await Promise.all([
    ctx.db.from("tasks").select("*").in("status", OPEN_STATUSES).is("parent_task_id", null).order("due_at", { ascending: true, nullsFirst: false }).order("created_at"),
    ctx.db.from("tasks").select("*").eq("status", "done").is("parent_task_id", null).gte("completed_at", dayStart.toISO()!),
    ctx.db.from("plan_blocks").select("id,task_id,plan_date,starts_at,ends_at,status").gte("plan_date", today).not("task_id", "is", null).order("starts_at"),
    ctx.db.from("workspaces").select("id,name,color"),
  ]);
  for (const r of [openRes, doneRes, blocksRes, spacesRes]) if (r.error) throw new Error(r.error.message);
  const open = (openRes.data ?? []) as Task[];
  const done = (doneRes.data ?? []) as Task[];
  const blocks = (blocksRes.data ?? []) as Pick<PlanBlock, "id" | "task_id" | "plan_date" | "starts_at" | "ends_at" | "status">[];
  const spaces = new Map(((spacesRes.data ?? []) as { id: string; name: string; color: string | null }[]).map((s) => [s.id, s]));

  // As on Tasks → Today: a time today (a block that wasn't skipped or missed), or due by the end of today.
  const todayBlock = new Map<string, string>();
  const next = new Map<string, MTaskItem["next"]>();
  for (const b of blocks) {
    if (!b.task_id) continue;
    if (b.plan_date === today && !["skipped", "missed"].includes(b.status) && !todayBlock.has(b.task_id)) todayBlock.set(b.task_id, b.starts_at);
    if (["planned", "in_progress"].includes(b.status) && !next.has(b.task_id)) next.set(b.task_id, { blockId: b.id, start: b.starts_at, end: b.ends_at });
  }
  const ids = [...open, ...done].map((t) => t.id);
  const stepsRes = ids.length ? await ctx.db.from("tasks").select("parent_task_id,status").in("parent_task_id", ids).neq("status", "cancelled") : { data: [] };
  const steps = new Map<string, { total: number; done: number }>();
  for (const s of (stepsRes.data ?? []) as { parent_task_id: string; status: string }[]) {
    const c = steps.get(s.parent_task_id) ?? { total: 0, done: 0 };
    c.total++;
    if (s.status === "done") c.done++;
    steps.set(s.parent_task_id, c);
  }
  const item = (t: Task): MTaskItem => ({ ...taskView(t), space: spaceOf(spaces, t.workspace_id), steps: steps.get(t.id) ?? { total: 0, done: 0 }, next: next.get(t.id) ?? null });

  const dueMs = (t: Task) => (t.due_at ? Date.parse(t.due_at) : null);
  const isToday = (t: Task) => todayBlock.has(t.id) || (dueMs(t) != null && dueMs(t)! <= dayEnd);
  const todayTasks = open.filter(isToday);
  const overdue = todayTasks.filter((t) => !todayBlock.has(t.id) && dueMs(t)! < dayStart.toMillis());
  const when = (t: Task) => (todayBlock.has(t.id) ? Date.parse(todayBlock.get(t.id)!) : (dueMs(t) ?? Infinity));
  const rest = todayTasks.filter((t) => !overdue.includes(t)).sort((a, b) => when(a) - when(b));
  const notToday = open.filter((t) => !isToday(t));
  return {
    today: [...overdue, ...rest].map(item),
    needsTime: notToday.filter((t) => !next.has(t.id) && t.priority < 4).map(item),
    later: notToday.filter((t) => next.has(t.id) || t.priority === 4).map(item),
    doneToday: done.map(item),
  };
}

// ---- inbox ---------------------------------------------------------------------------------

export function proposalView(p: Proposal, area: MProposal["area"] = null): MProposal {
  return {
    id: p.id,
    capture_id: p.capture_id,
    conversation_id: p.conversation_id,
    kind: p.kind,
    payload: p.payload,
    source_excerpt: p.source_excerpt,
    origin: p.origin,
    confidence: p.confidence,
    rationale: p.rationale,
    status: p.status,
    created_at: p.created_at,
    title: proposalTitle(p),
    area,
  };
}

export async function inboxView(ctx: Ctx): Promise<MInbox> {
  const [inbox, approvalsRes] = await Promise.all([
    loadInbox(ctx),
    ctx.db.from("approvals").select("id").eq("status", "proposed").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(100),
  ]);
  if (approvalsRes.error) throw new Error(approvalsRes.error.message);
  const approvalIds = ((approvalsRes.data ?? []) as { id: string }[]).map((a) => a.id);
  const cards = await actionViews(ctx, approvalIds);
  const view = (p: Proposal) => proposalView(p, inbox.areaOf(p));
  return {
    groups: inbox.groups.map((g) => ({
      key: g.key,
      label: g.label,
      capture: g.capture ? { id: g.capture.id, raw_text: g.capture.raw_text, status: g.capture.status, source: g.capture.source, captured_at: g.capture.captured_at } : null,
      proposals: g.items.map(view),
    })),
    deferred: inbox.deferred.map(view),
    approvals: approvalIds.flatMap((id) => (cards[id] ? [cards[id]] : [])),
    openTasks: inbox.openTasks,
    counts: { proposals: inbox.pending.length, approvals: approvalIds.length, stated: inbox.pending.filter((p) => p.origin === "stated").length },
  };
}

// ---- focus ------------------------------------------------------------------------------------

export function focusSessionView(s: FocusSession): MFocusSession {
  return {
    id: s.id,
    task_id: s.task_id,
    block_id: s.block_id,
    started_at: s.started_at,
    ended_at: s.ended_at,
    planned_minutes: s.planned_minutes,
    actual_minutes: s.actual_minutes,
    outcome: s.outcome,
    note: s.note,
    paused_at: s.paused_at,
    paused_seconds: s.paused_seconds ?? 0,
  };
}

export async function focusView(ctx: Ctx): Promise<MFocusCurrent> {
  const { data, error } = await ctx.db.from("focus_sessions").select("*, tasks(title, workspace_id)").is("ended_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { session: null };
  const s = data as FocusSession & { tasks: { title: string; workspace_id: string | null } | null };
  let space: MSpace | null = null;
  if (s.tasks?.workspace_id) {
    const { data: w } = await ctx.db.from("workspaces").select("id,name,color").eq("id", s.tasks.workspace_id).maybeSingle();
    space = spaceOf(new Map(w ? [[w.id as string, w as { id: string; name: string; color: string | null }]] : []), s.tasks.workspace_id);
  }
  return { session: { ...focusSessionView(s), title: s.tasks?.title ?? "Focus", space, elapsedSeconds: focusElapsedSeconds(s, Date.now()) } };
}

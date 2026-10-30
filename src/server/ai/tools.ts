import "server-only";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import { createProposals } from "@/server/domain/proposals";
import { createTask, completeTask, updateTask } from "@/server/domain/tasks";
import { updateEntity, type EntityTable } from "@/server/domain/entities";
import { addMemory, relevantMemories } from "@/server/domain/memory";
import { requestApproval } from "@/server/domain/approvals";
import { generateDayPlan, generateWeekPlan, recoverPlan } from "@/server/planner/plan";
import { ProfileUpdate, TaskCreate, TaskUpdate, compact } from "@/server/domain/schemas";
import { logActivity } from "@/server/domain/activity";
import { formatDue, formatTime, nowIn } from "@/lib/time";
import { integrations } from "@/server/integrations";
import type { Task } from "@/lib/types";

// The tools Navi can use. The same registry backs text chat, real-time voice
// and onboarding, and every tool calls the same domain functions the
// dashboard uses, with the user's own database permissions.

export type ToolResult = { ok: boolean; summary: string; data?: unknown; mutated?: boolean };

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
      "Fields for the item. workspace:{name,description}; goal:{title,why,measure,target_date,workspace_ref}; project:{name,objective,due_date,workspace_ref,goal_ref}; routine:{title,days[0-6],start_time HH:MM|null,duration_minutes,is_fixed,workspace_ref,goal_ref}; event:{title,starts_at,ends_at,recurrence{freq:'weekly',days,until}|null,location,workspace_ref}; task/reminder:{title,notes,priority 1-4,due_at,due_is_hard,estimate_minutes,workspace_ref,project_ref,goal_ref}; note:{title,body}; question:{question}; memory:{kind:profile|project|episodic|behavioral,content,origin:'stated'|'inferred'}; preference:{timezone,quiet_hours_start,quiet_hours_end,morning_briefing_time,evening_review_time,availability[{days,start,end}]}. Use *_ref to point at another proposal's ref_key in the same call.",
    ),
  ref_key: z.string().max(60).nullish().describe("Short unique key so other proposals can reference this one, e.g. 'ws_school'"),
  source_excerpt: z.string().max(1000).nullish().describe("The user's exact words this came from"),
  origin: z.enum(["stated", "inferred"]).describe("stated = the user said it explicitly; inferred = your interpretation"),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(500).nullish().describe("Why you propose this, briefly"),
});

const ENTITY_TABLES = ["projects", "goals", "workspaces", "routines", "events", "milestones", "plan_blocks"] as const;

async function overview(ctx: Ctx): Promise<string> {
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = nowIn(zone);
  const today = now.toISODate()!;
  const [tasks, blocks, inbox, projects, goals, approvals, workspaces, routines, events] = await Promise.all([
    ctx.db.from("tasks").select("id,title,status,priority,due_at,due_is_hard,estimate_minutes,project_id,blocker").in("status", ["todo", "in_progress", "blocked"]).order("due_at", { ascending: true, nullsFirst: false }).limit(40),
    ctx.db.from("plan_blocks").select("id,title,starts_at,ends_at,status,is_flexible,task_id").eq("plan_date", today).order("starts_at"),
    ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ctx.db.from("projects").select("id,name,status,due_date").eq("status", "active"),
    ctx.db.from("goals").select("id,title,status,target_date").eq("status", "active"),
    ctx.db.from("approvals").select("id,summary").eq("status", "pending"),
    ctx.db.from("workspaces").select("id,name").eq("status", "active"),
    ctx.db.from("routines").select("id,title,days,start_time,duration_minutes").eq("active", true),
    ctx.db.from("events").select("id,title,starts_at,ends_at,recurrence").neq("status", "cancelled").gte("ends_at", now.minus({ days: 1 }).toISO()!).lte("starts_at", now.plus({ days: 7 }).toISO()!).limit(30),
  ]);
  const lines: string[] = [];
  lines.push(`Now: ${now.toFormat("cccc, LLL d yyyy, h:mm a")} (${zone}). Availability: ${JSON.stringify(profile.availability)}. Quiet hours: ${profile.quiet_hours_start ?? "not set"}–${profile.quiet_hours_end ?? "not set"}.`);
  lines.push(`Workspaces: ${(workspaces.data ?? []).map((w) => `${w.name} [${w.id}]`).join("; ") || "none"}`);
  lines.push(`Active goals: ${(goals.data ?? []).map((g) => `${g.title}${g.target_date ? ` (by ${g.target_date})` : ""} [${g.id}]`).join("; ") || "none"}`);
  lines.push(`Active projects: ${(projects.data ?? []).map((p) => `${p.name}${p.due_date ? ` (due ${p.due_date})` : ""} [${p.id}]`).join("; ") || "none"}`);
  lines.push(`Routines: ${(routines.data ?? []).map((r) => `${r.title} days=${r.days.join(",")} ${r.start_time ?? "flexible"} ${r.duration_minutes}m [${r.id}]`).join("; ") || "none"}`);
  lines.push(`Upcoming events (7d): ${(events.data ?? []).map((e) => `${e.title} ${formatTime(e.starts_at, zone)} ${DateTime.fromISO(e.starts_at).setZone(zone).toFormat("ccc LLL d")}${e.recurrence ? " (weekly)" : ""} [${e.id}]`).join("; ") || "none"}`);
  lines.push(`Today's plan: ${(blocks.data ?? []).map((b) => `${formatTime(b.starts_at, zone)}–${formatTime(b.ends_at, zone)} ${b.title} (${b.status}${b.is_flexible ? "" : ", fixed"}) [${b.id}]`).join("; ") || "nothing planned"}`);
  lines.push(
    `Open tasks: ${((tasks.data ?? []) as Task[]).map((t) => `${t.title} (P${t.priority}, ${t.status}${t.due_at ? `, due ${formatDue(t.due_at, zone)}${t.due_is_hard ? " HARD" : ""}` : ""}${t.estimate_minutes ? `, ~${t.estimate_minutes}m` : ""}${t.blocker ? `, blocked: ${t.blocker}` : ""}) [${t.id}]`).join("; ") || "none"}`,
  );
  lines.push(`Review inbox: ${inbox.count ?? 0} pending. Pending approvals: ${(approvals.data ?? []).map((a) => a.summary).join("; ") || "none"}.`);
  return lines.join("\n");
}

export const TOOLS = [
  tool({
    name: "get_overview",
    description: "Read the user's current state: time, availability, workspaces, goals, projects, routines, upcoming events, today's plan, open tasks (with ids), inbox and approvals. Call this before acting on existing items.",
    schema: z.object({}),
    run: async (ctx) => ({ ok: true, summary: "Read overview", data: await overview(ctx) }),
  }),
  tool({
    name: "search_items",
    description: "Find tasks, projects, goals or events whose title matches a query. Includes done items.",
    schema: z.object({ query: z.string().min(1).max(200) }),
    run: async (ctx, { query }) => {
      const q = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      const [t, p, g, e] = await Promise.all([
        ctx.db.from("tasks").select("id,title,status,due_at,priority").ilike("title", q).limit(10),
        ctx.db.from("projects").select("id,name,status,objective").ilike("name", q).limit(5),
        ctx.db.from("goals").select("id,title,status").ilike("title", q).limit(5),
        ctx.db.from("events").select("id,title,starts_at").ilike("title", q).limit(5),
      ]);
      return { ok: true, summary: `Searched for “${query}”`, data: { tasks: t.data, projects: p.data, goals: g.data, events: e.data } };
    },
  }),
  tool({
    name: "propose_items",
    description:
      "Put NEW items you inferred from what the user said into their review inbox (they become real only when the user accepts them). Use this for anything from brain dumps, casual mentions, or onboarding. Preserve the user's words in source_excerpt and be honest about origin and confidence.",
    schema: z.object({ items: z.array(ProposalItem).min(1).max(40), batch: z.enum(["onboarding", "capture"]).nullish() }),
    run: async (ctx, { items, batch }) => {
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
      "Create a committed task immediately. ONLY when the user directly and explicitly commands it right now (e.g. 'add a task to email Ms. Lee'). For anything inferred or mentioned in passing, use propose_items instead.",
    schema: TaskCreate.extend({ user_command: z.string().min(3).max(300).describe("The user's explicit instruction, quoted") }),
    run: async (ctx, input) => {
      const { user_command, ...task } = input;
      const t = await createTask(ctx, task);
      await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: t.id, summary: `Added at your request: “${user_command.slice(0, 120)}”` });
      return { ok: true, mutated: true, summary: `Created task “${t.title}”`, data: { id: t.id } };
    },
  }),
  tool({
    name: "update_task",
    description: "Change an existing task (title, notes, priority, estimate, due date, status other than done, blocker, links). Hard-deadline changes go to the user for approval automatically.",
    schema: TaskUpdate.omit({ status: true }).extend({
      id: z.string().uuid(),
      status: z.enum(["todo", "in_progress", "blocked", "cancelled"]).nullish(),
    }),
    run: async (ctx, { id, ...patch }) => {
      if (patch.status === "cancelled") {
        const approval = await requestApproval(ctx, { actionType: "internal.update.tasks", summary: `Cancel task ${id.slice(0, 8)}`, details: { op: "update", table: "tasks", id, patch: { status: "cancelled" } } });
        return { ok: true, mutated: true, summary: `Cancelling needs the user's approval (request ${approval.id.slice(0, 8)})` };
      }
      const r = await updateTask(ctx, id, patch);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `That change ${r.reason}, so it was sent to the user for approval` };
      return { ok: true, mutated: true, summary: `Updated task “${r.row.title}”` };
    },
  }),
  tool({
    name: "complete_task",
    description: "Mark a task done ONLY when the user explicitly says they finished it. Quote what they said. Never infer completion.",
    schema: z.object({ id: z.string().uuid(), user_statement: z.string().min(3).max(300), actual_minutes: z.number().int().min(1).max(1440).nullish() }),
    run: async (ctx, { id, user_statement, actual_minutes }) => {
      // The user's own statement is the authority here, so it runs as the user.
      const r = await completeTask({ ...ctx, actor: "user" }, id, actual_minutes);
      await logActivity(ctx, { action: "explicit_command", entityType: "tasks", entityId: id, summary: `Marked done because you said: “${user_statement.slice(0, 120)}”` });
      return { ok: true, mutated: true, summary: r.kind === "updated" ? `Marked “${r.row.title}” done` : "Sent for approval" };
    },
  }),
  tool({
    name: "update_item",
    description: "Change an existing project, goal, workspace, routine, event, milestone or plan block by id. Moving fixed commitments, cancelling events, or dropping goals/projects is sent to the user for approval automatically.",
    schema: z.object({ table: z.enum(ENTITY_TABLES), id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }),
    run: async (ctx, { table, id, patch }) => {
      const forbidden = ["id", "user_id", "created_at", "updated_at", "external_ref"];
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !forbidden.includes(k)));
      const r = await updateEntity(ctx, table as EntityTable, id, clean);
      if (r.kind === "approval_requested") return { ok: true, mutated: true, summary: `That change ${r.reason}, so it was sent to the user for approval` };
      return { ok: true, mutated: true, summary: `Updated ${table.replace(/s$/, "")}` };
    },
  }),
  tool({
    name: "plan_day",
    description: "Re-plan flexible work for a date (default today) around fixed commitments and the user's availability. Deterministic; returns what was placed and what didn't fit.",
    schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (ctx, { date }) => {
      const r = await generateDayPlan(ctx, date ?? undefined);
      return {
        ok: true,
        mutated: true,
        summary: `Planned ${r.date}: ${r.blocks.length} blocks${r.unscheduled.length ? `, ${r.unscheduled.length} didn't fit` : ""}`,
        data: { blocks: r.blocks.map((b) => ({ title: b.title, start: b.starts_at, end: b.ends_at, why: b.reason })), unscheduled: r.unscheduled, warnings: r.warnings, freeMinutes: r.freeMinutes },
      };
    },
  }),
  tool({
    name: "plan_week",
    description: "Re-plan the next 7 days of flexible work.",
    schema: z.object({}),
    run: async (ctx) => {
      const days = await generateWeekPlan(ctx);
      return {
        ok: true,
        mutated: true,
        summary: `Planned the week: ${days.reduce((s, d) => s + d.blocks.length, 0)} blocks`,
        data: days.map((d) => ({ date: d.date, blocks: d.blocks.length, unscheduled: d.unscheduled.map((u) => u.title), warnings: d.warnings })),
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
    }),
    run: async (ctx, input) => {
      const r = await recoverPlan(ctx, { description: input.description, category: input.category, availableFrom: input.available_from });
      return { ok: true, mutated: true, summary: r.summary, data: { unscheduled: r.plan.unscheduled, warnings: r.plan.warnings } };
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
    description: "Change the user's settings when they explicitly ask: timezone (IANA), quiet hours, briefing times, weekly review day, availability windows for flexible work.",
    schema: ProfileUpdate,
    run: async (ctx, input) => {
      const patch = compact(ProfileUpdate.parse(input));
      if (patch.timezone && !DateTime.now().setZone(patch.timezone).isValid) return { ok: false, summary: `Unknown time zone ${patch.timezone}` };
      const { error } = await ctx.db.from("profiles").update(patch).eq("id", ctx.userId);
      if (error) return { ok: false, summary: error.message };
      await logActivity(ctx, { action: "settings_updated", summary: `Updated settings: ${Object.keys(patch).join(", ")}` });
      return { ok: true, mutated: true, summary: `Updated ${Object.keys(patch).join(", ")}` };
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
      const a = await requestApproval(ctx, {
        actionType: `external.${input.service}.${input.action}`,
        summary: input.exact_description,
        details: input.parameters,
      });
      const connected = integrations.find((i) => i.id === input.service)?.isConnected();
      return {
        ok: true,
        mutated: true,
        summary: `Approval requested (${a.id.slice(0, 8)}). Nothing has been sent or changed.${connected ? "" : ` Note: ${input.service} isn't connected, so even if approved it can't run yet.`}`,
      };
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
  try {
    return await t.run(ctx, parsed.data);
  } catch (err) {
    return { ok: false, summary: err instanceof Error ? err.message : String(err) };
  }
}

export function toolsFor(mode: "chat" | "onboarding" | "capture" | "voice"): NaviTool[] {
  const all = TOOLS as readonly NaviTool[];
  if (mode === "capture") return all.filter((t) => ["get_overview", "propose_items"].includes(t.name));
  if (mode === "onboarding") return all.filter((t) => ["get_overview", "propose_items", "remember", "mark_onboarding_ready", "update_settings"].includes(t.name));
  return all.filter((t) => t.name !== "mark_onboarding_ready");
}

import "server-only";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DateTime } from "luxon";
import { AuthError, requireApiCtx, type Ctx } from "@/server/context";
import { apiError, UserFacingError } from "@/server/http";
import { createConversation, deleteConversation, renameConversation } from "@/server/ai/chat";
import { changeTask, completeTask, createTask, endFocus, FocusEndInput, pauseFocus, resumeFocus, startFocus } from "@/server/domain/tasks";
import { TaskCreate } from "@/server/domain/schemas";
import { placeTask } from "@/server/planner/place";
import { BlockOutcomeInput, dayPlanMessage, generateDayPlan, generateWeekPlan, setBlockOutcome, weekPlanMessage } from "@/server/planner/plan";
import { acceptMany, acceptManyProblem, acceptProposal, editProposal, mergeProposalIntoTask, setProposalStatus } from "@/server/domain/proposals";
import { decideActionView, decisionMessage } from "@/server/domain/approvals";
import { revertActivities, revertActivity } from "@/server/domain/activity";
import { BriefingKind, generateBriefing, markBriefingRead } from "@/server/domain/briefings";
import type { UpdateResult } from "@/server/domain/entities";
import type { Task } from "@/lib/types";
import type {
  MAcceptManyResult,
  MBriefingGenerated,
  MChatCreated,
  MDecideResult,
  MFocusResult,
  MOk,
  MPlanResult,
  MProposalResult,
  MTaskChange,
  MTaskResult,
  MUndoResult,
  MUpdateResult,
  MTask,
} from "@/lib/mobile-api-types";
import { chatHistoryView, chatListView, dayView, focusSessionView, focusView, inboxView, meView, proposalView, taskGroupsView, taskView, weekView } from "./views";

// The phone app's JSON API: one table of routes under /api/m, each a thin
// wrapper over the same domain functions the web's server actions call (no
// logic of its own beyond validating input and shaping output). Contract:
// src/lib/mobile-api-types.ts; docs: docs/navi-1.5/mobile/API.md.
//
// Auth: getCtx accepts the app's `Authorization: Bearer` token (or the web
// cookie). Errors are `{ error }` with a status: 401 signed out, 400 invalid
// input or refused by Navi's rules (the same message the web shows), 404 no
// such thing, 405 wrong method, 409 conflict, 500 server fault (with a code).

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Params = Record<string, string>;
type Handler = (ctx: Ctx, req: { params: Params; body: unknown; query: URLSearchParams }) => Promise<unknown>;
type Route = { method: Method; pattern: string[]; handler: Handler };

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => DateTime.fromISO(v).isValid, "must be a real date (YYYY-MM-DD)");

/** A thrown error the person should see as it is (same as the web's action results). */
class NotFound extends UserFacingError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

function updateResult(r: UpdateResult<Task>): MUpdateResult<MTask> {
  return r.kind === "updated" ? { kind: "updated", row: taskView(r.row) } : r;
}

const routes: Route[] = [];
function route(method: Method, path: string, handler: Handler) {
  routes.push({ method, pattern: path.split("/").filter(Boolean), handler });
}

// ---- me & chats -------------------------------------------------------------------------
route("GET", "me", (ctx) => meView(ctx));
route("GET", "chats", (ctx) => chatListView(ctx));
route("POST", "chats", async (ctx): Promise<MChatCreated> => ({ id: await createConversation(ctx, "chat") }));
route("PATCH", "chats/:id", async (ctx, { params, body }): Promise<MOk> => {
  const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(body);
  await renameConversation(ctx, params.id, title);
  return { ok: true, message: "Chat renamed" };
});
route("DELETE", "chats/:id", async (ctx, { params }): Promise<MOk> => {
  await deleteConversation(ctx, params.id);
  return { ok: true, message: "Chat deleted" };
});
route("GET", "chats/:id/messages", (ctx, { params, query }) => {
  const limit = query.get("limit") ? z.coerce.number().int().min(1).max(200).parse(query.get("limit")) : undefined;
  return chatHistoryView(ctx, params.id, limit);
});

// ---- day & week -------------------------------------------------------------------------------
route("GET", "day", (ctx, { query }) => dayView(ctx, query.get("date") ? IsoDate.parse(query.get("date")) : null));
route("GET", "week", (ctx, { query }) => weekView(ctx, query.get("start") ? IsoDate.parse(query.get("start")) : null));

// ---- tasks & planning -----------------------------------------------------------------------
route("GET", "tasks", (ctx) => taskGroupsView(ctx));
route("POST", "tasks", async (ctx, { body }): Promise<MTaskResult> => {
  const { id } = z.object({ id: Uuid.optional() }).parse(body ?? {});
  return { task: taskView(await createTask(ctx, TaskCreate.parse(body), { id })) };
});
route("PATCH", "tasks/:id", async (ctx, { params, body }): Promise<MTaskChange> => ({ result: updateResult(await changeTask(ctx, params.id, body)) }));
route("POST", "tasks/:id/complete", async (ctx, { params, body }): Promise<MTaskChange> => {
  const { actualMinutes } = z.object({ actualMinutes: z.number().int().min(0).max(1440).nullish() }).parse(body ?? {});
  return { result: updateResult(await completeTask(ctx, params.id, actualMinutes)) };
});
route("POST", "tasks/:id/uncomplete", async (ctx, { params }): Promise<MTaskChange> => ({ result: updateResult(await changeTask(ctx, params.id, { status: "todo" })) }));
route("POST", "tasks/:id/place", async (ctx, { params, body }): Promise<MOk> => {
  await placeTask(ctx, { ...(body as object), taskId: params.id });
  return { ok: true };
});
route("POST", "plan/day", async (ctx, { body }): Promise<MPlanResult> => {
  const { date } = z.object({ date: IsoDate.nullish() }).parse(body ?? {});
  return { message: dayPlanMessage(await generateDayPlan(ctx, date ?? undefined), ctx.timezone) };
});
route("POST", "plan/week", async (ctx, { body }): Promise<MPlanResult> => {
  const { start } = z.object({ start: IsoDate.nullish() }).parse(body ?? {});
  return { message: weekPlanMessage(await generateWeekPlan(ctx, start ?? null), ctx.timezone) };
});
route("POST", "blocks/:id/outcome", async (ctx, { params, body }): Promise<MOk> => {
  const v = BlockOutcomeInput.parse(body);
  await setBlockOutcome(ctx, params.id, v.status, v.reason);
  return { ok: true };
});

// ---- inbox, approvals, undo ----------------------------------------------------------------
route("GET", "inbox", (ctx) => inboxView(ctx));
route("POST", "proposals/accept", async (ctx, { body }): Promise<MAcceptManyResult> => {
  const { ids } = z.object({ ids: z.array(Uuid).min(1).max(500) }).parse(body);
  const results = await acceptMany(ctx, ids);
  const problem = acceptManyProblem(results);
  if (problem && !results.some((r) => r.ok)) throw new UserFacingError(problem, 400, { results });
  return { results, message: problem ?? `Accepted ${results.length} item${results.length === 1 ? "" : "s"}` };
});
route("POST", "proposals/:id/accept", async (ctx, { params, body }): Promise<MProposalResult> => {
  const { edits } = z.object({ edits: z.record(z.string(), z.unknown()).optional() }).parse(body ?? {});
  return { proposal: proposalView(await acceptProposal(ctx, params.id, edits)) };
});
route("POST", "proposals/:id/status", async (ctx, { params, body }): Promise<MOk> => {
  const { status } = z.object({ status: z.enum(["rejected", "deferred", "pending"]) }).parse(body);
  await setProposalStatus(ctx, params.id, status);
  return { ok: true };
});
route("PATCH", "proposals/:id", async (ctx, { params, body }): Promise<MOk> => {
  const { payload } = z.object({ payload: z.record(z.string(), z.unknown()) }).parse(body);
  await editProposal(ctx, params.id, payload);
  return { ok: true, message: "Saved" };
});
route("POST", "proposals/:id/merge", async (ctx, { params, body }): Promise<MOk> => {
  const { taskId } = z.object({ taskId: Uuid }).parse(body);
  await mergeProposalIntoTask(ctx, params.id, taskId);
  return { ok: true, message: "Merged" };
});
route("POST", "approvals/:id/decide", async (ctx, { params, body }): Promise<MDecideResult> => {
  const { decision, revision } = z.object({ decision: z.enum(["approve", "decline"]), revision: z.number().int().min(1).optional() }).parse(body);
  const action = await decideActionView(ctx, params.id, decision === "approve" ? "approve" : "reject", revision);
  return { action, message: decisionMessage(action) };
});
route("POST", "undo", async (ctx, { body }): Promise<MUndoResult> => {
  const { activityIds } = z.object({ activityIds: z.array(Uuid).min(1).max(100) }).parse(body);
  return revertActivities(ctx, activityIds);
});
route("POST", "activity/:id/revert", async (ctx, { params }): Promise<MOk> => ({ ok: true, message: await revertActivity(ctx, params.id) }));

// ---- focus ------------------------------------------------------------------------------------
route("GET", "focus", (ctx) => focusView(ctx));
route("POST", "focus/start", async (ctx, { body }): Promise<MFocusResult> => {
  const v = z.object({ taskId: Uuid.nullish(), blockId: Uuid.nullish(), plannedMinutes: z.number().int().min(1).max(480).nullish() }).parse(body ?? {});
  return { session: focusSessionView(await startFocus(ctx, { task_id: v.taskId ?? null, block_id: v.blockId ?? null, planned_minutes: v.plannedMinutes ?? null })) };
});
route("POST", "focus/:id/pause", async (ctx, { params }): Promise<MFocusResult> => ({ session: focusSessionView(await pauseFocus(ctx, params.id)) }));
route("POST", "focus/:id/resume", async (ctx, { params }): Promise<MFocusResult> => ({ session: focusSessionView(await resumeFocus(ctx, params.id)) }));
route("POST", "focus/:id/end", async (ctx, { params, body }): Promise<MFocusResult> => {
  const v = FocusEndInput.parse(body);
  return { session: focusSessionView(await endFocus(ctx, params.id, v.outcome, v.note, v.reason, v.moreMinutes ?? null)) };
});

// ---- briefings ------------------------------------------------------------------------------
route("POST", "briefings/generate", async (ctx, { body }): Promise<MBriefingGenerated> => {
  const { kind } = z.object({ kind: BriefingKind }).parse(body);
  return generateBriefing(ctx, kind);
});
route("POST", "briefings/:id/read", async (ctx, { params }): Promise<MOk> => {
  await markBriefingRead(ctx, params.id);
  return { ok: true };
});

// ---- dispatch -------------------------------------------------------------------------------

function match(segments: string[]): { route: Route; params: Params }[] {
  const found: { route: Route; params: Params }[] = [];
  for (const r of routes) {
    if (r.pattern.length !== segments.length) continue;
    const params: Params = {};
    let ok = true;
    for (let i = 0; i < r.pattern.length && ok; i++) {
      const p = r.pattern[i];
      if (p.startsWith(":")) params[p.slice(1)] = segments[i];
      else ok = p === segments[i];
    }
    if (ok) found.push({ route: r, params });
  }
  // Literal segments win over :params ("proposals/accept" before "proposals/:id").
  found.sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
  return found;
}

/**
 * Errors as JSON. A plain Error from a change the person asked for carries a
 * message written for them (what the web shows after a button), so it is a
 * 400 with that message, or 404 when it says the thing doesn't exist. Reads
 * fail with apiError's generic 500 (details only in the server log).
 */
function errorResponse(err: unknown, change: boolean): NextResponse {
  if (err instanceof AuthError || err instanceof z.ZodError || err instanceof UserFacingError) return apiError(err);
  if (change && err instanceof Error) {
    const notFound = /doesn't exist|not found/i.test(err.message);
    return NextResponse.json({ error: err.message }, { status: notFound ? 404 : 400 });
  }
  return apiError(err);
}

/** Handle one /api/m request. `path`: the segments after /api/m. */
export async function dispatch(request: Request, path: string[]): Promise<NextResponse> {
  const method = request.method.toUpperCase() as Method;
  const segments = path.map((s) => decodeURIComponent(s));
  const found = match(segments);
  if (!found.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hit = found.find((f) => f.route.method === method);
  if (!hit) return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: [...new Set(found.map((f) => f.route.method))].join(", ") } });
  const change = method !== "GET";
  try {
    const ctx = await requireApiCtx(request);
    for (const [k, v] of Object.entries(hit.params)) if (!Uuid.safeParse(v).success) throw new NotFound(`No such ${k === "id" ? segments[0].replace(/s$/, "") : k}`);
    let body: unknown = undefined;
    if (change) {
      const text = await request.text();
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new UserFacingError("The request body isn't valid JSON.", 400);
        }
      }
    }
    const data = await hit.route.handler(ctx, { params: hit.params, body, query: new URL(request.url).searchParams });
    if (change) revalidatePath("/", "layout");
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    return errorResponse(err, change);
  }
}

/** Every route, for the docs test: "METHOD path". */
export function routeList(): string[] {
  return routes.map((r) => `${r.method} /api/m/${r.pattern.join("/")}`);
}

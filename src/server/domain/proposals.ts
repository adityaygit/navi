import "server-only";
import { z } from "zod";
import type { Ctx } from "@/server/context";
import type { Proposal, ProposalKind } from "@/lib/types";
import { createEntity, getEntity, updateEntity, type EntityTable } from "./entities";
import { logActivity } from "./activity";
import {
  EventCreate,
  GoalCreate,
  MemoryCreate,
  ProfileUpdate,
  ProjectCreate,
  RoutineCreate,
  TaskCreate,
  WorkspaceCreate,
  compact,
} from "./schemas";
import { addMemory } from "./memory";

// The review inbox. Navi never turns inferred items into commitments by
// itself: extraction writes proposals, and only an explicit accept by the
// user materializes them into real tasks/events/projects/etc.

const REF_FIELDS = ["workspace_ref", "project_ref", "goal_ref"] as const;

export type NewProposal = {
  kind: ProposalKind;
  payload: Record<string, unknown>;
  ref_key?: string | null;
  source_excerpt?: string | null;
  origin: "stated" | "inferred";
  confidence: number;
  rationale?: string | null;
};

export async function createProposals(
  ctx: Ctx,
  items: NewProposal[],
  link: { captureId?: string | null; conversationId?: string | null; batch?: string | null },
): Promise<Proposal[]> {
  if (items.length === 0) return [];
  const rows = items.map((p) => ({
    user_id: ctx.userId,
    capture_id: link.captureId ?? null,
    conversation_id: link.conversationId ?? null,
    batch: link.batch ?? null,
    kind: p.kind,
    payload: p.payload,
    ref_key: p.ref_key ?? null,
    source_excerpt: p.source_excerpt ?? null,
    origin: p.origin,
    confidence: Math.max(0, Math.min(1, p.confidence)),
    rationale: p.rationale ?? null,
  }));
  const { data, error } = await ctx.db.from("proposals").insert(rows).select();
  if (error) throw new Error(`Could not save proposals: ${error.message}`);
  await logActivity(ctx, {
    action: "proposals_created",
    summary: `Added ${rows.length} item${rows.length === 1 ? "" : "s"} to the review inbox`,
  });
  return data as Proposal[];
}

export async function listPendingProposals(ctx: Ctx, opts: { batch?: string | null; includeDeferred?: boolean } = {}) {
  let q = ctx.db
    .from("proposals")
    .select("*")
    .in("status", opts.includeDeferred ? ["pending", "deferred"] : ["pending"])
    .order("created_at", { ascending: true });
  if (opts.batch !== undefined) q = opts.batch === null ? q.is("batch", null) : q.eq("batch", opts.batch);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data as Proposal[];
}

async function resolveRefs(ctx: Ctx, proposal: Proposal, payload: Record<string, unknown>) {
  const out = { ...payload };
  for (const field of REF_FIELDS) {
    const ref = out[field];
    delete out[field];
    if (typeof ref !== "string" || !ref) continue;
    const { data } = await ctx.db
      .from("proposals")
      .select("status,result_id")
      .eq("ref_key", ref)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const idField = field.replace("_ref", "_id");
    if (data?.result_id && out[idField] == null) out[idField] = data.result_id;
  }
  return out;
}

const KIND_TABLE: Partial<Record<ProposalKind, { table: EntityTable; schema: z.ZodTypeAny }>> = {
  workspace: { table: "workspaces", schema: WorkspaceCreate },
  goal: { table: "goals", schema: GoalCreate },
  project: { table: "projects", schema: ProjectCreate },
  routine: { table: "routines", schema: RoutineCreate },
  event: { table: "events", schema: EventCreate },
  task: { table: "tasks", schema: TaskCreate },
  reminder: { table: "tasks", schema: TaskCreate },
};

/** Accept a proposal, optionally with user edits applied to its payload first. */
export async function acceptProposal(ctx: Ctx, id: string, edits?: Record<string, unknown>): Promise<Proposal> {
  const { data: p, error } = await ctx.db.from("proposals").select("*").eq("id", id).single();
  if (error || !p) throw new Error("Proposal not found");
  const proposal = p as Proposal;
  if (proposal.status === "accepted" || proposal.status === "merged") return proposal;

  // Claim it first, so two simultaneous accepts (double tap, voice and screen)
  // can't both create the item. Undone if creating the item fails.
  const { data: claimed } = await ctx.db
    .from("proposals")
    .update({ status: "accepted", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", proposal.status)
    .select("id");
  if (!claimed?.length) {
    const { data: current } = await ctx.db.from("proposals").select("*").eq("id", id).single();
    return current as Proposal;
  }
  let made: Awaited<ReturnType<typeof materialize>>;
  try {
    made = await materialize(ctx, proposal, edits);
  } catch (err) {
    await ctx.db.from("proposals").update({ status: proposal.status, decided_at: proposal.decided_at }).eq("id", id);
    throw err;
  }

  const { data: updated, error: upErr } = await ctx.db
    .from("proposals")
    .update({ result_table: made.resultTable, result_id: made.resultId, payload: made.merged })
    .eq("id", id)
    .select()
    .single();
  if (upErr) throw new Error(upErr.message);
  return updated as Proposal;
}

/** Create the real item a proposal describes, as the user. */
async function materialize(ctx: Ctx, proposal: Proposal, edits?: Record<string, unknown>) {
  const merged = { ...proposal.payload, ...(edits ?? {}) };
  const payload = await resolveRefs(ctx, proposal, merged);
  // The user accepted it, so the resulting item is theirs, not Navi's.
  const userCtx: Ctx = { ...ctx, actor: "user" };
  let resultTable: string | null = null;
  let resultId: string | null = null;

  const mapping = KIND_TABLE[proposal.kind];
  if (mapping) {
    const parsed = mapping.schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`This ${proposal.kind} needs fixing before it can be accepted: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    const values = compact(parsed.data as Record<string, unknown>);
    if (mapping.table === "tasks") {
      values.source = proposal.batch === "onboarding" ? "onboarding" : "capture";
    }
    if (mapping.table === "events") {
      values.source = proposal.batch === "onboarding" ? "onboarding" : "capture";
    }
    const row = await createEntity<{ id: string }>(userCtx, mapping.table, values, {
      summary: `Accepted ${proposal.kind} from inbox: “${String(values.title ?? values.name ?? "")}”`,
    });
    resultTable = mapping.table;
    resultId = row.id;
  } else if (proposal.kind === "note") {
    const row = await createEntity<{ id: string }>(userCtx, "notes", {
      title: (payload.title as string) ?? null,
      body: String(payload.body ?? proposal.source_excerpt ?? ""),
      source: "capture",
    });
    resultTable = "notes";
    resultId = row.id;
  } else if (proposal.kind === "memory") {
    const parsed = MemoryCreate.parse(payload);
    // Accepting an inferred memory is the user confirming it.
    const mem = await addMemory(userCtx, { ...parsed, origin: "stated", confidence: 1 });
    resultTable = "memories";
    resultId = mem.id;
  } else if (proposal.kind === "preference") {
    const parsed = compact(ProfileUpdate.parse(payload));
    const { error: upErr } = await ctx.db.from("profiles").update(parsed).eq("id", ctx.userId);
    if (upErr) throw new Error(upErr.message);
    await logActivity(userCtx, { action: "update", entityType: "profiles", summary: `Updated settings from inbox (${Object.keys(parsed).join(", ")})` });
  }
  // "question" proposals have nothing to materialize: accepting marks them handled.
  return { merged, resultTable, resultId };
}

export async function setProposalStatus(ctx: Ctx, id: string, status: "rejected" | "deferred" | "pending") {
  const { data, error } = await ctx.db
    .from("proposals")
    .update({ status, decided_at: status === "pending" ? null : new Date().toISOString() })
    .eq("id", id)
    .in("status", ["pending", "deferred"])
    .select()
    .single();
  if (error) throw new Error(error.message);
  await logActivity({ ...ctx, actor: "user" }, {
    action: `proposal_${status}`,
    summary: `${status === "rejected" ? "Rejected" : status === "deferred" ? "Deferred" : "Restored"} inbox item: ${proposalTitle(data as Proposal)}`,
  });
  return data as Proposal;
}

export async function editProposal(ctx: Ctx, id: string, payload: Record<string, unknown>) {
  const { data, error } = await ctx.db
    .from("proposals")
    .update({ payload })
    .eq("id", id)
    .in("status", ["pending", "deferred"])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Proposal;
}

/** Merge a task-like proposal into an existing task instead of creating a duplicate. */
export async function mergeProposalIntoTask(ctx: Ctx, id: string, taskId: string) {
  const { data: p } = await ctx.db.from("proposals").select("*").eq("id", id).single();
  if (!p) throw new Error("Proposal not found");
  const proposal = p as Proposal;
  const task = await getEntity<{ notes: string | null; due_at: string | null; estimate_minutes: number | null; title: string }>(ctx, "tasks", taskId);
  const patch: Record<string, unknown> = {};
  const extra = [proposal.payload.title, proposal.payload.notes, proposal.source_excerpt].filter(Boolean).join(" — ");
  if (extra) patch.notes = [task.notes, `Merged from inbox: ${extra}`].filter(Boolean).join("\n");
  if (!task.due_at && proposal.payload.due_at) patch.due_at = proposal.payload.due_at;
  if (!task.estimate_minutes && proposal.payload.estimate_minutes) patch.estimate_minutes = proposal.payload.estimate_minutes;
  await updateEntity({ ...ctx, actor: "user" }, "tasks", taskId, patch, { summary: `Merged inbox item into “${task.title}”` });
  const { data, error } = await ctx.db
    .from("proposals")
    .update({ status: "merged", decided_at: new Date().toISOString(), result_table: "tasks", result_id: taskId })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Proposal;
}

export function proposalTitle(p: Pick<Proposal, "kind" | "payload" | "source_excerpt">): string {
  const pl = p.payload as Record<string, unknown>;
  return String(pl.title ?? pl.name ?? pl.question ?? pl.content ?? pl.body ?? p.source_excerpt ?? p.kind).slice(0, 140);
}

// Order matters: parents must exist before children reference them.
const ACCEPT_ORDER: ProposalKind[] = ["preference", "workspace", "goal", "project", "routine", "event", "task", "reminder", "memory", "note", "question"];

/** Accept several proposals in dependency order. Returns per-item outcomes. */
export async function acceptMany(ctx: Ctx, ids: string[]) {
  const { data } = await ctx.db.from("proposals").select("*").in("id", ids);
  const proposals = ((data ?? []) as Proposal[]).sort(
    (a, b) => ACCEPT_ORDER.indexOf(a.kind) - ACCEPT_ORDER.indexOf(b.kind),
  );
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const p of proposals) {
    try {
      await acceptProposal(ctx, p.id);
      results.push({ id: p.id, ok: true });
    } catch (err) {
      results.push({ id: p.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

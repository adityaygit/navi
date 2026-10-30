import "server-only";
import { createHash } from "node:crypto";
import type { Ctx } from "@/server/context";
import type { Approval } from "@/lib/types";
import { logActivity } from "./activity";
import { integrations } from "@/server/integrations";

// The approval boundary. Anything consequential (external effects, deadline
// changes, destructive edits proposed by Navi) is stored here with an exact
// description of what will run, and only runs after the user approves.
// Execution is idempotent: the same approval can never execute twice.

export type ApprovalRequest = {
  actionType: string;
  summary: string;
  details: Record<string, unknown>;
  idempotencyKey?: string;
};

function keyFor(req: ApprovalRequest): string {
  return (
    req.idempotencyKey ??
    createHash("sha256").update(req.actionType + JSON.stringify(req.details)).digest("hex").slice(0, 32)
  );
}

export async function requestApproval(ctx: Ctx, req: ApprovalRequest): Promise<Approval> {
  const idempotency_key = keyFor(req);
  // A duplicate request for the same pending action returns the existing one.
  const { data: existing } = await ctx.db
    .from("approvals")
    .select("*")
    .like("idempotency_key", `${idempotency_key}:%`)
    .in("status", ["pending", "approved", "executing"])
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Approval;

  const { data, error } = await ctx.db
    .from("approvals")
    .insert({
      user_id: ctx.userId,
      action_type: req.actionType,
      summary: req.summary,
      details: req.details,
      idempotency_key: `${idempotency_key}:${Date.now()}`,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(`Could not create approval request: ${error.message}`);
  await logActivity(ctx, {
    action: "approval_requested",
    entityType: "approvals",
    entityId: data.id,
    summary: `Asked for approval: ${req.summary}`,
  });
  return data as Approval;
}

/**
 * Approve or reject. Approval executes immediately with the user's own
 * permissions. Uses an atomic status transition (pending -> executing) so a
 * double-click or retried request cannot run the action twice.
 */
export async function decideApproval(
  ctx: Ctx,
  approvalId: string,
  decision: "approve" | "reject",
  admin: import("@supabase/supabase-js").SupabaseClient,
): Promise<Approval> {
  // Approvals rows are not user-updatable under RLS (execution state is server
  // controlled), so the transition uses the admin client scoped by user_id.
  const now = new Date().toISOString();
  if (decision === "reject") {
    const { data, error } = await admin
      .from("approvals")
      .update({ status: "rejected", decided_at: now })
      .eq("id", approvalId)
      .eq("user_id", ctx.userId)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("This request was already decided");
    await logActivity(ctx, { action: "approval_rejected", entityType: "approvals", entityId: approvalId, summary: `Rejected: ${data.summary}` });
    return data as Approval;
  }

  const { data: claimed, error: claimErr } = await admin
    .from("approvals")
    .update({ status: "executing", decided_at: now })
    .eq("id", approvalId)
    .eq("user_id", ctx.userId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed) throw new Error("This request was already decided or is running");

  const approval = claimed as Approval;
  try {
    const result = await executeApproved(ctx, approval);
    const { data } = await admin
      .from("approvals")
      .update({ status: "executed", executed_at: new Date().toISOString(), result })
      .eq("id", approvalId)
      .select()
      .single();
    await logActivity(ctx, { action: "approval_executed", entityType: "approvals", entityId: approvalId, summary: `Approved and done: ${approval.summary}` });
    return data as Approval;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data } = await admin
      .from("approvals")
      .update({ status: "failed", error: message })
      .eq("id", approvalId)
      .select()
      .single();
    await logActivity(ctx, { action: "approval_failed", entityType: "approvals", entityId: approvalId, summary: `Approved but failed: ${approval.summary} — ${message}` });
    return data as Approval;
  }
}

async function executeApproved(ctx: Ctx, approval: Approval): Promise<Record<string, unknown>> {
  const d = approval.details as Record<string, unknown>;
  const userCtx: Ctx = { ...ctx, actor: "user" }; // the user approved it, so it runs as the user
  if (approval.action_type.startsWith("internal.")) {
    const { updateEntity, deleteEntity } = await import("./entities");
    const table = d.table as import("./entities").EntityTable;
    if (d.op === "update") {
      const r = await updateEntity(userCtx, table, String(d.id), d.patch as Record<string, unknown>, { summary: approval.summary });
      return { ok: true, kind: r.kind };
    }
    if (d.op === "delete") {
      await deleteEntity(userCtx, table, String(d.id));
      return { ok: true, kind: "deleted" };
    }
    throw new Error(`Unknown internal operation ${String(d.op)}`);
  }
  if (approval.action_type.startsWith("external.")) {
    const integration = integrations.find((i) => approval.action_type.startsWith(`external.${i.id}.`));
    if (!integration || !integration.isConnected()) {
      // Never pretend an external action happened.
      throw new Error("That service isn't connected, so nothing was sent or changed.");
    }
    return integration.execute(approval.action_type, d);
  }
  throw new Error(`Unknown action type ${approval.action_type}`);
}

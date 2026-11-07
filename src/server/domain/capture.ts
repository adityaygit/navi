import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { runAgent } from "@/server/ai/agent";
import { CAPTURE_SYSTEM } from "@/server/ai/prompts";
import { buildContext } from "@/server/ai/chat";
import { extractItems } from "@/server/ai/heuristics";
import { createProposals, type NewProposal } from "./proposals";
import { logActivity } from "./activity";

// Capture: raw words are stored first (never lost), then split into proposals
// for the review inbox. client_id makes submission idempotent, so the offline
// queue can retry safely without creating duplicates.

export type CaptureInput = {
  client_id: string;
  raw_text: string;
  source: "text" | "voice" | "offline" | "chat";
  captured_at?: string | null;
};

export async function saveCapture(ctx: Ctx, input: CaptureInput) {
  const raw = input.raw_text.trim();
  if (!raw) throw new Error("Nothing to capture");
  const { data: existing } = await ctx.db.from("captures").select("*").eq("client_id", input.client_id).maybeSingle();
  if (existing) return { capture: existing, duplicate: true };
  const { data, error } = await ctx.db
    .from("captures")
    .insert({
      user_id: ctx.userId,
      client_id: input.client_id,
      raw_text: raw.slice(0, 20000),
      source: input.source,
      captured_at: input.captured_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    // Unique violation from a concurrent retry: return the stored row.
    if (error.code === "23505") {
      const { data: again } = await ctx.db.from("captures").select("*").eq("client_id", input.client_id).single();
      return { capture: again, duplicate: true };
    }
    throw new Error(error.message);
  }
  await logActivity(ctx, { action: "captured", summary: `Captured: “${raw.slice(0, 80)}${raw.length > 80 ? "…" : ""}”` });
  return { capture: data, duplicate: false };
}

/** Rule-based split used when AI is unavailable; clearly labelled and low-confidence. */
function ruleBasedProposals(raw: string, zone: string): NewProposal[] {
  const items = extractItems(raw, DateTime.now().setZone(zone));
  const label = "Basic rule-based split (AI was unavailable). Please check it.";
  const out: NewProposal[] = items.map((i) => ({
    kind: i.kind === "event" ? "task" : i.kind,
    payload:
      i.kind === "task" || i.kind === "event"
        ? { title: i.title, due_at: i.due_at ?? null, priority: i.priority ?? 3, estimate_minutes: i.estimate_minutes ?? null }
        : i.kind === "question"
          ? { question: i.title }
          : { title: i.title, body: i.excerpt },
    source_excerpt: i.excerpt,
    origin: "inferred" as const,
    confidence: 0.3,
    rationale: label,
  }));
  return out.length ? out : [{ kind: "note", payload: { body: raw }, source_excerpt: raw, origin: "stated", confidence: 1, rationale: label }];
}

/** A claim older than this was left by a request that died (route limit is 60 s); another may take over. */
const STALE_CLAIM_MS = 5 * 60_000;

export type CaptureOutcome =
  | { status: "processed"; aiUsed: boolean; simulated?: boolean; partial?: boolean; message?: string }
  | { status: "needs_ai"; aiUsed: false; message: string }
  | { status: "processing"; aiUsed: false; message: string };

/**
 * Turn a stored capture into review-inbox proposals, exactly once. The
 * capture is claimed first (pending → processing in one conditional update),
 * so a retry that arrives while the first request is still working gets
 * "processing" back instead of creating a second set of proposals.
 */
export async function processCapture(ctx: Ctx, captureId: string): Promise<CaptureOutcome> {
  const { data: capture, error: readErr } = await ctx.db.from("captures").select("*").eq("id", captureId).maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!capture) throw new Error("Capture not found");
  if (capture.status === "processed") return { status: "processed", aiUsed: true };
  if (capture.status === "needs_ai") return { status: "needs_ai", aiUsed: false, message: capture.error ?? "Split by basic rules" };

  const claimedAt = new Date().toISOString();
  let claim = ctx.db.from("captures").update({ status: "processing", claimed_at: claimedAt }).eq("id", captureId);
  claim =
    capture.status === "processing"
      ? claim.eq("status", "processing").lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
      : claim.eq("status", capture.status);
  const { data: claimed, error: claimErr } = await claim.select("id");
  if (claimErr) throw new Error(claimErr.message);
  if (!claimed?.length) return { status: "processing", aiUsed: false, message: "This capture is already being sorted." };

  const captureCtx: Ctx = { ...ctx, captureId };
  const before = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", captureId);
  if (before.error) throw new Error(before.error.message);
  if ((before.count ?? 0) > 0) {
    // Taken over from a request that died after proposing: keep what it made rather than add a second set.
    await finish(ctx, captureId, { status: "processed", error: "Sorting was interrupted; some items may be missing" });
    return { status: "processed", aiUsed: true, partial: true };
  }
  try {
    return await extract(ctx, captureCtx, capture);
  } catch (err) {
    // Release the claim so a retry can run (unless proposals were already made: then keep them).
    const { count } = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", captureId);
    if (count) await finish(ctx, captureId, { status: "processed", error: "Sorting was interrupted; some items may be missing" });
    else await ctx.db.from("captures").update({ status: "pending", claimed_at: null, error: String(err instanceof Error ? err.message : err).slice(0, 300) }).eq("id", captureId).eq("claimed_at", claimedAt);
    throw err;
  }
}

async function finish(ctx: Ctx, captureId: string, patch: { status: "processed" | "needs_ai"; error: string | null }) {
  const { error } = await ctx.db.from("captures").update({ ...patch, processed_at: new Date().toISOString() }).eq("id", captureId);
  if (error) throw new Error(error.message);
}

async function extract(
  ctx: Ctx,
  captureCtx: Ctx,
  capture: { id: string; raw_text: string; source: string; captured_at: string },
): Promise<CaptureOutcome> {
  const captureId = capture.id;
  const result = await runAgent({
    ctx: captureCtx,
    mode: "capture",
    role: "fast",
    system: CAPTURE_SYSTEM,
    context: await buildContext(captureCtx, capture.raw_text, "capture"),
    history: [],
    userText: `Captured ${capture.source} note (${capture.captured_at}):\n"""\n${capture.raw_text}\n"""`,
    purpose: "capture",
  });
  const after = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", captureId);
  if (after.error) throw new Error(after.error.message);
  const created = after.count ?? 0;

  if (created === 0) {
    // Never silently discard: fall back to rule-based proposals, labelled as such.
    await createProposals(captureCtx, ruleBasedProposals(capture.raw_text, ctx.timezone), { captureId });
    await finish(ctx, captureId, { status: "needs_ai", error: result.error ? result.text.slice(0, 300) : "AI returned no items" });
    return { status: "needs_ai", aiUsed: false, message: result.text };
  }
  if (result.error) {
    // The AI proposed some items before it failed: keep them, and don't pile
    // rule-based guesses on top (they'd duplicate what it already proposed).
    await finish(ctx, captureId, { status: "processed", error: `AI stopped early; some items may be missing (${result.text.slice(0, 200)})` });
    return { status: "processed", aiUsed: !result.simulated, simulated: result.simulated, partial: true, message: "Some items may be missing: the AI stopped early." };
  }
  await finish(ctx, captureId, { status: "processed", error: null });
  return { status: "processed", aiUsed: !result.simulated, simulated: result.simulated };
}

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

export async function processCapture(ctx: Ctx, captureId: string) {
  const { data: capture } = await ctx.db.from("captures").select("*").eq("id", captureId).single();
  if (!capture) throw new Error("Capture not found");
  if (capture.status === "processed") return { status: "processed" as const, aiUsed: true };
  const captureCtx: Ctx = { ...ctx, captureId };
  const before = await ctx.db.from("proposals").select("id", { count: "exact", head: true }).eq("capture_id", captureId);
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
  const created = (after.count ?? 0) - (before.count ?? 0);

  if (result.error || created === 0) {
    // Never silently discard: fall back to rule-based proposals, labelled as such.
    await createProposals(captureCtx, ruleBasedProposals(capture.raw_text, ctx.timezone), { captureId });
    await ctx.db
      .from("captures")
      .update({ status: "needs_ai", error: result.error ? result.text.slice(0, 300) : "AI returned no items", processed_at: new Date().toISOString() })
      .eq("id", captureId);
    return { status: "needs_ai" as const, aiUsed: false, message: result.text };
  }
  await ctx.db.from("captures").update({ status: "processed", processed_at: new Date().toISOString(), error: null }).eq("id", captureId);
  return { status: "processed" as const, aiUsed: !result.simulated, simulated: result.simulated };
}

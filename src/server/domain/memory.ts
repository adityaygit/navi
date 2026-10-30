import "server-only";
import type { Ctx } from "@/server/context";
import type { Memory } from "@/lib/types";
import { logActivity } from "./activity";

// Persistent, inspectable memory. Every memory records where it came from
// (stated by the user, inferred by Navi, or observed from events) and how
// confident Navi is, so inference never masquerades as fact.

export type MemoryInput = {
  kind: Memory["kind"];
  content: string;
  origin: Memory["origin"];
  confidence?: number | null;
  project_id?: string | null;
  evidence?: unknown[];
  source_message_id?: string | null;
};

export async function addMemory(ctx: Ctx, input: MemoryInput): Promise<Memory> {
  const confidence =
    input.confidence ?? (input.origin === "stated" ? 1 : input.origin === "observed" ? 0.8 : 0.5);
  // Avoid exact duplicates: refresh the existing memory instead.
  const { data: dup } = await ctx.db
    .from("memories")
    .select("*")
    .eq("kind", input.kind)
    .eq("status", "active")
    .ilike("content", input.content.trim().replace(/[%_\\]/g, "\\$&"))
    .maybeSingle();
  if (dup) {
    const { data } = await ctx.db
      .from("memories")
      .update({
        last_confirmed_at: new Date().toISOString(),
        confidence: Math.max(Number(dup.confidence), confidence),
        origin: input.origin === "stated" ? "stated" : dup.origin,
      })
      .eq("id", dup.id)
      .select()
      .single();
    return data as Memory;
  }
  const { data, error } = await ctx.db
    .from("memories")
    .insert({
      user_id: ctx.userId,
      kind: input.kind,
      content: input.content.trim(),
      origin: input.origin,
      confidence,
      project_id: input.project_id ?? null,
      evidence: input.evidence ?? [],
      source_message_id: input.source_message_id ?? null,
      last_confirmed_at: input.origin === "stated" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) throw new Error(`Could not save memory: ${error.message}`);
  await logActivity(ctx, {
    action: "memory_added",
    entityType: "memories",
    entityId: data.id,
    summary: `Remembered (${input.origin}): ${input.content.slice(0, 100)}`,
    before: null,
    after: data,
    reversible: true,
  });
  return data as Memory;
}

export async function correctMemory(ctx: Ctx, id: string, content: string): Promise<Memory> {
  const { data: old } = await ctx.db.from("memories").select("*").eq("id", id).single();
  if (!old) throw new Error("Memory not found");
  // A correction is a fact from the user; keep the old version as superseded.
  const replacement = await addMemory({ ...ctx, actor: "user" }, {
    kind: old.kind,
    content,
    origin: "stated",
    confidence: 1,
    project_id: old.project_id,
    evidence: [{ corrected_from: old.content, at: new Date().toISOString() }],
  });
  await ctx.db.from("memories").update({ status: "superseded", superseded_by: replacement.id }).eq("id", id);
  return replacement;
}

export async function confirmMemory(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .from("memories")
    .update({ origin: "stated", confidence: 1, last_confirmed_at: new Date().toISOString() })
    .eq("id", id);
  await logActivity(ctx, { action: "memory_confirmed", entityType: "memories", entityId: id, summary: "Confirmed a memory" });
}

export async function rejectMemory(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.from("memories").update({ status: "rejected" }).eq("id", id);
  await logActivity(ctx, { action: "memory_rejected", entityType: "memories", entityId: id, summary: "Marked a memory as wrong" });
}

export async function deleteMemory(ctx: Ctx, id: string): Promise<void> {
  const { error } = await ctx.db.from("memories").delete().eq("id", id);
  if (error) throw new Error(error.message);
  // Content is intentionally not copied into the log: deletion means gone.
  await logActivity(ctx, { action: "memory_deleted", entityType: "memories", summary: "Deleted a memory" });
}

/** Memories relevant to a conversation: all profile memories + keyword-matched others. */
export async function relevantMemories(ctx: Ctx, query: string, limit = 25): Promise<Memory[]> {
  const { data } = await ctx.db
    .from("memories")
    .select("*, projects(name)")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(300);
  const all = (data ?? []) as (Memory & { projects: { name: string } | null })[];
  const q = query.toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 3);
  const scored = all.map((m) => {
    const text = m.content.toLowerCase();
    let score = m.kind === "profile" ? 2 : 0;
    for (const w of words) if (text.includes(w)) score += 1;
    // Mentioning a project brings back what was decided about it.
    const project = m.projects?.name.toLowerCase();
    if (project && new RegExp(`\\b${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q)) score += 3;
    if (m.origin === "stated") score += 0.5;
    return { m, score };
  });
  return scored
    .filter((s) => s.score > 0 || s.m.kind === "behavioral")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ m }) => {
      const { projects, ...rest } = m;
      return projects ? { ...rest, content: `[${projects.name}] ${rest.content}` } : rest;
    });
}

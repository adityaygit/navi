import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Memory } from "@/lib/types";
import { PART_OF_DAY_HOURS, INTERRUPTIONS_AT_TIME, type WeekInsights, type PartOfDay } from "./insights";

// Behavioral memory from evidence (spec F): when the weekly review finds a
// repeated pattern with enough evidence, Navi saves it as an "observed"
// behavioral memory with the evidence attached. Each pattern has a stable key
// (kept in its evidence entries), so the same pattern is updated rather than
// duplicated. Later weeks that contradict it lower its confidence and, below
// a threshold, mark it superseded. Confidence is recomputed from the evidence
// each time, so re-running a week's review changes nothing.
// The user stays in control: memories they rejected stay rejected, ones they
// corrected aren't revived, and ones they confirmed keep their wording.
// Takes an explicit userId: the scheduled job uses the service-role client.

export type PatternEvidence = {
  pattern: string;
  week_end: string;
  supports: boolean;
  summary: string;
};

type Finding = { key: string; content: string; summary: string };

const MAX_EVIDENCE = 8;
export const SUPERSEDE_BELOW = 0.4;

export function confidenceFrom(evidence: PatternEvidence[]): number {
  const s = evidence.filter((e) => e.supports).length;
  const c = evidence.filter((e) => !e.supports).length;
  return Math.round(Math.min(0.9, Math.max(0.1, 0.5 + 0.1 * s - 0.2 * c)) * 100) / 100;
}

/** What this week supports, and what it contradicts (only where it has evidence either way). */
export function weekPatterns(week: WeekInsights): { found: Finding[]; contradicted: Map<string, string> } {
  const found: Finding[] = [];
  const contradicted = new Map<string, string>();
  for (const a of week.repeatedlyAvoided) {
    found.push({
      key: `avoid:${a.task_id}`,
      content: `Tends to put off “${a.title}”: skipped ${a.times} times in 3 weeks without an outside reason.`,
      summary: `skipped ${a.times} times without an outside reason (3 weeks to ${week.end})`,
    });
  }
  const r = week.estimate.medianRatio;
  if (r !== null) {
    if (r > 1.25) found.push({ key: "estimate:under", content: `Tasks usually take longer than estimated: about ${r.toFixed(1)}× the estimate.`, summary: `median ${r.toFixed(2)}× over ${week.estimate.samples} finished tasks` });
    else contradicted.set("estimate:under", `median ${r.toFixed(2)}× over ${week.estimate.samples} finished tasks`);
    if (r < 0.8) found.push({ key: "estimate:over", content: `Tasks usually take less time than estimated: about ${r.toFixed(1)}× the estimate.`, summary: `median ${r.toFixed(2)}× over ${week.estimate.samples} finished tasks` });
    else contradicted.set("estimate:over", `median ${r.toFixed(2)}× over ${week.estimate.samples} finished tasks`);
  }
  if (week.enoughData) {
    const parts: PartOfDay[] = ["morning", "afternoon", "evening", "night"];
    for (const p of parts) {
      const n = week.interruptionsByPart.find((x) => x.part === p)?.count ?? 0;
      if (n >= INTERRUPTIONS_AT_TIME) {
        found.push({ key: `interruptions:${p}`, content: `Often interrupted in the ${p} (${PART_OF_DAY_HOURS[p]}).`, summary: `${n} interrupted blocks in the ${p} in 3 weeks` });
      } else {
        contradicted.set(`interruptions:${p}`, `${n} interrupted block${n === 1 ? "" : "s"} in the ${p} in 3 weeks`);
      }
    }
  }
  return { found, contradicted };
}

function withEntry(evidence: PatternEvidence[], entry: PatternEvidence) {
  // One entry per pattern per week: re-running a review replaces it.
  const rest = evidence.filter((e) => !(e.pattern === entry.pattern && e.week_end === entry.week_end));
  return [...rest, entry].sort((a, b) => a.week_end.localeCompare(b.week_end)).slice(-MAX_EVIDENCE);
}

const patternEntries = (m: Pick<Memory, "evidence">) => ((m.evidence ?? []) as PatternEvidence[]).filter((e) => e && typeof e === "object" && "pattern" in e);

/** Save, strengthen or weaken behavioral memories from one weekly review. Returns what changed. */
export async function learnFromWeek(db: SupabaseClient, userId: string, week: WeekInsights) {
  const { found, contradicted } = weekPatterns(week);
  const { data } = await db.from("memories").select("*").eq("user_id", userId).eq("kind", "behavioral").eq("origin", "observed");
  const confirmedRes = await db.from("memories").select("*").eq("user_id", userId).eq("kind", "behavioral").neq("origin", "observed");
  // A memory keeps its key in its evidence, even after the user confirms it (origin becomes "stated").
  const all = [...((data ?? []) as Memory[]), ...((confirmedRes.data ?? []) as Memory[])];
  const byKey = new Map<string, Memory>();
  for (const m of all) {
    const key = patternEntries(m)[0]?.pattern;
    if (key && !byKey.has(key)) byKey.set(key, m);
  }
  const changes: { key: string; action: "created" | "strengthened" | "weakened" | "superseded" | "kept" }[] = [];
  const now = new Date().toISOString();

  for (const f of found) {
    const entry: PatternEvidence = { pattern: f.key, week_end: week.end, supports: true, summary: f.summary };
    const existing = byKey.get(f.key);
    if (!existing) {
      const evidence = [entry];
      const { error } = await db.from("memories").insert({ user_id: userId, kind: "behavioral", content: f.content, origin: "observed", confidence: confidenceFrom(evidence), evidence });
      if (error) throw new Error(`Could not save pattern: ${error.message}`);
      await db.from("activity_log").insert({ user_id: userId, actor: "navi", action: "memory_added", entity_type: "memories", summary: `Noticed a pattern (observed): ${f.content.slice(0, 120)}` });
      changes.push({ key: f.key, action: "created" });
      continue;
    }
    // Rejected stays rejected; a pattern the user corrected isn't brought back.
    if (existing.status === "rejected" || (existing.status === "superseded" && existing.superseded_by)) {
      changes.push({ key: f.key, action: "kept" });
      continue;
    }
    const evidence = withEntry(patternEntries(existing), entry);
    const userOwned = existing.origin !== "observed";
    const patch: Record<string, unknown> = { evidence, updated_at: now };
    if (!userOwned) Object.assign(patch, { content: f.content, confidence: confidenceFrom(evidence), status: "active" });
    await db.from("memories").update(patch).eq("id", existing.id).eq("user_id", userId);
    changes.push({ key: f.key, action: "strengthened" });
  }

  // Patterns this week has evidence against: only existing, active, Navi-observed ones change.
  const foundKeys = new Set(found.map((f) => f.key));
  for (const [key, m] of byKey) {
    if (foundKeys.has(key) || m.status !== "active" || m.origin !== "observed") continue;
    let summary = contradicted.get(key);
    if (!summary && key.startsWith("avoid:")) {
      // Evidence against avoidance: the task got done, or wasn't skipped 3+ times in the window.
      const taskId = key.slice("avoid:".length);
      const { data: t } = await db.from("tasks").select("status,title").eq("user_id", userId).eq("id", taskId).maybeSingle();
      summary = !t ? "the task no longer exists" : t.status === "done" ? "the task was finished" : "not skipped 3+ times in the last 3 weeks";
    }
    if (!summary) continue;
    const evidence = withEntry(patternEntries(m), { pattern: key, week_end: week.end, supports: false, summary });
    const confidence = confidenceFrom(evidence);
    const superseded = confidence < SUPERSEDE_BELOW;
    await db.from("memories").update({ evidence, confidence, status: superseded ? "superseded" : "active", updated_at: now }).eq("id", m.id).eq("user_id", userId);
    if (superseded) await db.from("activity_log").insert({ user_id: userId, actor: "navi", action: "memory_superseded", entity_type: "memories", entity_id: m.id, summary: `Later evidence overturned a pattern: ${m.content.slice(0, 120)}` });
    changes.push({ key, action: superseded ? "superseded" : "weakened" });
  }
  return changes;
}

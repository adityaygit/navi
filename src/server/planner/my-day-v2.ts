import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import type { Approval, PlanBlock } from "@/lib/types";
import { loadDayModels } from "./plan-v2";

// What My day shows for the constraint-first planner (planner v2): the free
// time the planner uses (so "fits here" offers the same time the planner
// would), the assumptions today's plan relies on, time Navi doesn't know
// about, and any plan Navi proposed that's waiting for the person.

export type MyDayV2 = {
  capacity: { start: number; end: number }[];
  assumptions: { start: string; end: string; label: string; reason: string | null }[];
  unknown: { text: string }[];
  proposals: { id: string; revision: number; title: string; lines: { label: string; value: string; from?: string }[] }[];
};

const label = (s: DateTime, e: DateTime) => {
  const f = (d: DateTime) => d.toFormat(d.minute ? "h:mm" : "h");
  return s.toFormat("a") === e.toFormat("a") ? `${f(s)}–${f(e)} ${e.toFormat("a")}` : `${f(s)} ${s.toFormat("a")}–${f(e)} ${e.toFormat("a")}`;
};

export async function myDayV2(ctx: Ctx, date: string, blocks: PlanBlock[], fromMs: number): Promise<MyDayV2> {
  const zone = ctx.timezone;
  const model = (await loadDayModels(ctx, [date])).get(date)!;
  const capacity = model.capacity
    .map((c) => ({ start: Math.max(Date.parse(c.starts_at), fromMs), end: Date.parse(c.ends_at) }))
    .filter((c) => c.end > c.start);

  // Stretches of assumed time today's plan uses, at most two (D1).
  const assumed = blocks
    .filter((b) => b.plan_date === date && b.basis === "inferred" && ["planned", "in_progress"].includes(b.status))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const runs: { s: DateTime; e: DateTime; reason: string | null }[] = [];
  for (const b of assumed) {
    const s = DateTime.fromISO(b.starts_at).setZone(zone);
    const e = DateTime.fromISO(b.ends_at).setZone(zone);
    const last = runs.at(-1);
    if (last && s.diff(last.e).as("minutes") <= 15 && last.reason === (b.assumption ?? null)) last.e = e;
    else runs.push({ s, e, reason: b.assumption ?? null });
  }
  const assumptions = runs
    .sort((a, b) => b.e.diff(b.s).toMillis() - a.e.diff(a.s).toMillis())
    .slice(0, 2)
    .sort((a, b) => a.s.toMillis() - b.s.toMillis())
    .map((r) => ({ start: r.s.toFormat("HH:mm"), end: r.e.toFormat("HH:mm"), label: label(r.s, r.e), reason: r.reason }));

  const unknown = model.unknown
    .filter((u) => Date.parse(u.ends_at) > fromMs)
    .map((u) => ({ text: `${label(DateTime.fromISO(u.starts_at).setZone(zone), DateTime.fromISO(u.ends_at).setZone(zone))} (${u.label})` }));

  const { data: sets } = await ctx.db.from("plan_changesets").select("approval_id").eq("status", "proposed").contains("dates", [date]).not("approval_id", "is", null);
  const ids = ((sets ?? []) as { approval_id: string }[]).map((s) => s.approval_id);
  const { data: cards } = ids.length ? await ctx.db.from("approvals").select("*").in("id", ids).eq("status", "proposed").gt("expires_at", new Date().toISOString()) : { data: [] };
  const proposals = ((cards ?? []) as Approval[]).map((a) => {
    const d = (a.details ?? {}) as { lines?: MyDayV2["proposals"][number]["lines"] };
    return { id: a.id, revision: a.revision ?? 1, title: a.summary, lines: (d.lines ?? []).slice(0, 8) };
  });
  return { capacity, assumptions, unknown, proposals };
}

import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { analyzeImpact, type ImpactInput } from "@/server/planner/commands/impact";
import { decide, isAffirmative, quoteIsTheirs } from "@/server/planner/commands/authorize";
import { evaluate } from "@/server/planner/commands/verify";
import { estimateScales, loadCapRule, applyOps, type Op } from "@/server/planner/plan-v2";
import { gaveReason } from "@/server/planner/commands/accountability";
import type { PlanBlock, PlanningRule, Task } from "@/lib/types";

// The scheduling-command pipeline's pure parts: impact analysis (D6),
// authorization, verification, and how planning rules apply.

const zone = "America/New_York";
const now = DateTime.fromISO("2026-11-16T09:00", { zone });
const iso = (hm: string, day = "2026-11-16") => DateTime.fromISO(`${day}T${hm}`, { zone }).toUTC().toISO()!;
const block = (over: Partial<PlanBlock>): PlanBlock => ({
  id: over.id ?? "b", task_id: over.task_id ?? null, routine_id: null, title: over.title ?? "Block", plan_date: "2026-11-16", starts_at: iso("10:00"), ends_at: iso("11:00"),
  is_flexible: true, status: "planned", outcome_reason: null, created_by: "navi", reason: null, pinned: false, placement: "auto", session_id: null, session_title: null, ...over,
});
const task = (over: Partial<Task>) => ({ id: "t", title: "Task", due_at: null, due_is_hard: false, commitment: "normal" as const, ...over });

function impact(over: Partial<ImpactInput>) {
  return analyzeImpact({ before: [], after: [], dates: ["2026-11-16"], tasks: [], now, zone, riskHours: 48, actor: "navi", targets: { blockIds: [], taskIds: [], removes: false }, placed: [], fixed: [], ...over });
}

describe("impact analysis", () => {
  it("moving Navi's own work within the day is low impact", () => {
    const b = block({ id: "a", task_id: "x", title: "Reading" });
    const r = impact({ before: [b], after: [{ ...b, starts_at: iso("12:00"), ends_at: iso("13:00") }], tasks: [task({ id: "x", title: "Reading" })] });
    expect(r.displaced).toEqual([expect.objectContaining({ kind: "moved", title: "Reading" })]);
    expect(r.significance).toBe("low");
  });

  it("work that comes off the plan as a side effect is moderate; a hard deadline inside the window is high", () => {
    const a = block({ id: "a", task_id: "x", title: "Reading" });
    const q = block({ id: "q", task_id: "q1", title: "Quiz prep", starts_at: iso("12:00"), ends_at: iso("13:00") });
    const tasks = [task({ id: "x", title: "Reading" }), task({ id: "q1", title: "Quiz prep", due_is_hard: true, due_at: now.plus({ hours: 30 }).toISO()! })];
    const r = impact({ before: [a, q], after: [], tasks });
    expect(r.consequences.find((c) => c.key === "displace:x")?.level).toBe("moderate");
    expect(r.consequences.find((c) => c.key === "deadline:q1")?.level).toBe("high");
    expect(r.significance).toBe("high");
  });

  it("the deadline-risk window is configurable (48h default, not a fixed rule)", () => {
    const q = block({ id: "q", task_id: "q1", title: "Quiz prep" });
    const tasks = [task({ id: "q1", title: "Quiz prep", due_is_hard: true, due_at: now.plus({ hours: 60 }).toISO()! })];
    expect(impact({ before: [q], after: [], tasks }).deadlinesAtRisk).toHaveLength(0);
    expect(impact({ before: [q], after: [], tasks, riskHours: 72 }).deadlinesAtRisk).toHaveLength(1);
  });

  it("overlapping a fixed commitment is infeasible unless the person allowed it (then it's high impact)", () => {
    const p = block({ id: "p", title: "Navi work", starts_at: iso("14:00"), ends_at: iso("15:00") });
    const fixed = [{ title: "Dentist", start: DateTime.fromISO(iso("14:30")), end: DateTime.fromISO(iso("15:30")) }];
    const no = impact({ after: [p], placed: [p], fixed });
    expect(no.feasible).toBe(false);
    expect(no.infeasible).toMatch(/Dentist/);
    const yes = impact({ after: [p], placed: [p], fixed, allowOverlap: true });
    expect(yes.feasible).toBe(true);
    expect(yes.consequences[0]).toEqual(expect.objectContaining({ key: "overlap:Dentist", level: "high" }));
  });

  it("Navi changing a block the person placed by hand is high; their own edit isn't", () => {
    const m = block({ id: "m", title: "Piano", created_by: "user", placement: "manual" });
    expect(impact({ before: [m], after: [], targets: { blockIds: ["m"], taskIds: [], removes: true } }).consequences[0].key).toBe("override_manual:m");
    expect(impact({ before: [m], after: [], actor: "user", targets: { blockIds: ["m"], taskIds: [], removes: true } }).consequences).toHaveLength(0);
  });

  it("taking must-do work off is high impact; work pushed to another day is spillover", () => {
    const a = block({ id: "a", task_id: "x", title: "Essay" });
    const pushed = { ...a, plan_date: "2026-11-17", starts_at: iso("10:00", "2026-11-17"), ends_at: iso("11:00", "2026-11-17") };
    const r = impact({ before: [a], after: [pushed], tasks: [task({ id: "x", title: "Essay" })] });
    expect(r.spillover).toEqual([{ date: "2026-11-17", titles: ["Essay"] }]);
    const must = impact({ before: [a], after: [], tasks: [task({ id: "x", title: "Essay", commitment: "must" })], targets: { blockIds: ["a"], taskIds: ["x"], removes: true } });
    expect(must.consequences.map((c) => c.key)).toContain("must:x");
  });
});

describe("authorization", () => {
  const high = impact({ before: [block({ id: "q", task_id: "q1" })], after: [], tasks: [task({ id: "q1", due_is_hard: true, due_at: now.plus({ hours: 5 }).toISO()! })] });
  it("low/moderate runs; high needs a card unless every high consequence is named and backed by the person's words", () => {
    expect(decide({ actor: "navi", impact: impact({}) }).action).toBe("apply");
    expect(decide({ actor: "navi", impact: high }).action).toBe("propose");
    expect(decide({ actor: "navi", impact: high, authorize: ["deadline:q1"], userQuote: "take it off anyway", userMessage: "yes" }).action).toBe("propose");
    expect(decide({ actor: "navi", impact: high, authorize: ["something:else"], userQuote: "take it off anyway", userMessage: "take it off anyway" }).action).toBe("propose");
    expect(decide({ actor: "navi", impact: high, authorize: ["deadline:q1"], userQuote: "take it off anyway", userMessage: "I know, take it off anyway." }).action).toBe("apply");
  });
  it("the person's own edits run; 'ask me first' and previews always make a card", () => {
    expect(decide({ actor: "user", impact: high }).action).toBe("apply");
    expect(decide({ actor: "navi", autonomy: "ask", impact: impact({}) }).action).toBe("propose");
    expect(decide({ actor: "user", mode: "preview", impact: impact({}) }).action).toBe("propose");
  });
  it("a yes is a yes, and never one that also says no", () => {
    for (const y of ["yes", "Yes please", "sure, go ahead", "ok do it", "sounds good"]) expect(isAffirmative(y)).toBe(true);
    for (const n of ["no", "yes but not now", "wait", "don't", "maybe", ""]) expect(isAffirmative(n)).toBe(false);
    expect(quoteIsTheirs("Fine, clear the whole day.", "clear the whole day")).toBe(true);
    expect(quoteIsTheirs("Fine.", "clear the whole day")).toBe(false);
    expect(quoteIsTheirs("clear it", "clear")).toBe(false);
  });
});

describe("verification", () => {
  const ins: Op = { op: "insert", block: { id: "n", task_id: "t1", routine_id: null, title: "Navi work", plan_date: "2026-11-16", starts_at: iso("14:00"), ends_at: iso("15:00"), reason: "", basis: null, assumption: null } };
  const post = [{ kind: "task_at" as const, task_id: "t1", title: "Navi work", starts_at: iso("14:00"), ends_at: iso("15:00") }, { kind: "task_open" as const, task_id: "t1", title: "Navi work" }];
  it("passes only when the saved rows match every op and what was asked", () => {
    const saved = [block({ id: "n", task_id: "t1", title: "Navi work", starts_at: iso("14:00"), ends_at: iso("15:00") })];
    expect(evaluate(saved, [], [{ id: "t1", status: "todo" }], [ins], post, zone).ok).toBe(true);
  });
  it("fails (and says what's actually there) when the block isn't where it was asked", () => {
    const saved = [block({ id: "n", task_id: "t1", title: "Navi work", starts_at: iso("15:00"), ends_at: iso("16:00") })];
    const v = evaluate(saved, [], [{ id: "t1", status: "todo" }], [ins], post, zone);
    expect(v.ok).toBe(false);
    expect(v.opsPersisted).toBe(false);
    expect(v.checks.find((c) => !c.ok && c.label.includes("2:00 PM"))?.actual).toMatch(/3:00 PM/);
  });
  it("a soft condition (focus work in a re-plan) is reported but doesn't fail the change", () => {
    const v = evaluate([], [], [], [], [{ kind: "task_on", task_id: "x", title: "Essay", date: "2026-11-16", soft: true }], zone);
    expect(v.ok).toBe(true);
    expect(v.checks.at(-1)).toEqual(expect.objectContaining({ ok: false, soft: true }));
  });
  it("in-memory apply matches the SQL semantics for moves and removals", () => {
    const b = block({ id: "a", title: "A" });
    const out = applyOps([b], [{ op: "move", id: "a", title: "A", before: { starts_at: b.starts_at, ends_at: b.ends_at, plan_date: b.plan_date, pinned: false, placement: "auto", session_id: null, session_title: null }, after: { starts_at: iso("12:00"), ends_at: iso("13:00"), plan_date: "2026-11-16", pinned: true, placement: "requested", session_id: null, session_title: null } }]);
    expect(out[0]).toEqual(expect.objectContaining({ starts_at: iso("12:00"), pinned: true, placement: "requested" }));
    expect(applyOps([b], [{ op: "remove", id: "a", title: "A", before: {} }])).toEqual([]);
  });
});

describe("planning rules and accountability helpers", () => {
  const rule = (over: Partial<PlanningRule>): PlanningRule => ({ id: "r", kind: "estimate_scale", scope: "global", scope_id: null, params: { factor: 1.5 }, source: "stated", confidence: 1, status: "active", note: null, expires_on: null, ...over });
  const t = (id: string, over: Partial<Task> = {}) => ({ id, project_id: null, workspace_id: null, ...over }) as Task;
  it("the most specific active, unexpired rule wins; suggested and expired rules never apply", () => {
    const rules = [rule({ id: "g", params: { factor: 1.2 } }), rule({ id: "p", scope: "project", scope_id: "ela", params: { factor: 2 } }), rule({ id: "s", scope: "task", scope_id: "x", status: "suggested", params: { factor: 3 } }), rule({ id: "old", scope: "task", scope_id: "y", expires_on: "2026-11-01", params: { factor: 3 } })];
    expect(estimateScales([t("a", { project_id: "ela" }), t("x"), t("y")], rules, "2026-11-16")).toEqual({ a: 2, x: 1.2, y: 1.2 });
  });
  it("a daily load cap rule can be limited to weekdays", () => {
    const rules = [rule({ kind: "daily_load_cap", params: { cap: 0.5, days: [1, 2, 3, 4, 5] } })];
    expect(loadCapRule(rules, "2026-11-16", zone)).toBe(0.5); // Monday
    expect(loadCapRule(rules, "2026-11-15", zone)).toBeNull(); // Sunday
  });
  it("a stated reason or insistence counts; a bare request doesn't", () => {
    expect(gaveReason("I know, move it anyway")).toBe(true);
    expect(gaveReason("skip it, I already handed it in")).toBe(true);
    expect(gaveReason("skip chemistry today")).toBe(false);
  });
});

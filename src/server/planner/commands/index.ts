import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { getProfile } from "@/server/context";
import { planningPrefs } from "@/lib/planner-flag";
import { awakeSpan } from "@/server/day";
import { planView, changeLine } from "@/lib/plan-summary";
import type { StepView } from "@/lib/tool-events";
import { computeRun, persistRun, StalePlanError, type PlanOptions, type PlanRun } from "../plan-v2";
import { analyzeImpact, impactLines, type Impact } from "./impact";
import { decide, isAffirmative } from "./authorize";
import { interpret, CommandInputError, freeStarts } from "./interpret";
import { verifyChangeset, type Verification } from "./verify";
import { challengeFor } from "./accountability";
import { CommandSchema, type Command, type CommandOptions } from "./types";

export { CommandSchema, type Command, type CommandOptions } from "./types";
export type { Impact } from "./impact";
export type { Verification } from "./verify";

// The scheduling-command pipeline (docs/navi-1.5/PLANNER_RELIABILITY.md):
//
//   Interpret → Preview → Analyze → (Challenge once) → Authorize → Apply → Verify → Report
//
// Every schedule change, from Navi's tools, the web, the phone app or a
// planning button, goes through here when the person has the planner
// commands switch on. Nothing is saved before the preview and its impact are
// worked out; a change is saved as ONE change set (all or nothing, under the
// per-person lock, refused if anything it was based on changed since); the
// saved state is read back and checked against what was asked; and the reply
// is written from that check, never from the fact that the planner ran.

export type CommandStatus = "applied" | "proposed" | "unchanged" | "infeasible" | "challenged" | "duplicate" | "stale";

export type CommandResult = {
  status: CommandStatus;
  ok: boolean;
  changesetId: string | null;
  actionId: string | null;
  impact: Impact | null;
  verification: Verification | null;
  /** Exact, for the model. */
  summary: string;
  /** For the person (chat card / toast). */
  view: StepView;
  undo: string[];
  /** The planning run behind it (for re-plans and the plan card). */
  run?: PlanRun;
  alternatives?: string[];
};

const MAX_ATTEMPTS = 2;

function fail(status: "infeasible" | "stale" | "challenged", summary: string, display: string, alternatives: string[] = []): CommandResult {
  return { status, ok: false, changesetId: null, actionId: null, impact: null, verification: null, summary, view: { display, plan: true, unchanged: true }, undo: [], alternatives };
}

/** Run one command through the whole pipeline. `extra`: planning-run options (recovery uses them). */
export async function executeCommand(ctx: Ctx, input: Command, opts: CommandOptions = {}, extra: Partial<PlanOptions> = {}): Promise<CommandResult> {
  const cmd = CommandSchema.parse(input);
  const profile = await getProfile(ctx);
  const prefs = planningPrefs(profile.preferences);
  if (!prefs.commands) throw new Error("The scheduling commands aren't on for this account.");
  const zone = profile.timezone;

  // At most once: the same request (same key) returns what it did the first time.
  if (opts.idempotencyKey) {
    const { data: seen } = await ctx.db.from("plan_changesets").select("id,status,summary,verification,approval_id").eq("idempotency_key", opts.idempotencyKey).maybeSingle();
    if (seen) {
      return {
        status: "duplicate", ok: true, changesetId: seen.id, actionId: seen.approval_id, impact: null, verification: seen.verification as Verification | null,
        summary: `Already done for this request (${seen.status}); not repeated. ${seen.summary}`, view: { display: "Already done", plan: true, unchanged: true }, undo: [],
      };
    }
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 1. Interpret.
    let interp;
    try {
      interp = await interpret(ctx, cmd, profile);
    } catch (err) {
      if (err instanceof CommandInputError) return fail("infeasible", `Not done: ${err.message}`, err.message);
      throw err;
    }
    if ("infeasible" in interp) return fail("infeasible", `Not done: ${interp.infeasible}`, interp.infeasible, interp.alternatives);

    // 2. Preview: the command's own changes plus the rest of those days re-fitted, nothing saved.
    const preview = await computeRun(ctx, interp.dates, { trigger: extra.trigger ?? (ctx.actor === "user" ? "manual" : "command"), ...interp.plan, ...extra, direct: true }, { ops: interp.ops });

    // 3. Analyze.
    const placedBlocks = preview.after.filter((b) => interp.placed.includes(b.id));
    const awake = Object.fromEntries(interp.dates.map((d) => { const a = awakeSpan(profile, d, zone); return [d, a ? { start: DateTime.fromMillis(a.start, { zone }), end: DateTime.fromMillis(a.end, { zone }) } : null]; }));
    const impact = analyzeImpact({
      before: preview.before, after: preview.after, dates: preview.runDates, tasks: preview.inputs.tasks, now: DateTime.now().setZone(zone), zone, riskHours: prefs.riskHours,
      actor: ctx.actor, targets: interp.targets, placed: placedBlocks, fixed: interp.fixed, allowOverlap: opts.allowOverlap, awake,
    });
    if (!impact.feasible) {
      const minutes = placedBlocks[0] ? Math.round((Date.parse(placedBlocks[0].ends_at) - Date.parse(placedBlocks[0].starts_at)) / 60000) : 30;
      const alternatives = placedBlocks[0] ? freeStarts(interp.fixed, placedBlocks[0].plan_date, minutes, zone, profile) : [];
      const alt = alternatives.length ? ` Free then: ${alternatives.join(", ")}.` : "";
      return fail("infeasible", `Not done, nothing changed: ${impact.infeasible}${alt}`, `Couldn't do that: ${impact.infeasible}${alt}`, alternatives);
    }

    // 4. Authorize.
    const decision = decide({ actor: ctx.actor, autonomy: ctx.autonomy, mode: opts.mode ?? extra.mode, impact, authorize: opts.authorize, userQuote: opts.userQuote, userMessage: ctx.userMessage });

    // 5. Accountability: at most one challenge per decision, never a block. A
    //    change that already waits on a card with its consequences isn't challenged too.
    if (decision.action === "apply") {
      const challenge = await challengeFor(ctx, interp.defers, { reaffirmed: opts.reaffirmed, reason: opts.reason, riskHours: prefs.riskHours });
      if (challenge) {
        return fail("challenged", `Not done yet, nothing changed. Say this to the user (once; if they still want it, call again with reaffirmed true and it will run): ${challenge.text}`, challenge.text);
      }
    }
    if (!preview.ops.length) {
      const run: PlanRun = { results: preview.results, changesetId: null, status: "unchanged", actionId: null, summary: "", undo: [], changes: [] };
      const v = planView(preview.results, zone, { unchanged: true });
      return { status: "unchanged", ok: true, changesetId: null, actionId: null, impact, verification: null, summary: `Nothing needed to change. ${runSummary(preview.results, zone)}`.trim(), view: { ...v, display: cmd.kind === "replan" ? v.display : "Nothing needed to change" }, undo: [], run: { ...run, summary: runSummary(preview.results, zone) } };
    }

    // 6. Apply (or propose: one card for the whole change).
    let run: PlanRun;
    try {
      run = await persistRun(ctx, preview, {
        mode: decision.action, trigger: extra.trigger ?? (ctx.actor === "user" ? "manual" : "command"),
        command: cmd, impact, postconditions: interp.post, idempotencyKey: opts.idempotencyKey ?? null, offered: decision.action === "propose",
        approvalReason: decision.why ?? undefined, impactLines: impactLines(impact), subject: cmd.kind === "replan" ? undefined : interp.what,
      });
    } catch (err) {
      if (err instanceof StalePlanError && attempt < MAX_ATTEMPTS) continue; // something changed meanwhile: work it out again
      if (err instanceof StalePlanError) return fail("stale", `Not done, nothing changed: ${err.message}`, "Your plan changed while I was working on it, so I didn't change anything. Try again.");
      if (err instanceof Error && /plan_changesets_idempotency/.test(err.message) && opts.idempotencyKey) return executeCommand(ctx, cmd, opts, extra);
      throw err;
    }
    if (run.status === "proposed") {
      const lines = impact.consequences.map((c) => c.text);
      return {
        status: "proposed", ok: true, changesetId: run.changesetId, actionId: run.actionId, impact, verification: null,
        summary: `Not changed yet: ${interp.what} waits for the user's OK on its card because ${decision.why}.${lines.length ? ` Consequences shown on the card: ${lines.join(" ")}` : ""} If the user says yes in words, call confirm_change.`,
        view: { plan: true }, undo: [], run,
      };
    }

    // 7. Verify: read what's saved and check it against what was asked.
    const verification = await verifyChangeset(ctx, run.changesetId!, preview.ops, interp.post, preview.runDates);
    // 8. Report from the verification.
    return report(cmd, interp.what, impact, verification, run, zone);
  }
  return fail("stale", "Not done, nothing changed: the plan kept changing.", "Your plan kept changing, so I didn't change anything.");
}

function runSummary(results: PlanRun["results"], zone: string): string {
  return planView(results, zone).leftover?.line ?? "";
}

function report(cmd: Command, what: string, impact: Impact, v: Verification, run: PlanRun, zone: string): CommandResult {
  const failed = v.checks.filter((c) => !c.ok && !c.soft);
  const softMissed = v.checks.filter((c) => !c.ok && c.soft);
  const base = planView(run.results, zone, { changes: run.changes });
  const moreLines = [
    ...impact.displaced.filter((d) => d.kind !== "moved").map((d) => (d.kind === "pushed" ? `${d.title} → ${DateTime.fromISO(d.to!).setZone(zone).toFormat("ccc h:mm a")}` : `${d.title}: off the plan for now (still on your list)`)),
    ...impact.notes,
    ...softMissed.map((c) => `${c.label.replace(/ is planned /, " couldn't be planned ")}`),
  ];
  const display = failed.length
    ? `Saved, but not everything is as asked: ${failed[0].label.charAt(0).toLowerCase()}${failed[0].label.slice(1)} isn't true (${failed[0].actual ?? "different"})`
    : cmd.kind === "replan" ? base.display : what;
  const checks = v.checks.map((c) => `${c.ok ? "✓" : c.soft ? "–" : "✗"} ${c.label}${c.ok ? "" : ` (actually: ${c.actual ?? "no"})`}`).join("; ");
  const summary = `${failed.length ? "Applied, but verification FAILED (tell the user exactly what isn't as asked; they can undo)" : "Applied and verified"}: ${what}. Checked: ${checks}.${impact.consequences.length ? ` Also changed: ${impact.consequences.map((c) => c.text).join(" ")}` : ""} ${run.summary} (The user can undo this.)`;
  return {
    status: "applied", ok: !failed.length, changesetId: run.changesetId, actionId: null, impact, verification: v, summary,
    view: { display, detail: [...(base.detail ?? []), ...moreLines.filter((l) => !(base.detail ?? []).includes(l))].map((l) => l), plan: true, ...(base.leftover ? { leftover: base.leftover } : {}) },
    undo: run.undo, run: { ...run, summary: `${run.summary}${failed.length ? ` Verification failed: ${failed.map((f) => f.label).join("; ")}.` : ""}` },
  };
}

/**
 * A re-plan through the pipeline (planner commands on): what planDays,
 * the planning buttons, recovery and the morning tick call. Returns the
 * planning run, like planDays.
 */
export async function replan(ctx: Ctx, dates: string[], opts: PlanOptions): Promise<PlanRun & { impact?: Impact | null; verification?: Verification | null; commandStatus?: CommandStatus }> {
  const r = await executeCommand(
    ctx,
    { kind: "replan", dates: [...new Set(dates)].sort(), focus_task_ids: opts.focusTaskIds ?? null },
    { mode: opts.mode === "propose" ? "preview" : "apply" },
    { trigger: opts.trigger, from: opts.from, reasonPrefix: opts.reasonPrefix, carryFromFirstDay: opts.carryFromFirstDay, markBlocks: opts.markBlocks, refit: opts.refit },
  );
  if (r.status === "stale") throw new StalePlanError(r.summary);
  if (!r.run) throw new Error(r.summary);
  return { ...r.run, impact: r.impact, verification: r.verification, commandStatus: r.status };
}

/**
 * The person said yes to a pending change in words. It resolves to exactly
 * one plan card in this conversation that was shown before this message, with
 * its consequences on it; otherwise nothing is approved and the reply says why
 * (or which one they mean). Approving then runs it once, like a tap.
 */
export async function confirmChange(ctx: Ctx, changesetId?: string | null): Promise<{ ok: boolean; summary: string; display: string; actionId?: string }> {
  if (!ctx.conversationId) return { ok: false, summary: "Nothing to confirm here.", display: "" };
  if (!isAffirmative(ctx.userMessage)) return { ok: false, summary: "Not confirmed: the user's latest message isn't a clear yes. Ask them, or let them tap the card.", display: "" };
  const { data } = await ctx.db
    .from("plan_changesets")
    .select("id,summary,approval_id,created_at,impact")
    .eq("conversation_id", ctx.conversationId)
    .eq("status", "proposed")
    .not("approval_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const started = ctx.turnStartedAt ? Date.parse(ctx.turnStartedAt) : Date.now();
  const shown = ((data ?? []) as { id: string; summary: string; approval_id: string; created_at: string }[]).filter((c) => Date.parse(c.created_at) < started);
  const { data: live } = shown.length ? await ctx.db.from("approvals").select("id").in("id", shown.map((c) => c.approval_id)).eq("status", "proposed") : { data: [] };
  const open = shown.filter((c) => (live ?? []).some((a) => a.id === c.approval_id));
  if (!open.length) return { ok: false, summary: "There's no pending plan change in this chat that the user has already seen, so nothing was approved.", display: "" };
  const pick = changesetId ? open.find((c) => c.id === changesetId) : open.length === 1 ? open[0] : null;
  if (!pick) {
    return { ok: false, summary: `Not confirmed: ${changesetId ? "that isn't one of the pending changes" : `${open.length} changes are waiting`}. Ask the user one short question about which one they mean.`, display: "" };
  }
  const { decideApproval } = await import("@/server/domain/approvals");
  const { data: appr } = await ctx.db.from("approvals").select("status").eq("id", pick.approval_id).maybeSingle();
  if (appr?.status !== "proposed") return { ok: false, summary: `That change is already ${appr?.status ?? "gone"}.`, display: "" };
  const done = await decideApproval({ ...ctx, actor: "user" }, pick.approval_id, "approve");
  const r = (done.result ?? {}) as { summary?: string };
  if (done.status === "completed") return { ok: true, summary: `The user approved it in words; ${r.summary ?? "applied"}.`, display: r.summary ?? "Done", actionId: done.id };
  return { ok: false, summary: `Not applied (${done.status}): ${done.error ?? ""}`, display: done.error ?? "Not applied", actionId: done.id };
}

/** The changes behind the disclosure for a verified command (for callers outside the chat). */
export function commandMessage(r: CommandResult): string {
  return [r.view.display, r.view.leftover?.line].filter(Boolean).join(". ") + ".";
}

export { changeLine };

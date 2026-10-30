import "server-only";
import { DateTime } from "luxon";
import type { ToolEvent } from "@/lib/types";
import { getProfile } from "@/server/context";
import { recordUsage } from "./budget";
import { runTool } from "./tools";
import { areaFor, detectAreas, extractAvailability, extractItems, extractWeeklyCommitments } from "./heuristics";
import type { AgentRequest, AgentResult } from "./agent";

// Development simulator: a deterministic stand-in for the model so the full
// product loop (onboarding, capture, inbox, planning) can be exercised and
// tested without provider credentials. Every reply is visibly labelled, it is
// refused in production builds (see serverEnv.aiProvider), and it never
// pretends to be a real model.

export const SIM_LABEL = "[Simulated AI — development mode]";

const ONBOARDING_QUESTIONS = [
  "Hi, I'm Navi. Let's set up your operating system by talking it through. What are the main areas of your life right now (for example school, a startup, a sport, family), and what are you working on in each?",
  "Got it. What fixed commitments do you have each week, with days and times? For example “soccer practice Mon and Wed at 4pm” or “classes weekdays at 8am”. And any big deadlines coming up?",
  "Thanks. When are you usually free to do focused work (like “free after 5pm on weekdays”), and when should I stay quiet and not notify you (like “quiet 10pm to 7am”)?",
];

export async function runDevSim(req: AgentRequest): Promise<AgentResult> {
  const ctx = { ...req.ctx, actor: "navi" as const };
  const events: ToolEvent[] = [];
  let mutated = false;
  const call = async (name: string, input: unknown) => {
    const r = await runTool(ctx, name, input);
    events.push({ name, ok: r.ok, summary: r.summary });
    if (r.mutated) mutated = true;
    return r;
  };
  const profile = await getProfile(req.ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  // Capture requests wrap the user's words in a header and quotes; parse only the words.
  const wrapped = req.userText.match(/"""\n([\s\S]*)\n"""/);
  const text = (req.mode === "capture" && wrapped ? wrapped[1] : req.userText).trim();
  let reply = "";

  if (req.mode === "onboarding") {
    const userTurns = req.history.filter((m) => m.role === "user").map((m) => m.content);
    const greeting = /^(start|hi|hello|hey)\b[\s!.]*$/i;
    // Answers so far, not counting greetings; the current message is the next answer.
    const answers = userTurns.filter((t) => !greeting.test(t.trim())).length;
    const wantsProposal = /\b(that'?s it|that is all|i'?m done|all done|propose|set (it|me) up|go ahead)\b/i.test(text);
    if (greeting.test(text)) {
      reply = ONBOARDING_QUESTIONS[0];
    } else if (answers < ONBOARDING_QUESTIONS.length - 1 && !wantsProposal) {
      reply = ONBOARDING_QUESTIONS[answers + 1];
    } else {
      const all = [...userTurns.filter((t) => !greeting.test(t.trim())), text].join("\n");
      const items = buildOnboardingProposals(all, now);
      await call("propose_items", { items, batch: "onboarding" });
      await call("mark_onboarding_ready", { summary: `${items.length} items proposed` });
      reply = `I've drafted your setup: ${items.filter((i) => i.kind === "workspace").length} areas, ${items.filter((i) => i.kind === "event").length} fixed commitments, ${items.filter((i) => i.kind === "task").length} tasks and your schedule preferences. Review it below: approve what's right, edit or reject the rest.`;
    }
  } else if (req.mode === "chat" && /\b(plan|organi[sz]e)\b.*\b(week)\b/i.test(text)) {
    const r = await call("plan_week", {});
    reply = r.summary;
  } else if (req.mode === "chat" && /\b(plan|organi[sz]e|schedule)\b.*\b(day|today)\b/i.test(text)) {
    const r = await call("plan_day", {});
    const data = (await runTool(ctx, "get_overview", {})).data as string;
    // The overview carries item IDs for the model; people don't need them.
    const planLine = (data.split("\n").find((l) => l.startsWith("Today's plan")) ?? "").replace(/\s*\[[0-9a-f-]{36}\]/g, "");
    reply = `${r.summary}. ${planLine}`;
  } else if (req.mode === "chat" && /\b(plan (broke|fell apart)|got interrupted|ran out of time|i'?m behind|sick|unexpected)\b/i.test(text)) {
    const category = /sick|tired|rest/i.test(text) ? "rest" : /estimate|took longer/i.test(text) ? "estimate" : "interruption";
    const r = await call("recover_plan", { description: text.slice(0, 400), category });
    reply = `That happens. ${r.summary} Nothing unfinished was dropped.`;
  } else if (req.mode === "chat" && /^remember (that )?/i.test(text)) {
    const content = text.replace(/^remember (that )?/i, "");
    await call("remember", { kind: "profile", content, origin: "stated", confidence: 1 });
    reply = `Saved to memory: “${content}”.`;
  } else {
    const items = extractItems(text, now).filter((i) => req.mode === "capture" || i.kind !== "note");
    if (items.length) {
      await call("propose_items", {
        items: items.map((i) => ({
          kind: i.kind,
          payload:
            i.kind === "task"
              ? { title: i.title, due_at: i.due_at ?? null, priority: i.priority ?? 3, estimate_minutes: i.estimate_minutes ?? null }
              : i.kind === "event"
                ? { title: i.title, starts_at: i.due_at, ends_at: DateTime.fromISO(i.due_at!).plus({ hours: 1 }).toISO() }
                : i.kind === "question"
                  ? { question: i.title }
                  : { title: i.title, body: i.excerpt },
          source_excerpt: i.excerpt,
          origin: "inferred",
          confidence: 0.4,
          rationale: "Rule-based extraction by the development simulator",
        })),
      });
      reply = `I put ${items.length} item${items.length === 1 ? "" : "s"} in your review inbox. Nothing is committed until you accept it.`;
    } else {
      reply = "Noted. (The simulator only understands brain dumps, “plan my day/week”, “my plan broke…”, and “remember that…”.)";
    }
  }

  await recordUsage({ userId: req.ctx.userId, provider: "devsim", model: "devsim", role: req.role, purpose: req.purpose, costUsd: 0 });
  return { text: `${SIM_LABEL} ${reply}`, toolEvents: events, mutated, model: "devsim", simulated: true, costUsd: 0 };
}

type Proposal = {
  kind: string;
  payload: Record<string, unknown>;
  ref_key?: string;
  source_excerpt?: string;
  origin: "stated" | "inferred";
  confidence: number;
  rationale?: string;
};

export function buildOnboardingProposals(all: string, now: DateTime): Proposal[] {
  const items: Proposal[] = [];
  const areas = detectAreas(all);
  if (areas.length === 0) areas.push("Personal");
  const refOf = (area: string | null) => (area && areas.includes(area) ? `ws_${area.toLowerCase()}` : `ws_${areas[0].toLowerCase()}`);
  for (const a of areas) {
    items.push({ kind: "workspace", payload: { name: a }, ref_key: `ws_${a.toLowerCase()}`, origin: "inferred", confidence: 0.6, rationale: `You mentioned things that fit “${a}”.` });
  }
  for (const c of extractWeeklyCommitments(all)) {
    const first = (() => {
      let d = now.startOf("day");
      for (let i = 0; i < 7; i++) {
        d = now.startOf("day").plus({ days: i });
        if (c.days.includes(d.weekday % 7)) break;
      }
      return d.set({ hour: c.hour, minute: c.minute });
    })();
    items.push({
      kind: "event",
      payload: { title: c.title, starts_at: first.toISO(), ends_at: first.plus({ minutes: 90 }).toISO(), recurrence: { freq: "weekly", days: c.days }, workspace_ref: refOf(areaFor(c.title)) },
      source_excerpt: c.excerpt,
      origin: "stated",
      confidence: 0.7,
      rationale: "Weekly commitment you described; length assumed 90 minutes, adjust if needed.",
    });
  }
  const availability = extractAvailability(all);
  const quiet = all.toLowerCase().match(/quiet\s+(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const pref: Record<string, unknown> = {};
  if (availability.length) pref.availability = availability;
  if (quiet) {
    const to24 = (h: string, m: string | undefined, ap: string | undefined, def: "am" | "pm") => {
      let hr = Number(h);
      const a = ap ?? def;
      if (a === "pm" && hr < 12) hr += 12;
      if (a === "am" && hr === 12) hr = 0;
      return `${String(hr).padStart(2, "0")}:${m ?? "00"}`;
    };
    pref.quiet_hours_start = to24(quiet[1], quiet[2], quiet[3], "pm");
    pref.quiet_hours_end = to24(quiet[4], quiet[5], quiet[6], "am");
  }
  if (Object.keys(pref).length) {
    items.push({ kind: "preference", payload: pref, origin: "stated", confidence: 0.7, rationale: "Your availability and quiet hours." });
  }
  for (const t of extractItems(all, now).filter((i) => i.kind === "task" && !/\b(free|quiet)\b/i.test(i.excerpt))) {
    if (extractWeeklyCommitments(t.excerpt).length) continue;
    items.push({
      kind: "task",
      payload: { title: t.title, due_at: t.due_at ?? null, priority: t.priority ?? 3, estimate_minutes: t.estimate_minutes ?? 45, workspace_ref: refOf(areaFor(t.excerpt)) },
      source_excerpt: t.excerpt,
      origin: "inferred",
      confidence: 0.5,
      rationale: "Something you said you need to do; estimate assumed.",
    });
  }
  return items;
}

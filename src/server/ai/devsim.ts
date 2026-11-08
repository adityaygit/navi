import "server-only";
import { DateTime } from "luxon";
import type { ToolEvent } from "@/lib/types";
import { getProfile } from "@/server/context";
import { recordUsage } from "./budget";
import { plannerV2For, runTool, type ToolResult } from "./tools";
import type { Ctx } from "@/server/context";
import { parseDue, areaFor, detectAreas, extractAvailability, extractGoals, extractItems, extractName, extractProjects, extractRoutines, extractWeeklyCommitments } from "./heuristics";
import type { AgentRequest, AgentResult } from "./agent";
import { emitter, stepEndEvent, stepStartEvent, toolEventOf } from "./live";
import { actionViews } from "@/server/domain/approvals";

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Word groups of one to three words, each keeping its trailing space, for live text. */
export function wordGroups(text: string): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const groups: string[] = [];
  for (let i = 0; i < words.length; ) {
    const n = 1 + ((i * 7 + words.length) % 3);
    groups.push(words.slice(i, i + n).join(""));
    i += n;
  }
  return groups;
}

// ---- planner v2 phrases ---------------------------------------------------------

type Call = (name: string, input: unknown) => Promise<ToolResult>;
const STOP = new Set(["the", "and", "for", "my", "a", "an", "to", "of", "on", "in", "it", "with", "this", "that", "test", "homework", "work"]);
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "a couple of": 2, "a": 1 };

/** Open tasks whose titles share a meaningful word with the phrase. */
async function tasksLike(ctx: Ctx, phrase: string): Promise<{ id: string; title: string }[]> {
  const words = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return [];
  const { data } = await ctx.db.from("tasks").select("id,title").in("status", ["todo", "in_progress", "blocked"]);
  return ((data ?? []) as { id: string; title: string }[]).filter((t) => words.some((w) => t.title.toLowerCase().includes(w)));
}

async function eventLike(ctx: Ctx, phrase: string): Promise<{ id: string; title: string } | null> {
  const words = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return null;
  const { data } = await ctx.db.from("events").select("id,title").neq("status", "cancelled");
  return ((data ?? []) as { id: string; title: string }[]).find((e) => words.some((w) => e.title.toLowerCase().includes(w))) ?? null;
}

/** "6", "6pm", "6:30", "18:00" → "HH:MM" (afternoon/evening hours without am/pm are read as pm). */
function clock(h: string, m: string | undefined, ap: string | undefined): string {
  let hr = Number(h);
  if (ap?.toLowerCase() === "pm" && hr < 12) hr += 12;
  if (!ap && hr >= 1 && hr <= 8) hr += 12;
  return `${String(hr).padStart(2, "0")}:${m ?? "00"}`;
}

const clean = (s: string) => s.replace(/\s*\(The user can undo this\.\)/, "").trim();

export async function planningIntent(text: string, ctx: Ctx, call: Call, step: Call): Promise<string | null> {
  if (/^\s*undo( that| it| the plan)?\b/i.test(text)) return (await call("undo_plan", {})).summary;

  const nonNeg = text.match(/non-?negotiables?\b[\s:,-]*(?:are\s*)?(.*?)(?:\.\s*plan\b|\.\s*$|$)/i);
  if (nonNeg) {
    const names = nonNeg[1].split(/,|\band\b|;/).map((s) => s.trim()).filter(Boolean);
    const marked: string[] = [];
    for (const n of names) for (const t of await tasksLike(ctx, n)) {
      if (marked.includes(t.title)) continue;
      await call("update_task", { id: t.id, commitment: "must" });
      marked.push(t.title);
    }
    const r = await call("plan", {});
    return `Got it. ${marked.length ? `I marked ${marked.map((m) => `“${m}”`).join(", ")} as must-complete and` : "I"} built the rest of your day around them. ${clean(r.summary)}`;
  }

  const haveBut = text.match(/i have (.+?) (tonight|today|this (?:afternoon|evening|morning))\b(.*?)\b(?:need|have) to (?:finish|do|study for|work on|get) (.+?)[.!]?$/i);
  if (haveBut) {
    const [, what, , middle, goal] = haveBut;
    const time = (what + middle).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    const ev = await eventLike(ctx, what);
    const busy = time ? [{ start: clock(time[1], time[2], time[3]), end: clock(time[4], time[5], time[6] ?? time[3]), title: what.trim() }] : [];
    if (!ev && !busy.length) return `What time is ${what.trim()} ${haveBut[2].toLowerCase()}? I'll plan ${goal.trim()} around it.`;
    const focus = await tasksLike(ctx, goal);
    const r = await call("plan", { focus_task_ids: focus.map((t) => t.id), ...(busy.length ? { busy } : {}) });
    return `${ev ? `“${ev.title}” stays where it is.` : `Noted ${what.trim()} ${busy[0].start}–${busy[0].end} for today only.`} ${focus.length ? `I put ${focus.map((t) => `“${t.title}”`).join(", ")} first.` : ""} ${clean(r.summary)}`.replace(/\s+/g, " ");
  }

  const cancelled = text.match(/(?:my\s+)?(.+?)\s+(?:is|got|was|has been)\s+cancel+ed\b/i) ?? text.match(/\bno\s+(.+?)\s+(?:today|tonight)\b/i);
  if (cancelled) {
    const ev = await eventLike(ctx, cancelled[1]);
    if (ev) {
      const s = await call("skip_occurrence", { event_id: ev.id, date: "today", action: "cancel" });
      if (!s.ok) return s.summary;
      const r = await call("plan", {});
      return `${s.summary.split(" (")[0]}; the weekly one stays. ${clean(r.summary)}`;
    }
  }

  const opened = text.match(/\b(morning|afternoon|evening)\s+(?:just\s+)?(?:opened up|freed up|is free|cleared)\b/i);
  if (opened) {
    const span = { morning: ["08:00", "12:00"], afternoon: ["12:00", "17:00"], evening: ["17:00", "21:00"] }[opened[1].toLowerCase() as "morning" | "afternoon" | "evening"];
    const r = await call("plan", { free: [{ start: span[0], end: span[1] }] });
    return `Nice. I treated your ${opened[1].toLowerCase()} as free and moved work earlier. ${clean(r.summary)}`;
  }

  const only = text.match(/\bonly have (\d+|one|two|three|four|five|six|a couple of|an?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (only) {
    const n = /^\d+$/.test(only[1]) ? Number(only[1]) : NUMBERS[only[1].toLowerCase()] ?? 1;
    const minutes = /^h/i.test(only[2]) ? n * 60 : n;
    const r = await call("plan", { capacity_minutes: minutes });
    const data = (r.data as { blocks: { title: string; start: string; end: string }[] }[] | undefined)?.[0];
    const first = data?.blocks.map((b) => `“${b.title}”`).join(", ");
    return `With ${minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`}, prioritise ${first || "nothing new: what's planned already fills it"}. ${clean(r.summary)}`;
  }

  const behind = text.match(/\bbehind on ([^.,!]+)/i);
  if (behind) {
    const focus = await tasksLike(ctx, behind[1]);
    if (!focus.length) return `I couldn't find a task for “${behind[1].trim()}”. Which task is it?`;
    const r = await call("plan", { focus_task_ids: focus.map((t) => t.id) });
    return `Let's catch up on ${focus.map((t) => `“${t.title}”`).join(", ")}: it goes first for the rest of today. ${clean(r.summary)}`;
  }

  if (/\b(build|plan|make|set up)\b.*\b(schedule|plan|day)\b.*\btomorrow\b|\btomorrow'?s (schedule|plan)\b/i.test(text)) {
    await step("get_plan", { date: "tomorrow" });
    const r = await call("plan", { date: "tomorrow" });
    return clean(r.summary);
  }
  if (/\b(plan|organi[sz]e|schedule)\b.*\b(my day|today)\b/i.test(text)) return clean((await call("plan", {})).summary);
  return null;
}

export async function runDevSim(req: AgentRequest): Promise<AgentResult> {
  const ctx = { ...req.ctx, actor: "navi" as const, userMessage: req.userText };
  const events: ToolEvent[] = [];
  let mutated = false;
  const emit = emitter(req);
  // Live pacing only when someone is watching the stream, and never in tests.
  const live = !!req.onEvent && process.env.NODE_ENV !== "test";
  let steps = 0;
  // Every tool call shows as a live step; only changes are saved as actions taken.
  const step = async (name: string, input: unknown) => {
    const id = `sim_${++steps}`;
    emit(stepStartEvent(id, name));
    if (live) await pause(350 + Math.random() * 250);
    const r = await runTool(ctx, name, input);
    const action = r.actionId && req.onEvent ? (await actionViews(req.ctx, [r.actionId]))[r.actionId] : undefined;
    emit(stepEndEvent(id, name, r.ok, r.summary, { action, undo: r.actionId ? undefined : r.undo }));
    return r;
  };
  const call = async (name: string, input: unknown) => {
    const r = await step(name, input);
    events.push(toolEventOf(name, r));
    if (r.mutated) mutated = true;
    return r;
  };
  if (live) await pause(400);
  const profile = await getProfile(req.ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  // Capture requests wrap the user's words in a header and quotes; parse only the words.
  const wrapped = req.userText.match(/"""\n([\s\S]*)\n"""/);
  const text = (req.mode === "capture" && wrapped ? wrapped[1] : req.userText).trim();
  let reply = "";
  // The newest action in this chat still waiting for the person's OK. The simulator
  // only knows a few fixed phrases for it; the real model reads intent freely.
  const pending =
    req.mode === "chat" && ctx.conversationId
      ? (await ctx.db.from("approvals").select("id").eq("conversation_id", ctx.conversationId).eq("status", "proposed").order("created_at", { ascending: false }).limit(1).maybeSingle()).data
      : null;
  const addTask = req.mode === "chat" ? text.match(/^(?:please\s+)?(?:add|create)\s+(?:a\s+)?task\s+(?:to\s+)?(.+?)[.!]?$/i) : null;
  const dropTask = req.mode === "chat" ? text.match(/^(?:please\s+)?(cancel|delete|remove)\s+(?:the\s+|my\s+)?(?:task\s+)?["“]?(.+?)["”]?[.!]?$/i) : null;

  // Planner v2: the six planning phrases from the brief, deterministically.
  const v2Reply = req.mode === "chat" && (await plannerV2For(ctx)) ? await planningIntent(text, { ...ctx, plannerV2: true }, call, step) : null;

  if (v2Reply !== null) {
    reply = v2Reply;
  } else if (req.mode === "onboarding") {
    const userTurns = req.history.filter((m) => m.role === "user").map((m) => m.content);
    const greeting = /^(start|hi|hello|hey)\b[\s!.]*$/i;
    // Answers so far, not counting greetings; the current message is the next answer.
    const answers = userTurns.filter((t) => !greeting.test(t.trim())).length;
    const wantsProposal = /\b(that'?s it|that is all|i'?m done|all done|propose|set (it|me) up|go ahead)\b/i.test(text);
    if (greeting.test(text)) {
      reply = ONBOARDING_QUESTIONS[0];
    } else if (answers < ONBOARDING_QUESTIONS.length - 1 && !wantsProposal) {
      // Keep the live "What Navi's picked up" list in sync as answers come in
      // (the full draft so far, replacing the previous one; no review yet).
      const soFar = [...userTurns.filter((t) => !greeting.test(t.trim())), text].join("\n");
      const draft = buildOnboardingProposals(soFar, now).filter((i) => i.kind !== "preference");
      if (draft.length) await call("propose_items", { items: draft, batch: "onboarding" });
      reply = ONBOARDING_QUESTIONS[answers + 1];
    } else {
      const all = [...userTurns.filter((t) => !greeting.test(t.trim())), text].join("\n");
      const items = buildOnboardingProposals(all, now);
      await call("propose_items", { items, batch: "onboarding" });
      await call("mark_onboarding_ready", { summary: `${items.length} items proposed` });
      reply = `I've drafted your setup: ${items.filter((i) => i.kind === "workspace").length} areas, ${items.filter((i) => i.kind === "goal" || i.kind === "project").length} goals and projects, ${items.filter((i) => i.kind === "event" || i.kind === "routine").length} commitments and routines, ${items.filter((i) => i.kind === "task").length} tasks and your schedule preferences. Review it below: approve what's right, edit or reject the rest.`;
    }
  } else if (req.mode === "chat" && /\b(on my plate|on (for )?tomorrow|tomorrow look|schedule for tomorrow|what'?s (on )?tomorrow)\b/i.test(text)) {
    // Questions about state are answered from a fresh read, never from history.
    const r = await step("get_plan", { date: "tomorrow" });
    reply = String(r.data ?? r.summary).replace(/\s*\[[0-9a-f-]{36}\]/g, "");
  } else if (req.mode === "chat" && /\bhow (did|have) i (do|done)\b|\bhow was my (day|week)\b/i.test(text)) {
    // "How did I do" comes from the computed review, never from the model's arithmetic.
    const kind = /\bweek\b/i.test(text) ? "week" : "day";
    const r = await step("get_review", { kind, date: /\byesterday\b/i.test(text) ? "yesterday" : "today" });
    const d = r.data as { review?: { explanation: string; findings: string[] }; week?: { findings: string[]; average_completion_percent: number | null } } | undefined;
    reply = d?.review ? [d.review.explanation, ...d.review.findings].join(" ") : d?.week ? d.week.findings.join(" ") : r.summary;
  } else if (req.mode === "chat" && /\b(just captured|did i (just )?capture|in my inbox|what changed)\b/i.test(text)) {
    const r = await step("get_inbox", {});
    reply = String(r.data ?? r.summary).replace(/\s*\[[0-9a-f-]{36}\]/g, "");
  } else if (req.mode === "chat" && /\b(plan|organi[sz]e)\b.*\b(week)\b/i.test(text)) {
    const r = await call("plan_week", {});
    reply = r.summary;
  } else if (req.mode === "chat" && /\b(plan|organi[sz]e|schedule)\b.*\b(day|today)\b/i.test(text)) {
    const r = await call("plan_day", {});
    const data = (await step("get_overview", {})).data as string;
    // The overview carries item IDs for the model; people don't need them.
    const planLine = (data.split("\n").find((l) => l.startsWith("Today's plan")) ?? "").replace(/\s*\[[0-9a-f-]{36}\]/g, "");
    reply = `${r.summary.replace(/\.$/, "")}. ${planLine}`;
  } else if (req.mode === "chat" && /\b(plan (broke|fell apart)|got interrupted|ran out of time|i'?m behind|sick|unexpected)\b/i.test(text)) {
    const category = /sick|tired|rest/i.test(text) ? "rest" : /estimate|took longer/i.test(text) ? "estimate" : "interruption";
    const r = await call("recover_plan", { description: text.slice(0, 400), category });
    reply = `That happens. ${r.summary} Nothing unfinished was dropped.`;
  } else if (pending && /^(no|nope|nah|don'?t|never ?mind|forget it|decline)\b/i.test(text)) {
    const r = await call("decline_action", { action_id: pending.id });
    reply = r.ok ? "Okay, I won't do that. Nothing was changed." : r.summary;
  } else if (pending && /\b(instead|change it|make it|rename it|call it)\b/i.test(text)) {
    const changes: Record<string, unknown> = {};
    const name = text.match(/\b(?:rename it|call it)\s+(?:to\s+)?["“]?(.+?)["”]?(?:\s+instead)?[.!]?$/i);
    if (name) changes.title = name[1];
    const est = text.match(/\b(\d{1,3})\s*(min|minutes|hours?|h)\b/i);
    if (est) changes.estimate_minutes = est[2].toLowerCase().startsWith("h") ? Number(est[1]) * 60 : Number(est[1]);
    const due = name ? null : parseDue(text, now);
    if (due) changes.due_at = due.iso;
    const r = await call("revise_action", { action_id: pending.id, changes });
    reply = r.ok ? "Updated the card. Tap Approve when it looks right." : r.summary;
  } else if (addTask) {
    const words = addTask[1];
    const due = parseDue(words, now);
    const est = words.match(/\b(\d{1,3})\s*(min|minutes|hours?|h)\b/i);
    const title = (due ? words.replace(new RegExp(`\\s*(?:due\\s+|by\\s+|on\\s+)?${due.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "") : words).replace(/\s+for\s+\d.*$/, "").trim() || words;
    await step("search_items", { query: title.slice(0, 60) });
    const r = await call("create_task", {
      title,
      due_at: due?.iso ?? null,
      due_is_hard: /\bhard deadline\b/i.test(text) ? true : null,
      estimate_minutes: est ? (est[2].toLowerCase().startsWith("h") ? Number(est[1]) * 60 : Number(est[1])) : null,
      user_command: text.slice(0, 300),
    });
    reply = !r.ok ? r.summary : r.actionId ? "Here it is. Approve it and I'll add it, or tell me what to change." : `${r.summary.split(":")[0]}.`;
  } else if (dropTask) {
    const { data: task } = await ctx.db.from("tasks").select("id,title").ilike("title", `%${dropTask[2].replace(/[%_\\]/g, "\\$&")}%`).neq("status", "cancelled").limit(1).maybeSingle();
    if (!task) {
      reply = `I couldn't find a task called “${dropTask[2]}”.`;
    } else {
      const r = /cancel/i.test(dropTask[1]) ? await call("update_task", { id: task.id, status: "cancelled" }) : await call("delete_item", { table: "tasks", id: task.id });
      reply = r.ok ? (r.actionId ? `That needs your OK first, so it's on the card below.` : r.summary) : r.summary;
    }
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
      reply = "Noted. (The simulator only understands brain dumps, “add a task to…”, “cancel/delete …”, “plan my day/week”, “my plan broke…”, and “remember that…”.)";
    }
  }

  await recordUsage({ userId: req.ctx.userId, provider: "devsim", model: "devsim", role: req.role, purpose: req.purpose, costUsd: 0 });
  const full = `${SIM_LABEL} ${reply}`;
  if (req.onEvent) {
    for (const delta of wordGroups(full)) {
      emit({ type: "text", delta, segment: 0 });
      if (live) await pause(30 + Math.random() * 30);
    }
  }
  return { text: full, toolEvents: events, mutated, model: "devsim", simulated: true, costUsd: 0 };
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
  // The area of a phrase, falling back to the sentence it was said in.
  const areaIn = (excerpt: string) => areaFor(excerpt) ?? areaFor(all.split(/(?<=[.!?\n])\s*/).find((sen) => sen.includes(excerpt)) ?? "");
  const goals = extractGoals(all);
  goals.forEach((g, i) => {
    items.push({ kind: "goal", payload: { title: g.title, workspace_ref: refOf(areaIn(g.excerpt)) }, ref_key: `goal_${i}`, source_excerpt: g.excerpt, origin: "stated", confidence: 0.7, rationale: "A goal you described." });
  });
  for (const p of extractProjects(all)) {
    const area = areaIn(p.excerpt);
    // Link to a goal only when exactly one goal shares the project's area.
    const sameArea = goals.map((g, i) => ({ g, i })).filter(({ g }) => areaIn(g.excerpt) === area);
    items.push({
      kind: "project",
      payload: { name: p.name, workspace_ref: refOf(area), ...(area && sameArea.length === 1 ? { goal_ref: `goal_${sameArea[0].i}` } : {}) },
      source_excerpt: p.excerpt,
      origin: "stated",
      confidence: 0.6,
      rationale: "Something you said you're working on.",
    });
  }
  const routines = extractRoutines(all);
  for (const r of routines) {
    items.push({
      kind: "routine",
      payload: { title: r.title, days: r.days, start_time: r.start_time, duration_minutes: 45, is_fixed: false, workspace_ref: refOf(areaIn(r.excerpt)) },
      source_excerpt: r.excerpt,
      origin: "stated",
      confidence: 0.6,
      rationale: "A habit you described; length assumed 45 minutes and the time can flex.",
    });
  }
  const coveredElsewhere = [...goals, ...routines].map((x) => x.excerpt.toLowerCase());
  const availability = extractAvailability(all);
  const quiet = all.toLowerCase().match(/quiet\s+(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const pref: Record<string, unknown> = {};
  const name = extractName(all);
  if (name) pref.display_name = name;
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
    items.push({ kind: "preference", payload: pref, origin: "stated", confidence: 0.7, rationale: name ? "Your name, availability and quiet hours." : "Your availability and quiet hours." });
  }
  for (const t of extractItems(all, now).filter((i) => i.kind === "task" && !/\b(free|quiet)\b/i.test(i.excerpt))) {
    if (extractWeeklyCommitments(t.excerpt).length) continue;
    if (coveredElsewhere.some((c) => t.excerpt.toLowerCase().includes(c) || c.includes(t.excerpt.toLowerCase()))) continue;
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

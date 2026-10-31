#!/usr/bin/env node
// Benchmarks a few representative Navi AI operations against the REAL
// Anthropic API for quality, latency and cost (spec §5).
//
//   node scripts/bench-ai.mjs                # every operation once
//   node scripts/bench-ai.mjs --runs 3       # repeat each operation (max 10)
//   node scripts/bench-ai.mjs --only capture,chat
//   node scripts/bench-ai.mjs --json         # machine-readable output
//   node scripts/bench-ai.mjs --yes          # allow a worst case above $0.10
//   node scripts/bench-ai.mjs --no-record    # don't touch any database
//
// What is real and what is a fixture:
// - System prompts are the app's own (imported from src/server/ai/prompts.ts).
// - Models are the app's roles: fast = NAVI_MODEL_FAST || claude-haiku-5-5,
//   planner = NAVI_MODEL_PLANNER || claude-sonnet-5-5 (same overrides as
//   src/lib/env.ts), with the same call shape as src/server/ai/agent.ts
//   (beta messages API, cached system prompt, effort low/medium, auto tool
//   choice). The planner's server-side refusal fallback is not used here.
// - Tool DEFINITIONS are hand-written mirrors of the app's (tools.ts imports
//   server-only and the database, so it can't load in plain Node). Keep them
//   in step with src/server/ai/tools.ts when those change.
// - Tool RESULTS and the "current state" context are fixed fixtures for a
//   fictional user (America/New_York, "now" = Wed 2026-11-04 10:00 -05:00).
//   Nothing is written anywhere; no user data is involved.
// - Quality checks are deterministic (tool called with valid input, expected
//   items and weekday numbers, no invented times, answer grounded in the tool
//   result). Capture output is checked BEFORE the app's time guard runs, so a
//   failure here means the model alone invented a time.
//
// Spend: worst case = every step of every op using its full max_tokens, with
// input estimated from prompt size. Refuses above $0.10 unless --yes. Like
// smoke-ai, it checks and records to ai_usage (purpose "benchmark") when
// Supabase is configured, and refuses if today's $2 testing budget can't cover
// the worst case. To keep a hosted database out of it, run with the hosted
// Supabase variables unset (then .env.local's local stack is used) or with
// --no-record. Keys are read from the environment or .env.local, never printed.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const env = process.env;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const RUNS = Math.max(1, Math.min(10, Number(option("--runs") ?? 1) || 1));
const ONLY = option("--only")?.split(",").map((s) => s.trim());
const JSON_OUT = flag("--json");
const WORST_CASE_CAP_USD = 0.1;
const log = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a));

const MODELS = {
  fast: env.NAVI_MODEL_FAST || "claude-haiku-5-5",
  planner: env.NAVI_MODEL_PLANNER || "claude-sonnet-5-5",
};

// Same table as src/server/ai/config.ts (USD per 1M tokens); unknown models
// are priced at the fallback so estimates err on the safe side.
const TOKEN_PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const FALLBACK_PRICE = { input: 10, output: 50 };
function tokenCost(model, u) {
  const p = TOKEN_PRICES[model] ?? FALLBACK_PRICE;
  return (
    (u.input * p.input + u.output * p.output + (u.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input * 1.25)) /
    1e6
  );
}

// The app's real system prompts. prompts.ts is plain template strings, so
// Node loads it directly; silence the one "module type" notice it triggers.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w?.message ?? w).includes("Module type of") ? undefined : emitWarning.call(process, w, ...rest));
const { CAPTURE_SYSTEM, CHAT_SYSTEM, ONBOARDING_SYSTEM } = await import("../src/server/ai/prompts.ts");
process.emitWarning = emitWarning;

// ---------------------------------------------------------------------------
// Tool definitions (mirrors of src/server/ai/tools.ts)
// ---------------------------------------------------------------------------
const KINDS = ["workspace", "project", "goal", "routine", "event", "task", "reminder", "note", "question", "memory", "preference"];
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const TOOL_DEFS = {
  get_overview: {
    description:
      "Read the user's current state: time, availability, workspaces, goals, projects, routines, fixed events for the next 7 days, today's and tomorrow's plan, open tasks (with ids), inbox and approvals. Call this before acting on existing items.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  get_plan: {
    description:
      "Read what's on any day or range of days, in the user's time zone: fixed events (weekly ones included), routines that occur that day, planned work blocks with their status, and tasks due that day. Read-only. Use for questions like 'what's on tomorrow?', 'am I free Saturday?', 'what's my week look like?'.",
    input_schema: {
      type: "object",
      properties: {
        date: { ...nullable({ type: "string", pattern: "^(\\d{4}-\\d{2}-\\d{2}|today|tomorrow)$" }), description: "First local date: YYYY-MM-DD, 'today' or 'tomorrow' (default today)" },
        days: { ...nullable({ type: "integer", minimum: 1, maximum: 14 }), description: "Number of days starting at date (default 1, max 14)" },
      },
      additionalProperties: false,
    },
  },
  get_review: {
    description:
      "Read how the user did, computed by Navi's code from what was recorded: kind 'day' gives a day's completion rating with its explanation, counts, focus minutes, findings and plan disruptions; kind 'week' gives the 7 days ending on date: average and per-day completion, estimate accuracy, repeatedly avoided tasks, project/goal progress, planned vs done minutes, disruptions, next week's deadlines and work vs free time, and findings. Read-only. Use it for 'how did I do today/yesterday/this week?', ratings, streaks or patterns, and quote its numbers.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["day", "week"], description: "'day' for one day, 'week' for the 7 days ending on date" },
        date: { ...nullable({ type: "string", pattern: "^(\\d{4}-\\d{2}-\\d{2}|today|yesterday)$" }), description: "Local date (default today); for 'week', the last day of the week" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  plan_week: {
    description: "Re-plan the next 7 days of flexible work.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  propose_items: {
    description:
      "Put NEW items you inferred from what the user said into their review inbox (they become real only when the user accepts them). Use this for anything from brain dumps, casual mentions, or onboarding. Preserve the user's words in source_excerpt and be honest about origin and confidence.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: KINDS },
              payload: {
                type: "object",
                additionalProperties: {},
                description:
                  "Fields for the item. workspace:{name,description}; goal:{title,why,measure,target_date,workspace_ref}; project:{name,objective,due_date,workspace_ref,goal_ref}; routine:{title,days[0-6],start_time HH:MM|null,duration_minutes,is_fixed,workspace_ref,goal_ref}; event:{title,starts_at,ends_at,recurrence{freq:'weekly',days,until}|null,location,workspace_ref}; task/reminder:{title,notes,priority 1-4,due_at,due_is_hard,estimate_minutes,workspace_ref,project_ref,goal_ref}; note:{title,body}; question:{question}; memory:{kind:profile|project|episodic|behavioral,content,origin:'stated'|'inferred'}; preference:{display_name (what the user wants to be called),timezone,quiet_hours_start,quiet_hours_end,morning_briefing_time,evening_review_time,availability[{days,start,end}]}. Use *_ref to point at another proposal's ref_key in the same call, or at an existing item's id. Weekday numbers everywhere (days, recurrence.days, availability days): 0=Sunday, 1=Monday ... 6=Saturday; weekdays = [1,2,3,4,5]. Date-times are local wall-clock time with the user's UTC offset (8 AM in New York in winter = ...T08:00:00-05:00), never Z unless the user's time zone is UTC.",
              },
              ref_key: { ...nullable({ type: "string", maxLength: 60 }), description: "Short unique key so other proposals can reference this one, e.g. 'ws_school'" },
              source_excerpt: { ...nullable({ type: "string", maxLength: 1000 }), description: "The user's exact words this came from" },
              origin: { type: "string", enum: ["stated", "inferred"], description: "stated = the user said it explicitly; inferred = your interpretation" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              rationale: { ...nullable({ type: "string", maxLength: 500 }), description: "Why you propose this, briefly" },
            },
            required: ["kind", "payload", "origin", "confidence"],
            additionalProperties: false,
          },
        },
        batch: nullable({ type: "string", enum: ["onboarding", "capture"] }),
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  mark_onboarding_ready: {
    description: "Onboarding only: call after proposing the user's initial setup with propose_items(batch='onboarding') so the review screen opens.",
    input_schema: { type: "object", properties: { summary: { type: "string", maxLength: 1000 } }, required: ["summary"], additionalProperties: false },
  },
};
const toolsNamed = (...names) => names.map((name) => ({ name, ...TOOL_DEFS[name] }));

// ---------------------------------------------------------------------------
// Fixtures: a fictional user, "now" = Wednesday 2026-11-04 10:00 in New York
// ---------------------------------------------------------------------------
const NOW_LINE = "User's local time: Wednesday 2026-11-04 10:00 -05:00";
const STATE = `Time zone: America/New_York (UTC offset -05:00 this week). Quiet hours 23:00–07:00.
Availability: weekdays 09:00–12:00 and 19:00–22:00; weekends 10:00–18:00.
Workspaces: School [ws-1], Soccer [ws-2].
Goals: Get into a summer research program (target 2026-12-01) [g-1].
Fixed events next 7 days: Soccer practice Tue & Thu 16:00–18:00 (weekly) [ev-1].
Today's plan (Wed Nov 4): 10:30–12:00 Bio lab report (focus) [pb-1]; 19:00–20:00 Research program essay outline [pb-2].
Open tasks: Bio lab report, due Fri Nov 6 23:59 (hard) [t-1]; Research essay draft, est. 4h, due Fri Nov 6 23:59 [t-2]; Read ch. 7 for orgo, est. 1h [t-3]; Research application personal statement, est. 4h, due Wed Nov 25 [t-4].
Review inbox: empty.`;
const context = (mode) => `Mode: ${mode}.\nCurrent state (a snapshot taken at the start of this turn; call the read tools for other dates or anything that may have changed since):\n${STATE}\n\nWhat you remember about the user:\n- (profile, stated) Junior, biology major; plays club soccer.\n${NOW_LINE}`;

const TODAY_PLAN = `Wed Nov 4 (today):
  - 10:30–12:00 Bio lab report (planned focus block, not started)
  - 13:00–13:30 Email Prof Chen about the extension (planned, flexible)
  - 19:00–20:00 Research program essay outline (planned, flexible)
  Tasks due today: none.`;
const WEEK_PLAN = `${TODAY_PLAN}
Thu Nov 5:
  - 09:00–11:00 Bio lab report (planned)
  - 16:00–18:00 Soccer practice (fixed event)
  - 19:00–21:00 Research essay draft (planned, moved here by the replan)
Fri Nov 6:
  - 09:00–11:00 Research essay draft (planned)
  Tasks due: Bio lab report 23:59 (hard); Research essay draft 23:59. 2h of the essay draft are not scheduled before its deadline.
Sat Nov 7:
  - 10:00–12:00 Research application personal statement (planned)
  - 14:00–15:00 Research application personal statement (planned)
Sun Nov 8:
  - 10:00–12:00 Research application personal statement (planned)
Not scheduled this week: Read ch. 7 for orgo (1h).
Mon Nov 9 – Tue Nov 10: Soccer practice Tue 16:00–18:00 (fixed event); no planned blocks yet.`;
const CANNED = {
  get_overview: { ok: true, summary: "Read the overview", data: STATE },
  get_plan: (input) =>
    (input?.days ?? 1) === 1 && [undefined, null, "today", "2026-11-04"].includes(input?.date)
      ? { ok: true, summary: "Read the plan for today", data: TODAY_PLAN }
      : { ok: true, summary: "Read the plan for this week", data: WEEK_PLAN },
  get_review: { ok: true, summary: "Week review", data: { planned_blocks: 9, done: 4, skipped: 2, unmarked: 3, findings: ["Two evening blocks were skipped this week (reason: tired)."] } },
  plan_week: {
    ok: true,
    summary:
      "Planned 7 days: 8 blocks placed. Research essay draft (4h) only fits 2h before its Fri deadline; Read ch. 7 for orgo didn't fit this week. Soccer practice (fixed) untouched.",
    data: [
      { date: "2026-11-04", blocks: 3, moved: [], unscheduled: [], warnings: [] },
      { date: "2026-11-05", blocks: 2, moved: ["Research essay draft 19:00–21:00"], unscheduled: [], warnings: [] },
      { date: "2026-11-06", blocks: 1, moved: [], unscheduled: ["Research essay draft (remaining 2h)"], only_after_deadline: ["Research essay draft"], warnings: ["Bio lab report and essay both due Fri"] },
      { date: "2026-11-07", blocks: 2, moved: [], unscheduled: [], warnings: [] },
      { date: "2026-11-08", blocks: 1, moved: [], unscheduled: ["Read ch. 7 for orgo"], warnings: [] },
    ],
  },
  propose_items: (input) => ({ ok: true, summary: `Added ${input?.items?.length ?? 0} items to the review inbox` }),
  mark_onboarding_ready: { ok: true, summary: "Setup is ready for the user to review" },
};

// ---------------------------------------------------------------------------
// Deterministic quality helpers
// ---------------------------------------------------------------------------
function proposalProblems(items) {
  if (!Array.isArray(items) || !items.length) return ["no items"];
  return items.flatMap((it, n) => {
    const p = [];
    if (!KINDS.includes(it?.kind)) p.push(`item ${n + 1}: bad kind ${it?.kind}`);
    if (!it?.payload || typeof it.payload !== "object" || Array.isArray(it.payload)) p.push(`item ${n + 1}: payload not an object`);
    if (!["stated", "inferred"].includes(it?.origin)) p.push(`item ${n + 1}: bad origin`);
    if (typeof it?.confidence !== "number" || it.confidence < 0 || it.confidence > 1) p.push(`item ${n + 1}: bad confidence`);
    return p;
  });
}
const DATE_FIELDS = ["due_at", "starts_at", "ends_at"];
const textOf = (it) => `${it.payload?.title ?? it.payload?.name ?? ""} ${it.source_excerpt ?? ""}`.toLowerCase();
const clock = (iso) => (typeof iso === "string" ? iso.match(/T(\d{2}:\d{2})/)?.[1] : undefined);
/** Times of day mentioned in a reply, as minutes after midnight (bare HH:MM counts as either half of the day). */
function timesIn(text) {
  const out = [];
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/gi)) {
    const h = (Number(m[1]) % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    out.push({ said: m[0], options: [h * 60 + Number(m[2] ?? 0)] });
  }
  for (const m of text.replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, "").matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const h = Number(m[1]);
    out.push({ said: m[0], options: [h * 60 + Number(m[2]), ((h % 12) + 12) * 60 + Number(m[2])] });
  }
  return out;
}
function inventedTimes(text, allowedHHMM) {
  const allowed = new Set(allowedHHMM.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))));
  return timesIn(text).filter((t) => !t.options.some((o) => allowed.has(o))).map((t) => t.said);
}
/** Every clock time the fixtures give the model; a reply may only use these. */
const FIXTURE_TIMES = [...new Set(JSON.stringify([STATE, WEEK_PLAN, CANNED]).match(/\b\d{2}:\d{2}\b/g))];
const check = (name, pass, detail = "") => ({ name, pass: Boolean(pass), detail });
const callsTo = (r, name) => r.toolCalls.filter((c) => c.name === name);
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
const CAPTURE_TEXT =
  "ugh ok brain dump: finish the orgo problem set by friday!! call mom sometime this weekend. dentist tuesday 3pm. buy printer ink. maybe start running again like 3x a week? ask prof chen about the extension";

const OPS = [
  {
    id: "capture",
    label: "Messy capture → proposals",
    role: "fast",
    system: CAPTURE_SYSTEM,
    context: context("capture"),
    tools: toolsNamed("get_overview", "get_plan", "propose_items"),
    messages: [{ role: "user", content: `Captured (typed): ${CAPTURE_TEXT}` }],
    maxSteps: 2,
    outputBudget: 2500,
    stopAfter: "propose_items",
    checks(r) {
      const calls = callsTo(r, "propose_items");
      const items = calls[0]?.input?.items ?? [];
      const problems = proposalProblems(items);
      const dentist = items.find((i) => /dentist/.test(textOf(i)));
      const pset = items.find((i) => /problem set|pset/.test(textOf(i)));
      const missing = ["problem set", "mom", "dentist", "ink", "run", "chen"].filter((w) => !items.some((i) => textOf(i).includes(w)));
      const invented = items
        .filter((i) => i !== dentist)
        .flatMap((i) => [...DATE_FIELDS.map((f) => i.payload?.[f]), i.payload?.start_time].filter((v) => typeof v === "string" && v).map((v) => [textOf(i).trim().slice(0, 30), v]))
        .filter(([, v]) => {
          const c = /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : clock(v);
          return c && c !== "23:59" && c !== "00:00";
        });
      return [
        check("propose_items called once", calls.length === 1, `${calls.length} call(s)`),
        check("valid proposal shape", !problems.length, problems.slice(0, 3).join("; ")),
        check("all 6 things captured", !missing.length, `${items.length} items (${items.map((i) => i.kind).join(",")})${missing.length ? `; missing: ${missing.join(", ")}` : ""}`),
        check("problem set due Fri 2026-11-06", /^2026-11-06/.test(pset?.payload?.due_at ?? ""), `${pset?.kind} ${pset?.payload?.due_at}`),
        check("dentist = event Tue 2026-11-10 15:00 -05:00", dentist?.kind === "event" && /^2026-11-10T15:00(:00)?-05:00$/.test(dentist?.payload?.starts_at ?? ""), `${dentist?.kind} ${dentist?.payload?.starts_at}`),
        check("no invented times", !invented.length, invented.map(([t, v]) => `${t}: ${v}`).join("; ")),
      ];
    },
  },
  {
    id: "chat",
    label: "Short chat answer",
    role: "fast",
    system: CHAT_SYSTEM,
    context: context("chat"),
    tools: toolsNamed("get_overview", "get_plan", "propose_items"),
    messages: [{ role: "user", content: "what's left on my plan today?" }],
    maxSteps: 2,
    outputBudget: 1000,
    checks(r) {
      const t = r.text;
      const bad = inventedTimes(t, FIXTURE_TIMES);
      return [
        check("read the plan (get_plan/overview)", callsTo(r, "get_plan").length + callsTo(r, "get_overview").length > 0, r.toolCalls.map((c) => c.name).join(",") || "no tools"),
        check("no writes", !callsTo(r, "propose_items").length),
        check("mentions all 3 blocks", /lab report/i.test(t) && /chen/i.test(t) && /essay|outline/i.test(t)),
        check("no invented times", !bad.length, bad.join(", ")),
        check("short (≤120 words)", wordCount(t) <= 120, `${wordCount(t)} words`),
      ];
    },
  },
  {
    id: "plan-week",
    label: "Week planning reasoning",
    role: "planner",
    system: CHAT_SYSTEM,
    context: context("chat"),
    tools: toolsNamed("get_plan", "get_review", "plan_week"),
    messages: [{ role: "user", content: "I'm overwhelmed and behind this week. Can you replan my week realistically?" }],
    maxSteps: 3,
    outputBudget: 1600,
    checks(r) {
      const t = r.text;
      const bad = inventedTimes(t, FIXTURE_TIMES);
      // Sentences about the orgo reading, which the planner could NOT place this week.
      const orgo = t.split(/(?<=[!?]|(?<!\bch)\.)\s+(?=[A-Z*])|\n+/).filter((x) => /orgo|ch(apter|\.)? ?7/i.test(x));
      return [
        check("called plan_week", callsTo(r, "plan_week").length === 1, r.toolCalls.map((c) => c.name).join(",") || "no tools"),
        check("final answer given", t.length > 0, r.stopReason),
        check("flags essay shortfall", /essay/i.test(t) && /(2 ?h|two hours|half|doesn'?t (all )?fit|didn'?t fit|won'?t fit|not enough|short|only fits)/i.test(t)),
        check("orgo reading reported as NOT scheduled", orgo.length && !orgo.some((x) => /\b(set|scheduled|planned|placed|slotted|booked|moved)\b/i.test(x) && !/\bnot\b|\bno\b|n't\b|unscheduled|\bwithout\b/i.test(x)), orgo.join(" | ").slice(0, 160)),
        check("no invented times", !bad.length, bad.join(", ")),
      ];
    },
  },
  {
    id: "onboarding",
    label: "Onboarding turn → setup",
    role: "planner",
    system: ONBOARDING_SYSTEM,
    context: `Mode: onboarding.\nCurrent state: new user, nothing set up yet. Browser time zone: America/New_York (UTC offset -05:00 this week).\n\nWhat you remember about the user:\n(none yet)\n${NOW_LINE}`,
    tools: toolsNamed("get_overview", "propose_items", "mark_onboarding_ready"),
    messages: [
      { role: "user", content: "hi, I'm Sam" },
      { role: "assistant", content: "Hi Sam! What are the main areas of your life right now: school, work, sports, side projects?" },
      {
        role: "user",
        content:
          "I'm a junior in college, bio major. I play club soccer, practice is Tuesdays and Thursdays 4 to 6pm. I'm also building a small app with a friend on weekends. Big goal: get into a summer research program, applications due Dec 1.",
      },
      { role: "assistant", content: "Got it. When are you usually free for focused work, and when should I stay quiet?" },
      { role: "user", content: "Weekdays I'm free 9 to 12 and 7 to 10pm. Weekends whenever. Don't bug me 11pm to 7am. I'm in New York." },
      { role: "assistant", content: "Thanks. Anything coming up soon that needs doing?" },
      { role: "user", content: "Bio lab report due Friday, and I need to ask Prof Chen for a recommendation letter. That's about it, go ahead and set it up." },
    ],
    maxSteps: 2,
    outputBudget: 2700,
    stopAfter: "mark_onboarding_ready",
    checks(r) {
      const call = callsTo(r, "propose_items")[0];
      const items = call?.input?.items ?? [];
      const problems = proposalProblems(items);
      const practice = items.find((i) => i.kind === "event" && /soccer|practice/.test(textOf(i)));
      const pref = items.find((i) => i.kind === "preference")?.payload ?? {};
      const lab = items.find((i) => /lab report/.test(textOf(i)));
      const refs = new Set(items.map((i) => i.ref_key).filter(Boolean));
      const dangling = items.flatMap((i) => Object.entries(i.payload ?? {}).filter(([k, v]) => k.endsWith("_ref") && v && !refs.has(v)).map(([k, v]) => `${k}=${v}`));
      const labClock = clock(lab?.payload?.due_at);
      return [
        check("propose_items(batch=onboarding)", call && call.input?.batch === "onboarding", call ? `batch=${call.input?.batch}` : "not called"),
        check("valid proposal shape", items.length && !problems.length, problems.slice(0, 3).join("; ")),
        check("has workspaces + goal", items.some((i) => i.kind === "workspace") && items.some((i) => i.kind === "goal"), items.map((i) => i.kind).join(",")),
        check(
          "practice weekly Tue/Thu [2,4] 16:00 -05:00",
          JSON.stringify(practice?.payload?.recurrence?.days) === "[2,4]" && /T16:00(:00)?-05:00$/.test(practice?.payload?.starts_at ?? ""),
          `${JSON.stringify(practice?.payload?.recurrence?.days)} ${practice?.payload?.starts_at}`,
        ),
        check("preference: tz + quiet 23:00–07:00", pref.timezone === "America/New_York" && /^23:00/.test(pref.quiet_hours_start ?? "") && /^0?7:00/.test(pref.quiet_hours_end ?? ""), `${pref.timezone} ${pref.quiet_hours_start}–${pref.quiet_hours_end}`),
        check("display_name Sam", pref.display_name === "Sam", String(pref.display_name)),
        check("lab report due Fri, no invented time", lab && (!labClock || labClock === "23:59") && /^2026-11-06/.test(lab.payload?.due_at ?? ""), String(lab?.payload?.due_at)),
        check("*_refs resolve", !dangling.length, dangling.join(", ")),
        check("mark_onboarding_ready called", callsTo(r, "mark_onboarding_ready").length === 1),
      ];
    },
  },
].filter((op) => !ONLY || ONLY.includes(op.id));

// ---------------------------------------------------------------------------
// Budget (same approach as smoke-ai.mjs)
// ---------------------------------------------------------------------------
async function supabase() {
  if (flag("--no-record") || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const budgetDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: env.NAVI_BUDGET_TIMEZONE || "UTC" }).format(new Date());
async function checkBudget(db, worstCase) {
  if (!db) return log("Budget: no database configured (or --no-record); today's usage not checked or recorded.");
  const cap = Number(env.NAVI_DAILY_BUDGET_USD || 2);
  const { data, error } = await db.from("ai_usage").select("cost_usd").eq("budget_day", budgetDay());
  if (error) throw new Error(`Couldn't read today's AI usage (${error.message}); use --no-record to run without the budget check.`);
  const spent = (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  if (spent + worstCase > cap) throw new Error(`Today's AI testing budget can't cover this run ($${spent.toFixed(4)} of $${cap} used, worst case $${worstCase.toFixed(4)}).`);
  log(`Budget today: $${spent.toFixed(4)} of $${cap} used (recording on ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname}).`);
}
async function record(db, row) {
  if (!db) return;
  const { error } = await db.from("ai_usage").insert({ ...row, provider: "anthropic", purpose: "benchmark", budget_day: budgetDay() });
  if (error) log(`  (couldn't record usage: ${error.message})`);
}

const estTokens = (v) => Math.ceil(JSON.stringify(v).length / 3); // ~3 chars per token
// The API adds its own tool-use instructions; measured 2026-10-31, chars/3 + 700 >= real input (largest gap seen: 689).
const TOOL_OVERHEAD_TOKENS = 700;
const CANNED_RESULT_TOKENS = Math.max(...Object.values(CANNED).map((c) => estTokens(typeof c === "function" ? c({ items: [] }) : c)));
/**
 * Each op has a step limit and one output-token budget shared by its steps
 * (each step's max_tokens is what's left). Worst case: the whole budget is
 * spent in the first step and re-read as input by every later step, each of
 * which also adds a tool result. Prompt caching is ignored (it only lowers cost).
 */
function worstCaseUsd(op) {
  const model = MODELS[op.role];
  const base = estTokens([op.system, op.context, op.tools, op.messages]) + TOOL_OVERHEAD_TOKENS;
  let input = 0;
  for (let i = 0; i < op.maxSteps; i++) input += base + (i ? op.outputBudget + i * CANNED_RESULT_TOKENS : 0);
  return tokenCost(model, { input, output: op.outputBudget });
}

// ---------------------------------------------------------------------------
// Runner: the agent loop of src/server/ai/agent.ts with canned tool results
// ---------------------------------------------------------------------------
async function runOp(client, db, op) {
  const model = MODELS[op.role];
  const messages = [...op.messages];
  const r = { toolCalls: [], text: "", steps: 0, latencyMs: 0, ttftMs: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, stopReason: "", servedModel: model };
  for (let step = 0; step < op.maxSteps; step++) {
    const maxTokens = op.outputBudget - r.output;
    if (maxTokens < 64) break;
    r.steps++;
    const started = performance.now();
    let first = null;
    const stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: op.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: op.context },
      ],
      tools: op.tools,
      messages,
      output_config: { effort: op.role === "fast" ? "low" : "medium" },
    });
    for await (const ev of stream) if (first === null && ev.type === "content_block_delta") first = performance.now() - started;
    const res = await stream.finalMessage();
    r.latencyMs += performance.now() - started;
    if (r.ttftMs === null) r.ttftMs = first;
    const u = { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 };
    const cost = tokenCost(model, u);
    r.input += u.input + u.cacheRead + u.cacheWrite;
    r.output += u.output;
    r.cacheRead += u.cacheRead;
    r.cacheWrite += u.cacheWrite;
    r.costUsd += cost;
    r.stopReason = res.stop_reason;
    r.servedModel = res.model ?? model;
    await record(db, { model, role: op.role, input_tokens: u.input, output_tokens: u.output, cached_input_tokens: u.cacheRead, cost_usd: cost });

    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) r.text = text;
    const uses = res.content.filter((b) => b.type === "tool_use");
    for (const use of uses) r.toolCalls.push({ name: use.name, input: use.input });
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    if (op.stopAfter && uses.some((u2) => u2.name === op.stopAfter)) break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: uses.map((use) => {
        const canned = CANNED[use.name];
        const result = typeof canned === "function" ? canned(use.input) : (canned ?? { ok: false, summary: `Unknown tool ${use.name}` });
        return { type: "tool_result", tool_use_id: use.id, is_error: !result.ok, content: JSON.stringify({ ...result, data: result.data ?? null }) };
      }),
    });
  }
  return r;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const apiKey = env.ANTHROPIC_API_KEY || env.NAVI_ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY (or NAVI_ANTHROPIC_API_KEY) is not set.");
  process.exit(1);
}
if (!OPS.length) {
  console.error(`No operations match --only. Known: capture, chat, plan-week, onboarding.`);
  process.exit(1);
}
const worstCase = OPS.reduce((s, op) => s + worstCaseUsd(op), 0) * RUNS;
log(`Models: fast=${MODELS.fast}, planner=${MODELS.planner}. ${OPS.length} op(s) × ${RUNS} run(s); worst-case cost $${worstCase.toFixed(4)}.`);
if (worstCase > WORST_CASE_CAP_USD && !flag("--yes")) {
  console.error(`Refusing: worst case $${worstCase.toFixed(4)} is above $${WORST_CASE_CAP_USD.toFixed(2)}. Pass --yes to run anyway.`);
  process.exit(2);
}
const db = await supabase();
try {
  await checkBudget(db, worstCase);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey, maxRetries: 2 });
const rows = [];
for (let run = 1; run <= RUNS; run++) {
  for (const op of OPS) {
    let r;
    let checks;
    try {
      r = await runOp(client, db, op);
      checks = op.checks(r);
    } catch (e) {
      r = { error: `${e.status ?? ""} ${e.message}`.trim(), toolCalls: [], costUsd: 0 };
      checks = [check("API call succeeded", false, r.error)];
    }
    const passed = checks.filter((c) => c.pass).length;
    rows.push({ op: op.id, label: op.label, run, role: op.role, model: r.servedModel ?? MODELS[op.role], ...r, checks, passed, total: checks.length });
    log(`  ${op.id} run ${run}: ${passed}/${checks.length} checks, ${Math.round(r.latencyMs ?? 0)} ms, $${r.costUsd.toFixed(5)}`);
  }
}

const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
if (JSON_OUT) {
  console.log(JSON.stringify({ date: new Date().toISOString(), models: MODELS, runs: RUNS, worstCaseUsd: worstCase, totalCostUsd: totalCost, results: rows }, null, 2));
} else {
  const header = ["op", "run", "model", "steps", "ttft ms", "total ms", "in tok", "out tok", "cost $", "quality"];
  const table = rows.map((r) => [
    r.op,
    String(r.run),
    r.model,
    String(r.steps ?? 0),
    r.ttftMs == null ? "-" : String(Math.round(r.ttftMs)),
    String(Math.round(r.latencyMs ?? 0)),
    String(r.input ?? 0),
    String(r.output ?? 0),
    r.costUsd.toFixed(5),
    `${r.passed}/${r.total}${r.passed === r.total ? " PASS" : " FAIL"}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(`\n${line(header)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`);
  for (const row of table) console.log(line(row));
  console.log(`\nTotal cost: $${totalCost.toFixed(5)} (worst case was $${worstCase.toFixed(4)}). ttft = first streamed content delta of the first step; total = all model steps.`);
  const failures = rows.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `  ${r.op} run ${r.run}: ${c.name}${c.detail ? ` (${c.detail})` : ""}`));
  if (failures.length) console.log(`\nQuality failures:\n${failures.join("\n")}`);
}
process.exit(rows.every((r) => r.passed === r.total) ? 0 : 1);

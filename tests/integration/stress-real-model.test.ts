import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { handleTurn } from "@/server/ai/chat";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Real-user stress scenarios with the real Claude models (2026-11-17): messy
// phrasing, corrections, "did you actually do that?", continuity across turns,
// overdue Canvas backlog. Each scenario is a fresh isolated local test account;
// the verdict comes from the database, never from the reply's wording. The
// reply is only checked for claims the database contradicts.
//
// Mirrors the production account setup: planner v2 on, scheduling commands off,
// autonomy "auto". Skipped unless NAVI_REAL_MODEL_EVAL=1; spend capped by the
// app's own guard (run with NAVI_DAILY_BUDGET_USD=1). Records results to
// NAVI_EVAL_OUT instead of failing on a model miss. Log:
// docs/navi-1.5/STRESS_TEST_LOG.md.

const on = process.env.NAVI_REAL_MODEL_EVAL === "1" && !!(process.env.NAVI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
const only = (process.env.NAVI_STRESS_ONLY ?? "").split(",").filter(Boolean);
const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
// A zone where it is morning, so "today" has room in it whenever this runs.
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 7 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const tomorrow = () => DateTime.now().setZone(zone).plus({ days: 1 }).toISODate()!;
const at = (d: string, hm: string) => DateTime.fromISO(`${d}T${hm}`, { zone });
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");

type Turn = { text: string; reply: string; tools: string[]; error?: string };
type Row = { id: string; category: string; scenario: string; pass: boolean; turns: Turn[]; note: string; costUsd: number };
const results: Row[] = [];

async function blocks(d?: string) {
  let q = me.db.from("plan_blocks").select("*").in("status", ["planned", "in_progress"]).order("starts_at");
  if (d) q = q.eq("plan_date", d);
  return ((await q).data ?? []) as PlanBlock[];
}
async function addTask(values: Record<string, unknown>) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, ...values }).select("id,title").single();
  if (error) throw error;
  return data as { id: string; title: string };
}
async function addBlock(taskId: string, title: string, d: string, start: string, minutes: number, by: "user" | "navi" = "navi") {
  const s = at(d, start);
  const { data, error } = await me.db.from("plan_blocks").insert({ user_id: me.userId, task_id: taskId, title, plan_date: d, starts_at: s.toISO(), ends_at: s.plus({ minutes }).toISO(), is_flexible: true, created_by: by, status: "planned" }).select("*").single();
  if (error) throw error;
  return data as PlanBlock;
}
async function task(id: string) {
  return (await me.db.from("tasks").select("id,title,status,due_at,estimate_minutes").eq("id", id).maybeSingle()).data as { id: string; title: string; status: string; due_at: string | null; estimate_minutes: number | null } | null;
}
async function openTasks(like?: string) {
  let q = me.db.from("tasks").select("id,title,status").in("status", ["todo", "in_progress", "blocked"]);
  if (like) q = q.ilike("title", like);
  return ((await q).data ?? []) as { id: string; title: string; status: string }[];
}
async function spent(): Promise<number> {
  const { data } = await admin().from("ai_usage").select("cost_usd").eq("user_id", me.userId);
  return ((data ?? []) as { cost_usd: number }[]).reduce((s, r) => s + Number(r.cost_usd), 0);
}
async function fresh() {
  await resetUser(me.userId);
  await me.db.from("conversations").delete().eq("user_id", me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, wake_time: "07:00", bed_time: "23:00" } }).eq("id", me.userId);
}
async function canvasBacklog(n: number) {
  const now = DateTime.now();
  await me.db.from("tasks").insert(Array.from({ length: n }, (_, i) => ({ user_id: me.userId, title: `Worksheet ${i + 1} [Chem 101]`, source: "external", external_ref: `ext:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 20) }).toISO(), status: "todo", priority: 2 })));
}

/**
 * "Moved to tomorrow": a block tomorrow, or kept off until tomorrow (the
 * morning plan then places it) with nothing left today.
 */
async function onTomorrow(taskId: string) {
  const block = (await blocks(tomorrow())).some((b) => b.task_id === taskId);
  const nb = (await me.db.from("tasks").select("not_before").eq("id", taskId).single()).data?.not_before as string | null;
  const kept = !!nb && DateTime.fromISO(nb).setZone(zone).toISODate() === tomorrow();
  const today_ = (await blocks(today())).some((b) => b.task_id === taskId);
  return { moved: (block || kept) && !today_, how: block ? "block tomorrow" : kept ? "kept off until tomorrow" : today_ ? "still today" : "unplanned, no date" };
}

async function scenario(
  id: string, category: string, name: string,
  setup: () => Promise<unknown>,
  turns: string[],
  check: (t: Turn[]) => Promise<{ pass: boolean; note: string }>,
) {
  if (only.length && !only.includes(id)) return;
  await fresh();
  await setup();
  const before = await spent();
  let conversationId: string | undefined;
  const done: Turn[] = [];
  for (const text of turns) {
    const r = await handleTurn(user, { kind: "chat", text, modality: "text", conversationId });
    conversationId = r.conversationId;
    done.push({ text, reply: r.assistantMessage.content, tools: r.assistantMessage.tool_events.map((e) => `${e.name}${e.ok === false ? "✗" : ""}`), error: r.error });
    if (r.error) break;
  }
  let c: { pass: boolean; note: string };
  try { c = await check(done); } catch (e) { c = { pass: false, note: `check threw: ${(e as Error).message}` }; }
  if (done.some((t) => t.error)) c = { pass: false, note: `${c.note}; turn error: ${done.find((t) => t.error)!.error}` };
  results.push({ id, category, scenario: name, pass: c.pass, turns: done, note: c.note, costUsd: Math.round(((await spent()) - before) * 10000) / 10000 });
}

describe.skipIf(!on)("real-user stress scenarios with the real model", () => {
  beforeAll(async () => {
    process.env.NAVI_AI_PROVIDER = "anthropic";
    me = await userClient("stress-real-model@navi.test");
    user = ctxFor(me.db, me.userId, zone);
    await admin().from("ai_usage").delete().eq("user_id", me.userId);
  });
  afterAll(async () => {
    const total = await spent();
    const lines = [
      `Real-user stress scenarios: ${results.filter((r) => r.pass).length}/${results.length} as intended, $${total.toFixed(4)} total (local guard $${process.env.NAVI_DAILY_BUDGET_USD}); zone ${zone}, today ${today()}.`,
      "",
      ...results.map((r) => [
        `### ${r.pass ? "PASS" : "MISS"} ${r.id} (${r.category}) ${r.scenario} — $${r.costUsd}`,
        `- state: ${r.note}`,
        ...r.turns.map((t) => `- > ${t.text}\n  - tools: ${t.tools.join(", ") || "none"}${t.error ? ` — error: ${t.error}` : ""}\n  - reply: ${t.reply.replace(/\s+/g, " ").slice(0, 500)}`),
        "",
      ].join("\n")),
    ];
    if (process.env.NAVI_EVAL_OUT) writeFileSync(process.env.NAVI_EVAL_OUT, lines.join("\n") + "\n");
    await resetUser(me.userId);
    await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
    process.env.NAVI_AI_PROVIDER = "devsim";
  });

  it("runs the scenarios within the budget guard", async () => {
    // ── A. Truthfulness ────────────────────────────────────────────────
    await scenario("A1", "truth", "Add, then 'wait did you actually do that?'", async () => {}, [
      "add bio lab report due friday",
      "wait did you actually do that?",
    ], async (t) => {
      const rows = await openTasks("%lab report%");
      const r2 = t[1]?.reply ?? "";
      // The database says turn 1 created it: a reply that denies or retracts that is false.
      const claimsNo = /^\s*no\b|\b(didn'?t|did not|haven'?t|wasn'?t) (add|create|save)|not as a new|already (had|on|in) (it|your|the)|before your message|was misleading/i.test(r2);
      return { pass: rows.length === 1 && !claimsNo, note: `${rows.length} "lab report" task(s); 2nd reply ${claimsNo ? "denies or retracts the (true) add" : "confirms"}` };
    });

    let math = { id: "", title: "" };
    await scenario("A2", "truth", "Delete something that doesn't exist", async () => { math = await addTask({ title: "Math problem set 7", estimate_minutes: 40 }); }, [
      "delete my french essay",
    ], async (t) => {
      const kept = await task(math.id);
      const n = (await me.db.from("tasks").select("id")).data?.length ?? 0;
      const falseClaim = /\b(deleted|removed|gone)\b/i.test(t[0].reply) && !/\b(no|not|couldn'?t|can'?t|don'?t)\b/i.test(t[0].reply);
      return { pass: kept?.status === "todo" && n === 1 && !falseClaim, note: `math ${kept?.status}; ${n} task(s); ${falseClaim ? "claims a deletion" : "no false deletion claim"}` };
    });

    // ── B. Planner intelligence ────────────────────────────────────────
    await scenario("B1", "planner", "'I only have like 30 min today'", async () => {
      await addTask({ title: "English essay draft", estimate_minutes: 60 });
      await addTask({ title: "Spanish vocab", estimate_minutes: 20 });
      await addTask({ title: "Physics reading", estimate_minutes: 45 });
    }, ["I only have like 30 min today, plan it"], async () => {
      const bs = await blocks(today());
      const mins = bs.reduce((s, b) => s + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0);
      return { pass: mins > 0 && mins <= 35, note: `${bs.length} block(s), ${mins} min planned today` };
    });

    let chem = { id: "", title: "" };
    const mine: PlanBlock[] = [];
    await scenario("B2", "planner", "'make room for chem but don't touch my other stuff'", async () => {
      mine.length = 0;
      const a = await addTask({ title: "Robotics club notes", estimate_minutes: 60 });
      const b = await addTask({ title: "History reading", estimate_minutes: 60 });
      mine.push(await addBlock(a.id, a.title, today(), "15:00", 60, "user"), await addBlock(b.id, b.title, today(), "17:00", 60, "user"));
      chem = await addTask({ title: "Chem lab prep", estimate_minutes: 45 });
    }, ["make room for chem today but don't touch my other stuff"], async () => {
      const bs = await blocks(today());
      const untouched = mine.every((m) => bs.some((b) => b.id === m.id && b.starts_at === m.starts_at && b.ends_at === m.ends_at));
      const c = bs.find((b) => b.task_id === chem.id);
      const overlap = c && mine.some((m) => Date.parse(c.starts_at) < Date.parse(m.ends_at) && Date.parse(m.starts_at) < Date.parse(c.ends_at));
      return { pass: untouched && !!c && !overlap, note: `own blocks ${untouched ? "untouched" : "CHANGED"}; chem ${c ? `at ${hm(c.starts_at)}` : "not planned"}${overlap ? " (overlaps!)" : ""}` };
    });

    let rep = { id: "", title: "" };
    await scenario("B3", "planner", "'put this after school unless I have something' (after-school event)", async () => {
      await me.db.from("events").insert({ user_id: me.userId, title: "Dentist", starts_at: at(today(), "15:30").toISO(), ends_at: at(today(), "16:30").toISO(), source: "user", status: "confirmed" });
      rep = await addTask({ title: "Lab report revisions", estimate_minutes: 45 });
    }, ["I need to do my lab report revisions today", "put this after school unless I have something"], async () => {
      const b = (await blocks(today())).find((x) => x.task_id === rep.id);
      const s = b ? Date.parse(b.starts_at) : 0, e = b ? Date.parse(b.ends_at) : 0;
      const clash = b && s < at(today(), "16:30").toMillis() && at(today(), "15:30").toMillis() < e;
      const afterSchool = b && s >= at(today(), "14:30").toMillis();
      return { pass: !!b && !clash && !!afterSchool, note: b ? `revisions at ${hm(b.starts_at)}–${hm(b.ends_at)}${clash ? " (CLASHES with dentist)" : ""}` : "not planned" };
    });

    // ── C. Natural language ────────────────────────────────────────────
    let sp = { id: "", title: "" };
    await scenario("C1", "nlu", "'bro move that thing to tomorrow'", async () => {
      sp = await addTask({ title: "Spanish oral practice", estimate_minutes: 30 });
      await addBlock(sp.id, sp.title, today(), "16:00", 30);
    }, ["whats on my plan today", "bro move that thing to tomorrow"], async () => {
      const m = await onTomorrow(sp.id);
      const st = (await task(sp.id))?.status;
      return { pass: m.moved && st === "todo", note: `spanish: ${m.how}, task ${st}` };
    });

    let ch = { id: "", title: "" }, bi = { id: "", title: "" };
    await scenario("C2", "nlu", "'nah not that one, the other assignment'", async () => {
      ch = await addTask({ title: "Chem worksheet", estimate_minutes: 30 });
      bi = await addTask({ title: "Bio worksheet", estimate_minutes: 30 });
      await addBlock(ch.id, ch.title, today(), "15:00", 30);
      await addBlock(bi.id, bi.title, today(), "16:00", 30);
    }, ["push the chem worksheet to tomorrow", "nah not that one, the other assignment"], async () => {
      const bio = await onTomorrow(bi.id);
      const chem = await onTomorrow(ch.id);
      const chemToday = (await blocks(today())).some((b) => b.task_id === ch.id);
      return { pass: bio.moved && !chem.moved && chemToday, note: `bio: ${bio.how}; chem: ${chem.moved ? `${chem.how} (not put back)` : chemToday ? "back on today" : chem.how}` };
    });

    await scenario("C3", "nlu", "'actually forget what I just said'", async () => {}, ["add a task to call grandma tonight", "actually forget what I just said"], async () => {
      const left = await openTasks("%grandma%");
      return { pass: left.length === 0, note: `${left.length} open "grandma" task(s)` };
    });

    let e1 = { id: "", title: "" }, e2 = { id: "", title: "" }, other = { id: "", title: "" };
    await scenario("C4", "nlu", "'I finished those already'", async () => {
      const soon = DateTime.now().setZone(zone).plus({ days: 2 }).set({ hour: 23, minute: 59 }).toISO();
      e1 = await addTask({ title: "Read Gatsby ch. 5", estimate_minutes: 30, due_at: soon, due_is_hard: true });
      e2 = await addTask({ title: "Gatsby reading quiz", estimate_minutes: 15, due_at: soon, due_is_hard: true });
      other = await addTask({ title: "Start science fair board", estimate_minutes: 90 });
    }, ["what's due in the next couple days?", "I finished those already"], async () => {
      const s1 = (await task(e1.id))?.status, s2 = (await task(e2.id))?.status, s3 = (await task(other.id))?.status;
      return { pass: s1 === "done" && s2 === "done" && s3 === "todo", note: `gatsby ch5 ${s1}, quiz ${s2}, science fair ${s3}` };
    });

    let lit = { id: "", title: "" };
    await scenario("C5", "nlu", "'why is this back on my schedule?' (read-only question)", async () => {
      lit = await addTask({ title: "Lit annotations", estimate_minutes: 30 });
      const y = DateTime.now().setZone(zone).minus({ days: 1 }).toISODate()!;
      const s = at(y, "16:00");
      await me.db.from("plan_blocks").insert({ user_id: me.userId, task_id: lit.id, title: lit.title, plan_date: y, starts_at: s.toISO(), ends_at: s.plus({ minutes: 30 }).toISO(), status: "skipped", outcome_reason: "Ran out of time", created_by: "navi" });
      await addBlock(lit.id, lit.title, today(), "17:00", 30);
    }, ["why is lit annotations back on my schedule?"], async (t) => {
      const still = (await blocks(today())).filter((b) => b.task_id === lit.id).length;
      const st = (await task(lit.id))?.status;
      const changed = t[0].tools.length > 0;
      return { pass: still === 1 && st === "todo" && !changed, note: `block today ${still}, task ${st}; ${changed ? `changed things: ${t[0].tools.join(", ")}` : "nothing changed (a question)"}` };
    });

    // ── D. Continuity ──────────────────────────────────────────────────
    await scenario("D1", "continuity", "Three turns refining one piece of work", async () => {}, [
      "I have a chem test on friday, add 1 hour of study time today",
      "make it 45 min instead",
      "actually put it at 7pm",
    ], async () => {
      const ts = await openTasks("%chem%");
      const bs = (await blocks(today())).filter((b) => ts.some((x) => x.id === b.task_id));
      const b = bs[0];
      const mins = b ? (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000 : 0;
      return { pass: bs.length === 1 && !!b && hm(b.starts_at) === "19:00" && mins === 45, note: `${ts.length} chem task(s), ${bs.length} block(s) today${b ? ` at ${hm(b.starts_at)} for ${mins} min` : ""}` };
    });

    // ── E. Canvas backlog (integration) ────────────────────────────────
    await scenario("E1", "integration", "'what do I have today?' with 30 overdue Canvas items", async () => {
      await canvasBacklog(30);
      await addTask({ title: "PBL presentation slides", estimate_minutes: 60 });
    }, ["what do I have today?"], async (t) => {
      const n = (await me.db.from("tasks").select("id").eq("source", "external").eq("status", "todo")).data?.length ?? 0;
      const planned = (await blocks()).length;
      const dueToday = /30 (things|items|assignments).{0,30}due today/i.test(t[0].reply);
      return { pass: n === 30 && !dueToday, note: `${n}/30 imported still open (no silent changes); ${planned} block(s); ${dueToday ? "calls them due today" : "doesn't call the backlog 'due today'"}` };
    });

    await scenario("E2", "integration", "'I handed all the old canvas stuff in'", async () => {
      await canvasBacklog(25);
      await addTask({ title: "PBL presentation slides", estimate_minutes: 60 });
    }, ["I handed all the old canvas stuff in already"], async () => {
      const open = (await me.db.from("tasks").select("id").eq("source", "external").eq("status", "todo")).data?.length ?? 0;
      const own = (await openTasks("%PBL%")).length;
      return { pass: open === 0 && own === 1, note: `${open} imported still open; own PBL task ${own ? "kept" : "GONE"}` };
    });

    expect(results.length).toBeGreaterThan(0);
  }, 1_200_000);
});

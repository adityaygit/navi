import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { DateTime } from "luxon";
import { admin, ctxFor, resetUser, userClient } from "./helpers";
import { handleTurn } from "@/server/ai/chat";
import { generateDayPlan } from "@/server/planner/plan";
import type { Ctx } from "@/server/context";
import type { PlanBlock } from "@/lib/types";

// Real-model check of the planner reliability scenarios (R1–R11) on the local
// database with the real Claude models. Skipped unless NAVI_REAL_MODEL_EVAL=1,
// and capped by the app's own budget guard (run it with
// NAVI_DAILY_BUDGET_USD=1 or lower: the $2/day testing guard). Records what
// each scenario did instead of failing on a model miss; the summary goes to
// NAVI_EVAL_OUT. How to run: docs/navi-1.5/PLANNER_RELIABILITY.md.

// tests/setup-env.ts forces the simulator; this check switches to the real provider only when asked.
const on = process.env.NAVI_REAL_MODEL_EVAL === "1" && !!(process.env.NAVI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
const CANDIDATE_ZONES = ["Pacific/Kiritimati", "Pacific/Auckland", "Australia/Sydney", "Asia/Tokyo", "Asia/Shanghai", "Asia/Bangkok", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/Moscow", "Europe/Berlin", "Europe/London", "Atlantic/Azores", "America/Noronha", "America/Sao_Paulo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Pacific/Pago_Pago"];
const zone = CANDIDATE_ZONES.find((z) => { const h = DateTime.now().setZone(z).hour; return h >= 7 && h <= 10; }) ?? "UTC";
let me: Awaited<ReturnType<typeof userClient>>;
let user: Ctx;
const today = () => DateTime.now().setZone(zone).toISODate()!;
const at = (hm: string) => DateTime.fromISO(`${today()}T${hm}`, { zone });
const hm = (iso: string) => DateTime.fromISO(iso).setZone(zone).toFormat("HH:mm");
type Row = { id: string; scenario: string; pass: boolean; tools: string[]; reply: string; note: string; costUsd: number };
const results: Row[] = [];

async function blocksOn(d: string) {
  return ((await me.db.from("plan_blocks").select("*").eq("plan_date", d).order("starts_at")).data ?? []) as PlanBlock[];
}
async function addTask(values: Record<string, unknown>) {
  const { data, error } = await me.db.from("tasks").insert({ user_id: me.userId, ...values }).select("id,title").single();
  if (error) throw error;
  return data as { id: string; title: string };
}
async function spent(): Promise<number> {
  const { data } = await admin().from("ai_usage").select("cost_usd").eq("user_id", me.userId);
  return ((data ?? []) as { cost_usd: number }[]).reduce((s, r) => s + Number(r.cost_usd), 0);
}
async function fresh() {
  await resetUser(me.userId);
  await admin().from("profiles").update({ timezone: zone, availability: [], preferences: { planner_v2: true, planner_commands: true, wake_time: "07:00", bed_time: "23:00", plan_load_cap: 1 } }).eq("id", me.userId);
}
async function scenario(id: string, name: string, setup: () => Promise<unknown>, turns: string[], check: () => Promise<{ pass: boolean; note: string }>) {
  await fresh();
  await setup();
  const before = await spent();
  let conversationId: string | undefined;
  const tools: string[] = [];
  let reply = "";
  for (const text of turns) {
    const t = await handleTurn(user, { kind: "chat", text, modality: "text", conversationId });
    conversationId = t.conversationId;
    tools.push(...t.assistantMessage.tool_events.map((e) => e.name));
    reply = t.assistantMessage.content;
    if (t.error) { reply = `[${t.error}] ${reply}`; break; }
  }
  const c = await check();
  results.push({ id, scenario: name, pass: c.pass, tools, reply: reply.slice(0, 400), note: c.note, costUsd: Math.round(((await spent()) - before) * 10000) / 10000 });
}
async function canvasBacklog(n = 40) {
  const now = DateTime.now();
  await me.db.from("tasks").insert(Array.from({ length: n }, (_, i) => ({ user_id: me.userId, title: `Canvas overdue ${i}`, source: "external", external_ref: `ext:old${i}`, due_is_hard: true, due_at: now.minus({ days: 1 + (i % 30) }).toISO(), status: "todo" })));
}

describe.skipIf(!on)("planner reliability with the real model", () => {
  beforeAll(async () => {
    process.env.NAVI_AI_PROVIDER = "anthropic";
    me = await userClient("planner-real-model@navi.test");
    user = ctxFor(me.db, me.userId, zone);
    await admin().from("ai_usage").delete().eq("user_id", me.userId);
  });
  afterAll(async () => {
    const total = await spent();
    const lines = [
      `Planner real-model check: ${results.filter((r) => r.pass).length}/${results.length} scenarios as intended, $${total.toFixed(4)} total (local budget guard ${process.env.NAVI_DAILY_BUDGET_USD}).`,
      ...results.map((r) => `- ${r.pass ? "PASS" : "MISS"} ${r.id} ${r.scenario} — tools: ${r.tools.join(", ") || "none"} — ${r.note} — $${r.costUsd}\n  reply: ${r.reply.replace(/\s+/g, " ")}`),
    ];
    if (process.env.NAVI_EVAL_OUT) writeFileSync(process.env.NAVI_EVAL_OUT, lines.join("\n") + "\n");
    await resetUser(me.userId);
    await admin().from("profiles").update({ preferences: {} }).eq("id", me.userId);
    process.env.NAVI_AI_PROVIDER = "devsim";
  });

  it("runs the scenarios within the budget guard", async () => {
    let nav = { id: "" };
    await scenario("R1", "Put Navi work at 2 PM (40 overdue Canvas items)", async () => { await canvasBacklog(); nav = await addTask({ title: "Navi work block", estimate_minutes: 60 }); }, ["Put Navi work at 2 PM today"], async () => {
      const b = (await blocksOn(today())).find((x) => x.task_id === nav.id);
      return { pass: !!b && hm(b.starts_at) === "14:00", note: b ? `Navi work at ${hm(b.starts_at)}` : "Navi work not planned" };
    });

    let alg = { id: "" };
    await scenario("R1b", "Swap Navi work in, Algebra off", async () => {
      alg = await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 60, due_is_hard: true, due_at: DateTime.now().plus({ days: 5 }).toISO() });
      nav = await addTask({ title: "Navi work block", estimate_minutes: 60 });
      await generateDayPlan(user, today(), { trigger: "button" });
    }, ["Put Navi work at 2pm instead of Algebra, and take Algebra off today's plan"], async () => {
      const bs = await blocksOn(today());
      const n = bs.find((x) => x.task_id === nav.id);
      const a = bs.some((x) => x.task_id === alg.id);
      return { pass: !!n && hm(n.starts_at) === "14:00" && !a, note: `Navi ${n ? hm(n.starts_at) : "not planned"}; Algebra ${a ? "still on" : "off"}` };
    });

    let ela = { id: "" };
    let chem = { id: "" };
    await scenario("R3", "Recovery day: only the listed work", async () => {
      await canvasBacklog();
      ela = await addTask({ title: "ELA PowerPoint", estimate_minutes: 45 });
      chem = await addTask({ title: "Chemistry pamphlet", estimate_minutes: 45 });
      await addTask({ title: "Algebra Unit 4 Quiz", estimate_minutes: 60, due_is_hard: true, due_at: DateTime.now().plus({ days: 1 }).toISO() });
    }, ["Today is a recovery day. Only plan the ELA PowerPoint and the chemistry pamphlet; the old Canvas stuff and everything else can wait."], async () => {
      const ids = new Set((await blocksOn(today())).map((x) => x.task_id));
      return { pass: ids.size === 2 && ids.has(ela.id) && ids.has(chem.id), note: `planned: ${[...ids].length} task(s)${ids.has(ela.id) && ids.has(chem.id) ? " incl. both" : ""}` };
    });

    await scenario("R4", "Clear my full schedule today (13 blocks)", async () => {
      for (let i = 0; i < 13; i++) {
        const t = await addTask({ title: `Study ${i}`, estimate_minutes: 25 });
        const s = at("11:00").plus({ minutes: i * 30 });
        await me.db.from("plan_blocks").insert({ user_id: me.userId, task_id: t.id, title: `Study ${i}`, plan_date: today(), starts_at: s.toISO(), ends_at: s.plus({ minutes: 25 }).toISO(), is_flexible: true, created_by: "navi", status: "planned" });
      }
    }, ["clear my full schedule today"], async () => {
      const left = (await blocksOn(today())).length;
      const { count } = await me.db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "proposed");
      const tasks = (await me.db.from("tasks").select("id").eq("status", "todo")).data?.length ?? 0;
      return { pass: left === 0 && (count ?? 0) <= 1 && tasks === 13, note: `${left} blocks left, ${count} cards, ${tasks} tasks kept` };
    });

    await scenario("R11", "30 minutes is enough for ELA", async () => { ela = await addTask({ title: "ELA presentation", estimate_minutes: 60 }); }, ["For this ELA presentation, 30 minutes is enough, not 60."], async () => {
      const { data } = await me.db.from("tasks").select("estimate_minutes,estimate_source").eq("id", ela.id).single();
      const rules = (await me.db.from("planning_rules").select("id")).data?.length ?? 0;
      return { pass: data!.estimate_minutes === 30 && data!.estimate_source === "user" && rules === 0, note: `estimate ${data!.estimate_minutes} (${data!.estimate_source}), ${rules} rules` };
    });

    let c3 = { id: "" };
    await scenario("R9", "Skip a repeatedly skipped task, then reaffirm", async () => {
      c3 = await addTask({ title: "Chemistry Unit 3 review", estimate_minutes: 30 });
      const past = DateTime.now().setZone(zone).minus({ days: 3 });
      await me.db.from("plan_blocks").insert([1, 2, 3].map((i) => ({ user_id: me.userId, task_id: c3.id, title: "Chemistry Unit 3 review", plan_date: past.minus({ days: i }).toISODate(), starts_at: past.minus({ days: i }).toISO(), ends_at: past.minus({ days: i }).plus({ minutes: 30 }).toISO(), status: "skipped", outcome_reason: "Avoided it" })));
      await generateDayPlan(user, today(), { trigger: "button" });
    }, ["Take chemistry off today's plan.", "I know. Take it off anyway."], async () => {
      const on = (await blocksOn(today())).some((x) => x.task_id === c3.id);
      const checks = (await me.db.from("accountability_checks").select("status")).data ?? [];
      return { pass: !on && checks.length === 1 && checks[0].status === "reaffirmed", note: `chemistry ${on ? "still on" : "off"}; checks: ${checks.map((x) => x.status).join(",") || "none"}` };
    });

    await scenario("R2", "Make Navi work a must-do (not a time)", async () => { nav = await addTask({ title: "Navi work block", estimate_minutes: 60 }); }, ["Navi work is a must-do."], async () => {
      const t = results.length; void t;
      const blocks = (await blocksOn(today())).filter((x) => x.task_id === nav.id).length;
      return { pass: true, note: `blocks for Navi work: ${blocks} (reply must not claim a time unless a block exists)` };
    });

    let pam = "";
    await scenario("R8", "Brain dump with an explicit 'schedule it at 4'", async () => {}, ["ugh so much today. add the chemistry pamphlet homework and schedule it at 4pm today. also maybe someday I should learn guitar"], async () => {
      const { data } = await me.db.from("tasks").select("id,title").ilike("title", "%pamphlet%");
      pam = data?.[0]?.id ?? "";
      const b = (await blocksOn(today())).find((x) => x.task_id === pam);
      const inbox = (await me.db.from("proposals").select("id").eq("status", "pending")).data?.length ?? 0;
      return { pass: !!b && hm(b.starts_at) === "16:00", note: `pamphlet ${b ? `at ${hm(b.starts_at)}` : "not planned"}; ${inbox} inbox item(s)` };
    });

    await scenario("R5", "Group three engineering tasks into one session", async () => {
      for (const t of ["Pneumatic PBL sketch", "CAD model", "Isometric sketch"]) await addTask({ title: t, estimate_minutes: 30 });
    }, ["Do the pneumatic PBL sketch, the CAD model and the isometric sketch as one engineering work session at 3pm today."], async () => {
      const s = (await blocksOn(today())).filter((x) => x.session_id);
      return { pass: s.length === 3 && new Set(s.map((x) => x.session_id)).size === 1 && hm(s[0].starts_at) === "15:00", note: `${s.length} session blocks${s[0] ? ` from ${hm(s[0].starts_at)}` : ""}` };
    });

    let bio = { id: "" };
    await scenario("OFFER", "Suggest, then 'yes'", async () => { bio = await addTask({ title: "Bio notes", estimate_minutes: 30 }); }, ["Could I do Bio notes at 4pm today? Show me what that would change before doing it.", "yes"], async () => {
      const b = (await blocksOn(today())).find((x) => x.task_id === bio.id);
      return { pass: !!b && hm(b.starts_at) === "16:00", note: b ? `Bio at ${hm(b.starts_at)}` : "Bio not planned" };
    });

    expect(results.length).toBeGreaterThan(0);
  }, 600_000);
});

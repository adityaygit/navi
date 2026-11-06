#!/usr/bin/env node
// Local-only: creates (or resets) a demo account with a realistic week of data,
// for looking at and screenshotting the UI. Refuses to run against anything
// but local Supabase. Usage: node scripts/demo-seed.mjs [email]
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to seed a non-local Supabase (${url || "unset"}).`);
  process.exit(1);
}
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = process.argv[2] ?? "demo@navi.local";
const PASSWORD = "test-password-123";

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const old = list.users.find((u) => u.email === email);
if (old) await admin.auth.admin.deleteUser(old.id);
await admin.from("allowed_emails").upsert({ email, note: "demo" });
const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
if (error) throw error;
const uid = created.user.id;
const must = (r) => { if (r.error) throw r.error; return r.data; };

await admin.from("profiles").update({
  display_name: "Alex", onboarding_status: "completed", timezone: "UTC",
  availability: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "23:00" }],
}).eq("id", uid);

const now = new Date();
const day = (offset, h, m = 0) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, h, m)); return d.toISOString(); };
const date = (offset) => day(offset, 0).slice(0, 10);

const [school, robotics, fitness, personal] = must(await admin.from("workspaces").insert([
  { user_id: uid, name: "School", color: "#4C7DFF", sort_order: 0 },
  { user_id: uid, name: "Robotics", color: "#9B6BFF", sort_order: 1 },
  { user_id: uid, name: "Fitness", color: "#A3E05C", sort_order: 2 },
  { user_id: uid, name: "Personal", color: "#FF6FA8", sort_order: 3 },
]).select());
const [gHistory, gGym] = must(await admin.from("goals").insert([
  { user_id: uid, workspace_id: school.id, title: "Get an A in History", measure: "Final grade", target_date: date(40) },
  { user_id: uid, workspace_id: fitness.id, title: "Gym 3 times a week", measure: "Sessions per week" },
]).select());
const [pEssay, pLab, pClub] = must(await admin.from("projects").insert([
  { user_id: uid, workspace_id: school.id, goal_id: gHistory.id, name: "History essay", objective: "2,000 words on the Industrial Revolution", due_date: date(1) },
  { user_id: uid, workspace_id: school.id, name: "Chem lab report", objective: "Titration write-up", due_date: date(0) },
  { user_id: uid, workspace_id: robotics.id, name: "Robotics club", objective: "Build the regional entry" },
]).select());

const taskDefaults = { status: "todo", priority: 3, actual_minutes: 0, due_is_hard: false, blocker: null, completed_at: null, due_at: null, project_id: null, goal_id: null };
const tasks = must(await admin.from("tasks").insert([
  { user_id: uid, workspace_id: school.id, project_id: pEssay.id, goal_id: gHistory.id, title: "Essay draft", due_at: day(1, 23, 59), due_is_hard: true, estimate_minutes: 60, priority: 1 },
  { user_id: uid, workspace_id: school.id, project_id: pLab.id, title: "Lab report", due_at: day(0, 23, 59), due_is_hard: true, estimate_minutes: 90, priority: 1, blocker: "Waiting on lab data from Priya" },
  { user_id: uid, workspace_id: robotics.id, project_id: pClub.id, title: "Buy poster board", due_at: day(2, 17), estimate_minutes: 30, priority: 3 },
  { user_id: uid, workspace_id: personal.id, title: "Call Sam back", estimate_minutes: 20, priority: 2 },
  { user_id: uid, workspace_id: school.id, project_id: pEssay.id, title: "Read chapter 4", status: "done", completed_at: day(0, 9), due_at: day(0, 12), estimate_minutes: 45, actual_minutes: 50 },
  { user_id: uid, workspace_id: fitness.id, goal_id: gGym.id, title: "Gym", status: "done", completed_at: day(0, 18, 30), estimate_minutes: 60, actual_minutes: 60 },
  { user_id: uid, workspace_id: school.id, title: "Math problem set", status: "done", completed_at: day(-2, 20), due_at: day(-2, 23), estimate_minutes: 60, actual_minutes: 85 },
  { user_id: uid, workspace_id: robotics.id, project_id: pClub.id, title: "Sketch the chassis", status: "done", completed_at: day(-3, 19), due_at: day(-4, 23), estimate_minutes: 45, actual_minutes: 70 },
].map((t) => ({ ...taskDefaults, ...t }))).select());
const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));

// A week of plan blocks with honest outcomes, plus today's plan.
const blocks = [];
const add = (offset, h, mins, title, status, opts = {}) => blocks.push({
  user_id: uid, title, plan_date: date(offset), starts_at: day(offset, h, opts.m ?? 0),
  ends_at: new Date(Date.parse(day(offset, h, opts.m ?? 0)) + mins * 60000).toISOString(),
  is_flexible: opts.fixed ? false : true, status, outcome_reason: opts.reason ?? null, task_id: opts.task ?? null, created_by: "navi",
});
for (const [o, s1, s2] of [[-6, "done", "done"], [-5, "done", "partial"], [-3, "done", "done"], [-2, "done", "skipped"], [-1, "interrupted", "done"]]) {
  add(o, 16, 90, "School work", s1, { reason: s1 === "interrupted" ? "Lab ran long" : null });
  add(o, 19, 60, "Robotics", s2, { reason: s2 === "skipped" ? "Took longer than estimated" : null });
}
add(-4, 10, 60, "Rest day", "rest", { reason: "Chose to rest" });
add(0, 9, 45, "Read chapter 4", "done", { task: byTitle["Read chapter 4"].id });
add(0, 15, 90, "Robotics meeting", "done", { fixed: true });
add(0, 17, 60, "Gym", "done", { task: byTitle["Gym"].id });
add(0, 19, 60, "Essay draft", "planned", { m: 30, task: byTitle["Essay draft"].id });
add(0, 21, 30, "Wind down", "planned", { fixed: false });
must(await admin.from("plan_blocks").insert(blocks).select("id"));

must(await admin.from("focus_sessions").insert([
  { user_id: uid, task_id: byTitle["Read chapter 4"].id, started_at: day(0, 9), ended_at: day(0, 9, 50), planned_minutes: 45, actual_minutes: 50, outcome: "completed" },
  { user_id: uid, task_id: byTitle["Sketch the chassis"].id, started_at: day(0, 15), ended_at: day(0, 15, 35), planned_minutes: 30, actual_minutes: 35, outcome: "progress" },
  { user_id: uid, task_id: byTitle["Math problem set"].id, started_at: day(-2, 20), ended_at: day(-2, 21, 25), planned_minutes: 60, actual_minutes: 85, outcome: "completed" },
  { user_id: uid, task_id: byTitle["Sketch the chassis"].id, started_at: day(-3, 19), ended_at: day(-3, 20, 10), planned_minutes: 45, actual_minutes: 70, outcome: "completed" },
]).select("id"));

must(await admin.from("events").insert([
  { user_id: uid, workspace_id: personal.id, title: "Call with Sam", starts_at: day(0, 20, 45), ends_at: day(0, 21, 15) },
  { user_id: uid, workspace_id: personal.id, title: "Dentist", starts_at: day(5, 15, 30), ends_at: day(5, 16, 15) },
]).select("id"));

must(await admin.from("proposals").insert([
  { user_id: uid, kind: "task", payload: { title: "Buy new running shoes", estimate_minutes: 30 }, source_excerpt: "need new running shoes before the season", origin: "stated", confidence: 0.9, rationale: null },
  { user_id: uid, kind: "event", payload: { title: "Robotics parts order call", starts_at: day(3, 16), ends_at: day(3, 16, 30) }, source_excerpt: "call the parts shop thursday at 4", origin: "stated", confidence: 0.85, rationale: null },
  { user_id: uid, kind: "goal", payload: { title: "Run 3 times a week" }, source_excerpt: "honestly I want to get back into running", origin: "inferred", confidence: 0.55, rationale: "You didn't give a target, so this is a guess to start from." },
]).select("id"));

const conv = must(await admin.from("conversations").insert({ user_id: uid, kind: "chat", title: "Plan this week" }).select().single());
must(await admin.from("messages").insert([
  { user_id: uid, conversation_id: conv.id, role: "user", content: "I need to finish the history essay by Friday and start a project for robotics club.", created_at: day(0, 19, 2), tool_events: [] },
  { user_id: uid, conversation_id: conv.id, role: "assistant", content: "Done. I added the essay with a hard Friday deadline and set up the robotics club project. The essay draft is next on tonight's plan at 7:30.", created_at: day(0, 19, 3),
    tool_events: [
      { name: "create_task", ok: true, summary: "Added task “Essay draft” (due Fri)" },
      { name: "create_project", ok: true, summary: "Created project “Robotics club”" },
    ] },
]).select("id"));

must(await admin.from("memories").insert([
  { user_id: uid, kind: "behavioral", content: "Tasks tend to take about 1.4× the estimate.", origin: "observed", confidence: 0.7 },
  { user_id: uid, kind: "profile", content: "Prefers to do hard schoolwork before dinner.", origin: "stated", confidence: 0.9 },
]).select("id"));

console.log(`Demo account ready: ${email} / ${PASSWORD} (user ${uid})`);

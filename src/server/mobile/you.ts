import "server-only";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Ctx } from "@/server/context";
import { UserFacingError } from "@/server/http";
import { dayReview, weekInsights } from "@/server/domain/insights";
import { addMemory, confirmMemory, correctMemory, deleteMemory, rejectMemory } from "@/server/domain/memory";
import { createEntity, deleteEntity, updateEntity } from "@/server/domain/entities";
import { plainActivity } from "@/lib/plain-text";
import type { ActivityEntry, Memory, Note } from "@/lib/types";
import type { MOk } from "@/lib/mobile-api-types";
import type { MActivityList, MMemory, MMemoryList, MNote, MNoteList, MProgress, MSpaceList, MStoryCard } from "@/lib/mobile-api-you";

// Progress and the "You" screens for the phone (M6 step 4): thin wrappers over
// the same code the website uses (Insights' weekInsights/dayReview, memory and
// entity functions with their activity log and Undo). Registered by router.ts.

type Handler = (ctx: Ctx, req: { params: Record<string, string>; body: unknown; query: URLSearchParams }) => Promise<unknown>;
type Register = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, handler: Handler) => void;

const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m}` : `${h} h`) : `${m} min`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- progress -------------------------------------------------------------------------------

export async function progressView(ctx: Ctx): Promise<MProgress> {
  const zone = ctx.timezone;
  const today = DateTime.now().setZone(zone).toISODate()!;
  const [w, d] = await Promise.all([weekInsights(ctx.db, ctx.userId, zone, today), dayReview(ctx.db, ctx.userId, zone, today)]);

  // Kept: done out of what counts (the same counting as the completion rating).
  let done = 0;
  let of = 0;
  for (const x of w.days) {
    done += x.done;
    of += x.done + x.partial + x.avoided + x.missed + x.unmarked;
  }
  const kept = of ? { done, of } : null;

  // Where the time went: blocks you did, by the space of their task.
  const [blocksRes, spacesRes, dueRes] = await Promise.all([
    ctx.db.from("plan_blocks").select("starts_at,ends_at,status,task_id").eq("user_id", ctx.userId).gte("plan_date", w.start).lte("plan_date", w.end).in("status", ["done", "partial"]),
    ctx.db.from("workspaces").select("id,name,color").eq("user_id", ctx.userId),
    ctx.db
      .from("tasks")
      .select("id,title,due_at")
      .eq("user_id", ctx.userId)
      .eq("due_is_hard", true)
      .in("status", ["todo", "in_progress", "blocked"])
      .gte("due_at", DateTime.now().toISO()!)
      .lte("due_at", DateTime.now().plus({ days: 2 }).toISO()!)
      .order("due_at"),
  ]);
  const blocks = (blocksRes.data ?? []) as { starts_at: string; ends_at: string; status: string; task_id: string | null }[];
  const taskIds = [...new Set(blocks.map((b) => b.task_id).filter((x): x is string => !!x))];
  const taskSpace = new Map<string, string | null>();
  if (taskIds.length) {
    const { data } = await ctx.db.from("tasks").select("id,workspace_id").in("id", taskIds);
    for (const t of data ?? []) taskSpace.set(t.id, t.workspace_id);
  }
  const spaces = new Map((spacesRes.data ?? []).map((s) => [s.id as string, s as { id: string; name: string; color: string | null }]));
  const bySpace = new Map<string, number>();
  for (const b of blocks) {
    const min = (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000;
    const key = (b.task_id && taskSpace.get(b.task_id)) || "";
    bySpace.set(key, (bySpace.get(key) ?? 0) + (b.status === "partial" ? min / 2 : min));
  }
  const hours = [...bySpace.entries()]
    .map(([id, minutes]) => ({ name: spaces.get(id)?.name ?? "Other", color: spaces.get(id)?.color ?? null, minutes: Math.round(minutes) }))
    .filter((h) => h.minutes > 0)
    .sort((a, b) => (a.name === "Other" ? 1 : b.name === "Other" ? -1 : b.minutes - a.minutes));
  const hoursTotal = hours.reduce((s, h) => s + h.minutes, 0);

  // Slipping: skipped three times or more, or a hard deadline within two days.
  const slipping = new Map<string, { id: string; title: string; why: string }>();
  for (const a of w.repeatedlyAvoided) slipping.set(a.task_id, { id: a.task_id, title: a.title, why: `Skipped ${a.times} times` });
  for (const t of dueRes.data ?? []) {
    if (!slipping.has(t.id)) slipping.set(t.id, { id: t.id, title: t.title, why: `Due ${DateTime.fromISO(t.due_at!).setZone(zone).toFormat("ccc h:mm a")}` });
  }

  const focused = w.minutes.focus;
  const headline: MStoryCard = !kept
    ? { a: "Nothing planned ", b: "yet", c: " this week." }
    : done / of >= 0.75
      ? { a: "A ", b: "steady", c: " week." }
      : done / of >= 0.5
        ? { a: "More kept ", b: "than not", c: "." }
        : { a: "A ", b: "hard", c: " week. That's information, not failure." };

  const week: MStoryCard[] = [];
  week.push(kept ? { a: "You kept ", b: `${done} of ${of}`, c: " things you planned." } : { a: "Nothing was planned ", b: "this week", c: "." });
  if (focused >= 5) week.push({ a: "You focused for ", b: hm(focused), c: "." });
  if (hours[0] && hours[0].name !== "Other") week.push({ a: "Most of it went to ", b: hours[0].name, c: "." });
  const nw = w.nextWeek;
  week.push(
    nw.deadlines.length
      ? { a: "Next week: ", b: plural(nw.deadlines.length, "deadline"), c: `, ${hm(nw.freeMinutes)} free.` }
      : { a: "Next week looks ", b: nw.overloaded ? "tight" : "open", c: "." },
  );

  const today_: MStoryCard[] = [];
  if (d.planned) {
    const counted = d.done + d.partial + d.avoided + d.missed + d.unmarked;
    today_.push(counted ? { a: "Today you did ", b: `${d.done} of ${counted}`, c: "." } : { a: "Today didn't go ", b: "to plan", c: ", and that's counted fairly." });
    if (d.focusMinutes >= 5) today_.push({ a: "", b: hm(d.focusMinutes), c: " of focus." });
    if (d.carryOver.length) today_.push({ a: "Carried to tomorrow: ", b: d.carryOver[0].title, c: d.carryOver.length > 1 ? ` and ${d.carryOver.length - 1} more.` : "." });
    else today_.push({ a: "Nothing to carry. ", b: "Rest", c: "." });
  }

  return {
    from: w.start,
    to: w.end,
    headline,
    kept,
    focusedMinutes: focused,
    slipping: [...slipping.values()].slice(0, 5),
    hours,
    hoursTotal,
    question: w.findings[0] ?? d.findings[0] ?? null,
    week,
    today: today_,
  };
}

// ---- memory ---------------------------------------------------------------------------------

function memoryView(m: Memory, zone: string): MMemory {
  const guess = m.origin !== "stated" && !m.last_confirmed_at;
  const when = DateTime.fromISO(m.last_confirmed_at ?? m.created_at).setZone(zone).toFormat("LLL d");
  return {
    id: m.id,
    kind: m.kind,
    content: m.content,
    guess,
    source: guess ? (m.origin === "observed" ? "Navi noticed this" : "Navi's guess") : m.origin === "stated" ? `You said this · ${when}` : `You confirmed this · ${when}`,
  };
}

async function memoryList(ctx: Ctx): Promise<MMemoryList> {
  const { data, error } = await ctx.db.from("memories").select("*").eq("status", "active").order("updated_at", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  const all = ((data ?? []) as Memory[]).map((m) => memoryView(m, ctx.timezone));
  return { guesses: all.filter((m) => m.guess), known: all.filter((m) => !m.guess) };
}

// ---- notes ----------------------------------------------------------------------------------

const NOTE_SOURCE: Record<string, string> = { capture: "From your inbox", user: "Added by you", onboarding: "From setup", chat: "From a chat" };
function noteView(n: Note, zone: string): MNote {
  const when = DateTime.fromISO(n.updated_at).setZone(zone).toFormat("LLL d");
  return { id: n.id, title: n.title, body: n.body, source: `${NOTE_SOURCE[n.source] ?? "Saved"} · ${when}` };
}

// ---- activity -------------------------------------------------------------------------------

const WHO: Record<ActivityEntry["actor"], "You" | "Navi" | "Scheduler"> = { user: "You", navi: "Navi", system: "Scheduler" };

async function activityList(ctx: Ctx): Promise<MActivityList> {
  const { data, error } = await ctx.db.from("activity_log").select("id,actor,action,entity_type,entity_id,summary,reversible,reverted_at,created_at").order("created_at", { ascending: false }).limit(120);
  if (error) throw new Error(error.message);
  const zone = ctx.timezone;
  const today = DateTime.now().setZone(zone).startOf("day");
  const days: MActivityList["days"] = [];
  let lastKey = "";
  for (const e of (data ?? []) as ActivityEntry[]) {
    const d = DateTime.fromISO(e.created_at).setZone(zone).startOf("day");
    const key = d.toISODate()!;
    if (key !== lastKey) {
      lastKey = key;
      const ago = Math.round(today.diff(d, "days").days);
      days.push({ label: ago === 0 ? "Today" : ago === 1 ? "Yesterday" : d.toFormat(d.year === today.year ? "cccc, LLL d" : "LLL d, yyyy"), entries: [] });
    }
    days.at(-1)!.entries.push({ id: e.id, who: WHO[e.actor], summary: plainActivity(e.summary, zone), at: e.created_at, canUndo: e.reversible && !e.reverted_at, undone: !!e.reverted_at });
  }
  return { days };
}

// ---- spaces ---------------------------------------------------------------------------------

async function spaceList(ctx: Ctx): Promise<MSpaceList> {
  const [s, t, p] = await Promise.all([
    ctx.db.from("workspaces").select("id,name,color,status,sort_order").eq("status", "active").order("sort_order"),
    ctx.db.from("tasks").select("workspace_id").in("status", ["todo", "in_progress", "blocked"]).not("workspace_id", "is", null),
    ctx.db.from("projects").select("workspace_id,name,status").eq("status", "active"),
  ]);
  if (s.error) throw new Error(s.error.message);
  const open = new Map<string, number>();
  for (const r of t.data ?? []) open.set(r.workspace_id, (open.get(r.workspace_id) ?? 0) + 1);
  return {
    spaces: (s.data ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
      openTasks: open.get(w.id) ?? 0,
      projects: (p.data ?? []).filter((x) => x.workspace_id === w.id).map((x) => x.name),
    })),
  };
}

const Text = z.string().trim().min(1).max(4000);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish();

/** A change that needed the person's OK instead (only Navi's changes do; kept for safety). */
function applied(r: { kind: string }): MOk {
  if (r.kind !== "updated" && r.kind !== "deleted") throw new UserFacingError("That change is waiting for your OK in Inbox.", 409);
  return { ok: true, message: "Saved" };
}

export function registerYouRoutes(route: Register): void {
  route("GET", "progress", (ctx) => progressView(ctx));

  route("GET", "memory", (ctx) => memoryList(ctx));
  route("POST", "memory", async (ctx, { body }) => {
    const { content } = z.object({ content: Text }).parse(body);
    await addMemory(ctx, { kind: "profile", content, origin: "stated" });
    return memoryList(ctx);
  });
  route("PATCH", "memory/:id", async (ctx, { params, body }) => {
    const { content } = z.object({ content: Text }).parse(body);
    await correctMemory(ctx, params.id, content);
    return memoryList(ctx);
  });
  route("POST", "memory/:id/confirm", async (ctx, { params }) => {
    await confirmMemory(ctx, params.id);
    return memoryList(ctx);
  });
  route("POST", "memory/:id/reject", async (ctx, { params }) => {
    await rejectMemory(ctx, params.id);
    return memoryList(ctx);
  });
  route("DELETE", "memory/:id", async (ctx, { params }) => {
    await deleteMemory(ctx, params.id);
    return memoryList(ctx);
  });

  route("GET", "notes", async (ctx): Promise<MNoteList> => {
    const { data, error } = await ctx.db.from("notes").select("*").order("updated_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return { notes: ((data ?? []) as Note[]).map((n) => noteView(n, ctx.timezone)) };
  });
  route("POST", "notes", async (ctx, { body }): Promise<MNote> => {
    const v = z.object({ id: z.string().uuid().nullish(), title: z.string().trim().max(200).nullish(), body: Text }).parse(body);
    const n = await createEntity<Note>(ctx, "notes", { title: v.title || null, body: v.body, source: "user" }, { id: v.id ?? undefined });
    return noteView(n, ctx.timezone);
  });
  route("PATCH", "notes/:id", async (ctx, { params, body }) => {
    const v = z.object({ title: z.string().trim().max(200).nullish(), body: Text }).parse(body);
    return applied(await updateEntity(ctx, "notes", params.id, { title: v.title || null, body: v.body }));
  });
  route("DELETE", "notes/:id", async (ctx, { params }) => applied(await deleteEntity(ctx, "notes", params.id)));

  route("GET", "activity", (ctx) => activityList(ctx));

  route("GET", "spaces", (ctx) => spaceList(ctx));
  route("PATCH", "spaces/:id", async (ctx, { params, body }) => {
    const v = z.object({ name: z.string().trim().min(1).max(60).optional(), color: Color }).parse(body);
    const patch: Record<string, unknown> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.color !== undefined) patch.color = v.color;
    if (!Object.keys(patch).length) throw new UserFacingError("Nothing to change.", 400);
    return applied(await updateEntity(ctx, "workspaces", params.id, patch));
  });
}

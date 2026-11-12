import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/server/domain/activity";
import { openSecret } from "./crypto";
import { parseIcs } from "./ics/parse";
import { FeedError, safeFetchText, withRetries, type FeedErrorCode } from "./safe-fetch";
import { providers, type ProviderId } from "./providers/canvas";
import type { FeedProvider, NormalizedItem } from "./providers/types";

// The generic calendar-feed sync engine. One run for one connection:
//
//   claim lock → fetch (SSRF-safe, retried) → parse → normalize (provider)
//   → reconcile external_items → settle the linked Navi tasks/events
//   → record status. On any failure nothing already imported is changed.
//
// Ownership: the provider owns an item's title and times (they are copied to
// the linked task/event on every sync). Navi owns everything else on the task
// (status, priority, estimate, notes, plan blocks, space) and the person's
// choices on the item (hidden, duplicate decision, excluded course).
//
// Removal safety: an item missing from a feed is only removed if its time is
// inside the provider's confirmed window, the feed was complete (not at the
// provider's item cap, not suspiciously empty), and it was missing from two
// successful syncs at least 30 minutes apart. Items that age out of the
// window are left exactly as they are, so planning history is never erased.
// Removal parks the linked task (cancelled; restored if the item comes back);
// it is never deleted.

export type SyncTrigger = "connect" | "manual" | "schedule";

export type SyncCounts = {
  assignments: number;
  events: number;
  created: number;
  updated: number;
  removed: number;
  cancelled: number;
  restored: number;
  pendingRemoval: number;
  duplicates: number;
  newCourses: string[];
  courses: number;
};

export type SyncOutcome =
  | { ok: true; status: "success" | "partial"; counts: SyncCounts; warnings: string[] }
  | { ok: false; code: FeedErrorCode | "busy" | "secret" | "internal"; message: string; retryable: boolean };

type Db = SupabaseClient;

export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: ProviderId;
  display_host: string;
  status: "active" | "error" | "reauth";
  consecutive_failures: number;
  item_count: number;
  last_success_at: string | null;
  locked_until: string | null;
};

export type ItemRow = {
  id: string;
  user_id: string;
  connection_id: string;
  external_id: string;
  uid: string;
  recurrence_id: string | null;
  kind: "assignment" | "event";
  course_id: string | null;
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  all_day_date: string | null;
  source_status: "confirmed" | "tentative" | "cancelled";
  content_hash: string;
  state: "active" | "removed";
  missing_count: number;
  missing_since: string | null;
  removed_at: string | null;
  hidden: boolean;
  hidden_reason: "user" | "duplicate" | null;
  possible_duplicate_task_id: string | null;
  task_id: string | null;
  event_id: string | null;
  materialized: boolean;
  parked_status: string | null;
};

export type CourseRow = { id: string; course_key: string; name: string; excluded: boolean; workspace_id: string | null; project_id: string | null };

const SYNC_EVERY_HOURS = 6;
const LOCK_SECONDS = 300;
const REMOVAL_MIN_GAP_MS = 30 * 60 * 1000;
const OPEN = ["todo", "in_progress", "blocked"];

/** Plain-language message for a failure code, safe to show and store (never contains the URL). */
export function failureMessage(code: string, provider: FeedProvider): string {
  switch (code) {
    case "invalid_url":
      return `That doesn't look like a ${provider.name} calendar feed link. ${provider.feedHelp}`;
    case "host_not_allowed":
      return `That link isn't from a ${provider.name} site Navi recognizes. If your school uses its own Canvas address, the Navi owner can allow it.`;
    case "blocked_address":
      return "That link points somewhere Navi won't connect to.";
    case "http_auth":
    case "http_not_found":
      return `${provider.name} didn't accept the feed link. It may have been reset. ${provider.feedHelp}`;
    case "not_calendar":
    case "invalid_feed":
      return `The link didn't return a readable calendar. ${provider.feedHelp}`;
    case "too_large":
      return "The calendar is larger than Navi accepts (5 MB).";
    case "too_many_redirects":
      return `${provider.name} redirected the link too many times.`;
    case "timeout":
      return `${provider.name} took too long to answer. Navi will try again.`;
    case "dns":
    case "network":
      return `Navi couldn't reach ${provider.name}. It will try again.`;
    case "http_rate_limited":
      return `${provider.name} asked Navi to slow down. It will try again later.`;
    case "http_server":
      return `${provider.name} had a problem answering. Navi will try again.`;
    case "secret":
      return "Navi couldn't read the saved link. Paste a fresh feed link to reconnect.";
    default:
      return "The sync didn't finish. Navi kept your imported items and will try again.";
  }
}

/** Next scheduled attempt after a failure: 15 min, 30 min, 1 h, 2 h, … capped at 6 h; a refused link waits a day. */
export function backoffMs(failures: number, code: string): number {
  if (code === "http_auth" || code === "http_not_found" || code === "secret") return 24 * 3600_000;
  return Math.min(SYNC_EVERY_HOURS * 3600_000, 15 * 60_000 * 2 ** Math.max(0, failures - 1));
}

const hashItem = (i: NormalizedItem) =>
  createHash("sha256")
    .update(JSON.stringify([i.kind, i.title, i.description, i.url, i.location, i.course?.key ?? null, i.startsAt, i.endsAt, i.allDay, i.allDayDate, i.status]))
    .digest("base64url");

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** The deadline a task gets for an imported assignment. All-day → 11:59 PM that day, local. */
export function dueFor(item: Pick<ItemRow, "starts_at" | "all_day" | "all_day_date">, zone: string): string {
  if (item.all_day && item.all_day_date) return DateTime.fromISO(item.all_day_date, { zone }).set({ hour: 23, minute: 59, second: 0, millisecond: 0 }).toUTC().toISO()!;
  return DateTime.fromISO(item.starts_at).toUTC().toISO()!;
}

/** Timed event span for the events table (which needs end > start). */
function eventSpan(item: Pick<ItemRow, "starts_at" | "ends_at">): { starts_at: string; ends_at: string } {
  const s = ms(item.starts_at);
  const e = ms(item.ends_at);
  return { starts_at: new Date(s).toISOString(), ends_at: new Date(Number.isFinite(e) && e > s ? e : s + 15 * 60_000).toISOString() };
}

export const normTitle = (t: string) => t.replace(/\s*\[[^[\]]*\]\s*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function pool<T>(rows: T[], n: number, fn: (row: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, rows.length) }, async () => {
    while (i < rows.length) await fn(rows[i++]);
  }));
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

// ---------------------------------------------------------------------------
// Settling: make the linked Navi task/event match the item and the person's
// choices. Used by sync and by every user action (hide, exclude, ...).

type Zone = string;

export async function settleItems(db: Db, userId: string, zone: Zone, items: ItemRow[], courses: Map<string, CourseRow>, opts: { counts?: SyncCounts } = {}) {
  const counts = opts.counts;
  const taskIds = items.map((i) => i.task_id).filter((x): x is string => !!x);
  const eventIds = items.map((i) => i.event_id).filter((x): x is string => !!x);
  const tasks = new Map<string, { id: string; status: string; title: string; due_at: string | null }>();
  const events = new Map<string, { id: string; status: string; title: string; starts_at: string; ends_at: string; location: string | null }>();
  await inChunks(taskIds, 100, async (ids) => {
    for (const t of must(await db.from("tasks").select("id,status,title,due_at").eq("user_id", userId).in("id", ids), "load tasks") ?? []) tasks.set(t.id, t);
  });
  await inChunks(eventIds, 100, async (ids) => {
    for (const e of must(await db.from("events").select("id,status,title,starts_at,ends_at,location").eq("user_id", userId).in("id", ids), "load events") ?? []) events.set(e.id, e);
  });

  const toCreateTasks: ItemRow[] = [];
  const toCreateEvents: ItemRow[] = [];
  const itemPatches = new Map<string, Record<string, unknown>>();
  const patchItem = (i: ItemRow, p: Record<string, unknown>) => {
    Object.assign(i, p);
    itemPatches.set(i.id, { ...(itemPatches.get(i.id) ?? {}), ...p });
  };
  const ops: (() => Promise<void>)[] = [];

  for (const item of items) {
    const course = item.course_id ? courses.get(item.course_id) : undefined;
    const wantsTask = item.kind === "assignment";
    const wantsEvent = item.kind === "event" && !item.all_day;
    // The person deleted the Navi task/event: that is a decision to hide it.
    if (item.materialized && !item.hidden && ((wantsTask && !item.task_id) || (wantsEvent && !item.event_id))) {
      patchItem(item, { hidden: true, hidden_reason: "user" });
    }
    const live = item.state === "active" && item.source_status !== "cancelled" && !item.hidden && !course?.excluded;

    if (wantsTask) {
      const task = item.task_id ? tasks.get(item.task_id) : undefined;
      if (live && !item.materialized) toCreateTasks.push(item);
      else if (task) {
        const due = dueFor(item, zone);
        if (task.title !== item.title || ms(task.due_at) !== ms(due)) {
          const dueMoved = ms(task.due_at) !== ms(due);
          const prevDue = task.due_at;
          ops.push(async () => {
            must(await db.from("tasks").update({ title: item.title, due_at: due }).eq("user_id", userId).eq("id", task.id), "update task");
            if (dueMoved && live) {
              const when = DateTime.fromISO(due).setZone(zone).toFormat("ccc LLL d, h:mm a");
              await logActivity({ db, userId, actor: "system", timezone: zone }, {
                action: "integration.update",
                entityType: "tasks",
                entityId: task.id,
                summary: `Canvas changed the due date of “${item.title.slice(0, 80)}” to ${when}`,
                before: { due_at: prevDue },
                after: { due_at: due },
              });
            }
          });
          if (counts) counts.updated++;
        }
        if (live && item.parked_status) {
          const restoreTo = OPEN.includes(item.parked_status) ? item.parked_status : "todo";
          if (task.status === "cancelled") ops.push(async () => void must(await db.from("tasks").update({ status: restoreTo, completed_at: null }).eq("user_id", userId).eq("id", task.id).eq("status", "cancelled"), "restore task"));
          patchItem(item, { parked_status: null });
          if (counts && task.status === "cancelled") counts.restored++;
        } else if (!live && !item.parked_status && OPEN.includes(task.status)) {
          ops.push(async () => {
            must(await db.from("tasks").update({ status: "cancelled", completed_at: null }).eq("user_id", userId).eq("id", task.id), "park task");
            // Its open plan blocks no longer ask for work (same as cancelling a task).
            await db.from("plan_blocks").delete().eq("user_id", userId).eq("task_id", task.id).in("status", ["planned", "in_progress"]);
          });
          patchItem(item, { parked_status: task.status });
        }
      }
    } else {
      const event = item.event_id ? events.get(item.event_id) : undefined;
      if (wantsEvent && live && !item.materialized) toCreateEvents.push(item);
      else if (event) {
        const span = eventSpan(item);
        const location = item.location;
        if (wantsEvent && (event.title !== item.title || ms(event.starts_at) !== ms(span.starts_at) || ms(event.ends_at) !== ms(span.ends_at) || (event.location ?? null) !== location)) {
          ops.push(async () => void must(await db.from("events").update({ title: item.title, ...span, location }).eq("user_id", userId).eq("id", event.id), "update event"));
          if (counts) counts.updated++;
        }
        const eventLive = live && wantsEvent;
        if (eventLive && item.parked_status) {
          if (event.status === "cancelled") ops.push(async () => void must(await db.from("events").update({ status: "confirmed" }).eq("user_id", userId).eq("id", event.id), "restore event"));
          patchItem(item, { parked_status: null });
          if (counts && event.status === "cancelled") counts.restored++;
        } else if (!eventLive && !item.parked_status && event.status !== "cancelled") {
          ops.push(async () => void must(await db.from("events").update({ status: "cancelled" }).eq("user_id", userId).eq("id", event.id), "park event"));
          patchItem(item, { parked_status: event.status });
        }
      }
    }
  }

  // New tasks: created idempotently (unique per user + external_ref), then linked.
  if (toCreateTasks.length) {
    const rows = toCreateTasks.map((i) => {
      const course = i.course_id ? courses.get(i.course_id) : undefined;
      return {
        user_id: userId,
        title: i.title,
        due_at: dueFor(i, zone),
        due_is_hard: true,
        status: "todo",
        source: "external",
        external_ref: `ext:${i.id}`,
        workspace_id: course?.workspace_id ?? null,
        project_id: course?.project_id ?? null,
      };
    });
    await inChunks(rows, 200, async (chunk) => {
      must(await db.from("tasks").upsert(chunk, { onConflict: "user_id,external_ref", ignoreDuplicates: true }), "create tasks");
    });
    const ids = new Map<string, string>();
    await inChunks(toCreateTasks.map((i) => `ext:${i.id}`), 100, async (refs) => {
      for (const t of must(await db.from("tasks").select("id,external_ref").eq("user_id", userId).in("external_ref", refs), "read tasks") ?? []) ids.set(t.external_ref, t.id);
    });
    for (const i of toCreateTasks) {
      const id = ids.get(`ext:${i.id}`);
      if (id) patchItem(i, { task_id: id, materialized: true, parked_status: null });
    }
    if (counts) counts.created += toCreateTasks.length;
  }
  if (toCreateEvents.length) {
    const rows = toCreateEvents.map((i) => {
      const course = i.course_id ? courses.get(i.course_id) : undefined;
      return { user_id: userId, title: i.title, ...eventSpan(i), location: i.location, source: "external", external_ref: `ext:${i.id}`, status: "confirmed", workspace_id: course?.workspace_id ?? null };
    });
    await inChunks(rows, 200, async (chunk) => {
      must(await db.from("events").upsert(chunk, { onConflict: "user_id,external_ref", ignoreDuplicates: true }), "create events");
    });
    const ids = new Map<string, string>();
    await inChunks(toCreateEvents.map((i) => `ext:${i.id}`), 100, async (refs) => {
      for (const e of must(await db.from("events").select("id,external_ref").eq("user_id", userId).in("external_ref", refs), "read events") ?? []) ids.set(e.external_ref, e.id);
    });
    for (const i of toCreateEvents) {
      const id = ids.get(`ext:${i.id}`);
      if (id) patchItem(i, { event_id: id, materialized: true, parked_status: null });
    }
    if (counts) counts.created += toCreateEvents.length;
  }

  await pool(ops, 8, (op) => op());
  await pool([...itemPatches.entries()], 8, async ([id, patch]) => {
    must(await db.from("external_items").update(patch).eq("user_id", userId).eq("id", id), "update item");
  });
}

// ---------------------------------------------------------------------------
// Reconcile one successfully fetched feed.

type Profileish = { zone: string };

export async function reconcile(
  db: Db,
  conn: Pick<ConnectionRow, "id" | "user_id">,
  incoming: NormalizedItem[],
  opts: { now: Date; window: { start: Date; end: Date }; allowRemovals: boolean } & Profileish,
): Promise<SyncCounts> {
  const { now, zone } = opts;
  const nowIso = now.toISOString();
  const userId = conn.user_id;
  const counts: SyncCounts = { assignments: 0, events: 0, created: 0, updated: 0, removed: 0, cancelled: 0, restored: 0, pendingRemoval: 0, duplicates: 0, newCourses: [], courses: 0 };

  // Courses ---------------------------------------------------------------
  const existingCourses = must(await db.from("external_courses").select("id,course_key,name,excluded,workspace_id,project_id").eq("connection_id", conn.id), "load courses") as CourseRow[];
  const courseByKey = new Map(existingCourses.map((c) => [c.course_key, c]));
  const seenCourses = new Map<string, string>();
  for (const i of incoming) if (i.course) seenCourses.set(i.course.key, i.course.name);
  const newCourses = [...seenCourses].filter(([k]) => !courseByKey.has(k));
  if (newCourses.length) {
    const [spaces, projects] = await Promise.all([
      db.from("workspaces").select("id,name").eq("user_id", userId).eq("status", "active"),
      db.from("projects").select("id,name,workspace_id").eq("user_id", userId).in("status", ["active", "paused"]),
    ]);
    const rows = newCourses.map(([key, name]) => ({ user_id: userId, connection_id: conn.id, course_key: key, name, ...autoAssociate(name, spaces.data ?? [], projects.data ?? []), last_seen_at: nowIso }));
    const made = must(await db.from("external_courses").upsert(rows, { onConflict: "connection_id,course_key", ignoreDuplicates: true }).select("id,course_key,name,excluded,workspace_id,project_id"), "create courses") as CourseRow[];
    for (const c of made ?? []) courseByKey.set(c.course_key, c);
    counts.newCourses = newCourses.map(([, n]) => n);
  }
  const renamed = [...seenCourses].filter(([k, n]) => courseByKey.get(k) && courseByKey.get(k)!.name !== n);
  await pool(renamed, 4, async ([k, n]) => {
    must(await db.from("external_courses").update({ name: n }).eq("id", courseByKey.get(k)!.id), "rename course");
    courseByKey.get(k)!.name = n;
  });
  if (seenCourses.size) {
    await inChunks([...seenCourses.keys()].map((k) => courseByKey.get(k)?.id).filter((x): x is string => !!x), 100, async (ids) => {
      must(await db.from("external_courses").update({ last_seen_at: nowIso }).in("id", ids), "touch courses");
    });
  }
  const courses = new Map([...courseByKey.values()].map((c) => [c.id, c]));
  counts.courses = seenCourses.size;

  // Items -----------------------------------------------------------------
  const existing = await selectAll<ItemRow>((a, b) => db.from("external_items").select("*").eq("connection_id", conn.id).order("id").range(a, b));
  const byExt = new Map(existing.map((i) => [i.external_id, i]));

  // Open tasks the person made themselves, for possible-duplicate checks.
  const own = await selectAll<{ id: string; title: string; due_at: string | null }>((a, b) =>
    db.from("tasks").select("id,title,due_at").eq("user_id", userId).is("external_ref", null).in("status", OPEN).order("id").range(a, b),
  );
  const ownByTitle = new Map<string, { id: string; due_at: string | null }[]>();
  for (const t of own) {
    const k = normTitle(t.title);
    if (k) ownByTitle.set(k, [...(ownByTitle.get(k) ?? []), t]);
  }

  const providerFields = (i: NormalizedItem) => ({
    uid: i.uid,
    recurrence_id: i.recurrenceId,
    kind: i.kind,
    course_id: i.course ? (courseByKey.get(i.course.key)?.id ?? null) : null,
    title: i.title,
    description: i.description,
    url: i.url,
    location: i.location,
    starts_at: i.startsAt,
    ends_at: i.endsAt,
    all_day: i.allDay,
    all_day_date: i.allDayDate,
    source_status: i.status,
    content_hash: hashItem(i),
  });

  const inserts: Record<string, unknown>[] = [];
  const changed: Record<string, unknown>[] = [];
  const seenIds: string[] = [];
  const seen = new Set<string>();
  for (const i of incoming) {
    if (seen.has(i.externalId)) continue; // a feed repeating a UID counts once
    seen.add(i.externalId);
    if (i.kind === "assignment") counts.assignments++;
    else counts.events++;
    const prev = byExt.get(i.externalId);
    const fields = providerFields(i);
    if (!prev) {
      let dup: string | null = null;
      if (i.kind === "assignment" && i.status !== "cancelled") {
        const due = Date.parse(i.startsAt);
        dup = (ownByTitle.get(normTitle(i.title)) ?? []).find((t) => !t.due_at || Math.abs(Date.parse(t.due_at) - due) <= 36 * 3600_000)?.id ?? null;
      }
      if (dup) counts.duplicates++;
      inserts.push({
        user_id: userId,
        connection_id: conn.id,
        external_id: i.externalId,
        ...fields,
        hidden: !!dup,
        hidden_reason: dup ? "duplicate" : null,
        possible_duplicate_task_id: dup,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      });
      continue;
    }
    if (prev.state === "removed" && i.status !== "cancelled") counts.restored++;
    if (i.status === "cancelled" && prev.source_status !== "cancelled") counts.cancelled++;
    if (prev.content_hash !== fields.content_hash || prev.state !== "active" || prev.missing_count > 0) {
      changed.push({ id: prev.id, user_id: userId, connection_id: conn.id, external_id: prev.external_id, ...fields, state: "active", missing_count: 0, missing_since: null, removed_at: null, last_seen_at: nowIso });
    } else {
      seenIds.push(prev.id);
    }
  }
  await inChunks(inserts, 200, async (chunk) => {
    must(await db.from("external_items").upsert(chunk, { onConflict: "connection_id,external_id", ignoreDuplicates: true }), "insert items");
  });
  await inChunks(changed, 200, async (chunk) => {
    must(await db.from("external_items").upsert(chunk, { onConflict: "connection_id,external_id" }), "update items");
  });
  await inChunks(seenIds, 100, async (ids) => {
    must(await db.from("external_items").update({ last_seen_at: nowIso }).in("id", ids), "touch items");
  });
  for (const i of incoming) if (i.status === "cancelled" && !byExt.has(i.externalId)) counts.cancelled++;

  // Missing items: only inside the confirmed window, only from a complete feed.
  const winStart = opts.window.start.getTime();
  const winEnd = opts.window.end.getTime();
  for (const prev of existing) {
    if (seen.has(prev.external_id) || prev.state !== "active") continue;
    const t = ms(prev.starts_at);
    if (!(t >= winStart && t <= winEnd)) continue; // aged out (or beyond): keep as is
    if (!opts.allowRemovals) continue;
    const since = prev.missing_since ?? nowIso;
    const missing = prev.missing_count + 1;
    const confirmed = missing >= 2 && now.getTime() - Date.parse(since) >= REMOVAL_MIN_GAP_MS;
    if (confirmed) counts.removed++;
    else counts.pendingRemoval++;
    must(
      await db.from("external_items").update(confirmed ? { missing_count: missing, missing_since: since, state: "removed", removed_at: nowIso } : { missing_count: missing, missing_since: since }).eq("id", prev.id),
      "mark missing",
    );
  }

  // Settle every item (cheap: writes only where something differs).
  const all = await selectAll<ItemRow>((a, b) => db.from("external_items").select("*").eq("connection_id", conn.id).order("id").range(a, b));
  await settleItems(db, userId, zone, all, courses, { counts });
  return counts;
}

/** Links a new course to a space or project whose name clearly matches it (one match only). */
export function autoAssociate(courseName: string, spaces: { id: string; name: string }[], projects: { id: string; name: string; workspace_id: string | null }[]) {
  const n = normTitle(courseName);
  const code = courseName.match(/\b([A-Z]{2,5})[\s-]?(\d{2,4}[A-Z]?)\b/);
  const codeKey = code ? `${code[1]} ${code[2]}`.toLowerCase() : null;
  const matches = (name: string) => {
    const m = normTitle(name);
    if (!m) return false;
    if (m === n) return true;
    if (codeKey && (m === codeKey || m.replace(/\s/g, "") === codeKey.replace(/\s/g, ""))) return true;
    return m.length >= 6 && n.includes(m);
  };
  const p = projects.filter((x) => matches(x.name));
  if (p.length === 1) return { project_id: p[0].id, workspace_id: p[0].workspace_id, association: "auto" as const };
  const s = spaces.filter((x) => matches(x.name));
  if (s.length === 1) return { workspace_id: s[0].id, project_id: null, association: "auto" as const };
  return {};
}

// ---------------------------------------------------------------------------
// One run.

export type FetchFeed = (url: string, provider: FeedProvider) => Promise<string>;

export const defaultFetchFeed: FetchFeed = async (url, provider) =>
  (await withRetries(() => safeFetchText(url, provider.fetchPolicy()), { attempts: 3, baseMs: 1000 })).text;

export async function runSync(
  db: Db,
  connectionId: string,
  opts: { trigger: SyncTrigger; now?: Date; fetchFeed?: FetchFeed; prefetched?: string },
): Promise<SyncOutcome> {
  const now = opts.now ?? new Date();
  const realNow = new Date();
  const token = randomUUID();
  const claim = await db
    .from("integration_connections")
    .update({ lock_token: token, locked_until: new Date(realNow.getTime() + LOCK_SECONDS * 1000).toISOString(), last_attempt_at: realNow.toISOString() })
    .eq("id", connectionId)
    .or(`locked_until.is.null,locked_until.lt."${realNow.toISOString()}"`)
    .select("id,user_id,provider,display_host,status,consecutive_failures,item_count,last_success_at,locked_until")
    .maybeSingle();
  if (claim.error) throw new Error(`claim connection: ${claim.error.message}`);
  if (!claim.data) return { ok: false, code: "busy", message: "A sync is already running for this connection.", retryable: true };
  const conn = claim.data as ConnectionRow;
  const provider = providers[conn.provider];

  const { data: run } = await db.from("integration_sync_runs").insert({ user_id: conn.user_id, connection_id: conn.id, trigger: opts.trigger }).select("id").single();
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", conn.user_id).maybeSingle();
  const zone = profile?.timezone ?? "UTC";
  const window = provider.confirmedWindow(now);

  const release = async (patch: Record<string, unknown>) => {
    await db.from("integration_connections").update({ ...patch, lock_token: null, locked_until: null }).eq("id", conn.id).eq("lock_token", token);
  };

  try {
    let text = opts.prefetched;
    if (text === undefined) {
      const { data: secret, error } = await db.from("integration_secrets").select("ciphertext").eq("connection_id", conn.id).eq("user_id", conn.user_id).maybeSingle();
      if (error) throw new Error(`load secret: ${error.message}`);
      let url: string;
      try {
        if (!secret) throw new Error("missing");
        url = openSecret(secret.ciphertext, { userId: conn.user_id, connectionId: conn.id });
      } catch {
        throw new FeedError("secret", "secret unavailable");
      }
      text = await (opts.fetchFeed ?? defaultFetchFeed)(url, provider);
    }
    const expand = provider.expansionWindow(now);
    const parsed = parseIcs(text, { windowStart: expand.start, windowEnd: expand.end, defaultZone: zone });
    const items = provider.toItems(parsed, { host: conn.display_host, zone });

    const warnings: string[] = [];
    let allowRemovals = true;
    if (provider.maxFeedItems && parsed.rawEventCount >= provider.maxFeedItems) {
      allowRemovals = false;
      warnings.push(`${provider.name} sent its maximum of ${provider.maxFeedItems.toLocaleString("en-US")} items, so some may be missing. Navi didn't remove anything this time.`);
    }
    if (parsed.expansionCapped) {
      allowRemovals = false;
      warnings.push("A repeating event had too many occurrences to import them all.");
    }
    if (items.length === 0 && conn.item_count > 0) {
      allowRemovals = false;
      warnings.push(`${provider.name} sent an empty calendar. Navi kept what it imported before.`);
    }

    const counts = await reconcile(db, conn, items, { now, window, allowRemovals, zone });
    const status = warnings.length ? "partial" : "success";
    const { count } = await db.from("external_items").select("id", { count: "exact", head: true }).eq("connection_id", conn.id).eq("state", "active");
    const summary = { ...counts, warnings, at: realNow.toISOString(), trigger: opts.trigger };
    await release({
      status: "active",
      last_success_at: realNow.toISOString(),
      next_sync_at: new Date(realNow.getTime() + SYNC_EVERY_HOURS * 3600_000).toISOString(),
      consecutive_failures: 0,
      last_error: null,
      last_error_code: null,
      window_start: window.start.toISOString(),
      window_end: window.end.toISOString(),
      item_count: count ?? items.length,
      last_summary: summary,
    });
    if (run) await db.from("integration_sync_runs").update({ status, finished_at: new Date().toISOString(), counts: summary, window_start: window.start.toISOString(), window_end: window.end.toISOString() }).eq("id", run.id);
    if (counts.created || counts.removed || counts.restored) {
      const parts = [
        counts.created ? `added ${counts.created} item${counts.created === 1 ? "" : "s"}` : null,
        counts.removed ? `removed ${counts.removed} deleted in ${provider.name}` : null,
        counts.restored ? `restored ${counts.restored}` : null,
      ].filter(Boolean);
      await logActivity({ db, userId: conn.user_id, actor: "system", timezone: zone }, { action: "integration.sync", entityType: "integration_connections", entityId: conn.id, summary: `${provider.name} sync ${parts.join(", ")}` });
    }
    return { ok: true, status, counts, warnings };
  } catch (err) {
    const code = err instanceof FeedError ? err.code : "internal";
    const retryable = err instanceof FeedError ? err.retryable : true;
    const message = failureMessage(code, provider);
    // Never log the feed URL or its contents: only the code and an error class.
    console.error(`[integration sync] connection ${conn.id} failed: ${code}${err instanceof FeedError ? "" : ` (${err instanceof Error ? err.message.slice(0, 200) : "unknown"})`}`);
    const failures = conn.consecutive_failures + 1;
    await release({
      status: code === "http_auth" || code === "http_not_found" || code === "secret" ? "reauth" : "error",
      consecutive_failures: failures,
      last_error_code: code,
      last_error: message,
      next_sync_at: new Date(realNow.getTime() + backoffMs(failures, code)).toISOString(),
    });
    if (run) await db.from("integration_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: code, error: message }).eq("id", run.id);
    return { ok: false, code: code as FeedErrorCode, message, retryable };
  }
}

/** Scheduled entry point: syncs connections that are due, a few at a time. */
export async function syncDueConnections(db: Db, opts: { limit?: number; concurrency?: number; deadlineMs?: number; fetchFeed?: FetchFeed } = {}) {
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("integration_connections")
    .select("id")
    .lte("next_sync_at", nowIso)
    .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
    .order("next_sync_at")
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`due connections: ${error.message}`);
  const results: { id: string; ok: boolean; code?: string }[] = [];
  await pool(data ?? [], opts.concurrency ?? 4, async ({ id }) => {
    if (Date.now() - started > (opts.deadlineMs ?? 240_000)) return; // leave the rest for the next run
    try {
      const r = await runSync(db, id, { trigger: "schedule", fetchFeed: opts.fetchFeed });
      results.push({ id, ok: r.ok, code: r.ok ? undefined : r.code });
    } catch (err) {
      console.error(`[integration sync] connection ${id} crashed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}`);
      results.push({ id, ok: false, code: "internal" });
    }
  });
  return { due: data?.length ?? 0, synced: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.code) };
}

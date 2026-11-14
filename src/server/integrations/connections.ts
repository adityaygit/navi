import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { UserFacingError } from "@/server/http";
import { logActivity } from "@/server/domain/activity";
import { fingerprint, integrationCryptoReady, sealSecret } from "./crypto";
import { parseIcs } from "./ics/parse";
import { FeedError, safeFetchText, withRetries } from "./safe-fetch";
import { providers, type ProviderId } from "./providers/canvas";
import { failureMessage, runSync, settleItems, type CourseRow, type FetchFeed, type ItemRow, type SyncOutcome } from "./feed-sync";

// What the person can do with a feed connection. Every operation first proves
// the connection/course/item belongs to the signed-in user (ctx.userId), then
// writes with the service role, always filtered by that user id. Feed URLs are
// accepted here, encrypted, and never returned, logged or shown again.

type Deps = { admin?: SupabaseClient; fetchText?: (url: string, providerId: ProviderId) => Promise<string>; now?: Date };

const adminOf = (deps: Deps) => deps.admin ?? createSupabaseAdmin();

async function fetchForTest(url: string, providerId: ProviderId, deps: Deps): Promise<string> {
  if (deps.fetchText) return deps.fetchText(url, providerId);
  const provider = providers[providerId];
  return (await withRetries(() => safeFetchText(url, provider.fetchPolicy()), { attempts: 2, baseMs: 800 })).text;
}

const fetchFeedFrom = (deps: Deps): FetchFeed | undefined => (deps.fetchText ? (url, provider) => deps.fetchText!(url, provider.id) : undefined);

async function rateLimit(admin: SupabaseClient, userId: string, key: string, max: number, windowSeconds: number, message: string) {
  const { data, error } = await admin.rpc("integration_rate_hit", { p_user: userId, p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (error) throw new Error(`rate limit: ${error.message}`);
  if (data !== true) throw new UserFacingError(message, 429);
}

/** Validates, test-fetches and parses a pasted link. Returns the normalized URL and body; throws UserFacingError. */
async function checkFeed(providerId: ProviderId, input: string, zone: string, deps: Deps) {
  const provider = providers[providerId];
  let norm: { url: string; host: string };
  try {
    norm = provider.normalizeUrl(input);
  } catch (err) {
    if (err instanceof FeedError) throw new UserFacingError(failureMessage(err.code, provider), 400, { code: err.code });
    throw err;
  }
  let text: string;
  try {
    text = await fetchForTest(norm.url, providerId, deps);
    const now = deps.now ?? new Date();
    const win = provider.expansionWindow(now);
    parseIcs(text, { windowStart: win.start, windowEnd: win.end, defaultZone: zone });
  } catch (err) {
    if (err instanceof FeedError) throw new UserFacingError(failureMessage(err.code, provider), 400, { code: err.code });
    throw err;
  }
  return { ...norm, text };
}

function requireCrypto() {
  if (!integrationCryptoReady()) {
    throw new UserFacingError("Calendar connections aren't set up on this server yet (the encryption key is missing). The Navi owner needs to add NAVI_INTEGRATION_ENCRYPTION_KEY.", 503, { code: "not_configured" });
  }
}

async function ownedConnection(admin: SupabaseClient, userId: string, id: string) {
  const { data, error } = await admin.from("integration_connections").select("id,user_id,provider,display_host,last_attempt_at,status").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError("That connection doesn't exist (or isn't yours).", 404);
  return data as { id: string; user_id: string; provider: ProviderId; display_host: string; last_attempt_at: string | null; status: string };
}

export type ConnectResult = { connectionId: string; outcome: SyncOutcome };

/** Connect a feed: check it works, store it encrypted, import it right away. */
export async function connectFeed(ctx: Ctx, providerId: ProviderId, input: string, deps: Deps = {}): Promise<ConnectResult> {
  requireCrypto();
  const admin = adminOf(deps);
  await rateLimit(admin, ctx.userId, `connect:${providerId}`, 8, 15 * 60, "Too many connection attempts. Wait a few minutes and try again.");
  const checked = await checkFeed(providerId, input, ctx.timezone, deps);
  const fp = fingerprint(checked.url, ctx.userId);
  const { data: same } = await admin.from("integration_connections").select("id").eq("user_id", ctx.userId).eq("feed_fingerprint", fp).maybeSingle();
  if (same) throw new UserFacingError("That calendar is already connected.", 409, { code: "duplicate" });

  const id = randomUUID();
  const { error } = await admin.from("integration_connections").insert({ id, user_id: ctx.userId, provider: providerId, display_host: checked.host, feed_fingerprint: fp });
  if (error) {
    if (error.code === "23505") throw new UserFacingError("That calendar is already connected.", 409, { code: "duplicate" });
    throw new Error(`create connection: ${error.message}`);
  }
  const { error: secretErr } = await admin.from("integration_secrets").insert({ connection_id: id, user_id: ctx.userId, ciphertext: sealSecret(checked.url, { userId: ctx.userId, connectionId: id }) });
  if (secretErr) {
    await admin.from("integration_connections").delete().eq("id", id);
    throw new Error(`store secret: ${secretErr.message}`);
  }
  await logActivity({ ...ctx, db: admin }, { action: "integration.connect", entityType: "integration_connections", entityId: id, summary: `Connected ${providers[providerId].name} (${checked.host})` });
  const outcome = await runSync(admin, id, { trigger: "connect", prefetched: checked.text, now: deps.now, fetchFeed: fetchFeedFrom(deps) });
  return { connectionId: id, outcome };
}

/** Replace the stored link (e.g. after the person reset it in Canvas). Imported items are kept. */
export async function replaceFeedUrl(ctx: Ctx, connectionId: string, input: string, deps: Deps = {}): Promise<SyncOutcome> {
  requireCrypto();
  const admin = adminOf(deps);
  const conn = await ownedConnection(admin, ctx.userId, connectionId);
  await rateLimit(admin, ctx.userId, `connect:${conn.provider}`, 8, 15 * 60, "Too many connection attempts. Wait a few minutes and try again.");
  const checked = await checkFeed(conn.provider, input, ctx.timezone, deps);
  const fp = fingerprint(checked.url, ctx.userId);
  const { data: other } = await admin.from("integration_connections").select("id").eq("user_id", ctx.userId).eq("feed_fingerprint", fp).neq("id", conn.id).maybeSingle();
  if (other) throw new UserFacingError("That calendar is already connected separately.", 409, { code: "duplicate" });
  const { error } = await admin.from("integration_secrets").upsert({ connection_id: conn.id, user_id: ctx.userId, ciphertext: sealSecret(checked.url, { userId: ctx.userId, connectionId: conn.id }) }, { onConflict: "connection_id" });
  if (error) throw new Error(`store secret: ${error.message}`);
  await admin.from("integration_connections").update({ feed_fingerprint: fp, display_host: checked.host, status: "active", last_error: null, last_error_code: null, consecutive_failures: 0 }).eq("id", conn.id).eq("user_id", ctx.userId);
  await logActivity({ ...ctx, db: admin }, { action: "integration.relink", entityType: "integration_connections", entityId: conn.id, summary: `Updated the ${providers[conn.provider].name} feed link` });
  return runSync(admin, conn.id, { trigger: "manual", prefetched: checked.text, now: deps.now, fetchFeed: fetchFeedFrom(deps) });
}

/** "Refresh now". At most once a minute per connection and 20 times an hour per person. */
export async function refreshConnection(ctx: Ctx, connectionId: string, deps: Deps = {}): Promise<SyncOutcome> {
  const admin = adminOf(deps);
  const conn = await ownedConnection(admin, ctx.userId, connectionId);
  if (conn.last_attempt_at && Date.now() - Date.parse(conn.last_attempt_at) < 60_000) {
    throw new UserFacingError("Synced less than a minute ago. Try again shortly.", 429, { code: "too_soon" });
  }
  await rateLimit(admin, ctx.userId, "refresh", 20, 3600, "Too many refreshes this hour. Navi also syncs on its own every 6 hours.");
  const outcome = await runSync(admin, conn.id, { trigger: "manual", now: deps.now, fetchFeed: fetchFeedFrom(deps) });
  if (!outcome.ok && outcome.code === "busy") throw new UserFacingError("A sync is already running. Give it a moment.", 409, { code: "busy" });
  return outcome;
}

/**
 * Disconnect: deletes the encrypted link, the connection and everything
 * imported through it. Tasks the person made themselves are never touched.
 * `removeImported` also deletes the imported tasks still open and the imported
 * calendar events; finished imported tasks stay as history. Without it,
 * imported tasks and events stay as ordinary, editable Navi items.
 */
export async function disconnectFeed(ctx: Ctx, connectionId: string, opts: { removeImported: boolean }, deps: Deps = {}) {
  const admin = adminOf(deps);
  const conn = await ownedConnection(admin, ctx.userId, connectionId);
  const links: { task_id: string | null; event_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("external_items").select("task_id,event_id").eq("connection_id", conn.id).eq("user_id", ctx.userId).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    links.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const taskIds = links.map((l) => l.task_id).filter((x): x is string => !!x);
  const eventIds = links.map((l) => l.event_id).filter((x): x is string => !!x);
  let removedTasks = 0;
  let removedEvents = 0;
  for (let i = 0; i < taskIds.length; i += 100) {
    const ids = taskIds.slice(i, i + 100);
    if (opts.removeImported) {
      // Open (or parked) imported tasks go with their blocks; finished ones are history and stay.
      await admin.from("plan_blocks").delete().eq("user_id", ctx.userId).in("task_id", ids).in("status", ["planned", "in_progress"]);
      const { data } = await admin.from("tasks").delete().eq("user_id", ctx.userId).like("external_ref", "ext:%").in("id", ids).neq("status", "done").select("id");
      removedTasks += data?.length ?? 0;
    }
    // Whatever is left becomes an ordinary task the person can edit freely.
    await admin.from("tasks").update({ external_ref: null }).eq("user_id", ctx.userId).in("id", ids);
  }
  for (let i = 0; i < eventIds.length; i += 100) {
    const ids = eventIds.slice(i, i + 100);
    if (opts.removeImported) {
      const { data } = await admin.from("events").delete().eq("user_id", ctx.userId).like("external_ref", "ext:%").in("id", ids).select("id");
      removedEvents += data?.length ?? 0;
    } else {
      await admin.from("events").update({ external_ref: null, source: "user" }).eq("user_id", ctx.userId).in("id", ids);
    }
  }
  // Cascades: the secret, courses, items and sync runs.
  const { error } = await admin.from("integration_connections").delete().eq("id", conn.id).eq("user_id", ctx.userId);
  if (error) throw new Error(`disconnect: ${error.message}`);
  await logActivity({ ...ctx, db: admin }, {
    action: "integration.disconnect",
    summary: `Disconnected ${providers[conn.provider].name}${opts.removeImported ? ` and removed ${removedTasks} open task${removedTasks === 1 ? "" : "s"} and ${removedEvents} event${removedEvents === 1 ? "" : "s"} it imported` : "; imported items kept as your own"}`,
  });
  return { removedTasks, removedEvents };
}

// ---------------------------------------------------------------------------
// The person's choices about imported items and courses.

async function coursesOf(admin: SupabaseClient, connectionId: string) {
  const { data, error } = await admin.from("external_courses").select("id,course_key,name,excluded,workspace_id,project_id").eq("connection_id", connectionId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as CourseRow[]).map((c) => [c.id, c]));
}

async function ownedItem(admin: SupabaseClient, userId: string, itemId: string): Promise<ItemRow> {
  const { data, error } = await admin.from("external_items").select("*").eq("id", itemId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError("That imported item doesn't exist (or isn't yours).", 404);
  return data as ItemRow;
}

/** Hide an imported item (its task/event is set aside) or bring it back. */
export async function setItemHidden(ctx: Ctx, itemId: string, hidden: boolean, deps: Deps = {}) {
  const admin = adminOf(deps);
  const item = await ownedItem(admin, ctx.userId, itemId);
  const patch = hidden ? { hidden: true, hidden_reason: "user" as const } : { hidden: false, hidden_reason: null, possible_duplicate_task_id: null };
  // Bringing back an item whose task was deleted creates a fresh one.
  const extra = !hidden && item.materialized && !item.task_id && !item.event_id ? { materialized: false } : {};
  const { error } = await admin.from("external_items").update({ ...patch, ...extra }).eq("id", item.id).eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  await settleItems(admin, ctx.userId, ctx.timezone, [{ ...item, ...patch, ...extra }], await coursesOf(admin, item.connection_id));
}

/** A possible duplicate of the person's own task: import it anyway, or keep only theirs. */
export async function resolveDuplicate(ctx: Ctx, itemId: string, choice: "keep_both" | "use_mine", deps: Deps = {}) {
  const admin = adminOf(deps);
  const item = await ownedItem(admin, ctx.userId, itemId);
  if (item.hidden_reason !== "duplicate") throw new UserFacingError("That item isn't waiting for a duplicate decision.", 409);
  if (choice === "use_mine") {
    await admin.from("external_items").update({ hidden_reason: "user" }).eq("id", item.id).eq("user_id", ctx.userId);
    return;
  }
  await setItemHidden(ctx, itemId, false, deps);
}

/** Exclude a whole course (its items are set aside) or include it again. */
export async function setCourseExcluded(ctx: Ctx, courseId: string, excluded: boolean, deps: Deps = {}) {
  const admin = adminOf(deps);
  const { data: course, error } = await admin.from("external_courses").update({ excluded }).eq("id", courseId).eq("user_id", ctx.userId).select("connection_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!course) throw new UserFacingError("That course doesn't exist (or isn't yours).", 404);
  const { data: items } = await admin.from("external_items").select("*").eq("course_id", courseId).eq("user_id", ctx.userId);
  await settleItems(admin, ctx.userId, ctx.timezone, (items ?? []) as ItemRow[], await coursesOf(admin, course.connection_id));
}

/**
 * Link a course to one of the person's spaces or projects (or unlink it).
 * Imported tasks and events of the course move with it; their other
 * planning fields are untouched.
 */
export async function setCourseLink(ctx: Ctx, courseId: string, target: { kind: "workspace" | "project"; id: string } | null, deps: Deps = {}) {
  const admin = adminOf(deps);
  let workspace_id: string | null = null;
  let project_id: string | null = null;
  if (target) {
    // Read through the person's own (RLS) client: only their spaces/projects are visible.
    if (target.kind === "project") {
      const { data } = await ctx.db.from("projects").select("id,workspace_id").eq("id", target.id).maybeSingle();
      if (!data) throw new UserFacingError("That project doesn't exist (or isn't yours).", 404);
      project_id = data.id;
      workspace_id = data.workspace_id;
    } else {
      const { data } = await ctx.db.from("workspaces").select("id").eq("id", target.id).maybeSingle();
      if (!data) throw new UserFacingError("That space doesn't exist (or isn't yours).", 404);
      workspace_id = data.id;
    }
  }
  const { data: course, error } = await admin.from("external_courses").update({ workspace_id, project_id, association: target ? "user" : null }).eq("id", courseId).eq("user_id", ctx.userId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!course) throw new UserFacingError("That course doesn't exist (or isn't yours).", 404);
  const { data: items } = await admin.from("external_items").select("task_id,event_id").eq("course_id", courseId).eq("user_id", ctx.userId);
  const taskIds = (items ?? []).map((i) => i.task_id).filter((x): x is string => !!x);
  const eventIds = (items ?? []).map((i) => i.event_id).filter((x): x is string => !!x);
  for (let i = 0; i < taskIds.length; i += 100) await admin.from("tasks").update({ workspace_id, project_id }).eq("user_id", ctx.userId).in("id", taskIds.slice(i, i + 100));
  for (let i = 0; i < eventIds.length; i += 100) await admin.from("events").update({ workspace_id }).eq("user_id", ctx.userId).in("id", eventIds.slice(i, i + 100));
}

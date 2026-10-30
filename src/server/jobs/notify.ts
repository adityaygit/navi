import "server-only";
import webpush from "web-push";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";
import { endOfQuietHours, inQuietHours } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { pushEndpointAllowed } from "@/lib/push-endpoint";

// Notifications are deduplicated by (user, dedupe_key), held during the
// user's quiet hours, and delivered by web push to opted-in devices. Every
// attempt's outcome is recorded for the delivery diagnostics in Settings.

export function pushConfigured(): boolean {
  return Boolean(publicEnv.vapidPublicKey && serverEnv.vapidPrivateKey());
}

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(serverEnv.vapidSubject(), publicEnv.vapidPublicKey, serverEnv.vapidPrivateKey()!);
  vapidSet = true;
}

export async function queueNotification(
  db: SupabaseClient,
  profile: Profile,
  n: { kind: string; title: string; body: string; url: string; dedupeKey: string; expiresAt?: DateTime },
): Promise<boolean> {
  const now = DateTime.now().setZone(profile.timezone);
  const deliverAfter = endOfQuietHours(now, profile.quiet_hours_start, profile.quiet_hours_end);
  // A reminder that quiet hours would hold until after it stops mattering
  // (e.g. "due in 2 hours" delivered after the deadline) is not sent at all.
  if (n.expiresAt && deliverAfter >= n.expiresAt) return false;
  const { error } = await db.from("notifications").insert({
    user_id: profile.id,
    kind: n.kind,
    title: n.title,
    body: n.body.slice(0, 500),
    url: n.url,
    dedupe_key: n.dedupeKey,
    deliver_after: deliverAfter.toUTC().toISO(),
    status: deliverAfter > now ? "held_quiet_hours" : "queued",
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  return !error;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

export async function sendToSubscriptions(db: SupabaseClient, userId: string, payload: { title: string; body: string; url: string; tag: string }) {
  const { data: subs } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId);
  if (!subs?.length) return { sent: 0, failed: 0, none: true, errors: [] as string[] };
  ensureVapid();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const s of subs as Sub[]) {
    // Never send to anything but a real push service (rows can predate the check).
    if (!pushEndpointAllowed(s.endpoint)) {
      failed++;
      errors.push("unsupported push service");
      await db.from("push_subscriptions").delete().eq("id", s.id);
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "normal" });
      sent++;
      await db.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), last_error: null }).eq("id", s.id);
    } catch (err) {
      failed++;
      const statusCode = (err as { statusCode?: number }).statusCode;
      // A short, fixed description: the service's own response text isn't kept.
      const msg = statusCode ? `push service answered HTTP ${statusCode}` : "couldn't reach the push service";
      errors.push(msg);
      if (statusCode === 404 || statusCode === 410) {
        // The browser revoked this subscription; forget it.
        await db.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        await db.from("push_subscriptions").update({ last_error: msg.slice(0, 300) }).eq("id", s.id);
      }
    }
  }
  return { sent, failed, none: false, errors };
}

/** Deliver due notifications for one user (respecting quiet hours at send time too). */
export async function dispatchDue(db: SupabaseClient, profile: Profile) {
  const now = DateTime.now().setZone(profile.timezone);
  if (inQuietHours(now, profile.quiet_hours_start, profile.quiet_hours_end)) return 0;
  const { data: due } = await db
    .from("notifications")
    .select("*")
    .eq("user_id", profile.id)
    .in("status", ["queued", "held_quiet_hours"])
    .lte("deliver_after", new Date().toISOString())
    .lt("attempts", 3)
    .order("created_at")
    .limit(10);
  let delivered = 0;
  for (const n of due ?? []) {
    // Claim it by bumping its attempt count from the value read, so when two
    // scheduler runs overlap only one of them sends it.
    const { data: claimed } = await db
      .from("notifications")
      .update({ attempts: n.attempts + 1 })
      .eq("id", n.id)
      .eq("attempts", n.attempts)
      .in("status", ["queued", "held_quiet_hours"])
      .select("id");
    if (!claimed?.length) continue;
    if (!pushConfigured()) {
      await db.from("notifications").update({ status: "no_subscription", last_error: "Push is not configured on the server" }).eq("id", n.id);
      continue;
    }
    const r = await sendToSubscriptions(db, profile.id, { title: n.title, body: n.body, url: n.url, tag: n.dedupe_key });
    // A failed delivery (e.g. the push service was briefly down) is retried
    // later, 5 then 10 minutes on, before it's given up as failed.
    const attempts = n.attempts + 1;
    const retry = !r.none && r.sent === 0 && attempts < 3;
    const status = r.none ? "no_subscription" : r.sent > 0 ? "sent" : retry ? n.status : "failed";
    await db
      .from("notifications")
      .update({
        status,
        sent_at: r.sent ? new Date().toISOString() : null,
        last_error: r.errors.join("; ").slice(0, 300) || null,
        ...(retry ? { deliver_after: new Date(Date.now() + attempts * 5 * 60_000).toISOString() } : {}),
      })
      .eq("id", n.id);
    if (r.sent) delivered++;
  }
  return delivered;
}

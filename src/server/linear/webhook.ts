import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Prepared for real-time sync; not required (the scheduler reconciles every
// 30 minutes). Linear sends app webhooks per workspace that authorised the app
// (https://linear.app/developers/webhooks). Navi verifies the HMAC-SHA256
// signature of the raw body (Linear-Signature, hex) with LINEAR_WEBHOOK_SECRET
// and the webhookTimestamp (within 60 s), then only *asks* for a sync of the
// matching connections; the sync itself reads from the API as usual, so
// webhook bodies are never trusted as data.

const MAX_SKEW_MS = 60_000;

export function verifyLinearSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function freshTimestamp(ts: unknown, now = Date.now()): boolean {
  const n = Number(ts);
  return Number.isFinite(n) && Math.abs(now - n) <= MAX_SKEW_MS;
}

export type WebhookOutcome = "sync_requested" | "access_revoked" | "ignored";

/** Acts on a verified payload. Only touches connections for the payload's workspace. */
export async function handleLinearWebhook(admin: SupabaseClient, payload: Record<string, unknown>, clientId: string | null): Promise<WebhookOutcome> {
  const orgId = typeof payload.organizationId === "string" ? payload.organizationId : null;
  if (!orgId) return "ignored";
  const type = String(payload.type ?? "");
  const action = String(payload.action ?? "");

  if (type === "OAuthApp" && action === "revoked") {
    if (!clientId || payload.oauthClientId !== clientId) return "ignored";
    await admin
      .from("integration_connections")
      .update({ status: "needs_reauth", status_detail: "Navi's access was removed in Linear. Reconnect to keep syncing." })
      .eq("provider", "linear")
      .eq("external_org_id", orgId);
    return "access_revoked";
  }
  if (type === "Issue" || type === "Project") {
    await admin.from("integration_connections").update({ sync_requested_at: new Date().toISOString() }).eq("provider", "linear").eq("external_org_id", orgId).eq("status", "active");
    return "sync_requested";
  }
  return "ignored";
}

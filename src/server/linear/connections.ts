import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { linearGraphql, VIEWER_QUERY, type LinearViewer } from "./api";
import type { FetchLike, TokenSet } from "./oauth";
import { revokeToken } from "./oauth";
import { readTokensForRevoke, saveTokens } from "./tokens";
import { logActivity } from "@/server/domain/activity";

// Connection lifecycle. Writes use the service-role client (connections and
// tokens aren't writable through the API); every call is scoped to the
// signed-in person's user id, checked by the caller.

/** What Settings shows. No secrets. */
export type LinearConnectionView = {
  id: string;
  external_org_name: string | null;
  external_org_url_key: string | null;
  external_user_name: string | null;
  status: "active" | "needs_reauth";
  status_detail: string | null;
  last_sync_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
  last_sync_stats: { imported: number; updated: number; closed: number; detached: number; open: number; truncated: boolean } | null;
  sync_started_at: string | null;
  created_at: string;
};

export const CONNECTION_VIEW_COLUMNS = "id,external_org_name,external_org_url_key,external_user_name,status,status_detail,last_sync_at,last_sync_ok_at,last_sync_error,last_sync_stats,sync_started_at,created_at";

/** The person's Linear connections, read with their own (RLS) client. */
export async function listLinearConnections(db: SupabaseClient): Promise<LinearConnectionView[]> {
  const { data, error } = await db.from("integration_connections").select(CONNECTION_VIEW_COLUMNS).eq("provider", "linear").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as LinearConnectionView[];
}

/**
 * After a successful code exchange: identify the Linear user and workspace,
 * create or refresh the connection (reconnecting the same workspace reuses
 * it, so imported tasks keep their link), and store the tokens encrypted.
 */
export async function completeLinearConnection(admin: SupabaseClient, userId: string, tokens: TokenSet, f: FetchLike = fetch): Promise<{ id: string; orgName: string }> {
  const { viewer } = await linearGraphql<LinearViewer>(tokens.accessToken, VIEWER_QUERY, {}, f);
  const { data, error } = await admin
    .from("integration_connections")
    .upsert(
      {
        user_id: userId,
        provider: "linear",
        external_org_id: viewer.organization.id,
        external_org_name: viewer.organization.name,
        external_org_url_key: viewer.organization.urlKey,
        external_user_id: viewer.id,
        external_user_name: viewer.displayName || viewer.name,
        external_user_email: viewer.email,
        scopes: tokens.scopes,
        status: "active",
        status_detail: null,
        last_sync_error: null,
        sync_started_at: null,
      },
      { onConflict: "user_id,provider,external_org_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`Could not save the Linear connection: ${error.message}`);
  await saveTokens(admin, data.id, userId, tokens);
  await logActivity({ db: admin, userId, actor: "user", timezone: "UTC" }, { action: "connect", entityType: "integration_connections", entityId: data.id, summary: `Connected Linear workspace “${viewer.organization.name}” (read-only)` });
  return { id: data.id, orgName: viewer.organization.name };
}

/**
 * Disconnect: revoke Navi's tokens at Linear (best effort), then delete the
 * connection and its tokens. Imported tasks and projects stay as ordinary
 * Navi items (their Linear link and history are kept, so reconnecting the
 * same workspace picks them back up instead of duplicating them).
 */
export async function disconnectLinear(admin: SupabaseClient, userId: string, connectionId: string, f: FetchLike = fetch): Promise<{ revoked: boolean }> {
  const { data: conn } = await admin.from("integration_connections").select("id,external_org_name").eq("id", connectionId).eq("user_id", userId).maybeSingle();
  if (!conn) throw new Error("That Linear connection doesn't exist (or isn't yours)");
  const tokens = await readTokensForRevoke(admin, connectionId);
  let revoked = !tokens;
  if (tokens) {
    // Revoking the refresh token ends the whole grant; the access token too, in case it outlives it.
    const results = await Promise.all([tokens.refresh ? revokeToken(tokens.refresh, "refresh_token", f) : true, tokens.access ? revokeToken(tokens.access, "access_token", f) : true]);
    revoked = results.every(Boolean);
  }
  const { error } = await admin.from("integration_connections").delete().eq("id", connectionId).eq("user_id", userId);
  if (error) throw new Error(`Could not disconnect Linear: ${error.message}`);
  await logActivity({ db: admin, userId, actor: "user", timezone: "UTC" }, { action: "disconnect", entityType: "integration_connections", entityId: connectionId, summary: `Disconnected Linear workspace “${conn.external_org_name ?? "Linear"}”. Imported tasks stay in Navi.` });
  return { revoked };
}

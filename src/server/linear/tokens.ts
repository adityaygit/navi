import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { linearConfig } from "./config";
import { InvalidGrantError, refreshTokens, type FetchLike, type TokenSet } from "./oauth";

// Encrypted token storage and refresh. Access tokens last ~24h; refresh tokens
// rotate on every refresh, so only one refresher may run at a time: it takes a
// short lease on the row (refresh_lease_until) guarded by token_version.
// Others wait for the new version instead of spending the old refresh token.
// All reads/writes go through the service-role client; the table has no API access.

/** Refresh this long before expiry. */
const EARLY_MS = 5 * 60_000;
const LEASE_MS = 30_000;

/** The person must reconnect: the grant is gone (revoked, expired, app uninstalled). */
export class ReauthRequiredError extends Error {}

const ctxAccess = (connectionId: string) => `linear:access:${connectionId}`;
const ctxRefresh = (connectionId: string) => `linear:refresh:${connectionId}`;

type TokenRow = {
  connection_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  access_expires_at: string | null;
  token_version: number;
  refresh_lease_until: string | null;
};

export async function saveTokens(admin: SupabaseClient, connectionId: string, userId: string, t: TokenSet) {
  // A new grant bumps the version, so a refresh still running for the old grant can't overwrite it.
  const { data: current } = await admin.from("integration_tokens").select("token_version").eq("connection_id", connectionId).maybeSingle();
  const { error } = await admin.from("integration_tokens").upsert(
    {
      token_version: (current?.token_version ?? 0) + 1,
      connection_id: connectionId,
      user_id: userId,
      access_token_enc: encryptSecret(t.accessToken, ctxAccess(connectionId)),
      refresh_token_enc: t.refreshToken ? encryptSecret(t.refreshToken, ctxRefresh(connectionId)) : null,
      access_expires_at: t.expiresAt?.toISOString() ?? null,
      refresh_lease_until: null,
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new Error(`Could not save Linear tokens: ${error.message}`);
}

async function readRow(admin: SupabaseClient, connectionId: string): Promise<TokenRow> {
  const { data, error } = await admin.from("integration_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (error) throw new Error(`Could not read Linear tokens: ${error.message}`);
  if (!data) throw new ReauthRequiredError("No Linear tokens are stored for this connection");
  return data as TokenRow;
}

/** Decrypted tokens for revocation on disconnect. Null if none are stored. */
export async function readTokensForRevoke(admin: SupabaseClient, connectionId: string): Promise<{ access: string | null; refresh: string | null } | null> {
  const { data } = await admin.from("integration_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!data) return null;
  const row = data as TokenRow;
  const safe = (fn: () => string) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  return {
    access: safe(() => decryptSecret(row.access_token_enc, ctxAccess(connectionId))),
    refresh: row.refresh_token_enc ? safe(() => decryptSecret(row.refresh_token_enc!, ctxRefresh(connectionId))) : null,
  };
}

const fresh = (row: TokenRow, now: number) => !row.access_expires_at || Date.parse(row.access_expires_at) - EARLY_MS > now;

/**
 * A usable access token for the connection, refreshing (and rotating the
 * refresh token) when it's expired or about to be. `force`: refresh even if
 * it looks valid (the API just rejected it).
 */
export async function getAccessToken(admin: SupabaseClient, connectionId: string, opts: { force?: boolean; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let row = await readRow(admin, connectionId);
  const startVersion = row.token_version;
  if (!opts.force && fresh(row, Date.now())) return decryptSecret(row.access_token_enc, ctxAccess(connectionId));
  if (!row.refresh_token_enc) throw new ReauthRequiredError("The Linear access token expired and there is no refresh token");

  // Take the lease for this version. If someone else holds it (or already rotated), wait for their result.
  const now = new Date();
  const { data: claimed, error } = await admin
    .from("integration_tokens")
    .update({ refresh_lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("connection_id", connectionId)
    .eq("token_version", row.token_version)
    .or(`refresh_lease_until.is.null,refresh_lease_until.lt.${now.toISOString()}`)
    .select("connection_id");
  if (error) throw new Error(`Could not lock Linear tokens: ${error.message}`);

  if (!claimed?.length) {
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      row = await readRow(admin, connectionId);
      if (row.token_version > startVersion) return decryptSecret(row.access_token_enc, ctxAccess(connectionId));
      if (!row.refresh_lease_until || Date.parse(row.refresh_lease_until) < Date.now()) break;
    }
    throw new Error("Another Linear token refresh is still running; try again shortly");
  }

  const cfg = linearConfig();
  if (!cfg) throw new Error("Linear isn't configured on the server");
  const refreshToken = decryptSecret(row.refresh_token_enc, ctxRefresh(connectionId));
  let next: TokenSet;
  try {
    next = await refreshTokens(cfg, refreshToken, opts.fetch);
  } catch (err) {
    await admin.from("integration_tokens").update({ refresh_lease_until: null }).eq("connection_id", connectionId).eq("token_version", row.token_version);
    if (err instanceof InvalidGrantError) throw new ReauthRequiredError("Linear access was revoked or the refresh token expired");
    throw err;
  }
  // Rotation: store the new pair (keep the old refresh token only if Linear didn't send one).
  const { error: saveErr } = await admin
    .from("integration_tokens")
    .update({
      access_token_enc: encryptSecret(next.accessToken, ctxAccess(connectionId)),
      refresh_token_enc: next.refreshToken ? encryptSecret(next.refreshToken, ctxRefresh(connectionId)) : row.refresh_token_enc,
      access_expires_at: next.expiresAt?.toISOString() ?? null,
      token_version: row.token_version + 1,
      refresh_lease_until: null,
    })
    .eq("connection_id", connectionId)
    .eq("token_version", row.token_version);
  // If this write failed, Linear lets the same refresh token be retried for 30 minutes to recover the new pair.
  if (saveErr) throw new Error(`Could not save refreshed Linear tokens: ${saveErr.message}`);
  return next.accessToken;
}

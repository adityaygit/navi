import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { LINEAR_AUTHORIZE_URL, LINEAR_REVOKE_URL, LINEAR_SCOPES, LINEAR_TOKEN_URL, type LinearConfig } from "./config";
import { decryptSecret, encryptSecret } from "@/server/crypto";

// OAuth 2.0 authorization-code flow with PKCE (S256) and a CSRF state, per
// https://linear.app/developers/oauth-2-0-authentication. The state and PKCE
// verifier live in an encrypted, httpOnly cookie scoped to the integration
// routes; the callback must present the same state, for the same signed-in
// Navi user, within 10 minutes. Token exchange happens server-side only.

export const STATE_COOKIE = "navi_linear_oauth";
export const STATE_COOKIE_PATH = "/api/integrations/linear";
export const STATE_TTL_SECONDS = 600;
const STATE_CONTEXT = "linear:oauth-state";

export type FetchLike = typeof fetch;

export type OAuthState = { state: string; verifier: string; userId: string; issuedAt: number };

export function newOAuthState(userId: string, now = Date.now()): OAuthState {
  return { state: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"), userId, issuedAt: now };
}

export function sealState(s: OAuthState): string {
  return encryptSecret(JSON.stringify(s), STATE_CONTEXT);
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizeUrl(cfg: LinearConfig, s: OAuthState): string {
  const url = new URL(LINEAR_AUTHORIZE_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LINEAR_SCOPES.join(","));
  url.searchParams.set("state", s.state);
  url.searchParams.set("code_challenge", codeChallenge(s.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the consent screen, so the person can pick which workspace to connect.
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export type StateCheck = { ok: true; verifier: string } | { ok: false; reason: "missing" | "invalid" | "mismatch" | "expired" | "other_user" };

/** Validates the callback's `state` against the sealed cookie. Constant-time comparison. */
export function checkState(sealed: string | undefined, given: string | null, userId: string, now = Date.now()): StateCheck {
  if (!sealed || !given) return { ok: false, reason: "missing" };
  let s: OAuthState;
  try {
    s = JSON.parse(decryptSecret(sealed, STATE_CONTEXT)) as OAuthState;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const a = Buffer.from(String(s.state ?? ""));
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };
  if (!Number.isFinite(s.issuedAt) || now - s.issuedAt > STATE_TTL_SECONDS * 1000 || now < s.issuedAt - 60_000) return { ok: false, reason: "expired" };
  if (s.userId !== userId) return { ok: false, reason: "other_user" };
  return { ok: true, verifier: s.verifier };
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scopes: string[] };

/** The provider said the grant is no longer valid (revoked, expired, already used): the person must reconnect. */
export class InvalidGrantError extends Error {}

function parseScopes(scope: unknown): string[] {
  if (Array.isArray(scope)) return scope.map(String);
  if (typeof scope === "string") return scope.split(/[\s,]+/).filter(Boolean);
  return [];
}

async function tokenRequest(form: Record<string, string>, f: FetchLike): Promise<TokenSet> {
  const res = await f(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (gateway error page): handled below by status.
  }
  if (!res.ok) {
    const code = String(body.error ?? "");
    // Never include the response body verbatim: it could echo request values.
    if (res.status === 400 && code === "invalid_grant") throw new InvalidGrantError(`Linear refused the grant (${code})`);
    if (res.status === 401 || code === "invalid_client") throw new Error(`Linear rejected Navi's client credentials (${code || res.status})`);
    throw new Error(`Linear token endpoint returned ${res.status}${code ? ` (${code})` : ""}`);
  }
  if (typeof body.access_token !== "string" || !body.access_token) throw new Error("Linear token response had no access token");
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    scopes: parseScopes(body.scope),
  };
}

export function exchangeCode(cfg: LinearConfig, code: string, verifier: string, f: FetchLike = fetch): Promise<TokenSet> {
  return tokenRequest(
    { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: verifier },
    f,
  );
}

/** Refresh tokens rotate: the response carries a new refresh token that replaces the old one. */
export function refreshTokens(cfg: LinearConfig, refreshToken: string, f: FetchLike = fetch): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }, f);
}

/** Best effort: true when Linear confirmed the token is revoked (or was already unusable). */
export async function revokeToken(token: string, hint: "access_token" | "refresh_token", f: FetchLike = fetch): Promise<boolean> {
  try {
    const res = await f(LINEAR_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: hint }).toString(),
      cache: "no-store",
    });
    // 400 = already revoked; 401 = token no longer authenticates. Either way it's unusable.
    return res.ok || res.status === 400 || res.status === 401;
  } catch {
    return false;
  }
}

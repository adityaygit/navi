import "server-only";
import { publicEnv } from "@/lib/env";
import { encryptionConfigured } from "@/server/crypto";

// Linear OAuth app settings, read from the server environment only:
//   LINEAR_CLIENT_ID       OAuth app client id (not secret, but kept server-side)
//   LINEAR_CLIENT_SECRET   OAuth app client secret (never sent to the browser)
//   LINEAR_REDIRECT_URL    optional; defaults to <NEXT_PUBLIC_SITE_URL>/api/integrations/linear/callback.
//                          Must exactly match a callback URL registered on the Linear app.
//   LINEAR_WEBHOOK_SECRET  optional; signing secret for the app webhook (future real-time sync)
//   NAVI_TOKEN_ENCRYPTION_KEY  encrypts stored tokens (see src/server/crypto.ts)

export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
export const CALLBACK_PATH = "/api/integrations/linear/callback";
/** Read-only: Navi never writes to Linear in this version. */
export const LINEAR_SCOPES = ["read"];

export type LinearConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function linearRedirectUri(): string {
  return process.env.LINEAR_REDIRECT_URL?.trim() || `${publicEnv.siteUrl.replace(/\/$/, "")}${CALLBACK_PATH}`;
}

/** What's missing before people can connect Linear (names of server settings). Empty = ready. */
export function linearMissingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.LINEAR_CLIENT_ID?.trim()) missing.push("LINEAR_CLIENT_ID");
  if (!process.env.LINEAR_CLIENT_SECRET?.trim()) missing.push("LINEAR_CLIENT_SECRET");
  if (!encryptionConfigured()) missing.push("NAVI_TOKEN_ENCRYPTION_KEY");
  return missing;
}

export function linearConfig(): LinearConfig | null {
  if (linearMissingConfig().length) return null;
  return { clientId: process.env.LINEAR_CLIENT_ID!.trim(), clientSecret: process.env.LINEAR_CLIENT_SECRET!.trim(), redirectUri: linearRedirectUri() };
}

export function linearWebhookSecret(): string | null {
  return process.env.LINEAR_WEBHOOK_SECRET?.trim() || null;
}

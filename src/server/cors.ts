// CORS and bearer-token helpers for the Navi phone app (Capacitor). Pure, no
// server-only imports: the proxy (src/proxy.ts) uses them, and so do tests.
//
// The app is a bundled SPA served from these origins inside the native shell;
// it signs in with Supabase directly and calls the API with
// `Authorization: Bearer <access token>`. No cookies cross origins, so
// credentials are never allowed here and the origin list is exact (no wildcard).

/** Origins the phone app runs on. */
export const MOBILE_ORIGINS: readonly string[] = [
  "capacitor://localhost", // iPhone (Capacitor's iOS scheme)
  "https://localhost", // Android (androidScheme "https")
  "http://localhost", // Android with the http scheme
  "http://localhost:5173", // the app's own dev server (vite) while developing it
];

/** API paths the phone app may call cross-origin. */
const CORS_PREFIXES = ["/api/m/", "/api/voice/"];
const CORS_EXACT = ["/api/m", "/api/chat", "/api/capture"];

export function isCorsPath(path: string): boolean {
  return CORS_EXACT.includes(path) || CORS_PREFIXES.some((p) => path.startsWith(p));
}

export function isAllowedOrigin(origin: string | null | undefined): origin is string {
  return !!origin && MOBILE_ORIGINS.includes(origin);
}

const ALLOW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type, Accept";
/** Preflight results may be cached by the app for 10 minutes. */
const MAX_AGE = "600";

/**
 * Headers for a response to `origin` on a CORS path. Empty for any other
 * origin (the browser then blocks the response), except `Vary: Origin`, which
 * every CORS-path response carries so caches never mix them up.
 */
export function corsHeaders(origin: string | null | undefined, preflight = false): Record<string, string> {
  if (!isAllowedOrigin(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    ...(preflight ? { "Access-Control-Allow-Methods": ALLOW_METHODS, "Access-Control-Allow-Headers": ALLOW_HEADERS, "Access-Control-Max-Age": MAX_AGE } : {}),
  };
}

/**
 * The token of an `Authorization: Bearer <token>` header, or null. Only a
 * plausible JWT (three base64url parts) counts, so junk never reaches Supabase.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** The request asks with a bearer header at all (valid-looking or not). */
export function hasBearer(header: string | null | undefined): boolean {
  return !!header && /^Bearer\s/i.test(header);
}

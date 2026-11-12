// Where the OAuth routes send the person back to, with a short result code
// Settings turns into a sentence. Codes only: no provider text is echoed.

export const LINEAR_RESULTS = {
  connected: "Linear is connected. Your assigned issues are in Tasks.",
  connected_sync_failed: "Linear is connected, but the first import didn't finish. Navi will retry shortly, or use Sync now.",
  denied: "Linear wasn't connected: access was not granted.",
  state: "Linear wasn't connected: the sign-in link expired or didn't match. Please try again.",
  exchange: "Linear wasn't connected: Linear didn't accept the sign-in. Please try again.",
  not_configured: "Linear can't be connected yet: the server isn't configured for it.",
  error: "Linear wasn't connected because of a server error. Please try again.",
} as const;

export type LinearResult = keyof typeof LINEAR_RESULTS;

export function settingsUrl(origin: string, result: LinearResult, extra: Record<string, string> = {}): URL {
  const url = new URL("/settings", origin);
  url.searchParams.set("linear", result);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.hash = "services";
  return url;
}

export function linearResultMessage(code: string | undefined | null): string | null {
  return code && code in LINEAR_RESULTS ? LINEAR_RESULTS[code as LinearResult] : null;
}

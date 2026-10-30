// The server POSTs to whatever endpoint a push subscription names, so only
// the browsers' real push services are accepted (otherwise a signed-in user
// could make the server send requests into internal networks). Local test
// endpoints are allowed only outside production, or when a test run opts in
// with NAVI_ALLOW_LOCAL_PUSH=true.

const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, most Chromium browsers
  /^(.+\.)?push\.apple\.com$/, // Safari / iOS (web.push.apple.com)
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^(.+\.)?notify\.windows\.com$/, // Edge on Windows (WNS)
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function localPushAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.NAVI_ALLOW_LOCAL_PUSH === "true";
}

export function pushEndpointAllowed(endpoint: string, allowLocal = localPushAllowed()): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (allowLocal && LOCAL_HOSTS.has(host) && (url.protocol === "https:" || url.protocol === "http:")) return true;
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(host));
}

// Which URLs the Navi window may show, and which open in the person's own
// browser instead. Pure, so it is unit-tested (test/navigation.test.js).

/** Hosts that sign-in may pass through inside the window (Supabase auth). */
function authHosts(appUrl, supabaseUrl) {
  const hosts = new Set();
  if (supabaseUrl) {
    try {
      hosts.add(new URL(supabaseUrl).host);
    } catch {}
  }
  return hosts;
}

/**
 * "app": stays in the window. "external": opened in the default browser.
 * "block": not opened at all (non-web schemes such as file:, javascript:).
 */
function classify(target, appUrl, supabaseUrl) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return "block";
  }
  if (url.protocol === "mailto:") return "external";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "block";
  const app = new URL(appUrl);
  if (url.origin === app.origin) return "app";
  if (authHosts(appUrl, supabaseUrl).has(url.host) && url.pathname.startsWith("/auth/")) return "app";
  // Plain http only for a local development server.
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return "block";
  return "external";
}

/** Only the app itself may use the microphone and notifications. */
function permissionAllowed(permission, requestingUrl, appUrl) {
  let origin;
  try {
    origin = new URL(requestingUrl).origin;
  } catch {
    return false;
  }
  if (origin !== new URL(appUrl).origin) return false;
  return ["media", "notifications", "clipboard-sanitized-write", "fullscreen"].includes(permission);
}

module.exports = { classify, permissionAllowed };

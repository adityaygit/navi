// Plain-language labels for push diagnostics in Settings. The endpoint itself
// is never sent to the page: only which push service and device it belongs to.

export function pushServiceLabel(endpoint: string): string {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return "Unknown push service";
  }
  if (/(^|\.)push\.apple\.com$/.test(host)) return "Apple";
  if (host === "fcm.googleapis.com") return "Google";
  if (host === "updates.push.services.mozilla.com") return "Mozilla";
  if (/(^|\.)notify\.windows\.com$/.test(host)) return "Microsoft";
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "Local test";
  return "Unknown push service";
}

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux|CrOS/.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (os && browser) return `${browser} on ${os}`;
  return os ?? browser ?? "Unknown device";
}

export type NotificationStatus = "queued" | "sent" | "held_quiet_hours" | "failed" | "no_subscription" | "read";

export const NOTIFICATION_STATUS_TEXT: Record<NotificationStatus, string> = {
  queued: "waiting to send",
  sent: "delivered to the push service",
  held_quiet_hours: "held for quiet hours",
  failed: "failed",
  no_subscription: "not sent: no device had notifications on",
  read: "opened",
};

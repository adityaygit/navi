import { DateTime } from "luxon";

/**
 * What the person has open, in words: the "Looking at" chip on the Navi panel,
 * and the line sent with each chat message so Navi answers about what's on
 * screen. Built only from the URL (never stored). Unknown pages fall back to
 * the page's own name.
 */
export function viewingLabel(pathname: string, search: URLSearchParams | null, zone: string, now: DateTime = DateTime.now()): string {
  const today = now.setZone(zone).toISODate()!;
  const dayName = (iso: string | null) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return now.setZone(zone).toFormat("cccc");
    const d = DateTime.fromISO(iso, { zone });
    if (!d.isValid) return now.setZone(zone).toFormat("cccc");
    if (iso === today) return d.toFormat("cccc");
    return d.toFormat("cccc, LLL d");
  };
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "Home";
  if (p === "/tasks") {
    const tab = search?.get("tab") ?? "today";
    const names: Record<string, string> = { today: "Today", upcoming: "Upcoming", anytime: "Anytime", someday: "Someday" };
    return `Tasks, ${names[tab] ?? "Today"}`;
  }
  if (p === "/planner") {
    const date = search?.get("date") ?? null;
    if (search?.get("view") === "calendar") {
      const span = search.get("span") === "day" ? "day" : "week";
      if (span === "day") return `Calendar, ${dayName(date)}`;
      const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? DateTime.fromISO(date, { zone }) : now.setZone(zone);
      const monday = base.startOf("week");
      return `Calendar, week of ${monday.toFormat("LLL d")}`;
    }
    return `My day, ${dayName(date)}`;
  }
  if (p === "/inbox") return "Inbox";
  if (p === "/focus") return "Focus";
  if (p.startsWith("/projects/")) return "A project";
  const simple: Record<string, string> = {
    "/projects": "Projects and goals",
    "/insights": "Insights",
    "/memory": "Memory",
    "/notes": "Notes",
    "/activity": "Activity",
    "/settings": "Settings",
    "/review": "Review",
    "/chat": "Chats",
  };
  return simple[p] ?? "Navi";
}

/** "⌘K" on Apple devices, "Ctrl K" elsewhere (Windows, Linux, ChromeOS). */
export function shortcutLabel(platform: string | undefined | null, key = "K"): string {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "") ? `⌘${key}` : `Ctrl ${key}`;
}

/** True when the platform string is an Apple one (Cmd is the modifier there). */
export function isApplePlatform(platform: string | undefined | null): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

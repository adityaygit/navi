import { DateTime } from "luxon";
import { FeedError, type FetchPolicy } from "../safe-fetch";
import type { IcsOccurrence, ParsedFeed } from "../ics/parse";
import type { FeedProvider, NormalizedItem } from "./types";

// Canvas LMS through the person's private Calendar Feed (Canvas → Calendar →
// Calendar Feed). No OAuth, developer keys or API tokens.
//
// Canvas facts this relies on:
//  - The feed covers 30 days back and 366 days ahead, at most 1,000 items.
//  - Canvas "To Do" items are not in it; submission state is not in it.
//  - UIDs look like event-assignment-123 / event-calendar-event-456; SUMMARY
//    ends with "[Course name]"; URL points into the course on the Canvas host.
//  - Hosted Canvas lives on *.instructure.com. Schools with their own domain
//    are allowed by the server owner via NAVI_CANVAS_ALLOWED_HOSTS.

const PAST_DAYS = 30;
const FUTURE_DAYS = 366;
/** Removals are only considered this far inside Canvas's window. */
const MARGIN_DAYS = 2;
const FEED_PATH = /^\/feeds\/calendars\/(user|course|group)_[A-Za-z0-9_-]{8,200}\.ics$/;

type HostRules = { exact: Set<string>; suffixes: string[] };

export function canvasHostRules(env = process.env.NAVI_CANVAS_ALLOWED_HOSTS): HostRules {
  const entries = (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const exact = new Set<string>();
  const suffixes = [".instructure.com"];
  for (const e of entries) {
    if (e.startsWith("*.")) {
      if (e.split(".").length >= 3) suffixes.push(e.slice(1));
    } else if (/^[a-z0-9.-]+$/.test(e) && e.includes(".")) exact.add(e);
  }
  return { exact, suffixes };
}

export function isCanvasHost(host: string, rules = canvasHostRules()): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(h) || h.includes("..")) return false;
  return rules.exact.has(h) || rules.suffixes.some((s) => h.endsWith(s) && h.length > s.length);
}

/** Development-only escape hatch for a local fixture server (never in production). */
export function localFeedsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NAVI_ALLOW_LOCAL_FEEDS === "true";
}

function isLocalTestUrl(url: URL): boolean {
  return localFeedsAllowed() && url.protocol === "http:" && url.hostname === "localhost" && FEED_PATH.test(url.pathname);
}

/** Every hop (first URL and each redirect) must be a Canvas feed on HTTPS port 443. */
export function isAllowedCanvasFeedUrl(url: URL, rules = canvasHostRules()): boolean {
  if (isLocalTestUrl(url)) return true;
  return url.protocol === "https:" && (url.port === "" || url.port === "443") && !url.username && !url.password && isCanvasHost(url.hostname, rules) && FEED_PATH.test(url.pathname);
}

export function normalizeCanvasFeedUrl(input: string, rules = canvasHostRules()): { url: string; host: string } {
  const raw = input.trim().replace(/^<|>$/g, "");
  if (!raw || raw.length > 2000 || /\s/.test(raw)) throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  // webcal:// is the same feed over HTTPS.
  const withScheme = raw.replace(/^webcals?:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  }
  if (isLocalTestUrl(url)) return { url: url.toString(), host: url.host };
  if (url.protocol === "http:") throw new FeedError("invalid_url", "Use the https:// (or webcal://) link Canvas shows.");
  if (url.protocol !== "https:") throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  if (url.username || url.password) throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  if (url.port && url.port !== "443") throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isCanvasHost(url.hostname, rules)) throw new FeedError("host_not_allowed", "That link isn't from a Canvas site Navi recognizes.");
  if (url.search) throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link.");
  if (!FEED_PATH.test(url.pathname)) throw new FeedError("invalid_url", "That doesn't look like a Canvas calendar feed link. It should end in .ics.");
  return { url: url.toString(), host: url.hostname };
}

const COURSE_IN_URL = /\/courses\/(\d{1,20})(?:\/|$)/;
const CONTEXT_IN_URL = /[?&]include_contexts=(course|group)_(\d{1,20})/;
const BRACKET = /\s*\[([^[\]]{1,200})\]\s*$/;

/** The course an occurrence belongs to: from the Canvas link, else the "[Course]" suffix. */
export function canvasCourse(occ: Pick<IcsOccurrence, "summary" | "url">): { key: string; name: string } | null {
  const name = occ.summary.match(BRACKET)?.[1]?.trim() ?? null;
  const url = occ.url ?? "";
  const id = url.match(COURSE_IN_URL)?.[1];
  if (id) return { key: `course_${id}`, name: name ?? `Course ${id}` };
  const ctx = url.match(CONTEXT_IN_URL);
  if (ctx) return { key: `${ctx[1]}_${ctx[2]}`, name: name ?? `${ctx[1] === "group" ? "Group" : "Course"} ${ctx[2]}` };
  if (name) return { key: `name:${name.toLowerCase().replace(/\s+/g, " ")}`, name };
  return null;
}

export function isCanvasAssignment(uid: string): boolean {
  return /assignment/i.test(uid);
}

/** Keep only https links back into the feed's own Canvas site. */
export function safeCanvasLink(url: string | null, feedHost: string, rules = canvasHostRules()): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h !== feedHost.toLowerCase() && !isCanvasHost(h, rules)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function toCanvasItems(feed: ParsedFeed, ctx: { host: string; zone: string }): NormalizedItem[] {
  const rules = canvasHostRules();
  // Course from the Canvas link (only links back into Canvas count); an item
  // known only by its "[Course]" suffix joins the same-named course if there is one.
  const linked = feed.occurrences.map((o) => ({ o, url: safeCanvasLink(o.url, ctx.host, rules) }));
  const keyByName = new Map<string, string>();
  for (const { o, url } of linked) {
    const c = canvasCourse({ summary: o.summary, url });
    if (c && !c.key.startsWith("name:")) keyByName.set(c.name.toLowerCase(), c.key);
  }
  return linked.map(({ o, url }) => {
    let course = canvasCourse({ summary: o.summary, url });
    if (course?.key.startsWith("name:")) course = { ...course, key: keyByName.get(course.name.toLowerCase()) ?? course.key };
    const startsAt = o.start.allDay ? DateTime.fromISO(o.start.date, { zone: ctx.zone }).startOf("day").toUTC().toISO()! : o.start.utc;
    const endsAt = !o.end ? null : o.end.allDay ? DateTime.fromISO(o.end.date, { zone: ctx.zone }).startOf("day").toUTC().toISO()! : o.end.utc;
    return {
      externalId: o.recurrenceId ? `${o.uid}@@${o.recurrenceId}` : o.uid,
      uid: o.uid,
      recurrenceId: o.recurrenceId,
      kind: isCanvasAssignment(o.uid) ? "assignment" : "event",
      title: o.summary,
      description: o.description,
      url,
      location: o.location,
      course,
      startsAt,
      endsAt,
      allDay: o.start.allDay,
      allDayDate: o.start.allDay ? o.start.date : null,
      status: o.status,
    };
  });
}

export const canvasProvider: FeedProvider = {
  id: "canvas",
  name: "Canvas",
  normalizeUrl: (input) => normalizeCanvasFeedUrl(input),
  fetchPolicy: (): FetchPolicy => ({
    isAllowedUrl: (u) => isAllowedCanvasFeedUrl(u),
    allowLoopback: localFeedsAllowed(),
    maxBytes: 5 * 1024 * 1024,
    timeoutMs: 20_000,
    maxRedirects: 3,
  }),
  confirmedWindow: (now) => ({
    start: DateTime.fromJSDate(now, { zone: "UTC" }).minus({ days: PAST_DAYS - MARGIN_DAYS }).toJSDate(),
    end: DateTime.fromJSDate(now, { zone: "UTC" }).plus({ days: FUTURE_DAYS - MARGIN_DAYS }).toJSDate(),
  }),
  expansionWindow: (now) => ({
    start: DateTime.fromJSDate(now, { zone: "UTC" }).minus({ days: PAST_DAYS + 1 }).toJSDate(),
    end: DateTime.fromJSDate(now, { zone: "UTC" }).plus({ days: FUTURE_DAYS + 1 }).toJSDate(),
  }),
  maxFeedItems: 1000,
  toItems: toCanvasItems,
  feedHelp: "In Canvas, open Calendar, choose Calendar Feed, and copy the link.",
};

export const providers = { canvas: canvasProvider } as const;
export type ProviderId = keyof typeof providers;

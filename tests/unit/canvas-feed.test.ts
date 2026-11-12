import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canvasHostRules, normalizeCanvasFeedUrl, safeCanvasLink, toCanvasItems, canvasProvider, canvasCourse } from "@/server/integrations/providers/canvas";
import { FeedError, isBlockedAddress, safeFetchText, withRetries, type Transport } from "@/server/integrations/safe-fetch";
import { parseIcs } from "@/server/integrations/ics/parse";
import { sanitizeText } from "@/server/integrations/ics/text";
import { fingerprint, openSecret, sealSecret } from "@/server/integrations/crypto";
import { autoAssociate, backoffMs, dueFor, normTitle } from "@/server/integrations/feed-sync";

const FIX = path.resolve(__dirname, "../fixtures/canvas");
const v1 = readFileSync(path.join(FIX, "feed-v1.ics"), "utf8");
const NOW = new Date("2026-11-12T15:00:00Z");
const FEED = "https://navi-u.instructure.com/feeds/calendars/user_AbCdEf0123456789xyzAbCdEf0123456789xyz.ics";

async function code(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e instanceof FeedError ? e.code : `other:${(e as Error).message}`;
  }
  return "no error";
}

describe("Canvas feed URL", () => {
  it("accepts https and normalizes webcal", () => {
    expect(normalizeCanvasFeedUrl(FEED)).toEqual({ url: FEED, host: "navi-u.instructure.com" });
    expect(normalizeCanvasFeedUrl(FEED.replace("https://", "webcal://")).url).toBe(FEED);
    expect(normalizeCanvasFeedUrl(`  ${FEED.replace("navi-u", "NAVI-U")}  `).url).toBe(FEED);
  });
  it("rejects anything that isn't a Canvas feed", async () => {
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace("https://", "http://")))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace("navi-u.instructure.com", "evil.example.com")))).toBe("host_not_allowed");
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace("navi-u.instructure.com", "instructure.com.evil.io")))).toBe("host_not_allowed");
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace("navi-u.instructure.com", "169.254.169.254")))).toBe("host_not_allowed");
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace("https://", "https://user:pw@")))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl(FEED.replace(".com/", ".com:8443/")))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl(`${FEED}?x=1`))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl("https://navi-u.instructure.com/courses/1/assignments"))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl("file:///etc/passwd"))).toBe("invalid_url");
    expect(await code(() => normalizeCanvasFeedUrl("not a url"))).toBe("invalid_url");
  });
  it("allows a school's own Canvas domain only when configured", async () => {
    const own = FEED.replace("navi-u.instructure.com", "canvas.navi.edu");
    expect(await code(() => normalizeCanvasFeedUrl(own))).toBe("host_not_allowed");
    expect(normalizeCanvasFeedUrl(own, canvasHostRules("canvas.navi.edu")).host).toBe("canvas.navi.edu");
    expect(normalizeCanvasFeedUrl(own, canvasHostRules("*.navi.edu")).host).toBe("canvas.navi.edu");
    expect(await code(() => normalizeCanvasFeedUrl(own, canvasHostRules("*.edu")))).toBe("host_not_allowed"); // too broad, ignored
  });
});

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local, metadata and mapped addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:127.0.0.1", "64:ff9b::10.0.0.1", "2002:0a00:0001::1", "not-an-ip"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isBlockedAddress(ip), ip).toBe(false);
    expect(isBlockedAddress("127.0.0.1", { allowLoopback: true })).toBe(false);
    expect(isBlockedAddress("10.0.0.1", { allowLoopback: true })).toBe(true);
  });

  const okBody = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
  const respond = (status: number, body = "", headers: Record<string, string> = {}): Awaited<ReturnType<Transport>> => ({
    status,
    headers,
    body: (async function* () {
      if (body) yield Buffer.from(body);
    })(),
    destroy: () => {},
  });
  const policy = (over: Partial<Parameters<typeof safeFetchText>[1]> = {}) => ({ ...canvasProvider.fetchPolicy(), resolver: async () => [{ address: "151.101.1.1", family: 4 as const }], ...over });

  it("connects only to the checked address (no second DNS lookup)", async () => {
    const seen: string[] = [];
    const r = await safeFetchText(FEED, policy({ transport: async (req) => { seen.push(`${req.address}|${req.url.hostname}`); return respond(200, okBody); } }));
    expect(r.text).toBe(okBody);
    expect(seen).toEqual(["151.101.1.1|navi-u.instructure.com"]);
  });
  it("refuses names that resolve to private addresses, including mixed answers (rebinding)", async () => {
    let called = false;
    const transport: Transport = async () => { called = true; return respond(200, okBody); };
    expect(await code(safeFetchText(FEED, policy({ transport, resolver: async () => [{ address: "10.1.2.3", family: 4 }] })))).toBe("blocked_address");
    expect(await code(safeFetchText(FEED, policy({ transport, resolver: async () => [{ address: "151.101.1.1", family: 4 }, { address: "169.254.169.254", family: 4 }] })))).toBe("blocked_address");
    expect(called).toBe(false);
  });
  it("re-checks every redirect hop", async () => {
    const hops = (loc: string): Transport => async (req) => (req.url.toString() === FEED ? respond(302, "", { location: loc }) : respond(200, okBody));
    expect(await code(safeFetchText(FEED, policy({ transport: hops("https://evil.example.com/feeds/calendars/user_abcdefgh.ics") })))).toBe("host_not_allowed");
    expect(await code(safeFetchText(FEED, policy({ transport: hops("http://navi-u.instructure.com/feeds/calendars/user_abcdefgh.ics") })))).toBe("host_not_allowed");
    const other = "https://other.instructure.com/feeds/calendars/user_abcdefgh.ics";
    expect((await safeFetchText(FEED, policy({ transport: hops(other) }))).finalHost).toBe("other.instructure.com");
    // A redirect to an allowed name that resolves privately is refused at the DNS check.
    const resolver = async (h: string) => [{ address: h === "other.instructure.com" ? "127.0.0.1" : "151.101.1.1", family: 4 as const }];
    expect(await code(safeFetchText(FEED, policy({ transport: hops(other), resolver })))).toBe("blocked_address");
    const loop: Transport = async () => respond(301, "", { location: FEED });
    expect(await code(safeFetchText(FEED, policy({ transport: loop })))).toBe("too_many_redirects");
  });
  it("caps the size, enforces the deadline and classifies HTTP errors", async () => {
    expect(await code(safeFetchText(FEED, policy({ maxBytes: 100, transport: async () => respond(200, "x".repeat(500)) })))).toBe("too_large");
    expect(await code(safeFetchText(FEED, policy({ transport: async () => respond(200, okBody, { "content-length": String(10 ** 9) }) })))).toBe("too_large");
    const hang: Transport = (req) => new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await code(safeFetchText(FEED, policy({ timeoutMs: 50, transport: hang })))).toBe("timeout");
    expect(await code(safeFetchText(FEED, policy({ transport: async () => respond(401) })))).toBe("http_auth");
    expect(await code(safeFetchText(FEED, policy({ transport: async () => respond(404) })))).toBe("http_not_found");
    expect(await code(safeFetchText(FEED, policy({ transport: async () => { throw new Error("ECONNRESET"); } })))).toBe("network");
    const err = (await safeFetchText(FEED, policy({ transport: async () => respond(503) })).catch((e) => e)) as FeedError;
    expect([err.code, err.retryable]).toEqual(["http_server", true]);
  });
  it("retries only retryable failures, with backoff", async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withRetries(async () => { if (++n < 3) throw new FeedError("network", "x", true); return "ok"; }, { sleep: async (ms) => void waits.push(ms) });
    expect([r, n, waits]).toEqual(["ok", 3, [1000, 3000]]);
    n = 0;
    expect(await code(withRetries(async () => { n++; throw new FeedError("http_auth", "x"); }, { sleep: async () => {} }))).toBe("http_auth");
    expect(n).toBe(1);
  });
});

describe("iCalendar parsing", () => {
  const win = canvasProvider.expansionWindow(NOW);
  const parse = (text = v1) => parseIcs(text, { windowStart: win.start, windowEnd: win.end, defaultZone: "America/New_York" });

  it("reads a realistic Canvas feed", () => {
    const f = parse();
    expect(f.calendarName).toBe("Ada Student Calendar (Navi University)");
    expect(f.rawEventCount).toBe(12);
    const by = (uid: string) => f.occurrences.filter((o) => o.uid === uid);
    // UTC due date, kept exactly.
    expect(by("event-assignment-1001")[0].start).toEqual({ allDay: false, utc: "2026-11-20T04:59:00.000Z" });
    // All-day: a date, ending the next day.
    expect(by("event-assignment-1003")[0]).toMatchObject({ start: { allDay: true, date: "2026-12-01" }, end: { allDay: true, date: "2026-12-02" } });
    expect(by("event-calendar-event-2003")[0]).toMatchObject({ start: { allDay: true, date: "2026-11-26" } });
    // TZID wall time → UTC (EST in November).
    expect(by("event-calendar-event-2001")[0].start).toEqual({ allDay: false, utc: "2026-11-17T19:00:00.000Z" });
    expect(by("event-calendar-event-2001")[0].location).toBe("Humanities 204");
    expect(by("event-calendar-event-2004")[0].status).toBe("cancelled");
  });

  it("expands recurrence with exclusions, moved and cancelled occurrences, across DST", () => {
    const occ = parse().occurrences.filter((o) => o.uid === "event-calendar-event-2002");
    const list = occ.map((o) => [o.recurrenceId, o.start.allDay ? "" : o.start.utc, o.status, o.summary]);
    expect(list).toEqual([
      // Nov 3 is still EST? No: DST ended Nov 1, so 18:00 EST = 23:00Z.
      ["2026-11-03T23:00:00.000Z", "2026-11-03T23:00:00.000Z", "confirmed", "Study group"],
      ["2026-11-10T23:00:00.000Z", "2026-11-10T23:00:00.000Z", "confirmed", "Study group"],
      ["2026-11-17T23:00:00.000Z", "2026-11-17T23:00:00.000Z", "confirmed", "Study group"],
      // Nov 24 excluded (EXDATE). Dec 1 moved to 19:00. Dec 8 cancelled.
      ["2026-12-01T23:00:00.000Z", "2026-12-02T00:00:00.000Z", "confirmed", "Study group (moved)"],
      ["2026-12-08T23:00:00.000Z", "2026-12-08T23:00:00.000Z", "cancelled", "Study group"],
    ]);
    // Across spring DST the wall-clock time stays put (UTC shifts by an hour).
    const spring = parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s1\r\nDTSTART;TZID=America/New_York:20270301T090000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR", { windowStart: win.start, windowEnd: win.end, defaultZone: "UTC" });
    expect(spring.occurrences.map((o) => (o.start.allDay ? "" : o.start.utc))).toEqual(["2027-03-01T14:00:00.000Z", "2027-03-08T14:00:00.000Z", "2027-03-15T13:00:00.000Z"]);
  });

  it("treats descriptions as untrusted text", () => {
    const d = parse().occurrences.find((o) => o.uid === "event-assignment-1001")!.description!;
    expect(d).not.toMatch(/<|script|alert|‮/);
    expect(d).toContain("Rubric & details in Files.");
    expect(sanitizeText("a​b\u0007c<img src=x onerror=1>d", 100)).toBe("abc d");
    expect(sanitizeText("x".repeat(50), 10)).toHaveLength(10);
  });

  it("uses floating times in the feed's zone, else the person's", () => {
    const ics = (tz: string) => `BEGIN:VCALENDAR\r\n${tz}BEGIN:VEVENT\r\nUID:f\r\nDTSTART:20261120T090000\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const f1 = parseIcs(ics(""), { windowStart: win.start, windowEnd: win.end, defaultZone: "America/Chicago" });
    expect(f1.occurrences[0].start).toEqual({ allDay: false, utc: "2026-11-20T15:00:00.000Z" });
    const f2 = parseIcs(ics("X-WR-TIMEZONE:Europe/London\r\n"), { windowStart: win.start, windowEnd: win.end, defaultZone: "America/Chicago" });
    expect(f2.occurrences[0].start).toEqual({ allDay: false, utc: "2026-11-20T09:00:00.000Z" });
  });

  it("rejects things that aren't calendars and skips unusable events", async () => {
    expect(await code(() => parse("<!doctype html><html>Log in to Canvas</html>"))).toBe("not_calendar");
    expect(await code(() => parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nthis is :: broken"))).toBe("invalid_feed");
    const f = parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:no uid\r\nDTSTART:20261120T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR");
    expect([f.occurrences.length, f.skipped]).toEqual([0, 1]);
  });
});

describe("Canvas mapping", () => {
  const win = canvasProvider.expansionWindow(NOW);
  const items = toCanvasItems(parseIcs(v1, { windowStart: win.start, windowEnd: win.end, defaultZone: "America/New_York" }), { host: "navi-u.instructure.com", zone: "America/New_York" });
  const get = (id: string) => items.find((i) => i.externalId === id)!;

  it("classifies assignments and events and finds courses", () => {
    expect(get("event-assignment-1001")).toMatchObject({ kind: "assignment", course: { key: "course_101", name: "ENGL 101 Composition" }, url: "https://navi-u.instructure.com/courses/101/assignments/1001" });
    expect(get("event-calendar-event-2001")).toMatchObject({ kind: "event", course: { key: "course_101" } });
    expect(get("event-calendar-event-2002@@2026-11-10T23:00:00.000Z")).toMatchObject({ kind: "event", course: null });
    // All-day: starts at local midnight in the person's zone.
    expect(get("event-assignment-1003")).toMatchObject({ allDay: true, allDayDate: "2026-12-01", startsAt: "2026-12-01T05:00:00.000Z" });
    expect(canvasCourse({ summary: "Thing [Club]", url: null })).toEqual({ key: "name:club", name: "Club" });
  });
  it("drops links that don't point back into Canvas", () => {
    expect(get("event-calendar-event-2005").url).toBeNull();
    expect(safeCanvasLink("javascript:alert(1)", "navi-u.instructure.com")).toBeNull();
    expect(safeCanvasLink("https://navi-u.instructure.com/x", "navi-u.instructure.com")).toBe("https://navi-u.instructure.com/x");
  });
  it("puts all-day deadlines at 11:59 PM local", () => {
    expect(dueFor({ starts_at: "2026-12-01T05:00:00.000Z", all_day: true, all_day_date: "2026-12-01" }, "America/New_York")).toBe("2026-12-02T04:59:00.000Z");
    expect(dueFor({ starts_at: "2026-11-20T04:59:00.000Z", all_day: false, all_day_date: null }, "America/New_York")).toBe("2026-11-20T04:59:00.000Z");
  });
  it("confirmed window sits inside Canvas's 30 days back / 366 ahead", () => {
    const w = canvasProvider.confirmedWindow(NOW);
    expect(w.start.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-11-11T15:00:00.000Z");
  });
  it("links clearly matching courses, never ambiguous ones", () => {
    expect(autoAssociate("ENGL 101 Composition", [], [{ id: "p1", name: "ENGL 101", workspace_id: "w1" }])).toEqual({ project_id: "p1", workspace_id: "w1", association: "auto" });
    expect(autoAssociate("ENGL 101 Composition", [], [{ id: "p1", name: "ENGL101", workspace_id: null }, { id: "p2", name: "engl 101", workspace_id: null }])).toEqual({});
    expect(autoAssociate("MATH 150 Calculus", [{ id: "w", name: "School" }], [])).toEqual({});
    expect(normTitle("Problem Set 4 [MATH 150]")).toBe("problem set 4");
  });
  it("backs off after failures, longest for a refused link", () => {
    expect([1, 2, 3, 6].map((n) => backoffMs(n, "network") / 60000)).toEqual([15, 30, 60, 360]);
    expect(backoffMs(1, "http_auth")).toBe(24 * 3600_000);
  });
});

describe("credential encryption", () => {
  process.env.NAVI_INTEGRATION_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString("base64");
  it("round-trips and is bound to its owner and connection", () => {
    const b = { userId: "u1", connectionId: "c1" };
    const sealed = sealSecret(FEED, b);
    expect(sealed).not.toContain("instructure");
    expect(sealed).not.toBe(sealSecret(FEED, b)); // random IV
    expect(openSecret(sealed, b)).toBe(FEED);
    expect(() => openSecret(sealed, { userId: "u2", connectionId: "c1" })).toThrow();
    expect(() => openSecret(sealed, { userId: "u1", connectionId: "c2" })).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openSecret(parts.join("."), b)).toThrow();
  });
  it("fingerprints per user without revealing the URL", () => {
    expect(fingerprint(FEED, "u1")).toBe(fingerprint(FEED, "u1"));
    expect(fingerprint(FEED, "u1")).not.toBe(fingerprint(FEED, "u2"));
    expect(fingerprint(FEED, "u1")).not.toContain("instructure");
  });
});

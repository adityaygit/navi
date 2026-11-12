import type { FetchPolicy } from "../safe-fetch";
import type { ParsedFeed } from "../ics/parse";

// What a calendar-feed provider (Canvas today; other school platforms or
// calendars later) supplies to the generic sync engine.

export type ItemKind = "assignment" | "event";

/** One imported occurrence in provider-neutral form. Provider-owned fields only. */
export type NormalizedItem = {
  /** Stable within a connection: UID, plus the occurrence for recurring events. */
  externalId: string;
  uid: string;
  recurrenceId: string | null;
  kind: ItemKind;
  title: string;
  description: string | null;
  /** Only links back to the provider's own site are kept. */
  url: string | null;
  location: string | null;
  course: { key: string; name: string } | null;
  /** UTC ISO. For all-day items: the start of that date in the person's zone. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  /** First day of an all-day item (YYYY-MM-DD). */
  allDayDate: string | null;
  status: "confirmed" | "tentative" | "cancelled";
};

export type FeedProvider = {
  id: "canvas";
  name: string;
  /** Validates and normalizes what the person pasted. Throws FeedError. */
  normalizeUrl: (input: string) => { url: string; host: string };
  fetchPolicy: () => FetchPolicy;
  /**
   * The span this provider's feed is complete for (minus a safety margin).
   * Only items whose time is inside it can be treated as removed when missing.
   */
  confirmedWindow: (now: Date) => { start: Date; end: Date };
  /** Expansion range for recurring events (a little wider than the confirmed window). */
  expansionWindow: (now: Date) => { start: Date; end: Date };
  /** The provider's cap on items per feed; a feed at the cap may be cut short. */
  maxFeedItems: number | null;
  toItems: (feed: ParsedFeed, ctx: { host: string; zone: string }) => NormalizedItem[];
  /** Where in the provider the person finds their feed link (shown in errors). */
  feedHelp: string;
};

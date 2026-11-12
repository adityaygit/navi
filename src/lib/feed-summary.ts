// Plain-language summary of a calendar-feed sync, shown after connecting and
// in Settings. One concise line instead of an approval card per item.

export type FeedSummary = {
  assignments?: number;
  events?: number;
  created?: number;
  updated?: number;
  removed?: number;
  restored?: number;
  pendingRemoval?: number;
  duplicates?: number;
  courses?: number;
  newCourses?: string[];
  warnings?: string[];
  trigger?: string;
};

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function feedSummaryText(s: FeedSummary | null | undefined, provider = "Canvas"): string {
  if (!s || s.assignments == null) return "";
  const parts: string[] = [];
  const found = `${n(s.assignments ?? 0, "assignment")} and ${n(s.events ?? 0, "event")}${s.courses ? ` from ${n(s.courses, "course")}` : ""}`;
  if (s.trigger === "connect") parts.push(`Imported ${found}.`);
  else parts.push(`${provider} has ${found}.`);
  const changes = [
    s.trigger !== "connect" && s.created ? `${n(s.created, "new item")} added` : null,
    s.updated ? `${n(s.updated, "change")} applied` : null,
    s.removed ? `${s.removed} removed after being deleted in ${provider}` : null,
    s.restored ? `${s.restored} back again` : null,
  ].filter(Boolean);
  if (changes.length) parts.push(`${changes.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
  if (s.trigger !== "connect" && s.newCourses?.length) parts.push(`New: ${s.newCourses.join(", ")}.`);
  if (s.duplicates) parts.push(`${s.duplicates === 1 ? "1 looks like a task you already have" : `${s.duplicates} look like tasks you already have`}, so ${s.duplicates === 1 ? "it's" : "they're"} waiting for you to decide.`);
  return parts.join(" ");
}

import type { MMe } from "@shared/mobile-api-types";
import { getSetting } from "../native/settings";
import { cancel, scheduleDaily } from "../native/notify";

// Briefing reminders scheduled on the phone itself (no paid Apple account
// needed). They follow the briefing times and never land in quiet hours.

const MORNING = 7001;
const EVENING = 7002;

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** True when hh:mm falls inside quiet hours (which may cross midnight). */
export function inQuiet(t: string, quiet: MMe["quietHours"]): boolean {
  if (!quiet) return false;
  const m = mins(t);
  const a = mins(quiet.start);
  const b = mins(quiet.end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

/** Which reminders would be skipped because of quiet hours. */
export function skippedByQuiet(me: Pick<MMe, "briefings" | "quietHours">): ("morning" | "evening")[] {
  const out: ("morning" | "evening")[] = [];
  if (inQuiet(me.briefings.morning, me.quietHours)) out.push("morning");
  if (inQuiet(me.briefings.evening, me.quietHours)) out.push("evening");
  return out;
}

export async function syncReminders(me: MMe | null): Promise<void> {
  const on = !!me && getSetting("reminders") && me.briefings.enabled;
  const skip = me ? skippedByQuiet(me) : [];
  if (on && me && !skip.includes("morning")) await scheduleDaily(MORNING, me.briefings.morning, "Good morning", "Your day is planned. Open Navi for the briefing.");
  else await cancel(MORNING);
  if (on && me && !skip.includes("evening")) await scheduleDaily(EVENING, me.briefings.evening, "Evening review", "Two minutes to close the day with Navi.");
  else await cancel(EVENING);
}

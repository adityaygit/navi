import { Capacitor } from "@capacitor/core";

// Local notifications, scheduled on the phone itself. They work without a paid
// Apple account (remote push does not), so focus endings and reminders still arrive.

const native = Capacitor.isNativePlatform();
let asked = false;

async function plugin() {
  return (await import("@capacitor/local-notifications")).LocalNotifications;
}

/** Ask once, at the moment it's first useful (never on launch). */
export async function ensurePermission(): Promise<boolean> {
  if (!native) return false;
  try {
    const LN = await plugin();
    const now = await LN.checkPermissions();
    if (now.display === "granted") return true;
    if (asked) return false;
    asked = true;
    return (await LN.requestPermissions()).display === "granted";
  } catch {
    return false;
  }
}

export async function scheduleAt(id: number, at: Date, title: string, body: string): Promise<void> {
  if (!native || !(await ensurePermission())) return;
  try {
    const LN = await plugin();
    await LN.schedule({ notifications: [{ id, title, body, schedule: { at, allowWhileIdle: true }, smallIcon: "ic_stat_navi" }] });
  } catch {
    /* notifications are a nicety */
  }
}

export async function cancel(id: number): Promise<void> {
  if (!native) return;
  try {
    await (await plugin()).cancel({ notifications: [{ id }] });
  } catch {
    /* nothing to cancel */
  }
}

/** A notification every day at hh:mm on this phone (replaces any with the same id). */
export async function scheduleDaily(id: number, hhmm: string, title: string, body: string): Promise<boolean> {
  if (!native || !(await ensurePermission())) return false;
  try {
    const [hour, minute] = hhmm.split(":").map(Number);
    const LN = await plugin();
    await LN.cancel({ notifications: [{ id }] });
    await LN.schedule({ notifications: [{ id, title, body, schedule: { on: { hour, minute }, allowWhileIdle: true }, smallIcon: "ic_stat_navi" }] });
    return true;
  } catch {
    return false;
  }
}

/** Whether notifications can show at all (asks if not asked yet). */
export async function canNotify(): Promise<boolean> {
  return ensurePermission();
}
export const notificationsAvailable = native;

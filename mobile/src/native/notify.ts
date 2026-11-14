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

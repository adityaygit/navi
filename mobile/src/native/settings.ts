// Small per-device settings. Kept in localStorage (it persists inside the
// Capacitor web view) and read synchronously, so a haptic never waits on disk.
type Settings = { haptics: boolean; reminders: boolean; sky: boolean; lockTipSeen: boolean };
const defaults: Settings = { haptics: true, reminders: false, sky: true, lockTipSeen: false };
const KEY = "navi.settings";

function load(): Settings {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>) };
  } catch {
    return { ...defaults };
  }
}

let current = load();
const listeners = new Set<() => void>();

export function subscribeSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSetting<K extends keyof Settings>(k: K): Settings[K] {
  return current[k];
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
  current = { ...current, [k]: v };
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage blocked: the setting still holds for this session.
  }
}

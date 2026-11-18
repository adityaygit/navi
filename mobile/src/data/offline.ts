import { useEffect, useState, useSyncExternalStore } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { ApiError, api } from "../api/client";

// Offline (M6 polish): what you type while offline is kept on this phone and
// sent to Navi as a capture once you're back (it lands in Inbox, like a note
// to self); the last plan, inbox and progress you saw stay readable. Both are
// kept per account, so on a shared phone nobody sees anyone else's.
// Captures carry a client id, so a retry never adds the same thing twice.

type Queued = { client_id: string; raw_text: string; captured_at: string; owner: string; attempts: number };

const QUEUE = "navi.offline.queue.v1";
const CACHE = "navi.offline.cache.v1:";
let owner: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Who is signed in; set before the queue or cache is used. */
export function setOfflineOwner(id: string | null) {
  owner = id;
  emit();
  if (id) void flushQueue();
}

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) || "[]") as Queued[];
  } catch {
    return [];
  }
}
function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    /* storage blocked: the item stays in memory only for this run */
  }
  emit();
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

/** Keep something typed offline; it's sent when the phone is back online. */
export function enqueueCapture(text: string) {
  if (!owner) throw new Error("Not signed in");
  writeQueue([...readQueue(), { client_id: uuid(), raw_text: text, captured_at: new Date().toISOString(), owner, attempts: 0 }]);
}

let flushing = false;
/** Send what's waiting. Each item leaves the queue only once the server has it. */
export async function flushQueue(): Promise<number> {
  if (flushing || !owner || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of readQueue().filter((q) => q.owner === owner)) {
      try {
        await api("/api/capture", { body: { client_id: item.client_id, raw_text: item.raw_text, source: "offline", captured_at: item.captured_at } });
        writeQueue(readQueue().filter((q) => q.client_id !== item.client_id));
        sent++;
      } catch (e) {
        // A request the server refuses for good (bad input) would never get through: drop it after a few tries.
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429;
        writeQueue(readQueue().flatMap((q) => (q.client_id !== item.client_id ? [q] : permanent && q.attempts >= 2 ? [] : [{ ...q, attempts: q.attempts + 1 }])));
        if (!permanent) break; // offline again or the server is down: try later, in order
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

/** How many of this person's things are waiting to send. */
export function useQueued(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => readQueue().filter((q) => q.owner === owner).length,
  );
}

/** Online or not, kept up to date. */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return on;
}

/** Send the queue whenever the phone comes back online or the app comes back to the front. */
export function startOfflineSync(): () => void {
  const go = () => void flushQueue();
  window.addEventListener("online", go);
  let remove: (() => void) | null = null;
  if (Capacitor.isNativePlatform()) {
    void CapApp.addListener("appStateChange", (s) => {
      if (s.isActive) go();
    }).then((h) => {
      remove = () => void h.remove();
    });
  }
  go();
  return () => {
    window.removeEventListener("online", go);
    remove?.();
  };
}

// ---- the last answers, for reading offline ----

export function cacheGet<T>(path: string): { data: T; at: number } | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(CACHE + owner + path);
    return raw ? (JSON.parse(raw) as { data: T; at: number }) : null;
  } catch {
    return null;
  }
}

export function cachePut(path: string, data: unknown) {
  if (!owner) return;
  try {
    localStorage.setItem(CACHE + owner + path, JSON.stringify({ data, at: Date.now() }));
  } catch {
    /* full or blocked: reading offline just won't have this */
  }
}

/** On sign out: this person's cached answers go (their unsent captures stay for when they sign back in). */
export function clearOfflineCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE)) localStorage.removeItem(k);
    }
  } catch {
    /* nothing to clear */
  }
}

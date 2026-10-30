"use client";

// Offline capture queue in IndexedDB. Each item carries a client_id so the
// server can deduplicate retries; items are removed only after the server
// confirms it stored them. Nothing private is put in a shared cache.

export type QueuedCapture = {
  client_id: string;
  raw_text: string;
  source: "text" | "voice" | "offline";
  captured_at: string;
  attempts: number;
  last_error?: string;
};

const DB = "navi-offline";
const STORE = "captures";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "client_id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const offlineQueue = {
  add: (item: QueuedCapture) => tx("readwrite", (s) => s.put(item)).then(notify),
  all: () => tx<QueuedCapture[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedCapture[]>),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)).then(notify),
  update: (item: QueuedCapture) => tx("readwrite", (s) => s.put(item)).then(notify),
};

function notify() {
  window.dispatchEvent(new Event("navi:queue"));
}

export function newClientId(): string {
  return crypto.randomUUID();
}

let flushing = false;

/** Send queued captures. Safe to call repeatedly; returns how many were synced. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let synced = 0;
  try {
    const items = await offlineQueue.all();
    for (const item of items.sort((a, b) => a.captured_at.localeCompare(b.captured_at))) {
      try {
        const res = await fetch("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: item.client_id, raw_text: item.raw_text, source: item.source, captured_at: item.captured_at }),
        });
        if (res.ok) {
          await offlineQueue.remove(item.client_id);
          synced++;
        } else if (res.status === 401) {
          await offlineQueue.update({ ...item, attempts: item.attempts + 1, last_error: "Sign in to sync" });
          break;
        } else {
          const body = await res.json().catch(() => ({}));
          await offlineQueue.update({ ...item, attempts: item.attempts + 1, last_error: body.error ?? `Server error ${res.status}` });
        }
      } catch {
        await offlineQueue.update({ ...item, attempts: item.attempts + 1, last_error: "Network error" });
        break;
      }
    }
  } finally {
    flushing = false;
  }
  if (synced) announceChange();
  return synced;
}

/** Tell other open views (and tabs) that data changed so they refresh. */
export function announceChange() {
  window.dispatchEvent(new Event("navi:changed"));
  try {
    new BroadcastChannel("navi").postMessage("changed");
  } catch {
    // BroadcastChannel unavailable: same-tab event above still fires.
  }
}

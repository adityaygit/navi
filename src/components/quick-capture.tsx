"use client";
import { useEffect, useRef, useState } from "react";
import { announceChange, flushQueue, newClientId, offlineQueue, type QueuedCapture } from "@/lib/offline-queue";

const DRAFT_KEY = "navi:capture-draft";

// Global quick capture. Text is stored locally the moment it's submitted:
// online it is sent immediately, offline (or on failure) it waits in a
// visible queue and syncs on reconnect. The draft survives reloads.
export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [online, setOnline] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { setText(localStorage.getItem(DRAFT_KEY) ?? ""); } catch {}
    setOnline(navigator.onLine);
    const load = () => offlineQueue.all().then(setQueue).catch(() => setQueue([]));
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    void load();
    window.addEventListener("navi:queue", load);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const openCapture = () => setOpen(true);
    window.addEventListener("navi:open-capture", openCapture);
    return () => {
      window.removeEventListener("navi:queue", load);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("navi:open-capture", openCapture);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 50);
  }, [open]);

  function saveDraft(v: string) {
    setText(v);
    try { localStorage.setItem(DRAFT_KEY, v); } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) return;
    const item: QueuedCapture = { client_id: newClientId(), raw_text: raw, source: navigator.onLine ? "text" : "offline", captured_at: new Date().toISOString(), attempts: 0 };
    // Persist locally first so nothing is lost if the request or tab dies.
    await offlineQueue.add(item);
    saveDraft("");
    if (!navigator.onLine) {
      setStatus("Saved offline. It will sync when you're back online.");
      return;
    }
    setStatus("Sending to your inbox…");
    const synced = await flushQueue();
    setStatus(synced ? "Captured. Review it in your inbox." : "Saved on this device; will retry syncing.");
    if (synced) announceChange();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary fixed bottom-20 right-4 z-30 h-14 rounded-full px-5 shadow-lg md:bottom-6"
        aria-haspopup="dialog"
      >
        + Capture{queue.length > 0 && <span className="badge ml-1 border-accent-text text-accent-text">{queue.length}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="capture-title" className="w-full max-w-lg rounded-t-2xl bg-surface p-4 md:rounded-2xl safe-bottom" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 id="capture-title" className="h2">Capture</h2>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
              </div>
              <p className="muted text-sm">Dump anything: tasks, ideas, plans. Navi turns it into suggestions you review. Nothing becomes a commitment without you.</p>
              <label htmlFor="capture-text" className="sr-only">What's on your mind?</label>
              <textarea
                id="capture-text"
                ref={ref}
                className="input min-h-32"
                value={text}
                onChange={(e) => saveDraft(e.target.value)}
                placeholder="e.g. finish history essay by friday, email coach about saturday, buy running shoes"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e); }}
              />
              <div className="flex items-center gap-2">
                <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Capture</button>
                {!online && <span className="badge badge-warn">Offline</span>}
              </div>
              {status && <p role="status" className="text-sm">{status}</p>}
              {queue.length > 0 && (
                <div className="notice">
                  <div className="mb-1 font-medium">Waiting to sync ({queue.length})</div>
                  <ul className="flex flex-col gap-1">
                    {queue.map((q) => (
                      <li key={q.client_id} className="text-sm">
                        “{q.raw_text.slice(0, 60)}{q.raw_text.length > 60 ? "…" : ""}”
                        {q.last_error && <span className="muted"> — {q.last_error}</span>}
                      </li>
                    ))}
                  </ul>
                  {online && <button type="button" className="btn btn-sm mt-2" onClick={() => void flushQueue()}>Retry now</button>}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}

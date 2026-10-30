"use client";
import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import { createItemAction } from "../actions";
import { announceChange } from "@/lib/offline-queue";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Add a fixed commitment (one-off or weekly) to the internal calendar. */
export function AddCommitment({ zone, defaultDate }: { zone: string; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startT, setStartT] = useState("16:00");
  const [endT, setEndT] = useState("17:00");
  const [repeat, setRepeat] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn self-start" onClick={() => setOpen(true)}>+ Add fixed commitment</button>;
  return (
    <form
      className="card flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const s = DateTime.fromISO(`${date}T${startT}`, { zone });
        const en = DateTime.fromISO(`${date}T${endT}`, { zone });
        start(async () => {
          const r = await createItemAction("events", {
            title,
            starts_at: s.toISO(),
            ends_at: en.toISO(),
            recurrence: repeat.length ? { freq: "weekly", days: repeat } : null,
          });
          if (r.ok) { setMsg("Added"); setTitle(""); announceChange(); } else setMsg(r.error);
        });
      }}
    >
      <h2 className="h2">Add fixed commitment</h2>
      <div>
        <label htmlFor="c-title" className="label">What</label>
        <input id="c-title" required className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Soccer practice" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label htmlFor="c-date" className="label">Date</label><input id="c-date" type="date" required className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label htmlFor="c-start" className="label">Start</label><input id="c-start" type="time" required className="input" value={startT} onChange={(e) => setStartT(e.target.value)} /></div>
        <div><label htmlFor="c-end" className="label">End</label><input id="c-end" type="time" required className="input" value={endT} onChange={(e) => setEndT(e.target.value)} /></div>
      </div>
      <fieldset>
        <legend className="label">Repeats weekly on (optional)</legend>
        <div className="flex flex-wrap gap-1">
          {DAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={repeat.includes(i)} className={`btn btn-sm ${repeat.includes(i) ? "btn-primary" : ""}`} onClick={() => setRepeat((r) => (r.includes(i) ? r.filter((x) => x !== i) : [...r, i].sort()))}>{d}</button>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending}>Add</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </form>
  );
}

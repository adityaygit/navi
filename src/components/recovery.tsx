"use client";
import { useState, useTransition } from "react";
import { recoverPlanAction } from "@/app/(app)/actions";
import { announceChange } from "@/lib/offline-queue";

const CATEGORIES = [
  ["interruption", "Something interrupted me"],
  ["rest", "I need rest"],
  ["estimate", "Things took longer than planned"],
  ["missing_info", "I'm blocked / missing information"],
  ["external", "Something external changed"],
  ["other", "Other"],
] as const;

/** The fast "my plan broke" flow: say what happened, get a realistic re-plan. */
export function RecoveryButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("interruption");
  const [description, setDescription] = useState("");
  const [freeAt, setFreeAt] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>My plan broke</button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="recover-title" className="w-full max-w-md rounded-t-2xl bg-surface p-4 md:rounded-2xl safe-bottom" onClick={(e) => e.stopPropagation()}>
            <h2 id="recover-title" className="h2">What happened?</h2>
            <p className="muted mt-1 text-sm">Unfinished work stays on your list. Navi re-plans the rest of today around what's realistic.</p>
            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  let availableFrom: string | null = null;
                  if (freeAt) {
                    const [h, m] = freeAt.split(":").map(Number);
                    const d = new Date();
                    d.setHours(h, m, 0, 0);
                    availableFrom = d.toISOString();
                  }
                  const r = await recoverPlanAction({ description: description || CATEGORIES.find((c) => c[0] === category)![1], category, availableFrom });
                  if (r.ok) {
                    setResult((r.data as { summary: string }).summary);
                    announceChange();
                  } else setResult(r.error);
                });
              }}
            >
              <fieldset className="flex flex-col gap-1">
                <legend className="label">Reason</legend>
                {CATEGORIES.map(([value, text]) => (
                  <label key={value} className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} />
                    {text}
                  </label>
                ))}
              </fieldset>
              <div>
                <label htmlFor="recover-desc" className="label">Details (optional)</label>
                <input id="recover-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. practice ran 2 hours late" />
              </div>
              <div>
                <label htmlFor="recover-free" className="label">Free again at (optional)</label>
                <input id="recover-free" type="time" className="input" value={freeAt} onChange={(e) => setFreeAt(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={pending}>{pending ? "Re-planning…" : "Re-plan my day"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setResult(null); }}>Close</button>
              </div>
              {result && <p role="status" className="notice text-sm">{result}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}

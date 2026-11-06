"use client";
import { useEffect, useState } from "react";
import { ActionButton } from "./action-button";
import { endFocusAction } from "@/app/(app)/client-actions";
import { Pebble } from "./pebble";

export function FocusCard({ session }: { session: { id: string; started_at: string; planned_minutes: number | null; task_title: string | null } }) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.started_at)) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const over = session.planned_minutes && elapsed > session.planned_minutes * 60;
  return (
    <section className="lg border-[rgba(95,211,154,0.35)] p-5" aria-label="Focus session">
      <div className="flex flex-wrap items-center gap-3">
        <Pebble size={44} mood="working" />
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-[12px] text-focus">Focusing on</div>
          <div className="text-lg font-semibold leading-snug break-words">{session.task_title ?? "Untitled focus"}</div>
        </div>
        <div className={`num ml-auto text-[40px] font-semibold leading-none tracking-[-0.03em] ${over ? "text-recovery" : "gh"}`} aria-live="off">{mm}:{ss}</div>
      </div>
      {session.planned_minutes && <div className="muted mt-2 text-sm">Planned {session.planned_minutes} min{over ? " — running over" : ""}</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton className="btn btn-primary btn-sm" action={() => endFocusAction(session.id, "completed")}>Finished the task</ActionButton>
        <ActionButton action={() => endFocusAction(session.id, "progress")}>Made progress</ActionButton>
        <ActionButton action={() => endFocusAction(session.id, "interrupted")}>Interrupted</ActionButton>
        {!stopping && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStopping(true)}>Stop</button>}
      </div>
      {stopping && (
        // Stopping counts as skipped unless there's an outside reason; only the person can give one.
        <div className="well mt-4 flex flex-col gap-2 p-3.5" role="group" aria-labelledby="stop-why">
          <p id="stop-why" className="text-sm">Why stop? Without a reason, this block counts as skipped.</p>
          <div className="flex flex-wrap gap-2">
            <ActionButton action={() => endFocusAction(session.id, "abandoned", null, "rest")}>Need rest</ActionButton>
            <ActionButton action={() => endFocusAction(session.id, "abandoned", null, "missing_info")}>Missing info</ActionButton>
            <ActionButton action={() => endFocusAction(session.id, "abandoned", null, "estimate")}>Took longer than estimated</ActionButton>
            <ActionButton action={() => endFocusAction(session.id, "abandoned")}>No reason, just stop</ActionButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStopping(false)}>Keep going</button>
          </div>
        </div>
      )}
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import { ActionButton } from "./action-button";
import { endFocusAction } from "@/app/(app)/actions";

export function FocusCard({ session }: { session: { id: string; started_at: string; planned_minutes: number | null; task_title: string | null } }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.started_at)) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const over = session.planned_minutes && elapsed > session.planned_minutes * 60;
  return (
    <section className="card border-accent" aria-label="Focus session">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="muted text-xs uppercase tracking-wide">Focusing on</div>
          <div className="font-semibold">{session.task_title ?? "Untitled focus"}</div>
        </div>
        <div className={`ml-auto font-mono text-3xl tabular-nums ${over ? "text-warn" : ""}`} aria-live="off">{mm}:{ss}</div>
      </div>
      {session.planned_minutes && <div className="muted mt-1 text-xs">Planned {session.planned_minutes} min{over ? " — running over" : ""}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton className="btn btn-primary btn-sm" action={() => endFocusAction(session.id, "completed")}>Finished the task</ActionButton>
        <ActionButton action={() => endFocusAction(session.id, "progress")}>Made progress</ActionButton>
        <ActionButton action={() => endFocusAction(session.id, "interrupted")}>Interrupted</ActionButton>
        <ActionButton className="btn btn-ghost btn-sm" action={() => endFocusAction(session.id, "abandoned")}>Stop</ActionButton>
      </div>
    </section>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { breakThroughs, focusElapsedSeconds } from "@/lib/focus";
import { endFocusAction, pauseFocusAction, resumeFocusAction, startFocusAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { Stone } from "../shell/stone";

type Session = { id: string; started_at: string; paused_at: string | null; paused_seconds: number; planned_minutes: number | null };
type Outcome = "completed" | "progress" | "interrupted" | "abandoned";

const pill = "flex h-12 items-center justify-center rounded-[24px] px-6 text-[16px] font-semibold disabled:opacity-50";

function mmss(total: number) {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function FocusView({
  session: initial,
  title,
  space,
  fixedEvents,
  hardDeadlines,
  dayStartMs,
  dayEndMs,
  zone,
}: {
  session: Session;
  title: string;
  space: string | null;
  fixedEvents: { id: string; title: string; startMs: number }[];
  hardDeadlines: { id: string; title: string; dueMs: number }[];
  dayStartMs: number;
  dayEndMs: number;
  zone: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setSession(initial);
  }
  const [now, setNow] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const paused = !!session.paused_at;
  const elapsed = now === null ? 0 : focusElapsedSeconds(session, now);
  const planned = session.planned_minutes ? session.planned_minutes * 60 : null;
  const over = planned !== null && elapsed > planned;
  const shown = planned !== null && !over ? planned - elapsed : elapsed;
  const alerts = now === null ? [] : breakThroughs(now, fixedEvents, hardDeadlines, dayStartMs, dayEndMs);

  const toggle = () =>
    start(async () => {
      setError(null);
      const r = paused ? await resumeFocusAction(session.id) : await pauseFocusAction(session.id);
      if (!r.ok) return setError(r.error);
      const row = r.data as Session | undefined;
      if (row) setSession({ ...session, paused_at: row.paused_at, paused_seconds: row.paused_seconds ?? session.paused_seconds });
      router.refresh();
    });
  const end = (outcome: Outcome, reason?: "rest" | "missing_info" | "estimate") =>
    start(async () => {
      setError(null);
      const r = await endFocusAction(session.id, outcome, null, reason ?? null);
      if (!r.ok) return setError(r.error);
      announceChange();
      router.replace(`/focus?ended=${session.id}`);
      router.refresh();
    });

  return (
    <section aria-label="Focus" className="flex min-h-[calc(100dvh-6rem)] flex-col items-center justify-center pb-16 text-center">
      {alerts.length > 0 && (
        <div role="alert" className="mb-10 flex w-full max-w-[560px] flex-col gap-1 rounded-[20px] border border-[rgba(244,179,122,0.35)] bg-[rgba(244,179,122,0.07)] px-5 py-3.5 text-left text-[15px]">
          {alerts.map((a) => (
            <span key={`${a.kind}${a.id}`}>
              {a.kind === "event"
                ? `${a.title} starts at ${DateTime.fromMillis(a.at, { zone }).toFormat("h:mm a")}.`
                : `Hard deadline today: “${a.title}” at ${DateTime.fromMillis(a.at, { zone }).toFormat("h:mm a")}.`}
            </span>
          ))}
        </div>
      )}
      <span className="text-[15px] text-dim">Focus{space ? ` · ${space}` : ""}{paused ? " · paused" : ""}</span>
      <h1 className="mt-2 max-w-[640px] text-[24px] font-semibold tracking-[-0.01em]">{title}</h1>
      <div className={`mt-6 text-[96px] font-bold leading-none tracking-[-0.04em] tabular-nums ${paused ? "text-dim" : over ? "text-recovery" : "text-text"}`} aria-hidden="true">
        {now === null ? "–:––" : mmss(shown)}
      </div>
      <p className="sr-only" aria-live="polite">{paused ? "Paused" : "Running"}</p>
      <p className="mt-3 text-[14px] text-dim">
        {planned === null ? "Counting up" : over ? `${Math.round(planned / 60)} minutes planned — running over` : `left of ${Math.round(planned / 60)} minutes`}
      </p>
      {!ending ? (
        <div className="mt-9 flex gap-3">
          <button type="button" onClick={toggle} disabled={pending} className={`${pill} bg-white/[0.08] text-text`}>{paused ? "Resume" : "Pause"}</button>
          <button type="button" onClick={() => setEnding(true)} disabled={pending} className={`${pill} bg-text text-black`}>I&apos;m done</button>
        </div>
      ) : (
        <div className="mt-9 flex w-full max-w-[560px] flex-col items-center gap-3" role="group" aria-label="How did it go?">
          <span className="text-[15px] text-muted">How did it go?</span>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" disabled={pending} onClick={() => end("completed")} className={`${pill} bg-text text-black`}>Finished it</button>
            <button type="button" disabled={pending} onClick={() => end("progress")} className={`${pill} bg-white/[0.08]`}>Made progress</button>
            <button type="button" disabled={pending} onClick={() => end("interrupted")} className={`${pill} bg-white/[0.08]`}>Got interrupted</button>
            {!stopping && <button type="button" disabled={pending} onClick={() => setStopping(true)} className={`${pill} bg-transparent text-dim`}>Stop</button>}
          </div>
          {stopping && (
            // Stopping counts as skipped unless there's an outside reason; only the person can give one.
            <div className="mt-2 flex flex-col items-center gap-2">
              <span className="text-[14px] text-dim">Why stop? Without a reason, this counts as skipped.</span>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" disabled={pending} onClick={() => end("abandoned", "rest")} className="chip">Need rest</button>
                <button type="button" disabled={pending} onClick={() => end("abandoned", "missing_info")} className="chip">Missing info</button>
                <button type="button" disabled={pending} onClick={() => end("abandoned", "estimate")} className="chip">Took longer than estimated</button>
                <button type="button" disabled={pending} onClick={() => end("abandoned")} className="chip">No reason</button>
              </div>
            </div>
          )}
          <button type="button" onClick={() => { setEnding(false); setStopping(false); }} className="mt-1 text-[14px] text-dim underline underline-offset-4">Keep going</button>
        </div>
      )}
      {error && <p role="alert" className="mt-4 text-[14px] text-clash">{error}</p>}
      <p className="mt-12 max-w-[480px] text-[13px] leading-relaxed text-dim">
        Navi holds everything else until you finish. Only a fixed event in the next 10 minutes or a hard deadline today comes through.
      </p>
    </section>
  );
}

export type PickTask = { id: string; title: string; estimate_minutes: number | null; due_at: string | null; status: string };

export function FocusPicker({ tasks, ended, zone }: { tasks: PickTask[]; ended: { minutes: number | null; proposals: number; notes: { title: string; url: string }[] } | null; zone: string }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (taskId: string | null, mins: number) =>
    start(async () => {
      setError(null);
      const r = await startFocusAction({ task_id: taskId, planned_minutes: mins });
      if (!r.ok) return setError(r.error);
      announceChange();
      router.replace("/focus");
      router.refresh();
    });
  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col pb-16 pt-6">
      {ended && (
        <div className="mb-10 rounded-[22px] border border-white/[0.08] bg-white/[0.04] p-5" aria-label="While you focused">
          <div className="flex items-center gap-3">
            <Stone size={22} />
            <span className="text-[16px] font-semibold">Nice. {ended.minutes ? `${ended.minutes} minutes of focus.` : "Focus ended."}</span>
          </div>
          {(ended.proposals > 0 || ended.notes.length > 0) && (
            <>
              <div className="mt-4 text-[13px] text-dim">While you focused</div>
              <ul className="mt-2 flex flex-col gap-2 text-[15px]">
                {ended.proposals > 0 && (
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--navi-text)]" aria-hidden="true" />
                    <span className="flex-1">{ended.proposals === 1 ? "1 new item" : `${ended.proposals} new items`} in your inbox</span>
                    <Link href="/inbox" className="font-semibold text-[var(--navi-text)]">Review</Link>
                  </li>
                )}
                {ended.notes.map((n, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--navi-text)]" aria-hidden="true" />
                    <span className="flex-1">{n.title}</span>
                    <Link href={n.url} className="font-semibold text-[var(--navi-text)]">Open</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <h1 className="h1">Focus</h1>
      <p className="mt-2 text-[17px] text-muted">Pick one thing. Navi keeps everything else quiet until you&apos;re done.</p>
      <div className="mt-6 flex items-center gap-2" role="group" aria-label="How long">
        {[25, 50, 90].map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>
        ))}
      </div>
      <ul className="mt-6 flex flex-col gap-2">
        {tasks.map((t) => {
          const mins = t.estimate_minutes ? Math.min(t.estimate_minutes, minutes) : minutes;
          const due = t.due_at ? DateTime.fromISO(t.due_at, { zone }) : null;
          return (
            <li key={t.id}>
              <button type="button" disabled={pending} onClick={() => go(t.id, mins)} className="flex w-full items-center gap-4 rounded-[18px] bg-white/[0.04] px-5 py-4 text-left hover:bg-white/[0.07] disabled:opacity-50">
                <span className="flex flex-1 flex-col">
                  <span className="text-[16px] font-medium">{t.title}</span>
                  <span className="text-[13px] text-dim">
                    {t.status === "in_progress" ? "In progress" : due ? (due < DateTime.now() ? "Overdue" : `Due ${due.toFormat("h:mm a")}`) : ""}
                    {t.estimate_minutes ? ` · ${t.estimate_minutes} min estimate` : ""}
                  </span>
                </span>
                <span className="text-[14px] font-semibold text-[var(--navi-text)]">Focus · {mins} min</span>
              </button>
            </li>
          );
        })}
      </ul>
      {tasks.length === 0 && <p className="mt-4 text-[15px] text-dim">Nothing due today. Pick a task from <Link href="/tasks" className="underline">Tasks</Link>, or just focus.</p>}
      <button type="button" disabled={pending} onClick={() => go(null, minutes)} className="mt-4 self-start text-[15px] text-muted underline underline-offset-4 hover:text-text">
        Just focus, no task ({minutes} min)
      </button>
      {error && <p role="alert" className="mt-4 text-[14px] text-clash">{error}</p>}
    </section>
  );
}

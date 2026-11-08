"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePanel } from "../shell/panel-context";
import { Stone } from "../shell/stone";
import { dismissSuggestionAction, markBriefingReadAction, startFocusAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";

export function StartFocusButton({ taskId, minutes, label = "Start focus" }: { taskId: string; minutes: number | null; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startFocusAction({ task_id: taskId, planned_minutes: minutes });
            if (!r.ok) return setError(r.error);
            announceChange();
            router.push("/focus");
          })
        }
        className="flex h-11 items-center rounded-[22px] bg-text px-5 font-semibold text-black disabled:opacity-50"
      >
        {pending ? "Starting…" : label}
      </button>
      {error && <span role="alert" className="text-[13px] text-clash">{error}</span>}
    </span>
  );
}

export type InsightView =
  | { kind: "setup" }
  | { kind: "briefing"; id: string; title: string; body: string }
  | { kind: "unmarked"; key: string; count: number; date: string }
  | { kind: "occasion"; key: string; text: string; ask: string };

/** The one contextual line on Home. "Not now" is remembered (dismissed_suggestions). */
export function Insight({ insight }: { insight: InsightView }) {
  const panel = usePanel();
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;
  const dismiss = (key: string) =>
    start(async () => {
      const r = await dismissSuggestionAction(key);
      if (r.ok) setHidden(true);
    });
  const row = (text: React.ReactNode, actions: React.ReactNode) => (
    <div className="flex w-full items-center gap-3 px-1.5 text-[15px] text-[#C8C8CE]">
      <Stone size={14} />
      <span className="flex-1">{text}</span>
      {actions}
    </div>
  );
  const link = "font-semibold text-[var(--navi-text)] hover:underline";
  const quiet = "text-dim hover:text-text disabled:opacity-50";
  switch (insight.kind) {
    case "setup":
      return row("You skipped part of setting up Navi. Pick up where you left off whenever you like.", <Link href="/welcome" className={link}>Finish setting up</Link>);
    case "briefing":
      return (
        <div className="flex w-full flex-col gap-2">
          {row(
            <>{insight.title} is here.</>,
            <>
              <button type="button" className={link} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Read it"}</button>
              <button type="button" className={quiet} disabled={pending} onClick={() => start(async () => { await markBriefingReadAction(insight.id); setHidden(true); router.refresh(); })}>Done</button>
            </>,
          )}
          {open && <p className="whitespace-pre-line rounded-[18px] bg-white/[0.04] px-5 py-4 text-[15px] leading-relaxed text-[#C8C8CE]">{insight.body}</p>}
        </div>
      );
    case "unmarked":
      return row(
        `${insight.count} block${insight.count === 1 ? "" : "s"} from yesterday ${insight.count === 1 ? "isn't" : "aren't"} marked yet.`,
        <>
          <Link href={`/review?date=${insight.date}`} className={link}>Mark yesterday</Link>
          <button type="button" className={quiet} disabled={pending} onClick={() => dismiss(insight.key)}>Not now</button>
        </>,
      );
    case "occasion":
      return row(
        insight.text,
        <>
          <button type="button" className={link} onClick={() => { panel.ask(insight.ask); void dismissSuggestionAction(insight.key); setHidden(true); }}>Add it</button>
          <button type="button" className={quiet} disabled={pending} onClick={() => dismiss(insight.key)}>Not now</button>
        </>,
      );
  }
}

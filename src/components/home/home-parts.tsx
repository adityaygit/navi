"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePanel } from "../shell/panel-context";
import { Stone } from "../shell/stone";
import { dismissSuggestionAction, markBriefingReadAction, startFocusAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";

/** Home's box: what you type here goes to Navi (the panel opens beside Home). */
export function HomeComposer() {
  const panel = usePanel();
  const [text, setText] = useState("");
  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    panel.ask(v);
  };
  return (
    <form
      className="sticky bottom-7 z-10 mx-auto mt-auto flex h-[58px] w-full max-w-[660px] items-center gap-2.5 rounded-[29px] border border-white/[0.09] bg-[rgba(28,28,31,0.92)] pl-5 pr-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="home-ask" className="sr-only">Tell Navi anything</label>
      <input
        id="home-ask"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell Navi anything — a plan, a worry, a to-do"
        className="bare-field h-full min-w-0 flex-1 p-0 text-[15px] text-text placeholder:text-[#8E8E96]"
        autoComplete="off"
      />
      {text.trim() ? (
        <button type="submit" className="flex h-[42px] items-center gap-2 rounded-[21px] bg-text px-4 font-semibold text-black">Send</button>
      ) : (
        <button
          type="button"
          onClick={() => {
            panel.setHomeOpen(true);
            window.dispatchEvent(new Event("navi:start-voice"));
          }}
          className="flex h-[42px] items-center gap-2 rounded-[21px] bg-[var(--navi-text)] px-4 font-semibold text-[var(--navi-ink)]"
          aria-label="Talk to Navi"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>
          Talk
        </button>
      )}
    </form>
  );
}

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

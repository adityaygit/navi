"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import { completeTaskAction, dismissSuggestionAction, resolveTriageAction, updateTaskAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { usePanel } from "../shell/panel-context";
import { Stone } from "../shell/stone";
import { TaskCard } from "./task-card";

export type SpaceOpt = { id: string; name: string; color: string };
export type TaskGroup = { key: "overdue" | "morning" | "afternoon" | "evening" | "anytime" | "date" | "list"; label: string; ids: string[] };
export type Nudge = { key: string; title: string; waited: string };
export type TriageItem = { id: string; title: string; due_at: string | null };

const GROUP_ICON: Partial<Record<TaskGroup["key"], React.ReactNode>> = {
  morning: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E9C46A" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></svg>
  ),
  evening: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9DB8FF" strokeWidth="1.8" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
  ),
};

/** "due Friday", "due today 6:00 PM", "overdue · Thu". `soon` = within two days (shown in the due colour). */
export function dueText(t: Pick<Task, "due_at" | "status">, zone: string): { text: string; when: string; soon: boolean; overdue: boolean } | null {
  if (!t.due_at) return null;
  const due = DateTime.fromISO(t.due_at).setZone(zone);
  const now = DateTime.now().setZone(zone);
  const days = Math.round(due.startOf("day").diff(now.startOf("day"), "days").days);
  const endOfDay = due.hour === 23 && due.minute === 59;
  const overdue = due < now && t.status !== "done";
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 1 && days < 7 ? due.toFormat("cccc") : due.toFormat("ccc, LLL d");
  const when = `${day}${endOfDay || days !== 0 ? "" : ` ${due.toFormat("h:mm a")}`}`;
  return { text: overdue ? "overdue" : "due", when, soon: overdue || days <= 2, overdue };
}

export function TaskBoard({
  zone,
  tasks,
  steps,
  groups,
  spaces,
  initialOpen,
  nudge,
  emptyText,
  triage = [],
}: {
  zone: string;
  tasks: Task[];
  steps: Record<string, Task[]>;
  groups: TaskGroup[];
  spaces: SpaceOpt[];
  initialOpen: string | null;
  nudge: Nudge | null;
  emptyText: string;
  /** Overdue imported work waiting for the person's decision (one row). */
  triage?: TriageItem[];
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // ?open= may name a step: open its parent.
  const startOpen = initialOpen && byId.has(initialOpen) ? initialOpen : (tasks.find((t) => (steps[t.id] ?? []).some((s) => s.id === initialOpen))?.id ?? null);
  const [open, setOpen] = useState<string | null>(startOpen);
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  return (
    <div className="mt-[22px] flex flex-col">
      {triage.length > 0 && <TriageRow items={triage} zone={zone} />}
      {groups.length === 0 && <p className="px-1 py-6 text-[15px] text-dim">{emptyText}</p>}
      {groups.map((g, gi) => (
        <section key={`${g.key}${g.label}`} aria-label={g.label || "Tasks"} className="flex flex-col">
          {g.label && (
            <h2 className={`flex items-center gap-2 px-1 pb-1.5 text-[13px] font-semibold ${gi === 0 ? "pt-1.5" : "pt-3.5"} ${g.key === "overdue" ? "text-due" : "text-[#8E8E96]"}`}>
              {GROUP_ICON[g.key]}
              {g.label}
            </h2>
          )}
          <ul className="flex flex-col gap-0.5">
            {g.ids.map((id) => {
              const t = byId.get(id);
              if (!t) return null;
              const space = t.workspace_id ? (spaceById.get(t.workspace_id) ?? null) : null;
              return (
                <li key={id}>
                  {open === id ? (
                    <TaskCard task={t} steps={steps[id] ?? []} space={space} spaces={spaces} zone={zone} onClose={() => setOpen(null)} />
                  ) : (
                    <TaskRow task={t} space={space} zone={zone} stepsCount={(steps[id] ?? []).length} onOpen={() => setOpen(id)} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {nudge && <NudgeRow nudge={nudge} />}
    </div>
  );
}

/** The round checkbox. Completing goes through completeTask (repeats spawn their next one). */
export function CheckCircle({ task, size = 22 }: { task: Pick<Task, "id" | "title" | "status">; size?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(task.status === "done");
  const [error, setError] = useState<string | null>(null);
  // Follow the server once it has caught up (after a refresh).
  const [seen, setSeen] = useState(task.status);
  if (seen !== task.status) {
    setSeen(task.status);
    setDone(task.status === "done");
  }
  const toggle = () =>
    start(async () => {
      setError(null);
      const next = !done;
      setDone(next);
      const r = next ? await completeTaskAction(task.id) : await updateTaskAction(task.id, { status: "todo" });
      if (!r.ok) {
        setDone(!next);
        setError(r.error);
        return;
      }
      announceChange();
      router.refresh();
    });
  return (
    <span className="relative flex shrink-0 flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={done ? `Mark ${task.title} not done` : `Complete ${task.title}`}
        aria-pressed={done}
        // The circle is drawn small; on touch screens the button around it is a full 44px target.
        className="-m-1 flex items-center justify-center rounded-full p-1 pointer-coarse:-m-2.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <span
          aria-hidden="true"
          className={`flex items-center justify-center rounded-full font-bold leading-none transition-colors ${done ? "bg-[var(--navi-text)] text-[var(--navi-ink)]" : "border-[1.75px] border-[#6E6E77] text-transparent hover:border-[var(--navi-text)] hover:text-[var(--navi-text)]"}`}
          style={{ width: size, height: size, fontSize: size * 0.55 }}
        >
          ✓
        </span>
      </button>
      {error && <span role="alert" className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg bg-[#1C1C1F] px-2.5 py-1.5 text-[12.5px] text-clash">{error}</span>}
    </span>
  );
}

function TaskRow({ task, space, zone, stepsCount, onOpen }: { task: Task; space: SpaceOpt | null; zone: string; stepsCount: number; onOpen: () => void }) {
  const done = task.status === "done";
  const due = dueText(task, zone);
  return (
    <div className={`group flex items-center gap-3.5 rounded-[16px] px-1 py-2.5 hover:bg-white/[0.03] ${done ? "opacity-50" : ""}`}>
      <CheckCircle task={task} />
      <button type="button" onClick={onOpen} aria-expanded={false} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 text-left sm:flex-row sm:items-center sm:gap-3">
        <span className={`min-w-0 flex-1 text-[15px] sm:truncate ${done ? "line-through decoration-white/40" : ""}`}>{task.title}</span>
        <span className="flex shrink-0 flex-wrap items-center gap-x-2 text-[13px] text-[#8E8E96] sm:text-[14px]">
          {due && !done && (
            <span className={due.soon ? "text-due" : ""}>
              {due.text} {due.when}
            </span>
          )}
          {due && !done && (space || task.estimate_minutes) && <span aria-hidden="true">·</span>}
          {space && (
            <span className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: space.color }} aria-hidden="true" />
              {space.name}
            </span>
          )}
          {task.estimate_minutes != null && !done && (
            <span>
              {space ? "· " : ""}
              {task.estimate_minutes} min
            </span>
          )}
          {stepsCount > 0 && !done && <span className="sr-only">, {stepsCount} steps</span>}
        </span>
      </button>
    </div>
  );
}

function NudgeRow({ nudge }: { nudge: Nudge }) {
  const panel = usePanel();
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[18px] bg-white/[0.045] px-4 py-3 text-[14px] text-[#C8C8CE]">
      <Stone size={13} />
      <span className="min-w-[200px] flex-1">
        “{nudge.title}” has waited {nudge.waited}. Want me to split it into three small steps?
      </span>
      <button
        type="button"
        className="font-semibold text-[var(--navi-text)] hover:underline"
        onClick={() => {
          panel.ask(`Split “${nudge.title}” into three small steps`);
          void dismissSuggestionAction(nudge.key);
          setHidden(true);
        }}
      >
        Split it
      </button>
      <button
        type="button"
        className="text-dim hover:text-text disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await dismissSuggestionAction(nudge.key);
            if (r.ok) setHidden(true);
          })
        }
      >
        Leave it
      </button>
    </div>
  );
}

/**
 * Overdue imported (Canvas) work as one row, not a wall of "overdue": Canvas
 * can't tell Navi what was handed in, so the person decides. Same look as the
 * nudge row. "Show" lists them (each can be ticked off on its own).
 */
function TriageRow({ items, zone }: { items: TriageItem[]; zone: string }) {
  const router = useRouter();
  const panel = usePanel();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const n = items.length;
  const all = (decision: "handed_in") =>
    start(async () => {
      setError(null);
      const r = await resolveTriageAction(decision, { ids: items.map((i) => i.id) });
      if (!r.ok) return setError(r.error);
      setConfirm(false);
      announceChange();
      router.refresh();
    });
  return (
    <section aria-label="Past-due Canvas items" className="mb-2 flex flex-col gap-2 rounded-[18px] bg-white/[0.045] px-4 py-3 text-[14px] text-[#C8C8CE]">
      <div className="flex flex-wrap items-center gap-3">
        <Stone size={13} />
        <span className="min-w-[200px] flex-1">
          {n} past-due Canvas {n === 1 ? "item needs" : "items need"} a decision. Canvas doesn&apos;t tell Navi what you handed in.
        </span>
        <button type="button" className="font-semibold text-[var(--navi-text)] hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </button>
        {!confirm ? (
          <button type="button" className="text-dim hover:text-text disabled:opacity-50" disabled={pending} onClick={() => setConfirm(true)}>
            All handed in
          </button>
        ) : (
          <span className="flex items-center gap-3" role="group" aria-label="Confirm">
            <button type="button" className="font-semibold text-[var(--navi-text)] hover:underline disabled:opacity-50" disabled={pending} onClick={() => all("handed_in")}>
              {pending ? "Saving…" : `Mark all ${n} done`}
            </button>
            <button type="button" className="text-dim hover:text-text" disabled={pending} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {error && <p role="alert" className="text-[13px] text-due">{error}</p>}
      {open && (
        <ul className="flex flex-col gap-1 pt-1">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <CheckCircle task={{ id: t.id, title: t.title, status: "todo" }} size={20} />
              <span className="min-w-0 flex-1 truncate text-text">{t.title}</span>
              {t.due_at && <span className="shrink-0 text-[12.5px] text-dim">was due {DateTime.fromISO(t.due_at).setZone(zone).toFormat("ccc, LLL d")}</span>}
            </li>
          ))}
          <li className="pt-1">
            <button type="button" className="text-dim hover:text-text" onClick={() => panel.ask("Help me go through my past-due Canvas items: which are handed in and which still need time.")}>
              Go through them with Navi
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}

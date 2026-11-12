"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import { createTaskAction, deleteItemAction, newSubmitId, startFocusAction, updateTaskAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { usePanel } from "../shell/panel-context";
import { Stone } from "../shell/stone";
import { CheckCircle, dueText, type SpaceOpt } from "./task-board";

const LOCAL_FMT = "yyyy-LL-dd'T'HH:mm";
type Repeat = "never" | "daily" | "weekdays" | "weekly";

function repeatOf(r: Task["recurrence"]): Repeat {
  if (!r) return "never";
  if (r.freq === "daily") return "daily";
  const d = [...(r.days ?? [])].sort().join(",");
  return d === "1,2,3,4,5" ? "weekdays" : "weekly";
}

/**
 * A task, opened: just what you need to do it (steps, notes, Focus, Navi), and
 * the rest behind "More details" (V4-Advanced board). Every setting saves as
 * soon as it changes and says what it does.
 */
export function TaskCard({ task, steps, space, spaces, zone, onClose }: { task: Task; steps: Task[]; space: SpaceOpt | null; spaces: SpaceOpt[]; zone: string; onClose: () => void }) {
  const router = useRouter();
  const panel = usePanel();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [focusing, startFocus] = useTransition();
  const [notes, setNotes] = useState(task.notes ?? "");
  const [title, setTitle] = useState(task.title);
  const [step, setStep] = useState("");
  const stepSubmit = useRef<{ id: string; text: string } | null>(null);
  const done = task.status === "done";
  const due = dueText(task, zone);
  const openSteps = steps.filter((s) => s.status !== "done");
  const nextStepId = openSteps[0]?.id;
  const focusMinutes = Math.min(task.estimate_minutes ?? 25, 50);
  // Imported from Linear (and still connected): Linear owns the name, priority, due date and project.
  const linked = Boolean(task.external_connection_id);
  const ext = task.external_data;

  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      setError(null);
      const r = await updateTaskAction(task.id, patch);
      if (!r.ok) return setError(r.error);
      announceChange();
      router.refresh();
    });

  const addStep = () => {
    const t = step.trim();
    if (!t) return;
    const id = stepSubmit.current?.text === t ? stepSubmit.current.id : newSubmitId();
    stepSubmit.current = { id, text: t };
    start(async () => {
      setError(null);
      const r = await createTaskAction({ id, title: t, parent_task_id: task.id, workspace_id: task.workspace_id });
      if (!r.ok) return setError(r.error);
      stepSubmit.current = null;
      setStep("");
      announceChange();
      router.refresh();
    });
  };

  const sub = [
    space ? (
      <span key="s" className="flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: space.color }} aria-hidden="true" />
        {space.name}
      </span>
    ) : null,
    due ? (
      <span key="d">
        {due.text} <span className={due.soon ? "text-due" : ""}>{due.when}</span>
      </span>
    ) : null,
    steps.length ? <span key="p">{steps.length - openSteps.length} of {steps.length} steps</span> : null,
  ].filter(Boolean);

  return (
    <div className="my-1 flex flex-col gap-3 rounded-[22px] border border-white/[0.08] bg-white/[0.05] px-4 pb-4 pt-3.5" aria-label={`Task: ${task.title}`} role="group">
      <div className="flex items-start gap-3.5">
        <span className="mt-px">
          <CheckCircle task={task} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <label htmlFor={`title-${task.id}`} className="sr-only">Title</label>
          <input
            id={`title-${task.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={linked}
            title={linked ? "Change the name in Linear" : undefined}
            onBlur={() => !linked && title.trim() && title.trim() !== task.title && save({ title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={`w-full rounded-md bg-transparent text-[16px] font-semibold outline-none focus-visible:bg-white/[0.04] ${done ? "line-through" : ""}`}
          />
          {sub.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-1.5 text-[14px] text-[#8E8E96]">
              {sub.map((n, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {n}
                </span>
              ))}
            </span>
          )}
        </div>
        <button type="button" onClick={onClose} aria-expanded={true} aria-label={`Close ${task.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-dim hover:bg-white/[0.06] hover:text-text">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
        </button>
      </div>

      <div className="ml-9 flex flex-col gap-3">
        {task.external_source === "linear" && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-[#8E8E96]">
            <span>From Linear{ext?.identifier ? ` · ${ext.identifier}` : ""}</span>
            {ext?.state_name && <span>· {ext.state_name}</span>}
            {ext?.priority_label && ext.priority_label !== "No priority" && <span>· {ext.priority_label}</span>}
            {ext?.detached && <span className="text-recovery">· {ext.detached === "unassigned" ? "no longer assigned to you" : ext.detached === "archived" ? "archived in Linear" : "no longer in Linear"}</span>}
            {task.external_url && (
              <a href={task.external_url} target="_blank" rel="noopener noreferrer" className="text-[var(--navi-text)] hover:underline">
                Open in Linear<span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {linked && <span className="w-full">Name, priority and due date follow Linear. Planning here is yours.</span>}
          </p>
        )}
        {(steps.length > 0 || !done) && (
          <ul className="flex flex-col gap-2" aria-label="Steps">
            {steps.map((s) => (
              <li key={s.id} className={`flex items-center gap-2.5 text-[14.5px] ${s.status === "done" ? "text-dim" : ""}`}>
                <CheckCircle task={s} size={16} />
                <span className={s.status === "done" ? "line-through" : ""}>{s.title}</span>
                {s.id === nextStepId && <span className="text-[12.5px] text-[var(--navi-text)]">next</span>}
              </li>
            ))}
            {!done && (
              <li>
                <form
                  className="flex items-center gap-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addStep();
                  }}
                >
                  <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center text-[15px] text-dim">+</span>
                  <label htmlFor={`step-${task.id}`} className="sr-only">Add a step</label>
                  <input id={`step-${task.id}`} value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step" className="h-7 flex-1 rounded-md bg-transparent px-1 text-[14.5px] placeholder:text-dim focus-visible:bg-white/[0.06]" style={{ outline: "none" }} />
                </form>
              </li>
            )}
          </ul>
        )}

        <label htmlFor={`notes-${task.id}`} className="sr-only">Notes</label>
        <textarea
          id={`notes-${task.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => (notes.trim() || null) !== (task.notes ?? null) && save({ notes: notes.trim() || null })}
          placeholder="Notes"
          rows={1}
          className="min-h-10 w-full resize-none rounded-[14px] bg-white/[0.04] px-3.5 py-2.5 text-[14px] leading-relaxed text-[#C8C8CE] outline-none [field-sizing:content] placeholder:text-dim focus-visible:bg-white/[0.06]"
        />

        {!done && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={focusing}
              onClick={() =>
                startFocus(async () => {
                  setError(null);
                  const r = await startFocusAction({ task_id: task.id, planned_minutes: focusMinutes });
                  if (!r.ok) return setError(r.error);
                  announceChange();
                  router.push("/focus");
                })
              }
              className="flex h-[38px] items-center rounded-[19px] bg-text px-4 text-[14px] font-semibold text-black disabled:opacity-50"
            >
              {focusing ? "Starting…" : `Focus · ${focusMinutes} min`}
            </button>
            <button type="button" onClick={() => panel.ask(`Find a time today for “${task.title}”`)} className="flex h-[38px] items-center rounded-[19px] bg-white/[0.07] px-4 text-[14px] hover:bg-white/[0.11]">
              Find a time
            </button>
            <button type="button" onClick={() => panel.ask(`Help me with “${task.title}”`)} className="flex h-[38px] items-center gap-2 rounded-[19px] px-2 text-[14px] text-[var(--navi-text)] hover:underline">
              <Stone size={12} />
              Ask Navi to help
            </button>
          </div>
        )}

        <MoreDetails task={task} zone={zone} spaces={spaces} open={more} setOpen={setMore} save={save} pending={pending} linked={linked} />

        {error && <p role="alert" className="text-[13px] text-clash">{error}</p>}

        {!linked && <div className="flex justify-end">
          <button
            type="button"
            className="text-[13px] text-dim hover:text-clash disabled:opacity-50"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Delete “${task.title}”${steps.length ? " and its steps" : ""}? This can't be undone.`)) return;
              start(async () => {
                const r = await deleteItemAction("tasks", task.id);
                if (!r.ok) return setError(r.error);
                announceChange();
                router.refresh();
              });
            }}
          >
            Delete task
          </button>
        </div>}
      </div>
    </div>
  );
}

function MoreDetails({
  task,
  zone,
  spaces,
  open,
  setOpen,
  save,
  pending,
  linked,
}: {
  task: Task;
  zone: string;
  spaces: SpaceOpt[];
  open: boolean;
  setOpen: (v: boolean) => void;
  save: (patch: Record<string, unknown>) => void;
  pending: boolean;
  /** Linear owns due date and priority; repeating would copy the issue. */
  linked: boolean;
}) {
  const local = (iso: string | null | undefined) => (iso ? DateTime.fromISO(iso).setZone(zone).toFormat(LOCAL_FMT) : "");
  const fromLocal = (v: string) => (v ? DateTime.fromFormat(v, LOCAL_FMT, { zone }).toISO() : null);
  const [estimate, setEstimate] = useState<number | null>(task.estimate_minutes);
  const repeat = repeatOf(task.recurrence);
  const dueLabel = task.due_at ? DateTime.fromISO(task.due_at).setZone(zone).toFormat("cccc, h:mm a") : null;
  // ±5 minutes up to half an hour, ±15 above; below 5 means "no estimate".
  const step = (v: number | null, dir: 1 | -1): number | null => {
    if (dir > 0) return v == null ? 15 : Math.min(1440, v < 30 ? v + 5 : v + 15);
    if (v == null || v <= 5) return null;
    return v <= 30 ? v - 5 : v - 15;
  };
  const setEst = (v: number | null) => {
    setEstimate(v);
    save({ estimate_minutes: v });
  };
  const row = "flex flex-wrap items-center justify-between gap-3";
  const help = "mt-1 text-[13px] leading-snug text-[#8E8E96]";
  const pill = "flex h-9 items-center rounded-[18px] bg-white/[0.07] px-3.5 text-[14px] text-text outline-none [color-scheme:dark]";

  return (
    <div className="rounded-[18px] bg-white/[0.04]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`more-${task.id}`} className="flex h-11 w-full items-center gap-3 px-4 text-left">
        <span className="text-[14.5px]">More details</span>
        {!open && <span className="flex-1 text-[13px] text-dim">deadline, estimate, repeat, reminder</span>}
        {open && <span className="flex-1" />}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8E8E96" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={open ? "rotate-180" : ""}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={`more-${task.id}`} className="flex flex-col gap-5 px-4 pb-4 pt-1">
          <div>
            <div className={row}>
              <label htmlFor={`due-${task.id}`} className="text-[14.5px]">Due</label>
              <input id={`due-${task.id}`} type="datetime-local" defaultValue={local(task.due_at)} disabled={linked} onChange={(e) => save({ due_at: fromLocal(e.target.value), ...(e.target.value ? {} : { due_is_hard: false }) })} className={pill} />
            </div>
          </div>
          <div>
            <div className={row}>
              <span id={`hard-${task.id}`} className="text-[14.5px]">Hard deadline</span>
              <button
                type="button"
                role="switch"
                aria-checked={task.due_is_hard}
                aria-labelledby={`hard-${task.id}`}
                disabled={!task.due_at || pending}
                onClick={() => save({ due_is_hard: !task.due_is_hard })}
                className={`relative h-[26px] w-[44px] rounded-full transition-colors disabled:opacity-40 ${task.due_is_hard ? "bg-[var(--navi-text)]" : "bg-white/[0.14]"}`}
              >
                <span className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${task.due_is_hard ? "left-[21px] bg-[#00140A]" : "left-[3px] bg-text"}`} />
              </button>
            </div>
            <p className={help}>
              {!task.due_at
                ? "Set a due time first."
                : task.due_is_hard
                  ? `${dueLabel}. Navi won't move it past this, and will tell you early if it's at risk.`
                  : "A target, not a wall. Turn this on if it really can't slip."}
            </p>
          </div>
          <div>
            <div className={row}>
              <span className="text-[14.5px]" id={`est-${task.id}`}>Estimate</span>
              <span className="flex items-center gap-2.5" role="group" aria-labelledby={`est-${task.id}`}>
                <button type="button" onClick={() => setEst(step(estimate, -1))} disabled={estimate == null || pending} aria-label="Less time" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/[0.07] disabled:opacity-40">−</button>
                <span className="min-w-[64px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">{estimate == null ? "None" : `${estimate} min`}</span>
                <button type="button" onClick={() => setEst(step(estimate, 1))} disabled={pending} aria-label="More time" className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/[0.07] disabled:opacity-40">+</button>
              </span>
            </div>
            <p className={help}>Used to find free time that fits.</p>
          </div>
          <div>
            <div className={row}>
              <label htmlFor={`rep-${task.id}`} className="text-[14.5px]">Repeats</label>
              <select
                id={`rep-${task.id}`}
                value={repeat}
                onChange={(e) => {
                  const v = e.target.value as Repeat;
                  const weekday = (task.due_at ? DateTime.fromISO(task.due_at).setZone(zone) : DateTime.now().setZone(zone)).weekday % 7;
                  save({ recurrence: v === "never" ? null : v === "daily" ? { freq: "daily" } : v === "weekdays" ? { freq: "weekly", days: [1, 2, 3, 4, 5] } : { freq: "weekly", days: [weekday] } });
                }}
                className={pill}
                disabled={linked}
              >
                <option value="never">Never</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Every week</option>
              </select>
            </div>
            <p className={help}>When you finish it, the next one appears.</p>
          </div>
          <div>
            <div className={row}>
              <label htmlFor={`rem-${task.id}`} className="text-[14.5px]">Reminder</label>
              <span className="flex items-center gap-2">
                <input id={`rem-${task.id}`} type="datetime-local" key={task.remind_at ?? "none"} defaultValue={local(task.remind_at)} onChange={(e) => e.target.value && save({ remind_at: fromLocal(e.target.value) })} className={pill} />
                {task.remind_at && (
                  <button type="button" onClick={() => save({ remind_at: null })} className="text-[13px] text-dim hover:text-text" aria-label="Remove the reminder">Clear</button>
                )}
              </span>
            </div>
            <p className={help}>A push notification. Respects your quiet hours.</p>
          </div>
          <div>
            <div className={row}>
              <label htmlFor={`space-${task.id}`} className="text-[14.5px]">Space</label>
              <select id={`space-${task.id}`} value={task.workspace_id ?? ""} onChange={(e) => save({ workspace_id: e.target.value || null })} className={pill}>
                <option value="">None</option>
                {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className={row}>
              <span id={`someday-${task.id}`} className="text-[14.5px]">Someday</span>
              <button
                type="button"
                role="switch"
                aria-checked={task.priority === 4}
                aria-labelledby={`someday-${task.id}`}
                disabled={pending || linked}
                onClick={() => save({ priority: task.priority === 4 ? 3 : 4 })}
                className={`relative h-[26px] w-[44px] rounded-full transition-colors disabled:opacity-40 ${task.priority === 4 ? "bg-[var(--navi-text)]" : "bg-white/[0.14]"}`}
              >
                <span className={`absolute top-[3px] h-5 w-5 rounded-full transition-all ${task.priority === 4 ? "left-[21px] bg-[#00140A]" : "left-[3px] bg-text"}`} />
              </button>
            </div>
            <p className={help}>Parks it under Someday (lowest priority) until you pick it up. Undated only.</p>
          </div>
        </div>
      )}
    </div>
  );
}

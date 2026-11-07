"use client";
import { useRef, useState, useTransition } from "react";
import { DateTime } from "luxon";
import { createTaskAction, newSubmitId, updateTaskAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import type { Task } from "@/lib/types";

type Opt = { id: string; name?: string; title?: string; color?: string | null };

export function TaskForm({
  zone,
  projects,
  workspaces,
  goals,
  task,
  defaults = {},
  parentId,
  onDone,
}: {
  zone: string;
  projects: Opt[];
  workspaces: Opt[];
  goals: Opt[];
  task?: Task;
  defaults?: { project_id?: string; workspace_id?: string };
  parentId?: string;
  onDone?: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [due, setDue] = useState(task?.due_at ? DateTime.fromISO(task.due_at).setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm") : "");
  const [hard, setHard] = useState(task?.due_is_hard ?? false);
  const [priority, setPriority] = useState(String(task?.priority ?? 3));
  const [estimate, setEstimate] = useState(task?.estimate_minutes ? String(task.estimate_minutes) : "");
  const [projectId, setProjectId] = useState(task?.project_id ?? defaults.project_id ?? "");
  const [workspaceId, setWorkspaceId] = useState(task?.workspace_id ?? defaults.workspace_id ?? "");
  const [goalId, setGoalId] = useState(task?.goal_id ?? "");
  const [status, setStatus] = useState(task?.status ?? "todo");
  const [blocker, setBlocker] = useState(task?.blocker ?? "");
  const [recur, setRecur] = useState(task?.recurrence?.freq ?? "");
  const [more, setMore] = useState(Boolean(task));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = task?.id ?? parentId ?? "new";
  // One id per submit: a retry of the same values (after a dropped connection)
  // reuses it, so the server returns the task it already made instead of a duplicate.
  const submitRef = useRef<{ sig: string; id: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = {
      title: title.trim(),
      notes: notes.trim() || null,
      due_at: due ? DateTime.fromFormat(due, "yyyy-LL-dd'T'HH:mm", { zone }).toISO() : null,
      due_is_hard: hard,
      priority: Number(priority),
      estimate_minutes: estimate ? Number(estimate) : null,
      project_id: projectId || null,
      workspace_id: workspaceId || null,
      goal_id: goalId || null,
      recurrence: recur ? { freq: recur as "daily" | "weekly" } : null,
      ...(parentId ? { parent_task_id: parentId } : {}),
    };
    start(async () => {
      const r = task
        ? await updateTaskAction(task.id, { ...values, status, blocker: status === "blocked" ? blocker || null : null })
        : await (() => {
            const sig = JSON.stringify(values);
            if (submitRef.current?.sig !== sig) submitRef.current = { sig, id: newSubmitId() };
            return createTaskAction({ id: submitRef.current.id, ...values });
          })();
      if (!r.ok) { setMsg(r.error); return; }
      submitRef.current = null;
      announceChange();
      if (!task) { setTitle(""); setNotes(""); setDue(""); setEstimate(""); setMsg("Added"); }
      onDone?.();
    });
  }

  return (
    <form onSubmit={submit} className={task || parentId ? "flex flex-col gap-3" : "card flex flex-col gap-3 p-3 pl-4 md:p-3 md:pl-5"} aria-label={task ? "Edit task" : parentId ? "Add subtask" : "Add task"}>
      <div className="flex gap-2">
        <label htmlFor={`title-${id}`} className="sr-only">Task</label>
        <input id={`title-${id}`} required maxLength={500} className={`input min-w-0 flex-1 ${task || parentId ? "" : "border-transparent bg-transparent px-1 text-[17px] focus:bg-black/20"}`} placeholder={parentId ? "Add a subtask" : "Add a task"} value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn btn-primary min-w-20" disabled={pending || !title.trim()}>{task ? "Save" : "Add"}</button>
      </div>
      {!more && !parentId && <button type="button" className="btn btn-ghost btn-sm -mt-1 self-start px-1 text-muted" onClick={() => setMore(true)}>More details</button>}
      {more && (
        <div className="grid gap-4 pt-1 sm:grid-cols-3">
          <div><label className="label" htmlFor={`due-${id}`}>Due</label><input id={`due-${id}`} type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div><label className="label" htmlFor={`pri-${id}`}>Priority</label>
            <select id={`pri-${id}`} className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="1">P1 — critical</option><option value="2">P2 — high</option><option value="3">P3 — normal</option><option value="4">P4 — low</option>
            </select>
          </div>
          <div><label className="label" htmlFor={`est-${id}`}>Estimate (min)</label><input id={`est-${id}`} type="number" min={1} max={1440} className="input" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></div>
          <div><label className="label" htmlFor={`ws-${id}`}>Area</label>
            <select id={`ws-${id}`} className="input" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">None</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor={`pr-${id}`}>Project</label>
            <select id={`pr-${id}`} className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor={`go-${id}`}>Goal</label>
            <select id={`go-${id}`} className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <label className="flex min-h-11 items-center gap-2.5 self-end text-[15px]"><input type="checkbox" className="h-5 w-5 accent-[#f2f2f2]" checked={hard} onChange={(e) => setHard(e.target.checked)} /> Hard deadline</label>
          <div><label className="label" htmlFor={`rec-${id}`}>Repeats</label>
            <select id={`rec-${id}`} className="input" value={recur} onChange={(e) => setRecur(e.target.value)}>
              <option value="">Doesn't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
            </select>
          </div>
          {task && (
            <div><label className="label" htmlFor={`st-${id}`}>Status</label>
              <select id={`st-${id}`} className="input" value={status} onChange={(e) => setStatus(e.target.value as Task["status"])}>
                <option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="cancelled">Cancelled</option><option value="done">Done</option>
              </select>
            </div>
          )}
          {status === "blocked" && (
            <div className="sm:col-span-3"><label className="label" htmlFor={`bl-${id}`}>What's blocking it?</label><input id={`bl-${id}`} className="input" value={blocker} onChange={(e) => setBlocker(e.target.value)} /></div>
          )}
          <div className="sm:col-span-3"><label className="label" htmlFor={`no-${id}`}>Notes & links</label><textarea id={`no-${id}`} className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </form>
  );
}

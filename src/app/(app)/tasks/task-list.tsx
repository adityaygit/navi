"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { completeTaskAction, deleteItemAction, startFocusAction, updateTaskAction } from "@/app/(app)/client-actions";
import { TaskForm } from "./task-form";

type Opt = { id: string; name?: string; title?: string };

function dueLabel(t: Task, zone: string) {
  if (!t.due_at) return null;
  const due = DateTime.fromISO(t.due_at).setZone(zone);
  const overdue = due < DateTime.now() && t.status !== "done";
  return <span className={`text-xs ${overdue ? "text-danger" : "muted"}`}>{overdue ? "overdue · " : ""}due {due.toFormat("ccc LLL d, h:mm a")}{t.due_is_hard ? " (hard)" : ""}</span>;
}

export function TaskList({ tasks, zone, projects, workspaces, goals }: { tasks: Task[]; zone: string; projects: Opt[]; workspaces: Opt[]; goals: Opt[] }) {
  const byParent = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const key = t.parent_task_id && ids.has(t.parent_task_id) ? t.parent_task_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), t]);
  }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  return (
    <ul className="card flex flex-col p-0" aria-label="Tasks">
      {(byParent.get(null) ?? []).map((t) => (
        <TaskRow key={t.id} task={t} zone={zone} children_={byParent.get(t.id) ?? []} projectName={t.project_id ? projectName.get(t.project_id) : undefined} opts={{ projects, workspaces, goals }} />
      ))}
    </ul>
  );
}

function TaskRow({ task, zone, children_, projectName, opts, depth = 0 }: { task: Task; zone: string; children_: Task[]; projectName?: string; opts: { projects: Opt[]; workspaces: Opt[]; goals: Opt[] }; depth?: number }) {
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const done = task.status === "done" || task.status === "cancelled";
  return (
    <li className="border-b border-border last:border-0">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ paddingLeft: 16 + depth * 20 }}>
        {!done ? (
          <ActionButton className="btn btn-sm h-8 min-h-8 w-8 rounded-full p-0 pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:w-11" label={`Complete ${task.title}`} action={() => completeTaskAction(task.id)}>✓</ActionButton>
        ) : (
          <ActionButton className="btn btn-ghost btn-sm" label={`Reopen ${task.title}`} action={() => updateTaskAction(task.id, { status: "todo" })}>Reopen</ActionButton>
        )}
        {/* basis-48 keeps the title readable: on phones the buttons wrap below it. */}
        <div className="min-w-0 flex-1 basis-48">
          <div className={`flex flex-wrap items-center gap-1.5 ${done ? "muted line-through" : ""}`}>
            <span>{task.title}</span>
            {task.priority <= 2 && <span className={`badge ${task.priority === 1 ? "badge-danger" : "badge-warn"}`}>P{task.priority}</span>}
            {task.status === "in_progress" && <span className="badge badge-accent">in progress</span>}
            {task.status === "blocked" && <span className="badge badge-warn" title={task.blocker ?? ""}>blocked</span>}
            {task.recurrence && <span className="badge">repeats {task.recurrence.freq}</span>}
            {task.source !== "user" && <span className="badge" title="Where this came from">{task.source}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {dueLabel(task, zone)}
            {projectName && <span className="muted text-xs">{projectName}</span>}
            {(task.estimate_minutes || task.actual_minutes > 0) && (
              <span className="muted text-xs">{task.actual_minutes > 0 ? `${task.actual_minutes} min spent` : ""}{task.actual_minutes > 0 && task.estimate_minutes ? " / " : ""}{task.estimate_minutes ? `est. ${task.estimate_minutes} min` : ""}</span>
            )}
            {task.blocker && <span className="text-xs text-warn">Blocked: {task.blocker}</span>}
          </div>
        </div>
        <div className="ml-10 flex flex-wrap gap-1 pointer-coarse:ml-13 sm:ml-0 sm:pointer-coarse:ml-0">
          {!done && <ActionButton action={() => startFocusAction({ task_id: task.id, planned_minutes: task.estimate_minutes })}>Focus</ActionButton>}
          {!done && depth === 0 && <button type="button" className="btn btn-sm" onClick={() => setAddingSub((v) => !v)}>+ Sub</button>}
          <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? "Close" : "Edit"}</button>
          <ActionButton className="btn btn-ghost btn-sm" confirm={`Delete “${task.title}”? This can't be undone.`} action={() => deleteItemAction("tasks", task.id)}>Delete</ActionButton>
        </div>
      </div>
      {(editing || addingSub) && (
        <div className="border-t border-border bg-surface-2 px-4 py-3">
          {editing && <TaskForm zone={zone} {...opts} task={task} onDone={() => setEditing(false)} />}
          {addingSub && <TaskForm zone={zone} {...opts} parentId={task.id} defaults={{ project_id: task.project_id ?? undefined, workspace_id: task.workspace_id ?? undefined }} onDone={() => setAddingSub(false)} />}
        </div>
      )}
      {children_.length > 0 && (
        <ul aria-label={`Subtasks of ${task.title}`}>
          {children_.map((c) => <TaskRow key={c.id} task={c} zone={zone} children_={[]} opts={opts} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

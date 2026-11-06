"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import type { Task } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { completeTaskAction, deleteItemAction, startFocusAction, updateTaskAction } from "@/app/(app)/client-actions";
import { TaskForm } from "./task-form";

type Opt = { id: string; name?: string; title?: string; color?: string | null };

/** "Due Fri 5:00 PM", "Due today, end of day", or "Overdue · was due Thu" in the clash colour. */
function DueBadge({ t, zone }: { t: Task; zone: string }) {
  if (!t.due_at) return null;
  const due = DateTime.fromISO(t.due_at).setZone(zone);
  const now = DateTime.now().setZone(zone);
  const done = t.status === "done" || t.status === "cancelled";
  const overdue = due < now && !done;
  const days = Math.round(due.startOf("day").diff(now.startOf("day"), "days").days);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : days > 1 && days < 7 ? due.toFormat("ccc") : due.toFormat("ccc LLL d");
  const time = due.hour === 23 && due.minute === 59 ? ", end of day" : ` ${due.toFormat("h:mm a")}`;
  return (
    <span className={`badge num ${overdue ? "badge-danger" : t.due_is_hard ? "badge-accent" : ""}`}>
      {overdue ? `Overdue · was due ${day}${time}` : `Due ${day}${time}`}
      {t.due_is_hard && <span className={overdue ? "" : "text-muted"}>· hard</span>}
    </span>
  );
}

export function TaskList({ tasks, zone, projects, workspaces, goals }: { tasks: Task[]; zone: string; projects: Opt[]; workspaces: Opt[]; goals: Opt[] }) {
  const byParent = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const key = t.parent_task_id && ids.has(t.parent_task_id) ? t.parent_task_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), t]);
  }
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const area = new Map(workspaces.map((w) => [w.id, { name: w.name ?? "", color: w.color ?? null }]));
  const ctx = { zone, projectName, area, opts: { projects, workspaces, goals } };
  return (
    <ul className="surf flex flex-col divide-y divide-white/[0.07]" aria-label="Tasks">
      {(byParent.get(null) ?? []).map((t) => (
        <TaskRow key={t.id} task={t} children_={byParent.get(t.id) ?? []} ctx={ctx} />
      ))}
    </ul>
  );
}

type RowCtx = {
  zone: string;
  projectName: Map<string, string | undefined>;
  area: Map<string, { name: string; color: string | null }>;
  opts: { projects: Opt[]; workspaces: Opt[]; goals: Opt[] };
};

function TaskRow({ task, children_, ctx, depth = 0 }: { task: Task; children_: Task[]; ctx: RowCtx; depth?: number }) {
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const done = task.status === "done" || task.status === "cancelled";
  const area = task.workspace_id ? ctx.area.get(task.workspace_id) : undefined;
  const projectName = task.project_id ? ctx.projectName.get(task.project_id) : undefined;
  const effort = [task.actual_minutes > 0 ? `${task.actual_minutes} min spent` : "", task.estimate_minutes ? `est. ${task.estimate_minutes} min` : ""].filter(Boolean).join(" / ");
  return (
    <li>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3 px-4 py-4 md:px-5" style={depth ? { paddingLeft: 16 + depth * 28 } : undefined}>
        {!done ? (
          <ActionButton
            className="btn h-8 min-h-8 w-8 shrink-0 rounded-full border-white/25 p-0 text-sm text-transparent hover:text-text pointer-coarse:h-11 pointer-coarse:min-h-11 pointer-coarse:w-11 pointer-coarse:text-dim"
            label={`Complete ${task.title}`}
            action={() => completeTaskAction(task.id)}
          >
            ✓
          </ActionButton>
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(95,211,154,0.16)] text-sm text-focus pointer-coarse:h-11 pointer-coarse:w-11" aria-hidden>
            ✓
          </span>
        )}
        {/* basis-56 keeps the title readable: on phones the buttons wrap below it. */}
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5 pt-0.5 pointer-coarse:pt-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-[16px] leading-snug break-words ${done ? "text-muted line-through decoration-white/30" : "font-medium"}`}>{task.title}</span>
            {task.priority <= 2 && !done && <span className={`badge ${task.priority === 1 ? "badge-danger" : "badge-warn"}`}>P{task.priority}</span>}
            {task.status === "in_progress" && <span className="badge badge-flex">in progress</span>}
            {task.status === "blocked" && <span className="badge badge-warn" title={task.blocker ?? ""}>blocked</span>}
            {task.status === "cancelled" && <span className="badge">cancelled</span>}
          </div>
          {(task.due_at || area || projectName || effort || task.recurrence || task.source !== "user") && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted">
              <DueBadge t={task} zone={ctx.zone} />
              {area && (
                <span className="flex items-center gap-1.5">
                  <span className="dot h-[7px] w-[7px]" style={{ background: area.color ?? "#8b8e95" }} aria-hidden />
                  {area.name}
                </span>
              )}
              {projectName && <span>{area ? "· " : ""}{projectName}</span>}
              {effort && <span className="num text-dim">{effort}</span>}
              {task.recurrence && <span className="badge">repeats {task.recurrence.freq}</span>}
              {task.source !== "user" && <span className="badge" title="Where this came from">{task.source}</span>}
            </div>
          )}
          {task.blocker && <span className="text-[13px] text-warn">Blocked: {task.blocker}</span>}
        </div>
        <div className="ml-11 flex flex-wrap gap-1.5 pointer-coarse:ml-14 sm:ml-0 sm:pointer-coarse:ml-0">
          {done ? (
            <ActionButton className="btn btn-sm" label={`Reopen ${task.title}`} action={() => updateTaskAction(task.id, { status: "todo" })}>Reopen</ActionButton>
          ) : (
            <ActionButton action={() => startFocusAction({ task_id: task.id, planned_minutes: task.estimate_minutes })}>Focus</ActionButton>
          )}
          {!done && depth === 0 && <button type="button" className="btn btn-sm" onClick={() => setAddingSub((v) => !v)} aria-expanded={addingSub}>+ Sub</button>}
          <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>{editing ? "Close" : "Edit"}</button>
          <ActionButton className="btn btn-ghost btn-sm text-muted" confirm={`Delete “${task.title}”? This can't be undone.`} action={() => deleteItemAction("tasks", task.id)}>Delete</ActionButton>
        </div>
      </div>
      {(editing || addingSub) && (
        <div className="border-t border-border bg-black/20 px-4 py-5 md:px-5">
          {editing && <TaskForm zone={ctx.zone} {...ctx.opts} task={task} onDone={() => setEditing(false)} />}
          {addingSub && <TaskForm zone={ctx.zone} {...ctx.opts} parentId={task.id} defaults={{ project_id: task.project_id ?? undefined, workspace_id: task.workspace_id ?? undefined }} onDone={() => setAddingSub(false)} />}
        </div>
      )}
      {children_.length > 0 && (
        <ul aria-label={`Subtasks of ${task.title}`} className="divide-y divide-white/[0.05] border-t border-white/[0.05]">
          {children_.map((c) => <TaskRow key={c.id} task={c} children_={[]} ctx={ctx} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

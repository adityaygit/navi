import Link from "next/link";
import { requireCtx } from "@/server/context";
import type { Project, Task, Workspace, Goal } from "@/lib/types";
import { TaskList } from "./task-list";
import { TaskForm } from "./task-form";

export const metadata = { title: "Tasks · Navi" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ show?: string; project?: string; workspace?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const show = sp.show === "done" ? "done" : "open";
  let q = ctx.db.from("tasks").select("*");
  q = show === "done" ? q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false }).limit(100) : q.in("status", ["todo", "in_progress", "blocked"]).order("priority").order("due_at", { ascending: true, nullsFirst: false });
  if (sp.project) q = q.eq("project_id", sp.project);
  if (sp.workspace) q = q.eq("workspace_id", sp.workspace);
  const [tasksRes, projectsRes, workspacesRes, goalsRes] = await Promise.all([
    q,
    ctx.db.from("projects").select("id,name,workspace_id").in("status", ["active", "paused"]).order("name"),
    ctx.db.from("workspaces").select("id,name,color").eq("status", "active").order("sort_order"),
    ctx.db.from("goals").select("id,title").eq("status", "active").order("title"),
  ]);
  const tasks = (tasksRes.data ?? []) as Task[];
  const projects = (projectsRes.data ?? []) as Pick<Project, "id" | "name" | "workspace_id">[];
  const workspaces = (workspacesRes.data ?? []) as Pick<Workspace, "id" | "name" | "color">[];
  const goals = (goalsRes.data ?? []) as Pick<Goal, "id" | "title">[];
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ show, project: sp.project, workspace: sp.workspace, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${p}`;
  };

  const nowIso = new Date().toISOString();
  const overdue = show === "open" ? tasks.filter((t) => t.due_at && t.due_at < nowIso).length : 0;
  const filtered = Boolean(sp.project || sp.workspace);

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-8">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-4">
        <div className="mr-auto flex flex-col gap-1.5">
          <h1 className="h1">Tasks</h1>
          <p className="text-[17px] text-muted">
            {show === "open" ? `${tasks.length} open` : `${tasks.length} finished`}
            {overdue > 0 && <span className="text-clash"> · {overdue} overdue</span>}
            {filtered && " · filtered"}
          </p>
        </div>
        <div className="surf flex rounded-full p-1" role="group" aria-label="Show">
          <Link className={`btn btn-sm border-transparent ${show === "open" ? "btn-primary" : "bg-transparent"}`} href={link({ show: "open" })} aria-current={show === "open" ? "page" : undefined}>Open</Link>
          <Link className={`btn btn-sm border-transparent ${show === "done" ? "btn-primary" : "bg-transparent"}`} href={link({ show: "done" })} aria-current={show === "done" ? "page" : undefined}>Done</Link>
        </div>
      </header>
      <div className="flex flex-col gap-4">
        <form className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:flex sm:flex-wrap sm:items-center" action="/tasks">
          <input type="hidden" name="show" value={show} />
          <label className="sr-only" htmlFor="f-ws">Area</label>
          <select id="f-ws" name="workspace" defaultValue={sp.workspace ?? ""} className="input min-w-0 rounded-full sm:w-auto sm:min-w-40">
            <option value="">All areas</option>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="f-pr">Project</label>
          <select id="f-pr" name="project" defaultValue={sp.project ?? ""} className="input min-w-0 rounded-full sm:w-auto sm:min-w-40">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn">Filter</button>
          {filtered && <Link href={link({ project: undefined, workspace: undefined, show })} className="btn btn-ghost col-span-3 justify-self-start text-muted sm:col-span-1">Clear</Link>}
        </form>
        {show === "open" && <TaskForm zone={ctx.timezone} projects={projects} workspaces={workspaces} goals={goals} defaults={{ project_id: sp.project, workspace_id: sp.workspace }} />}
      </div>
      {tasks.length === 0 ? (
        <p className="notice">{show === "open" ? "No open tasks. Add one above, capture a brain dump, or tell Navi." : "Nothing completed yet."}</p>
      ) : (
        <TaskList tasks={tasks} zone={ctx.timezone} projects={projects} workspaces={workspaces} goals={goals} />
      )}
    </div>
  );
}

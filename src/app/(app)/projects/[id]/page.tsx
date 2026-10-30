import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import type { Memory, Milestone, Project, Task } from "@/lib/types";
import { TaskList } from "../../tasks/task-list";
import { TaskForm } from "../../tasks/task-form";
import { ProjectEditor } from "./editor";
import { CreateItem } from "../create-item";
import { ActionButton } from "@/components/action-button";
import { updateItemAction } from "../../actions";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const { data: project } = await ctx.db.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();
  const p = project as Project;
  const [tasksRes, msRes, memRes, wsRes, goalsRes, projRes] = await Promise.all([
    ctx.db.from("tasks").select("*").eq("project_id", id).order("status").order("priority"),
    ctx.db.from("milestones").select("*").eq("project_id", id).order("due_date", { nullsFirst: false }),
    ctx.db.from("memories").select("*").eq("project_id", id).eq("status", "active").order("updated_at", { ascending: false }),
    ctx.db.from("workspaces").select("id,name").eq("status", "active"),
    ctx.db.from("goals").select("id,title").eq("status", "active"),
    ctx.db.from("projects").select("id,name").eq("status", "active"),
  ]);
  const tasks = (tasksRes.data ?? []) as Task[];
  const open = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const done = tasks.filter((t) => t.status === "done");
  const ms = (msRes.data ?? []) as Milestone[];
  const memories = (memRes.data ?? []) as Memory[];
  const ws = (wsRes.data ?? []).map((w) => ({ id: w.id, name: w.name }));
  const goals = (goalsRes.data ?? []).map((g) => ({ id: g.id, name: g.title, title: g.title }));
  const projects = (projRes.data ?? []).map((x) => ({ id: x.id, name: x.name }));

  return (
    <div className="flex flex-col gap-4">
      <Link href="/projects" className="muted text-sm hover:underline">← Projects & Goals</Link>
      <ProjectEditor project={p} workspaces={ws} goals={goals} />
      <section className="card" aria-labelledby="ms-h">
        <div className="flex items-center gap-2"><h2 id="ms-h" className="h2">Milestones</h2><CreateItem kind="milestones" workspaces={ws} goals={goals} parent={{ project_id: id }} label="+ Milestone" /></div>
        {ms.length === 0 ? <p className="muted mt-2 text-sm">No milestones.</p> : (
          <ul className="mt-2 flex flex-col gap-1">
            {ms.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className={m.done_at ? "muted line-through" : ""}>{m.title}</span>
                {m.due_date && <span className="muted text-xs">due {m.due_date}</span>}
                <span className="ml-auto">
                  <ActionButton action={() => updateItemAction("milestones", m.id, { done_at: m.done_at ? null : new Date().toISOString() })}>{m.done_at ? "Reopen" : "Done"}</ActionButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="pt-h">
        <h2 id="pt-h" className="h2">Tasks <span className="muted text-sm">({done.length}/{tasks.filter((t) => t.status !== "cancelled").length} done)</span></h2>
        <TaskForm zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} defaults={{ project_id: id, workspace_id: p.workspace_id ?? undefined }} />
        {open.length > 0 ? <TaskList tasks={open} zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} /> : <p className="muted text-sm">No open tasks.</p>}
        {done.length > 0 && (
          <details className="card"><summary className="cursor-pointer text-sm">Completed ({done.length})</summary><div className="mt-2"><TaskList tasks={done} zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} /></div></details>
        )}
      </section>
      <section className="card" aria-labelledby="pm-h">
        <h2 id="pm-h" className="h2">Project context Navi remembers</h2>
        {memories.length === 0 ? <p className="muted mt-2 text-sm">Nothing yet. Decisions and context you share with Navi about this project will appear here.</p> : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">{memories.map((m) => <li key={m.id}>{m.content} <span className="muted text-xs">({m.origin})</span></li>)}</ul>
        )}
        <Link href="/memory" className="btn btn-ghost btn-sm mt-2">Manage memory</Link>
      </section>
    </div>
  );
}

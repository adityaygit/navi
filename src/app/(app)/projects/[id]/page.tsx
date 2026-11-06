import Link from "next/link";
import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import type { Memory, Milestone, Project, Task } from "@/lib/types";
import { TaskList } from "../../tasks/task-list";
import { TaskForm } from "../../tasks/task-form";
import { ProjectEditor } from "./editor";
import { CreateItem } from "../create-item";
import { ActionButton } from "@/components/action-button";
import { updateItemAction } from "../../actions";
import { ProjectsProgress } from "@/components/projects-progress";

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
    ctx.db.from("workspaces").select("id,name,color"),
    ctx.db.from("goals").select("id,title,status"),
    ctx.db.from("projects").select("id,name").eq("status", "active"),
  ]);
  const tasks = (tasksRes.data ?? []) as Task[];
  const open = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const done = tasks.filter((t) => t.status === "done");
  const ms = (msRes.data ?? []) as Milestone[];
  const memories = (memRes.data ?? []) as Memory[];
  const allWs = (wsRes.data ?? []) as { id: string; name: string; color: string | null; status?: string }[];
  const ws = allWs.map((w) => ({ id: w.id, name: w.name, color: w.color }));
  const area = p.workspace_id ? (allWs.find((w) => w.id === p.workspace_id) ?? null) : null;
  const allGoals = (goalsRes.data ?? []) as { id: string; title: string; status: string }[];
  const goals = allGoals.filter((g) => g.status === "active" || g.id === p.goal_id).map((g) => ({ id: g.id, name: g.title, title: g.title }));
  const goalTitle = p.goal_id ? (allGoals.find((g) => g.id === p.goal_id)?.title ?? null) : null;
  const counted = tasks.filter((t) => t.status !== "cancelled").length;
  const projects = (projRes.data ?? []).map((x) => ({ id: x.id, name: x.name }));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <Link href="/projects" className="self-start text-sm text-muted hover:underline pointer-coarse:py-2.5">← Projects & Goals</Link>
        <ProjectEditor
          project={p}
          workspaces={ws}
          goals={goals}
          area={area ? { name: area.name, color: area.color } : null}
          goalTitle={goalTitle}
          progressNode={<ProjectsProgress done={done.length} total={counted} label={p.name} />}
        />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="pt-h">
          <h2 id="pt-h" className="h2">Tasks <span className="num text-base font-normal text-dim">({done.length}/{counted} done)</span></h2>
          <TaskForm zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} defaults={{ project_id: id, workspace_id: p.workspace_id ?? undefined }} />
          {open.length > 0 ? <TaskList tasks={open} zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} /> : <p className="notice">No open tasks.</p>}
          {done.length > 0 && (
            <details className="card md:p-6"><summary className="cursor-pointer text-[15px] font-medium">Completed ({done.length})</summary><div className="mt-4"><TaskList tasks={done} zone={ctx.timezone} projects={projects} workspaces={ws} goals={goals} /></div></details>
          )}
        </section>
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-labelledby="ms-h">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="ms-h" className="h2 mr-auto">Milestones</h2>
              <CreateItem kind="milestones" workspaces={ws} goals={goals} parent={{ project_id: id }} label="+ Milestone" />
            </div>
            {ms.length === 0 ? <p className="text-[15px] text-dim">No milestones.</p> : (
              <ul className="surf flex flex-col divide-y divide-white/[0.07]">
                {ms.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${m.done_at ? "bg-[rgba(95,211,154,0.16)] text-focus" : "border-[1.5px] border-white/30"}`} aria-hidden>{m.done_at ? "✓" : ""}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`text-[15px] break-words ${m.done_at ? "text-muted line-through decoration-white/30" : ""}`}>{m.title}</span>
                      {m.due_date && <span className="num text-[13px] text-dim">due {DateTime.fromISO(m.due_date).toFormat("ccc LLL d")}</span>}
                    </span>
                    <ActionButton className={m.done_at ? "btn btn-ghost btn-sm text-muted" : "btn btn-sm"} action={updateItemAction} args={["milestones", m.id, { done_at: m.done_at ? null : new Date().toISOString() }]}>{m.done_at ? "Reopen" : "Done"}</ActionButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="pm-h">
            <h2 id="pm-h" className="h2">Project context Navi remembers</h2>
            {memories.length === 0 ? <p className="text-[15px] text-dim">Nothing yet. Decisions and context you share with Navi about this project will appear here.</p> : (
              <ul className="surf flex flex-col divide-y divide-white/[0.07] text-[15px]">
                {memories.map((m) => <li key={m.id} className="flex flex-col gap-0.5 px-4 py-3"><span>{m.content}</span><span className="text-[13px] text-dim">{m.origin === "stated" ? "You told Navi" : m.origin}</span></li>)}
              </ul>
            )}
            <Link href="/memory" className="btn btn-ghost btn-sm self-start px-0 text-muted">Manage memory</Link>
          </section>
        </div>
      </div>
    </div>
  );
}

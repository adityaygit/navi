import Link from "next/link";
import { requireCtx } from "@/server/context";
import type { Goal, Milestone, Project, Task, Workspace } from "@/lib/types";
import { CreateItem } from "./create-item";
import { ActionButton } from "@/components/action-button";
import { updateItemAction } from "../actions";

export const metadata = { title: "Projects & Goals · Navi" };

function progress(tasks: Pick<Task, "status">[]) {
  const relevant = tasks.filter((t) => t.status !== "cancelled");
  const done = relevant.filter((t) => t.status === "done").length;
  return { done, total: relevant.length };
}

function Bar({ done, total, label }: { done: number; total: number; label: string }) {
  if (total === 0) return <span className="muted text-xs">No tasks linked yet</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${done} of ${total} tasks done`}>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <span className="muted text-xs">{done}/{total} tasks</span>
    </div>
  );
}

export default async function ProjectsPage() {
  const ctx = await requireCtx();
  const [wsRes, goalsRes, projRes, tasksRes, msRes] = await Promise.all([
    ctx.db.from("workspaces").select("*").order("sort_order").order("created_at"),
    ctx.db.from("goals").select("*").order("created_at"),
    ctx.db.from("projects").select("*").order("created_at"),
    ctx.db.from("tasks").select("id,status,project_id,goal_id,workspace_id"),
    ctx.db.from("milestones").select("*").order("due_date", { nullsFirst: false }),
  ]);
  const workspaces = (wsRes.data ?? []) as Workspace[];
  const goals = (goalsRes.data ?? []) as Goal[];
  const projects = (projRes.data ?? []) as Project[];
  const tasks = (tasksRes.data ?? []) as Task[];
  const milestones = (msRes.data ?? []) as Milestone[];
  const activeWs = workspaces.filter((w) => w.status === "active");
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]));
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));
  const opts = { workspaces: activeWs.map((w) => ({ id: w.id, name: w.name })), goals: goals.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.title })) };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="h1">Projects & Goals</h1>

      <section aria-labelledby="ws-h" className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><h2 id="ws-h" className="h2">Areas</h2><CreateItem kind="workspaces" {...opts} /></div>
        {activeWs.length === 0 ? <p className="muted text-sm">No areas yet. Navi creates them during setup, or add one.</p> : (
          <ul className="flex flex-wrap gap-2">
            {activeWs.map((w) => {
              const p = progress(tasks.filter((t) => t.workspace_id === w.id));
              return (
                <li key={w.id} className="card flex min-w-48 flex-col gap-1 py-3">
                  <Link href={`/tasks?workspace=${w.id}`} className="font-medium hover:underline">{w.name}</Link>
                  {w.description && <span className="muted text-xs">{w.description}</span>}
                  <span className="muted text-xs">{projects.filter((x) => x.workspace_id === w.id && x.status === "active").length} active projects · {p.total - p.done} open tasks</span>
                  <ActionButton className="btn btn-ghost btn-sm self-start" confirm={`Archive “${w.name}”? Its items stay but the area is hidden.`} action={() => updateItemAction("workspaces", w.id, { status: "archived" })}>Archive</ActionButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="goals-h" className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><h2 id="goals-h" className="h2">Goals</h2><CreateItem kind="goals" {...opts} /></div>
        {goals.length === 0 ? <p className="muted text-sm">No goals yet.</p> : (
          <ul className="flex flex-col gap-2">
            {goals.map((g) => {
              const linkedProjects = projects.filter((p) => p.goal_id === g.id);
              const p = progress(tasks.filter((t) => t.goal_id === g.id || linkedProjects.some((lp) => lp.id === t.project_id)));
              const ms = milestones.filter((m) => m.goal_id === g.id);
              return (
                <li key={g.id} className="card flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{g.title}</span>
                    {g.status !== "active" && <span className="badge">{g.status}</span>}
                    {g.workspace_id && <span className="badge">{wsName.get(g.workspace_id)}</span>}
                    {g.target_date && <span className="muted text-xs">by {g.target_date}</span>}
                  </div>
                  {g.why && <p className="muted text-sm">Why: {g.why}</p>}
                  {g.measure && <p className="muted text-sm">Measured by: {g.measure}</p>}
                  <Bar {...p} label={g.title} />
                  {linkedProjects.length > 0 && <p className="muted text-xs">Projects: {linkedProjects.map((lp) => lp.name).join(", ")}</p>}
                  {ms.length > 0 && <p className="muted text-xs">Milestones: {ms.map((m) => `${m.done_at ? "✓ " : ""}${m.title}`).join(" · ")}</p>}
                  <div className="flex flex-wrap gap-1">
                    {g.status === "active" ? (
                      <>
                        <ActionButton action={() => updateItemAction("goals", g.id, { status: "achieved" })}>Mark achieved</ActionButton>
                        <ActionButton action={() => updateItemAction("goals", g.id, { status: "paused" })}>Pause</ActionButton>
                        <ActionButton className="btn btn-ghost btn-sm" confirm="Drop this goal?" action={() => updateItemAction("goals", g.id, { status: "dropped" })}>Drop</ActionButton>
                      </>
                    ) : (
                      <ActionButton action={() => updateItemAction("goals", g.id, { status: "active" })}>Reactivate</ActionButton>
                    )}
                    <CreateItem kind="milestones" {...opts} parent={{ goal_id: g.id }} label="+ Milestone" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="proj-h" className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><h2 id="proj-h" className="h2">Projects</h2><CreateItem kind="projects" {...opts} /></div>
        {projects.length === 0 ? <p className="muted text-sm">No projects yet.</p> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {projects.map((pr) => {
              const pt = tasks.filter((t) => t.project_id === pr.id);
              const blocked = pt.filter((t) => t.status === "blocked").length;
              return (
                <li key={pr.id} className="card flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${pr.id}`} className="font-medium hover:underline">{pr.name}</Link>
                    {pr.status !== "active" && <span className="badge">{pr.status}</span>}
                    {blocked > 0 && <span className="badge badge-warn">{blocked} blocked</span>}
                  </div>
                  {pr.objective && <p className="muted text-sm">{pr.objective}</p>}
                  <div className="muted flex flex-wrap gap-2 text-xs">
                    {pr.workspace_id && <span>{wsName.get(pr.workspace_id)}</span>}
                    {pr.goal_id && <span>→ {goalTitle.get(pr.goal_id)}</span>}
                    {pr.due_date && <span>due {pr.due_date}</span>}
                  </div>
                  <Bar {...progress(pt)} label={pr.name} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

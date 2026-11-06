import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { Goal, Milestone, Project, Task, Workspace } from "@/lib/types";
import { CreateItem } from "./create-item";
import { ActionButton } from "@/components/action-button";
import { ProjectsProgress } from "@/components/projects-progress";
import { updateItemAction } from "../actions";

export const metadata = { title: "Projects & Goals · Navi" };

type TaskLite = Pick<Task, "id" | "title" | "status" | "project_id" | "goal_id" | "workspace_id" | "due_at" | "priority">;

function progress(tasks: Pick<Task, "status">[]) {
  const relevant = tasks.filter((t) => t.status !== "cancelled");
  const done = relevant.filter((t) => t.status === "done").length;
  return { done, total: relevant.length };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function ProjectsPage() {
  const ctx = await requireCtx();
  const [wsRes, goalsRes, projRes, tasksRes, msRes] = await Promise.all([
    ctx.db.from("workspaces").select("*").order("sort_order").order("created_at"),
    ctx.db.from("goals").select("*").order("created_at"),
    ctx.db.from("projects").select("*").order("created_at"),
    ctx.db.from("tasks").select("id,title,status,project_id,goal_id,workspace_id,due_at,priority"),
    ctx.db.from("milestones").select("*").order("due_date", { nullsFirst: false }),
  ]);
  const workspaces = (wsRes.data ?? []) as Workspace[];
  const goals = (goalsRes.data ?? []) as Goal[];
  const projects = (projRes.data ?? []) as Project[];
  const tasks = (tasksRes.data ?? []) as TaskLite[];
  const milestones = (msRes.data ?? []) as Milestone[];
  const activeWs = workspaces.filter((w) => w.status === "active");
  const activeIds = new Set(activeWs.map((w) => w.id));
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));
  const opts = { workspaces: activeWs.map((w) => ({ id: w.id, name: w.name })), goals: goals.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.title })) };
  const zone = ctx.timezone;
  const shortDate = (d: string) => DateTime.fromISO(d, { zone }).toFormat("ccc LLL d");
  const todayIso = DateTime.now().setZone(zone).toISODate()!;
  const dayWord = (iso: string) => {
    const d = DateTime.fromISO(iso).setZone(zone);
    const diff = Math.round(d.startOf("day").diff(DateTime.fromISO(todayIso, { zone }), "days").days);
    return diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff > 1 && diff < 7 ? d.toFormat("ccc") : d.toFormat("LLL d");
  };
  const isOpen = (t: TaskLite) => !["done", "cancelled"].includes(t.status);
  // The next thing to do on a project: most urgent open task (due first, then priority).
  const nextTask = (list: TaskLite[]) =>
    list.filter(isOpen).sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.priority - b.priority)[0];

  const inArea = (id: string | null) => (id && activeIds.has(id) ? id : null);
  const groups = [
    ...activeWs.map((w) => ({ ws: w as Workspace | null, key: w.id })),
    { ws: null, key: "none" },
  ].map(({ ws, key }) => ({
    ws,
    key,
    goals: goals.filter((g) => inArea(g.workspace_id) === (ws?.id ?? null)),
    projects: projects.filter((p) => inArea(p.workspace_id) === (ws?.id ?? null)),
  }));

  const goalCard = (g: Goal) => {
    const linkedProjects = projects.filter((p) => p.goal_id === g.id);
    const p = progress(tasks.filter((t) => t.goal_id === g.id || linkedProjects.some((lp) => lp.id === t.project_id)));
    const ms = milestones.filter((m) => m.goal_id === g.id);
    const msDone = ms.filter((m) => m.done_at).length;
    return (
      <li key={g.id} className={`card flex flex-col gap-4 md:p-6 ${g.status === "active" ? "" : "opacity-75"}`}>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-medium uppercase tracking-[0.07em]">Goal</span>
            {g.status !== "active" && <span className={`badge ${g.status === "achieved" ? "badge-ok" : ""}`}>{g.status}</span>}
            {g.target_date && <span className="num ml-auto text-dim">by {shortDate(g.target_date)}</span>}
          </div>
          <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.01em] break-words">{g.title}</h3>
          {g.why && <p className="text-[15px] text-muted">Why: {g.why}</p>}
          {g.measure && <p className="text-[15px] text-muted">Measured by: {g.measure}</p>}
        </div>
        <ProjectsProgress {...p} label={g.title} />
        {(linkedProjects.length > 0 || ms.length > 0) && (
          <div className="flex flex-col gap-1.5 text-[13px] text-muted">
            {linkedProjects.length > 0 && <p>Projects: {linkedProjects.map((lp) => lp.name).join(", ")}</p>}
            {ms.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex gap-1" role="img" aria-label={`${msDone} of ${ms.length} milestones done`}>
                  {ms.map((m) => <span key={m.id} className={`h-2.5 w-2.5 rounded-full ${m.done_at ? "bg-focus" : "border-[1.5px] border-white/40"}`} />)}
                </span>
                <span>Milestones: {ms.map((m) => `${m.done_at ? "✓ " : ""}${m.title}`).join(" · ")}</span>
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {g.status === "active" ? (
            <>
              <ActionButton action={updateItemAction} args={["goals", g.id, { status: "achieved" }]}>Mark achieved</ActionButton>
              <ActionButton action={updateItemAction} args={["goals", g.id, { status: "paused" }]}>Pause</ActionButton>
              <ActionButton className="btn btn-ghost btn-sm text-muted" confirm="Drop this goal?" action={updateItemAction} args={["goals", g.id, { status: "dropped" }]}>Drop</ActionButton>
            </>
          ) : (
            <ActionButton action={updateItemAction} args={["goals", g.id, { status: "active" }]}>Reactivate</ActionButton>
          )}
          <CreateItem kind="milestones" {...opts} parent={{ goal_id: g.id }} label="+ Milestone" />
        </div>
      </li>
    );
  };

  const projectCard = (pr: Project) => {
    const pt = tasks.filter((t) => t.project_id === pr.id);
    const blocked = pt.filter((t) => t.status === "blocked").length;
    const next = nextTask(pt);
    const nowIso = new Date().toISOString();
    const late = pr.due_date && pr.status === "active" && pr.due_date < DateTime.now().setZone(zone).toISODate()!;
    return (
      <li key={pr.id} className={`card flex flex-col gap-4 md:p-6 ${pr.status === "active" ? "" : "opacity-75"}`}>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-medium uppercase tracking-[0.07em]">Project</span>
            {pr.status !== "active" && <span className={`badge ${pr.status === "done" ? "badge-ok" : ""}`}>{pr.status}</span>}
            {blocked > 0 && <span className="badge badge-warn">{blocked} blocked</span>}
            {pr.due_date && <span className={`num ml-auto ${late ? "text-clash" : "text-dim"}`}>{late ? "was due" : "due"} {shortDate(pr.due_date)}</span>}
          </div>
          <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.01em] break-words">
            <Link href={`/projects/${pr.id}`} className="hover:underline">{pr.name}</Link>
          </h3>
          {pr.objective && <p className="text-[15px] text-muted">{pr.objective}</p>}
          {pr.goal_id && <p className="text-[13px] text-dim">→ {goalTitle.get(pr.goal_id)}</p>}
        </div>
        <ProjectsProgress {...progress(pt)} label={pr.name} />
        {next && (
          <p className="text-[14px] text-muted">
            Next: <span className="text-text">{next.title}</span>
            {next.due_at && <span className={next.due_at < nowIso ? "text-clash" : ""}> · {next.due_at < nowIso ? "overdue" : `due ${dayWord(next.due_at)}`}</span>}
          </p>
        )}
      </li>
    );
  };

  const total = goals.length + projects.length;

  return (
    <div className="flex flex-col gap-10 md:gap-12">
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="h1">Projects & Goals</h1>
          <p className="text-[17px] text-muted">
            {plural(activeWs.length, "area")} · {plural(goals.length, "goal")} · {plural(projects.length, "project")}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <CreateItem kind="workspaces" {...opts} />
          <CreateItem kind="goals" {...opts} />
          <CreateItem kind="projects" {...opts} />
        </div>
      </header>

      {activeWs.length === 0 && total === 0 && (
        <p className="notice">No areas, goals or projects yet. Navi sets them up with you during setup, or add them above.</p>
      )}

      {groups
        .filter((g) => g.ws || g.goals.length || g.projects.length)
        .map((g) => {
          const w = g.ws;
          const areaTasks = w ? tasks.filter((t) => t.workspace_id === w.id) : [];
          const openCount = areaTasks.filter(isOpen).length;
          const activeProjects = g.projects.filter((p) => p.status === "active").length;
          return (
            <section key={g.key} aria-labelledby={`area-${g.key}`} className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3">
                {w && <span className="dot h-2.5 w-2.5" style={{ background: w.color ?? "#8b8e95" }} aria-hidden />}
                <h2 id={`area-${g.key}`} className="h2">
                  {w ? <Link href={`/tasks?workspace=${w.id}`} className="hover:underline">{w.name}</Link> : "Not in an area"}
                </h2>
                {w && (
                  <span className="num order-last w-full pl-[22px] text-sm text-dim sm:order-none sm:w-auto sm:pl-0">
                    {plural(activeProjects, "active project")} · {plural(openCount, "open task")}
                  </span>
                )}
                {w && (
                  <span className="ml-auto">
                    <ActionButton className="btn btn-ghost btn-sm text-muted" confirm={`Archive “${w.name}”? Its items stay but the area is hidden.`} action={updateItemAction} args={["workspaces", w.id, { status: "archived" }]}>Archive</ActionButton>
                  </span>
                )}
              </div>
              {w?.description && <p className="-mt-2 text-[15px] text-muted">{w.description}</p>}
              {g.goals.length + g.projects.length === 0 ? (
                <p className="text-[15px] text-dim">No goals or projects here yet.</p>
              ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                  {g.goals.map(goalCard)}
                  {g.projects.map(projectCard)}
                </ul>
              )}
            </section>
          );
        })}
    </div>
  );
}

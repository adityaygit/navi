"use client";
import { useState, useTransition } from "react";
import type { Project } from "@/lib/types";
import { updateItemAction } from "../../actions";
import { announceChange } from "@/lib/offline-queue";

export function ProjectEditor({ project, workspaces, goals }: { project: Project; workspaces: { id: string; name: string }[]; goals: { id: string; name: string }[] }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({
    name: project.name,
    objective: project.objective ?? "",
    notes: project.notes ?? "",
    due_date: project.due_date ?? "",
    status: project.status,
    workspace_id: project.workspace_id ?? "",
    goal_id: project.goal_id ?? "",
    links: (project.links ?? []).map((l) => l.url).join("\n"),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  if (!editing) {
    return (
      <header className="card flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="h1">{project.name}</h1>
          {project.status !== "active" && <span className="badge">{project.status}</span>}
          <button type="button" className="btn btn-sm ml-auto" onClick={() => setEditing(true)}>Edit</button>
        </div>
        {project.objective && <p>{project.objective}</p>}
        {project.due_date && <p className="muted text-sm">Due {project.due_date}</p>}
        {project.notes && <p className="whitespace-pre-wrap text-sm">{project.notes}</p>}
        {project.links?.length > 0 && (
          <ul className="text-sm">{project.links.map((l, i) => <li key={i}><a className="text-accent underline" href={l.url} target="_blank" rel="noreferrer noopener">{l.label ?? l.url}</a></li>)}</ul>
        )}
      </header>
    );
  }
  return (
    <form
      className="card flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const links = v.links.split("\n").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s)).map((url) => ({ url }));
        start(async () => {
          const r = await updateItemAction("projects", project.id, {
            name: v.name, objective: v.objective || null, notes: v.notes || null, due_date: v.due_date || null,
            status: v.status, workspace_id: v.workspace_id || null, goal_id: v.goal_id || null, links,
          });
          if (r.ok) { setEditing(false); announceChange(); } else setMsg(r.error);
        });
      }}
    >
      <div><label className="label" htmlFor="pe-n">Name</label><input id="pe-n" required className="input" value={v.name} onChange={set("name")} /></div>
      <div><label className="label" htmlFor="pe-o">Objective</label><input id="pe-o" className="input" value={v.objective} onChange={set("objective")} /></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <div><label className="label" htmlFor="pe-d">Due</label><input id="pe-d" type="date" className="input" value={v.due_date} onChange={set("due_date")} /></div>
        <div><label className="label" htmlFor="pe-s">Status</label><select id="pe-s" className="input" value={v.status} onChange={set("status")}><option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option><option value="archived">Archived</option></select></div>
        <div><label className="label" htmlFor="pe-w">Area</label><select id="pe-w" className="input" value={v.workspace_id} onChange={set("workspace_id")}><option value="">None</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <div><label className="label" htmlFor="pe-g">Goal</label><select id="pe-g" className="input" value={v.goal_id} onChange={set("goal_id")}><option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      </div>
      <div><label className="label" htmlFor="pe-no">Notes</label><textarea id="pe-no" className="input min-h-24" value={v.notes} onChange={set("notes")} /></div>
      <div><label className="label" htmlFor="pe-l">Links (one URL per line)</label><textarea id="pe-l" className="input min-h-16" value={v.links} onChange={set("links")} /></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button></div>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </form>
  );
}

"use client";
import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import type { Project } from "@/lib/types";
import { updateItemAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";

export function ProjectEditor({
  project,
  workspaces,
  goals,
  area,
  goalTitle,
  progressNode,
}: {
  project: Project;
  workspaces: { id: string; name: string }[];
  goals: { id: string; name: string }[];
  area?: { name: string; color: string | null } | null;
  goalTitle?: string | null;
  progressNode?: React.ReactNode;
}) {
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
    const late = project.due_date && project.status === "active" && project.due_date < new Date().toISOString().slice(0, 10);
    return (
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {area && (
            <>
              <span className="dot" style={{ background: area.color ?? "#8b8e95" }} aria-hidden />
              <span>{area.name}</span>
            </>
          )}
          {goalTitle && <span>{area ? "· " : ""}Goal: {goalTitle}</span>}
          {project.status !== "active" && <span className="badge">{project.status}</span>}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="h1 mr-auto min-w-0 break-words">{project.name}</h1>
          <button type="button" className="btn btn-sm mt-1.5" onClick={() => setEditing(true)}>Edit</button>
        </div>
        {project.objective && <p className="max-w-[65ch] text-[18px] leading-relaxed text-[#d6d7da]">{project.objective}</p>}
        {(project.due_date || progressNode) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            {project.due_date && <p className={`num shrink-0 text-[15px] ${late ? "text-clash" : "text-muted"}`}>{late ? "Was due" : "Due"} {DateTime.fromISO(project.due_date).toFormat("ccc LLL d, yyyy")}</p>}
            {progressNode && <div className="min-w-0 flex-1 sm:max-w-md">{progressNode}</div>}
          </div>
        )}
        {(project.notes || project.links?.length > 0) && (
          <div className="well flex flex-col gap-3 px-4 py-3.5 md:px-5">
            {project.notes && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{project.notes}</p>}
            {project.links?.length > 0 && (
              <ul className="flex flex-col gap-1 text-[15px]">{project.links.map((l, i) => <li key={i} className="break-all"><a className="text-flex underline underline-offset-2" href={l.url} target="_blank" rel="noreferrer noopener">{l.label ?? l.url}</a></li>)}</ul>
            )}
          </div>
        )}
      </header>
    );
  }
  return (
    <form
      aria-label="Edit project"
      className="lg flex flex-col gap-4 p-5 md:p-7"
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

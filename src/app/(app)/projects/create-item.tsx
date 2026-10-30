"use client";
import { useState, useTransition } from "react";
import { createItemAction } from "../actions";
import { announceChange } from "@/lib/offline-queue";

type Kind = "workspaces" | "goals" | "projects" | "milestones";
const LABEL: Record<Kind, string> = { workspaces: "area", goals: "goal", projects: "project", milestones: "milestone" };

export function CreateItem({ kind, workspaces, goals, parent, label }: { kind: Kind; workspaces: { id: string; name: string }[]; goals: { id: string; name: string }[]; parent?: Record<string, string>; label?: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  if (!open) return <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>{label ?? `+ ${LABEL[kind]}`}</button>;
  const nameKey = kind === "workspaces" || kind === "projects" ? "name" : "title";
  const id = `${kind}-${parent ? Object.values(parent)[0] : "new"}`;
  return (
    <form
      className="card flex w-full flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const payload: Record<string, unknown> = { ...parent };
        for (const [k, val] of Object.entries(v)) if (val) payload[k] = val;
        start(async () => {
          const r = await createItemAction(kind, payload);
          if (r.ok) { setV({}); setOpen(false); announceChange(); } else setMsg(r.error);
        });
      }}
    >
      <div><label className="label" htmlFor={`${id}-n`}>New {LABEL[kind]}</label><input id={`${id}-n`} required className="input" value={v[nameKey] ?? ""} onChange={set(nameKey)} /></div>
      {kind === "goals" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div><label className="label" htmlFor={`${id}-w`}>Why it matters</label><input id={`${id}-w`} className="input" value={v.why ?? ""} onChange={set("why")} /></div>
          <div><label className="label" htmlFor={`${id}-m`}>How you'll measure it</label><input id={`${id}-m`} className="input" value={v.measure ?? ""} onChange={set("measure")} /></div>
          <div><label className="label" htmlFor={`${id}-t`}>Target date</label><input id={`${id}-t`} type="date" className="input" value={v.target_date ?? ""} onChange={set("target_date")} /></div>
        </div>
      )}
      {kind === "projects" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-3"><label className="label" htmlFor={`${id}-o`}>Objective</label><input id={`${id}-o`} className="input" value={v.objective ?? ""} onChange={set("objective")} /></div>
          <div><label className="label" htmlFor={`${id}-d`}>Due</label><input id={`${id}-d`} type="date" className="input" value={v.due_date ?? ""} onChange={set("due_date")} /></div>
          <div><label className="label" htmlFor={`${id}-g`}>Goal</label><select id={`${id}-g`} className="input" value={v.goal_id ?? ""} onChange={set("goal_id")}><option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        </div>
      )}
      {kind === "milestones" && (
        <div><label className="label" htmlFor={`${id}-md`}>Due</label><input id={`${id}-md`} type="date" className="input" value={v.due_date ?? ""} onChange={set("due_date")} /></div>
      )}
      {(kind === "goals" || kind === "projects") && workspaces.length > 0 && (
        <div><label className="label" htmlFor={`${id}-ws`}>Area</label><select id={`${id}-ws`} className="input" value={v.workspace_id ?? ""} onChange={set("workspace_id")}><option value="">None</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      )}
      {kind === "workspaces" && <div><label className="label" htmlFor={`${id}-de`}>Description</label><input id={`${id}-de`} className="input" value={v.description ?? ""} onChange={set("description")} /></div>}
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={pending}>Add</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </form>
  );
}

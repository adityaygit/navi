"use client";
import { useState, useTransition } from "react";
import type { Memory } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { addMemoryAction, confirmMemoryAction, correctMemoryAction, deleteMemoryAction, rejectMemoryAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";

const ORIGIN: Record<Memory["origin"], [string, string]> = {
  stated: ["You told Navi", "badge-ok"],
  inferred: ["Navi inferred", "badge-warn"],
  observed: ["Observed from your activity", "badge-accent"],
};

export function MemoryItem({ memory, projectName }: { memory: Memory; projectName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [label, cls] = ORIGIN[memory.origin];
  return (
    <li className={`card flex flex-col gap-2 ${memory.status !== "active" ? "opacity-60" : ""}`}>
      {editing ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await correctMemoryAction(memory.id, text); if (r.ok) { setEditing(false); announceChange(); } else setErr(r.error); }); }}>
          <label htmlFor={`mem-${memory.id}`} className="sr-only">Correct this memory</label>
          <textarea id={`mem-${memory.id}`} className="input min-h-16" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={pending}>Save correction</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </form>
      ) : (
        <p>{memory.content}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`badge ${cls}`}>{label}</span>
        {memory.origin !== "stated" && <span className="badge">{Math.round(memory.confidence * 100)}% confident</span>}
        {projectName && <span className="badge">{projectName}</span>}
        {memory.status !== "active" && <span className="badge">{memory.status}</span>}
        <span className="muted">Saved {new Date(memory.created_at).toLocaleDateString()}{memory.last_confirmed_at ? ` · confirmed ${new Date(memory.last_confirmed_at).toLocaleDateString()}` : ""}</span>
      </div>
      {memory.status === "active" && !editing && (
        <div className="flex flex-wrap gap-1">
          {memory.origin !== "stated" && <ActionButton action={() => confirmMemoryAction(memory.id)}>That's right</ActionButton>}
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Correct</button>
          {memory.origin !== "stated" && <ActionButton action={() => rejectMemoryAction(memory.id)}>That's wrong</ActionButton>}
          <ActionButton className="btn btn-danger btn-sm" confirm="Delete this memory permanently?" action={() => deleteMemoryAction(memory.id)}>Delete</ActionButton>
        </div>
      )}
      {memory.status !== "active" && <ActionButton className="btn btn-ghost btn-sm self-start" confirm="Delete permanently?" action={() => deleteMemoryAction(memory.id)}>Delete</ActionButton>}
    </li>
  );
}

export function AddMemory() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Memory["kind"]>("profile");
  const [content, setContent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn self-start" onClick={() => setOpen(true)}>+ Tell Navi something to remember</button>;
  return (
    <form className="card flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addMemoryAction({ kind, content, origin: "stated" }); if (r.ok) { setContent(""); setOpen(false); announceChange(); } else setErr(r.error); }); }}>
      <div><label htmlFor="am-kind" className="label">Kind</label>
        <select id="am-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Memory["kind"])}>
          <option value="profile">About me</option><option value="episodic">Something that happened</option><option value="behavioral">A pattern about me</option>
        </select>
      </div>
      <div><label htmlFor="am-content" className="label">What should Navi remember?</label><textarea id="am-content" required className="input min-h-16" value={content} onChange={(e) => setContent(e.target.value)} /></div>
      <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={pending}>Save</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </form>
  );
}

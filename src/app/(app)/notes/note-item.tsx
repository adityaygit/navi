"use client";
import { useState, useTransition } from "react";
import type { Note } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { createItemAction, deleteItemAction, updateItemAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";

function NoteFields({ id, title, body, setTitle, setBody }: { id: string; title: string; body: string; setTitle: (v: string) => void; setBody: (v: string) => void }) {
  return (
    <>
      <div><label className="label" htmlFor={`${id}-t`}>Title (optional)</label><input id={`${id}-t`} className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label className="label" htmlFor={`${id}-b`}>Note</label><textarea id={`${id}-b`} required className="input min-h-24" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} /></div>
    </>
  );
}

export function NoteItem({ note, meta }: { note: Note; meta: string }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.body);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = note.title || note.body.split("\n")[0].slice(0, 80);
  return (
    <li className="card flex flex-col gap-2" aria-label={`Note: ${label}`}>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErr(null);
            start(async () => {
              const r = await updateItemAction("notes", note.id, { title: title.trim() || null, body });
              if (r.ok) { setEditing(false); announceChange(); } else setErr(r.error);
            });
          }}
        >
          <NoteFields id={`note-${note.id}`} title={title} body={body} setTitle={setTitle} setBody={setBody} />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={pending}>Save note</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setTitle(note.title ?? ""); setBody(note.body); }}>Cancel</button>
          </div>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        </form>
      ) : (
        <>
          {note.title && <h2 className="font-medium">{note.title}</h2>}
          <p className="whitespace-pre-wrap break-words">{note.body}</p>
          <p className="muted text-xs">{meta}</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <ActionButton className="btn btn-danger btn-sm" confirm="Delete this note permanently?" action={() => deleteItemAction("notes", note.id)}>Delete</ActionButton>
          </div>
        </>
      )}
    </li>
  );
}

export function AddNote() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" className="btn self-start" onClick={() => setOpen(true)}>+ New note</button>;
  return (
    <form
      className="card flex flex-col gap-2"
      aria-label="New note"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await createItemAction("notes", { title: title.trim() || null, body });
          if (r.ok) { setTitle(""); setBody(""); setOpen(false); announceChange(); } else setErr(r.error);
        });
      }}
    >
      <NoteFields id="new-note" title={title} body={body} setTitle={setTitle} setBody={setBody} />
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={pending}>Save note</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </form>
  );
}

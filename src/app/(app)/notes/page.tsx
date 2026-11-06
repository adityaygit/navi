import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { Note } from "@/lib/types";
import { AddNote, NoteItem } from "./note-item";

export const metadata = { title: "Notes · Navi" };

const SOURCE: Record<string, string> = { capture: "From your inbox", user: "Added by you", onboarding: "From setup" };

export default async function NotesPage() {
  const ctx = await requireCtx();
  const { data } = await ctx.db.from("notes").select("*").order("updated_at", { ascending: false }).limit(200);
  const notes = (data ?? []) as Note[];
  const when = (iso: string) => DateTime.fromISO(iso).setZone(ctx.timezone).toFormat("LLL d, yyyy");
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <header className="flex flex-col gap-3">
        <h1 className="h1">Notes</h1>
        <p className="muted max-w-prose text-[15px]">Things you wanted to keep that aren&apos;t tasks: notes you accept from the review inbox, or add here. Navi can look them up when you ask.</p>
        {notes.length > 0 && <p className="num dim text-sm">{notes.length} {notes.length === 1 ? "note" : "notes"}</p>}
      </header>
      <div className="max-w-2xl"><AddNote /></div>
      {notes.length === 0 ? (
        <p className="surf muted max-w-2xl px-4 py-5 text-sm sm:px-5">No notes yet. When you accept a note from your inbox, or add one here, it shows up here.</p>
      ) : (
        <ul className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Your notes">
          {notes.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              meta={`${SOURCE[n.source] ?? n.source} · saved ${when(n.created_at)}${n.updated_at.slice(0, 16) !== n.created_at.slice(0, 16) ? ` · edited ${when(n.updated_at)}` : ""}`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

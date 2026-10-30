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
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="h1">Notes</h1>
        <p className="muted text-sm">Things you wanted to keep that aren't tasks: notes you accept from the review inbox, or add here. Navi can look them up when you ask.</p>
      </header>
      <AddNote />
      {notes.length === 0 ? (
        <p className="muted text-sm">No notes yet. When you accept a note from your inbox, or add one here, it shows up here.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Your notes">
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

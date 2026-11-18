import { useState } from "react";
import type { MNote } from "@shared/mobile-api-you";
import { api } from "../api/client";
import { useNotes } from "../data/you";
import { feel } from "../native/haptics";
import { useToast } from "../ui/Toast";
import { ink } from "../theme/tokens";
import { Pushed } from "./Pushed";
import { AddButton, EditSheet, Empty, LoadState, youCard } from "./parts";

// Notes (M6): things you wanted to keep that aren't tasks. Tap one to edit
// (edits can be undone from Activity); deleting is for good, so it asks twice.

export function NotesScreen({ onClose }: { onClose: () => void }) {
  const notes = useNotes();
  const toast = useToast();
  const [edit, setEdit] = useState<MNote | "new" | null>(null);
  const list = notes.data?.notes;

  return (
    <>
      <Pushed title="Notes" z={30} onClose={onClose} aside={notes.data ? <AddButton label="New" onClick={() => setEdit("new")} /> : undefined}>
        {() => (
          <>
            {!notes.data ? <LoadState loading={notes.loading} error={notes.error} /> : null}
            {list && !list.length ? <Empty a="No notes" b="yet" line="Notes you accept from Inbox, or add here, show up here. Navi can look them up when you ask." /> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list?.map((n) => (
                <button key={n.id} type="button" onClick={() => { feel("select"); setEdit(n); }} style={{ ...youCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                  {n.title ? <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{n.title}</span> : null}
                  <span style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.4, color: ink.soft, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>{n.body}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: ink.dim }}>{n.source}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Pushed>
      {edit ? (
        <EditSheet
          title={edit === "new" ? "New note" : "Note"}
          fields={[
            { key: "title", label: "Title", value: edit === "new" ? "" : edit.title ?? "", placeholder: "Optional" },
            { key: "body", label: "Note", value: edit === "new" ? "" : edit.body, multiline: true, required: true },
          ]}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const body = { title: v.title.trim() || null, body: v.body.trim() };
            if (edit === "new") await api("/api/m/notes", { body: { ...body, id: crypto.randomUUID() } });
            else await api(`/api/m/notes/${edit.id}`, { method: "PATCH", body });
            feel("success");
            void notes.refresh();
          }}
          deleteLabel="delete it for good"
          onDelete={
            edit === "new"
              ? undefined
              : async () => {
                  await api(`/api/m/notes/${edit.id}`, { method: "DELETE" });
                  toast("Note deleted.");
                  void notes.refresh();
                }
          }
        />
      ) : null}
    </>
  );
}

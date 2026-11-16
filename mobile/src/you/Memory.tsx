import { useState } from "react";
import type { MMemory, MMemoryList } from "@shared/mobile-api-you";
import { api } from "../api/client";
import { useMemory } from "../data/you";
import { feel } from "../native/haptics";
import { useToast } from "../ui/Toast";
import { glass, ink } from "../theme/tokens";
import { Pushed } from "./Pushed";
import { AddButton, EditSheet, Empty, Heading, LoadState, youCard } from "./parts";

// Memory (M6): Navi's guesses on top to confirm or reject, then what Navi
// knows, each editable and deletable. Deleting is for good, so it asks twice.

export function MemoryScreen({ onClose }: { onClose: () => void }) {
  const mem = useMemory();
  const toast = useToast();
  const [list, setList] = useState<MMemoryList | null>(null);
  const [edit, setEdit] = useState<MMemory | "new" | null>(null);
  const data = list ?? mem.data;

  const send = async (path: string, init: { method?: string; body?: unknown }, ok?: string) => {
    try {
      setList(await api<MMemoryList>(path, init));
      if (ok) toast(ok);
    } catch (e) {
      feel("warning");
      toast(`Couldn't save that: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Pushed title="Memory" z={30} onClose={onClose} aside={data ? <AddButton label="Add" onClick={() => setEdit("new")} /> : undefined}>
        {() => (
          <>
            {!data ? <LoadState loading={mem.loading} error={mem.error} /> : null}
            {data && !data.guesses.length && !data.known.length ? <Empty a="Nothing" b="remembered yet" line="As you talk to Navi, what it learns about you shows up here." /> : null}
            {data?.guesses.length ? (
              <>
                <Heading tone="guess">Navi's guesses · check these</Heading>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.guesses.map((m) => (
                    <div key={m.id} style={{ ...youCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, border: "1.5px solid rgba(233,169,58,0.45)", animation: "nRise 0.3s ease both" }}>
                      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{m.content}</span>
                      <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint }}>{m.source}</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => { feel("success"); void send(`/api/m/memory/${m.id}/confirm`, { body: {} }, "Kept. Navi will rely on it."); }} style={{ height: 44, padding: "0 18px", borderRadius: 22, background: ink.text, color: "#fff", fontSize: 15, fontWeight: 600 }}>That's right</button>
                        <button type="button" onClick={() => { feel("select"); void send(`/api/m/memory/${m.id}/reject`, { body: {} }, "Removed. Navi won't assume this."); }} style={{ ...glass, height: 44, padding: "0 18px", borderRadius: 22, fontSize: 15, fontWeight: 600 }}>That's wrong</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {data?.known.length ? (
              <>
                <Heading>What Navi knows</Heading>
                <div style={youCard}>
                  {data.known.map((m, i) => (
                    <div key={m.id} style={{ minHeight: 64, padding: "10px 8px 10px 16px", display: "flex", alignItems: "center", gap: 6, borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{m.content}</span>
                        <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint }}>{m.source}</span>
                      </span>
                      <button type="button" aria-label={`Edit or delete: ${m.content}`} onClick={() => { feel("select"); setEdit(m); }} style={{ flex: "none", width: 44, height: 44, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z" fill="none" stroke={ink.text} strokeWidth="1.7" strokeLinejoin="round" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </Pushed>
      {edit ? (
        <EditSheet
          title={edit === "new" ? "Tell Navi something" : "Edit memory"}
          fields={[{ key: "content", label: edit === "new" ? "What should Navi remember?" : "What's true", value: edit === "new" ? "" : edit.content, multiline: true, required: true, placeholder: "I'm not a morning person" }]}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            setList(await api<MMemoryList>(edit === "new" ? "/api/m/memory" : `/api/m/memory/${edit.id}`, { method: edit === "new" ? "POST" : "PATCH", body: { content: v.content.trim() } }));
            feel("success");
          }}
          deleteLabel="delete it for good"
          onDelete={
            edit === "new"
              ? undefined
              : async () => {
                  setList(await api<MMemoryList>(`/api/m/memory/${edit.id}`, { method: "DELETE" }));
                  toast("Deleted. Navi has forgotten it.");
                }
          }
        />
      ) : null}
    </>
  );
}

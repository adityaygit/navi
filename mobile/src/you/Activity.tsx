import { useState } from "react";
import { api } from "../api/client";
import { useActivity } from "../data/you";
import { feel } from "../native/haptics";
import { useToast } from "../ui/Toast";
import { ink, meaning } from "../theme/tokens";
import { Pushed } from "./Pushed";
import { Empty, Heading, LoadState, youCard } from "./parts";

// Activity (M6): everything that changed, by day, and who did it. Undo only
// where it can really be undone.

const WHO_BG: Record<string, string> = { Navi: "#EEF3FC", You: "rgba(17,20,26,0.06)", Scheduler: "rgba(17,20,26,0.06)" };

export function ActivityScreen({ onClose }: { onClose: () => void }) {
  const act = useActivity();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const days = act.data?.days;

  const undo = async (id: string) => {
    feel("undo");
    setBusy(id);
    try {
      const r = await api<{ message?: string }>(`/api/m/activity/${id}/revert`, { body: {} });
      toast(r.message || "Undone.");
      await act.refresh();
    } catch (e) {
      feel("warning");
      toast(`Couldn't undo: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Pushed title="Activity" z={30} onClose={onClose}>
      {() => (
        <>
          {!act.data ? <LoadState loading={act.loading} error={act.error} /> : null}
          {days && !days.length ? <Empty a="Nothing has" b="changed yet" /> : null}
          {days?.map((d) => (
            <section key={d.label}>
              <Heading>{d.label}</Heading>
              <div style={youCard}>
                {d.entries.map((e, i) => (
                  <div key={e.id} style={{ minHeight: 60, padding: "10px 8px 10px 16px", display: "flex", alignItems: "center", gap: 10, borderTop: i ? `1px solid ${ink.line}` : "none", opacity: e.undone ? 0.6 : 1 }}>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35, textDecoration: e.undone ? "line-through" : "none" }}>{e.summary}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: ink.dim }}>
                        <span style={{ height: 24, padding: "0 8px", borderRadius: 12, background: WHO_BG[e.who], color: e.who === "Navi" ? ink.link : ink.muted, display: "flex", alignItems: "center" }}>{e.who}</span>
                        {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        {e.undone ? <span style={{ color: meaning.kept }}>Undone</span> : null}
                      </span>
                    </span>
                    {e.canUndo ? (
                      <button type="button" disabled={busy === e.id} onClick={() => void undo(e.id)} style={{ flex: "none", height: 44, padding: "0 10px", fontSize: 16, fontWeight: 700, color: ink.link, opacity: busy === e.id ? 0.5 : 1 }}>
                        Undo
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </Pushed>
  );
}

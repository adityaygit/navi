import { useState } from "react";
import type { MSpace } from "@shared/mobile-api-you";
import { api } from "../api/client";
import { useSpaces } from "../data/you";
import { feel } from "../native/haptics";
import { ink, spaceColor } from "../theme/tokens";
import { Pushed } from "./Pushed";
import { EditSheet, Empty, LoadState, youCard } from "./parts";

// Spaces (M6): the parts of your life Navi plans in, each a small dot of
// colour. Rename one or change its colour.

const SWATCHES = [spaceColor.school, spaceColor.work, spaceColor.friends, spaceColor.health, spaceColor.hobby, spaceColor.rest];

export function SpacesScreen({ onClose }: { onClose: () => void }) {
  const sp = useSpaces();
  const [edit, setEdit] = useState<MSpace | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const list = sp.data?.spaces;

  return (
    <>
      <Pushed title="Spaces" z={30} onClose={onClose}>
        {() => (
          <>
            {!sp.data ? <LoadState loading={sp.loading} error={sp.error} /> : null}
            {list && !list.length ? <Empty a="No spaces" b="yet" line="Tell Navi about school, work or anything else, and it sets them up." /> : null}
            {list?.length ? (
              <div style={youCard}>
                {list.map((s, i) => (
                  <button key={s.id} type="button" onClick={() => { feel("select"); setColor(s.color); setEdit(s); }} style={{ width: "100%", minHeight: 64, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left", borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                    <span aria-hidden="true" style={{ flex: "none", width: 12, height: 12, borderRadius: 6, background: s.color || "#A3A8BF" }} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 17, fontWeight: 600 }}>{s.name}</span>
                      <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.openTasks ? `${s.openTasks} open` : "Nothing open"}
                        {s.projects.length ? ` · ${s.projects.join(", ")}` : ""}
                      </span>
                    </span>
                    <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke={ink.dim} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </Pushed>
      {edit ? (
        <EditSheet
          title={edit.name}
          fields={[{ key: "name", label: "Name", value: edit.name, required: true }]}
          extra={
            <div role="radiogroup" aria-label="Colour" style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "2px 0" }}>
              {SWATCHES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color?.toLowerCase() === c.toLowerCase()} aria-label={`Colour ${c}`} onClick={() => { feel("select"); setColor(c); }} style={{ width: 44, height: 44, borderRadius: 22, background: c, boxShadow: color?.toLowerCase() === c.toLowerCase() ? `0 0 0 3px #fff, 0 0 0 5px ${ink.text}` : "none" }} />
              ))}
            </div>
          }
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            await api(`/api/m/spaces/${edit.id}`, { method: "PATCH", body: { name: v.name.trim(), color } });
            feel("success");
            void sp.refresh();
          }}
        />
      ) : null}
    </>
  );
}

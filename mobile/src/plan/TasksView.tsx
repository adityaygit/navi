import { useState } from "react";
import type { MTaskGroups, MTaskItem } from "@shared/mobile-api-types";
import { duration } from "../data/time";
import { feel } from "../native/haptics";
import { ease, ink } from "../theme/tokens";

type Props = { groups: MTaskGroups; onToggle: (t: MTaskItem, done: boolean) => void };

function sub(t: MTaskItem): string {
  const bits: string[] = [];
  if (t.due_at) bits.push(`${t.due_is_hard ? "Due" : "Aim for"} ${new Date(t.due_at).toLocaleDateString(undefined, { weekday: "long" })}`);
  if (t.steps.total) bits.push(`${t.steps.done} of ${t.steps.total} steps`);
  else if (t.estimate_minutes) bits.push(duration(t.estimate_minutes));
  return bits.join(" · ");
}

export function TasksView({ groups, onToggle }: Props) {
  // Ticked rows stay in place (struck through) until the view reloads, so nothing jumps under your finger.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const sections: [string, MTaskItem[]][] = [
    ["Today", [...groups.today, ...groups.doneToday]],
    ["Needs a time", groups.needsTime],
    ["Later", groups.later],
  ];
  return (
    <div style={{ padding: "8px 20px 0" }}>
      {sections
        .filter(([, items]) => items.length)
        .map(([h, items]) => (
          <section key={h}>
            <h2 style={{ margin: "24px 0 4px", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: ink.faint }}>{h}</h2>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((t) => {
                const done = ticked.has(t.id) ? t.status !== "done" : t.status === "done";
                const s = sub(t);
                return (
                  <li key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 60 }}>
                    <button
                      type="button"
                      aria-label={done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                      aria-pressed={done}
                      onClick={() => {
                        feel(done ? "undo" : "success");
                        setTicked((prev) => {
                          const n = new Set(prev);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        });
                        onToggle(t, !done);
                      }}
                      style={{ width: 44, height: 44, flex: "none", marginLeft: -10, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <span aria-hidden="true" style={{ width: 24, height: 24, boxSizing: "border-box", borderRadius: 12, border: done ? "none" : "1.5px solid rgba(255,255,255,0.35)", background: done ? "#9FF0D8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: `background-color 0.2s, transform 0.2s ${ease}`, transform: done ? "scale(1.08)" : "none" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00140A" strokeWidth="3" strokeLinecap="round" style={{ opacity: done ? 1 : 0, transition: "opacity 0.2s" }}><path d="m5 12 4.5 4.5L19 7" /></svg>
                      </span>
                    </button>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 17, color: done ? ink.dim : ink.text, textDecoration: done ? "line-through" : "none", transition: "color 0.25s", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                      {s ? <span style={{ fontSize: 13, color: t.due_is_hard && !done ? "#F8D2B0" : ink.faint }}>{s}</span> : null}
                    </span>
                    {t.space ? <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: t.space.color }} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      {!sections.some(([, i]) => i.length) ? <p style={{ margin: "24px 0 0", fontSize: 17, color: ink.faint }}>Nothing on your list. Tell Navi what's coming up.</p> : null}
    </div>
  );
}

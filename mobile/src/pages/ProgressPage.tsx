import { useState } from "react";
import { useProgress, notOnServer } from "../data/you";
import { feel } from "../native/haptics";
import { Story } from "../progress/Story";
import { AskBar, type AskRequest } from "../shell/AskSheet";
import { Sheet } from "../ui/Sheet";
import { useMoment } from "../theme/colour";
import { glass, ink, meaning, spaceColor, skyFor, type Palette } from "../theme/tokens";

// Progress (M6): one headline, kept · focused · slipping (tap for how they're
// counted), where the hours went, one question, and the week told back.
// Plain page; the sky only appears in the stories.

const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}` : `${h}h`) : `${m}m`;
};
/** "1 hour", "4½ hours", "31 hours" */
const hoursLabel = (min: number) => {
  const h = Math.max(0.5, Math.round(min / 30) / 2);
  return h === 1 ? "1 hour" : `${h % 1 ? `${Math.floor(h) || ""}½` : h} hours`;
};
const dot = (name: string, color: string | null) => color || spaceColor[name.toLowerCase() as keyof typeof spaceColor] || "#A3A8BF";
const card: React.CSSProperties = { background: ink.raised, borderRadius: 24, border: `1px solid ${ink.line}`, boxShadow: "0 10px 30px -18px rgba(20,32,64,0.22)" };

type Props = { palette: Palette; active: boolean; onAsk: (r: AskRequest) => void; onVoice: () => void };

export function ProgressPage({ palette: P, active, onAsk, onVoice }: Props) {
  const prog = useProgress(true);
  const moment = useMoment();
  const [counted, setCounted] = useState(false);
  const [story, setStory] = useState<null | "week" | "today">(null);
  const [asked, setAsked] = useState(false);
  const d = prog.data;
  const evening = moment === "evening" || moment === "night";
  const ask = (prompt?: string, send?: boolean) => onAsk({ context: "this week", viewing: "Progress", prompt, send });

  return (
    <div style={{ position: "absolute", inset: 0, background: ink.bg }}>
      <div className="scroll" style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 76px) 16px 150px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>
        {!d && !prog.error ? (
          <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[44, 120, 150, 90].map((h, i) => <span key={i} style={{ height: h, borderRadius: 24, background: i ? "rgba(17,20,26,0.05)" : "transparent" }} />)}
          </div>
        ) : null}
        {!d && prog.error ? (
          <div style={{ padding: "40px 4px 0", display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em" }}>
              Your week is <span className="em">on its way</span>.
            </p>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.4, fontWeight: 500, color: ink.muted }}>
              {notOnServer(prog.error) ? "Progress needs the newest version of Navi's server. It'll show here once that's live." : "Couldn't load it. It'll come back when you're online."}
            </p>
          </div>
        ) : null}

        {d ? (
          <>
            {prog.savedAt ? (
              <span role="status" style={{ ...glass, alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 17, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#A3A8BF" }} />
                Offline · as of {new Date(prog.savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : null}
            <h1 style={{ margin: "0 4px", fontSize: 36, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em", animation: "nFade 0.4s ease both" }}>
              {d.headline.a}
              <span className="em">{d.headline.b}</span>
              {d.headline.c}
            </h1>

            {evening && d.today.length ? (
              <div style={{ ...card, background: ink.text, color: "#fff", border: "none", padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ flex: 1, fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em" }}>Wrap up today</span>
                <button type="button" onClick={() => { feel("select"); setStory("today"); }} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: "#fff", color: ink.text, fontSize: 16, fontWeight: 700 }}>Start · 1 min</button>
              </div>
            ) : null}

            <button type="button" onClick={() => { feel("select"); setCounted(true); }} style={{ ...card, padding: "18px 8px 10px", display: "flex", flexDirection: "column", gap: 10, textAlign: "center" }}>
              <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", width: "100%" }}>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>{d.kept ? `${d.kept.done}/${d.kept.of}` : "–"}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: ink.muted }}>kept</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, borderLeft: `1px solid ${ink.edge}`, borderRight: `1px solid ${ink.edge}` }}>
                  <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>{d.focusedMinutes ? hm(d.focusedMinutes) : "0"}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: ink.muted }}>focused</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: d.slipping.length ? meaning.slipping : ink.text }}>{d.slipping.length}</span>
                  <span style={{ fontSize: 15, fontWeight: 500, color: ink.muted }}>slipping</span>
                </span>
              </span>
              <span style={{ alignSelf: "center", height: 32, display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 600, color: ink.link }}>
                How these are counted
                <svg width="8" height="12" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
            </button>

            {d.hoursTotal >= 30 ? (
              <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em" }}>Where {hoursLabel(d.hoursTotal)} went</h2>
                <div role="img" aria-label={d.hours.map((h) => `${h.name} ${hm(h.minutes)}`).join(", ")} style={{ display: "flex", gap: 4, height: 14 }}>
                  {d.hours.map((h) => <span key={h.name} style={{ flex: `${h.minutes} 1 0`, borderRadius: 7, background: dot(h.name, h.color) }} />)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px 16px", fontSize: 15, fontWeight: 500, color: ink.muted }}>
                  {d.hours.map((h) => (
                    <span key={h.name} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span aria-hidden="true" style={{ flex: "none", width: 10, height: 10, borderRadius: 5, background: dot(h.name, h.color) }} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name} {hm(h.minutes)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {d.question && !asked ? (
              <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.35, fontWeight: 700, letterSpacing: "-0.01em" }}>{d.question}</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => { setAsked(true); ask(`${d.question} Help me think about it.`, true); }} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: "#fff", fontSize: 16, fontWeight: 600 }}>Talk it through</button>
                  <button type="button" onClick={() => { feel("select"); setAsked(true); }} style={{ ...glass, height: 46, padding: "0 20px", borderRadius: 23, fontSize: 16, fontWeight: 600 }}>Not now</button>
                </div>
              </div>
            ) : null}

            <button type="button" onClick={() => { feel("select"); setStory("week"); }} style={{ ...card, height: 72, padding: "0 12px 0 20px", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
              <span style={{ flex: 1, fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em" }}>
                Your week, <span className="em">told back</span>
              </span>
              <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 23, background: ink.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1.5v13l11-6.5z" fill="#fff" /></svg>
              </span>
            </button>
          </>
        ) : null}
      </div>

      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "calc(var(--sat) + 78px)", background: "linear-gradient(180deg, #FBFBFD 0%, #FBFBFD 62%, rgba(251,251,253,0) 100%)", pointerEvents: "none" }} />
      {active ? <AskBar palette={P} text="Ask about this week" onOpen={() => ask()} onVoice={onVoice} /> : null}

      {counted && d ? (
        <Sheet label="How these are counted" onClose={() => setCounted(false)} style={{ padding: "0 16px" }}>
          {() => (
            <div className="scroll" style={{ padding: "8px 0 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ margin: "0 4px 4px", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>How these are counted</h2>
              {[
                [`Kept · ${d.kept ? `${d.kept.done} of ${d.kept.of}` : "nothing planned"}`, "Things you planned for yourself and did. Fixed events don't count. Rest, interruptions, missing information and work that ran over aren't held against you. Moving something with a day's notice isn't a miss."],
                [`Focused · ${d.focusedMinutes ? hm(d.focusedMinutes) : "none yet"}`, "Time inside Focus sessions in the last 7 days."],
                [`Slipping · ${d.slipping.length}`, "Something skipped three or more times in three weeks, or a hard deadline in the next two days."],
              ].map(([t, b]) => (
                <div key={t} style={{ background: ink.raised, borderRadius: 22, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{t}</span>
                  <span style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.45, color: ink.muted }}>{b}</span>
                </div>
              ))}
              {d.slipping.length ? (
                <div style={{ background: ink.raised, borderRadius: 22, overflow: "hidden" }}>
                  {d.slipping.map((s, i) => (
                    <div key={s.id} style={{ minHeight: 56, padding: "8px 16px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{s.title}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: meaning.slipping }}>{s.why}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Sheet>
      ) : null}

      {story && d ? <Story name={story === "week" ? "Your week" : "Today"} cards={story === "week" ? d.week : d.today} sky={skyFor(moment)} onClose={() => setStory(null)} /> : null}
    </div>
  );
}

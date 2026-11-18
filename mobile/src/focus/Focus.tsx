import { useEffect, useRef, useState } from "react";
import type { MDay, MFocusResult, MFocusSession } from "@shared/mobile-api-types";
import { api } from "../api/client";
import { feel } from "../native/haptics";
import { cancel, scheduleAt } from "../native/notify";
import { HoldButton } from "../ui/HoldButton";
import { Sheet } from "../ui/Sheet";
import { skyProps, useSkyOn } from "../ui/sky";
import { useExit } from "../ui/useExit";
import { useHideToast, useToast } from "../ui/Toast";
import { ease, glass, glassStrong, ink, meaning, spaceColor } from "../theme/tokens";

// Focus (M6): its own place above the clouds. Pick a length, hold 1 s to
// begin (heavy bump), 3·2·1, then a ring that empties as time passes. Pause is
// a tap; finishing early is an 0.8 s hold, so a brush doesn't end it. Only a
// fixed event 10 minutes out or a hard deadline within the hour breaks
// through; everything else waits. The server keeps the session; the phone
// keeps the clock and a local notification for the end.

export type FocusTarget = { title: string; taskId: string | null; blockId: string | null; minutes: number; space: string | null };
type Step = "setup" | "count" | "run" | "done";
type Alert = { key: string; at: number; title: string };
const NOTIFY_ID = 7001;
const BASE = [25, 50, 90];

type Props = { target: FocusTarget; hidden: boolean; onMinimize: (s: { left: number; title: string }) => void; onClose: () => void };

const fmt = (x: number) => {
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const s = String(Math.max(0, x % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60}` : ""}` : `${n} min`);

/** Three lengths; the block's own length replaces the nearest when it's different. */
function lengths(own: number): number[] {
  if (!own || own < 10 || own > 180 || BASE.includes(own)) return BASE;
  const near = BASE.reduce((a, b) => (Math.abs(b - own) < Math.abs(a - own) ? b : a));
  return BASE.map((b) => (b === near ? own : b)).sort((a, b) => a - b);
}

/** What may break through: fixed events (10 min before) and hard deadlines (within the hour). */
function breakThroughs(day: MDay | null, from: number, until: number): Alert[] {
  if (!day) return [];
  const out: Alert[] = [];
  for (const it of day.items) {
    if (it.look !== "fixed" || it.done) continue;
    const at = Date.parse(it.start) - 10 * 60000;
    if (Date.parse(it.start) > from && at <= until) out.push({ key: `e-${it.key}`, at, title: `${it.title} in 10 minutes` });
  }
  for (const n of day.needsTime) {
    if (!n.due_is_hard || !n.due_at) continue;
    const at = Date.parse(n.due_at) - 60 * 60000;
    if (Date.parse(n.due_at) > from && at <= until) out.push({ key: `d-${n.id}`, at, title: `${n.title} is due at ${clock(new Date(n.due_at))}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function Focus({ target, hidden, onMinimize, onClose }: Props) {
  const toast = useToast();
  const hideToast = useHideToast();
  const skyOn = useSkyOn();
  const opts = lengths(target.minutes);
  const [step, setStep] = useState<Step>("setup");
  const [len, setLen] = useState(() => (opts.includes(target.minutes) ? target.minutes : 50));
  const [count, setCount] = useState(3);
  const [session, setSession] = useState<MFocusSession | null>(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [focused, setFocused] = useState(0);
  const [rules, setRules] = useState(false);
  const [day, setDay] = useState<MDay | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);
  const shown = useRef(new Set<string>());
  const snoozed = useRef(new Map<string, number>());
  const { closing, close } = useExit(320);
  const pauseStarted = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Today's fixed things, for what may break through.
  useEffect(() => {
    void api<MDay>("/api/m/day").then(setDay).catch(() => {});
  }, []);

  const startedAt = session ? Date.parse(session.started_at) : 0;
  const pausedNow = pauseStarted.current ? now - pauseStarted.current : 0;
  const elapsed = session ? Math.max(0, Math.floor((now - startedAt - pausedMs.current - pausedNow) / 1000)) : 0;
  const total = len * 60;
  const left = Math.max(0, total - elapsed);
  const endsAt = clock(new Date((session ? startedAt + pausedMs.current + pausedNow : Date.now()) + total * 1000));

  // The clock.
  useEffect(() => {
    if (step !== "run") return;
    const iv = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, [step]);
  useEffect(() => {
    if (hidden && step === "run") onMinimize({ left, title: target.title });
  });

  // Time's up.
  useEffect(() => {
    if (step === "run" && session && left === 0 && !paused) void finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, step]);

  // Something that can't wait.
  useEffect(() => {
    if (step !== "run" || alert) return;
    const due = breakThroughs(day, startedAt, startedAt + total * 1000 + 60000).find((a) => {
      const until = snoozed.current.get(a.key);
      return now >= (until ?? a.at) && (until !== undefined || !shown.current.has(a.key));
    });
    if (due) {
      shown.current.add(due.key);
      snoozed.current.delete(due.key);
      setAlert(due);
      feel("warning");
    }
  }, [now, step, day, alert, startedAt, total]);

  function begin() {
    setStep("count");
    setCount(3);
    feel("count");
    timers.current.push(window.setTimeout(() => { setCount(2); feel("count"); }, 900), window.setTimeout(() => { setCount(1); feel("count"); }, 1800));
    const began = api<MFocusResult>("/api/m/focus/start", { body: { taskId: target.taskId, blockId: target.blockId, plannedMinutes: len } });
    timers.current.push(
      window.setTimeout(async () => {
        try {
          const r = await began;
          pausedMs.current = 0;
          setSession(r.session);
          setNow(Date.now());
          setStep("run");
          feel("go");
          void scheduleAt(NOTIFY_ID, new Date(Date.parse(r.session.started_at) + len * 60000), "Focus done", `${len} minutes on ${target.title}.`);
        } catch (e) {
          toast(`Couldn't start focus: ${(e as Error).message}`);
          feel("warning");
          setStep("setup");
        }
      }, 2700),
    );
  }

  async function togglePause() {
    if (!session) return;
    feel("select");
    if (!paused) {
      pauseStarted.current = Date.now();
      setPaused(true);
      void cancel(NOTIFY_ID);
      await api(`/api/m/focus/${session.id}/pause`, { body: {} }).catch(() => {});
    } else {
      pausedMs.current += Date.now() - (pauseStarted.current ?? Date.now());
      pauseStarted.current = null;
      setPaused(false);
      setNow(Date.now());
      await api(`/api/m/focus/${session.id}/resume`, { body: {} }).catch(() => {});
      void scheduleAt(NOTIFY_ID, new Date(Date.now() + left * 1000), "Focus done", `${len} minutes on ${target.title}.`);
    }
  }

  async function finish(natural: boolean) {
    if (!session) return;
    void cancel(NOTIFY_ID);
    if (pauseStarted.current) {
      pausedMs.current += Date.now() - pauseStarted.current;
      pauseStarted.current = null;
    }
    setFocused(Math.max(1, Math.round(elapsed / 60)));
    setAlert(null);
    hideToast();
    setStep("done");
    if (natural) feel("success");
    try {
      await api(`/api/m/focus/${session.id}/end`, { body: { outcome: natural ? "completed" : "progress" } });
    } catch (e) {
      toast(`Couldn't save the session: ${(e as Error).message}`);
    }
  }

  async function wrapUp(taskDone: boolean) {
    feel(taskDone ? "success" : "select");
    if (taskDone && target.taskId) await api(`/api/m/tasks/${target.taskId}/complete`, { body: {} }).catch(() => toast("Couldn't mark it done. Try from Plan."));
    close(onClose);
  }

  const sky = skyProps(step === "done" ? "dusk" : "focus", skyOn);
  const veil =
    step === "setup"
      ? "linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 45%, rgba(255,255,255,0.25) 100%)"
      : step === "done"
        ? "linear-gradient(180deg, rgba(251,251,253,0) 30%, rgba(251,251,253,0.35) 70%, rgba(251,251,253,0.6) 100%)"
        : `radial-gradient(circle at 50% 38%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 60%)${paused ? ", rgba(240,242,246,0.45)" : ""}`;
  const dot = spaceColor[(target.space ?? "").toLowerCase() as keyof typeof spaceColor] ?? "#A3A8BF";
  const R = 140;
  const C = 2 * Math.PI * R;
  const btn: React.CSSProperties = { flex: 1, height: 60, borderRadius: 30, fontSize: 17, fontWeight: 700, textAlign: "center" };
  const hint = (t: string) => toast(t);

  return (
    <div role="dialog" aria-label="Focus" aria-hidden={hidden} style={{ position: "absolute", inset: 0, zIndex: 20, overflow: "hidden", background: "#F4EEE8", color: ink.text, visibility: hidden ? "hidden" : "visible", animation: closing ? `nSink 0.32s ${ease} both` : "nFade 0.6s ease both" }}>
      <div aria-hidden="true" className={sky.className} style={{ ...sky.style, position: "absolute", inset: -40, backgroundPosition: "50% 50%", animation: "fDrift 36s ease-in-out infinite", transition: "background-image 0.8s" }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: veil, transition: "background 0.6s" }} />

      {step === "setup" ? (
        <div style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 4px) 16px var(--sab)", display: "flex", flexDirection: "column", animation: "nFade 0.45s ease both" }}>
          <button type="button" aria-label="Close" onClick={() => close(onClose)} style={{ ...glass, alignSelf: "flex-start", width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke={ink.text} strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <div style={{ marginTop: "clamp(24px, 9vh, 70px)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}>
            {target.space ? (
              <span style={{ ...glass, height: 36, padding: "0 14px", borderRadius: 18, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 5, background: dot }} />
                {target.space}
              </span>
            ) : null}
            <h1 style={{ margin: 0, fontSize: "clamp(38px, 13vw, 54px)", lineHeight: 0.98, fontWeight: 800, letterSpacing: "-0.045em", color: "#0E1116", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{target.title}</h1>
            <p style={{ margin: 0, fontSize: 19, fontWeight: 500, color: ink.soft }}>
              Until <span className="em">{endsAt}</span>, nothing else.
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ ...glassStrong, borderRadius: 34, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div role="radiogroup" aria-label="Length" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              {opts.map((m) => {
                const on = len === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) { feel("select"); setLen(m); } }} style={{ height: 64, borderRadius: 22, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: on ? ink.text : "rgba(255,255,255,0.7)", color: on ? "#fff" : ink.text, transition: "background-color 0.2s, color 0.2s" }}>
                    <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em" }}>{m}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>min</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => { feel("select"); setRules(true); }} style={{ minHeight: 48, borderRadius: 22, padding: "0 12px 0 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#A3A8BF" }} />
              <span style={{ flex: 1 }}>Only urgent things break through</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: ink.link }}>How</span>
            </button>
            <HoldButton ms={1000} doneFeel="go" label={`Hold to begin · ${mins(len)}`} holdingLabel="Keep holding" onDone={begin} onHint={hint} style={{ height: 62, borderRadius: 31, background: ink.text, color: "#fff", fontSize: 18, fontWeight: 700, textAlign: "center" }} />
          </div>
        </div>
      ) : null}

      {step === "count" ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, animation: "nFade 0.45s ease both" }}>
          <div style={{ ...glass, width: 250, height: 250, borderRadius: 125, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span key={count} aria-live="assertive" style={{ fontSize: 150, fontWeight: 800, letterSpacing: "-0.06em", animation: `nPop 0.5s ${ease} both` }}>{count}</span>
          </div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 600, color: ink.soft }}>
            Breathe <span className="em">{count === 2 ? "out" : "in"}</span>.
          </p>
        </div>
      ) : null}

      {step === "run" ? (
        <div style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 4px) 20px var(--sab)", display: "flex", flexDirection: "column", alignItems: "center", animation: "nFade 0.45s ease both" }}>
          <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button type="button" aria-label="Minimise" onClick={() => { feel("select"); onMinimize({ left, title: target.title }); }} style={{ ...glass, width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" onClick={() => { feel("select"); setRules(true); }} style={{ ...glass, height: 44, padding: "0 16px", borderRadius: 22, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#A3A8BF" }} />
              Only urgent breaks through
            </button>
            <span style={{ width: 48 }} />
          </div>
          <div style={{ position: "relative", marginTop: "clamp(28px, 7vh, 64px)", width: 300, height: 300, flex: "none" }}>
            <div aria-hidden="true" style={{ position: "absolute", inset: -30, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.75), rgba(255,255,255,0))", animation: "fGlow 5s ease-in-out infinite" }} />
            <div aria-hidden="true" style={{ ...glass, position: "absolute", inset: 14, borderRadius: "50%" }} />
            <svg width="300" height="300" viewBox="0 0 300 300" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
              <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="8" />
              <circle cx="150" cy="150" r={R} fill="none" stroke={ink.text} strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - left / total)} transform="rotate(-90 150 150)" style={{ transition: "stroke-dashoffset 1s linear" }} />
            </svg>
            <div role="timer" aria-label={`${Math.ceil(left / 60)} minutes left`} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <span style={{ fontSize: left >= 3600 ? 52 : 64, fontWeight: 800, letterSpacing: "-0.05em" }}>{fmt(left)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: ink.muted }}>ends {endsAt}</span>
            </div>
          </div>
          <h2 style={{ margin: "36px 0 0", fontSize: 32, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-0.035em", textAlign: "center", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{target.title}</h2>
          <span style={{ marginTop: 6, fontSize: 17, fontWeight: 600, color: ink.muted }}>{paused ? "Paused" : "Focusing"}</span>
          <div style={{ flex: 1 }} />
          <div style={{ alignSelf: "stretch", display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void togglePause()} style={{ ...glass, ...btn }}>{paused ? "Resume" : "Pause"}</button>
            <HoldButton ms={800} doneFeel="holdDone" label="Hold to finish" onDone={() => void finish(false)} onHint={hint} style={{ ...btn, background: ink.text, color: "#fff" }} />
          </div>
        </div>
      ) : null}

      {alert && step === "run" ? (
        <div role="alert" style={{ ...glassStrong, position: "absolute", left: 12, right: 12, top: "calc(var(--sat) + 4px)", zIndex: 3, borderRadius: 28, padding: 16, display: "flex", flexDirection: "column", gap: 12, animation: `nRise 0.45s ${ease} both` }}>
          <span style={{ alignSelf: "flex-start", height: 28, padding: "0 10px", borderRadius: 14, background: meaning.deadlineBg, color: meaning.deadline, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center" }}>Breaks through focus</span>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.015em" }}>{alert.title}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void finish(false)} style={{ height: 46, padding: "0 20px", borderRadius: 23, background: ink.text, color: "#fff", fontSize: 16, fontWeight: 600 }}>Wrap up</button>
            <button
              type="button"
              onClick={() => {
                feel("select");
                snoozed.current.set(alert.key, Date.now() + 5 * 60000);
                setAlert(null);
              }}
              style={{ ...glass, height: 46, padding: "0 18px", borderRadius: 23, fontSize: 16, fontWeight: 600 }}
            >
              5 more minutes
            </button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 10px) 20px var(--sab)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", animation: "nFade 0.45s ease both" }}>
          <div style={{ flex: 1 }} />
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "40%", width: 440, height: 300, margin: "-150px 0 0 -220px", background: "radial-gradient(closest-side, rgba(255,255,255,0.6), rgba(255,255,255,0))", filter: "blur(8px)" }} />
          <h1 style={{ position: "relative", margin: 0, fontSize: "clamp(38px, 13vw, 54px)", lineHeight: 0.98, fontWeight: 800, letterSpacing: "-0.045em", animation: `nRise 0.5s ${ease} both` }}>
            <span className="em">{mins(focused)}</span>
            <br />
            on {target.title.length > 28 ? "this" : target.title.charAt(0).toLowerCase() + target.title.slice(1)}.
          </h1>
          <p style={{ position: "relative", margin: "16px 0 0", fontSize: 20, fontWeight: 600, color: ink.soft }}>{target.taskId ? "Is it done?" : "That counts."}</p>
          <div style={{ flex: 1.3 }} />
          <div style={{ alignSelf: "stretch", display: "flex", gap: 8 }}>
            {target.taskId ? (
              <>
                <button type="button" onClick={() => void wrapUp(false)} style={{ ...glass, ...btn }}>Not finished</button>
                <button type="button" onClick={() => void wrapUp(true)} style={{ ...btn, background: ink.text, color: "#fff" }}>Mark done</button>
              </>
            ) : (
              <button type="button" onClick={() => void wrapUp(false)} style={{ ...btn, background: ink.text, color: "#fff" }}>Done</button>
            )}
          </div>
        </div>
      ) : null}

      {rules ? (
        <Sheet label="What happens during focus" floating z={30} onClose={() => setRules(false)} style={{ padding: "6px 18px 20px", gap: 14 }}>
          {() => (
            <>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>Only this breaks through</h2>
              <div style={{ background: ink.raised, borderRadius: 20, overflow: "hidden" }}>
                {["Fixed events, 10 minutes before", "A hard deadline within the hour"].map((t, i) => (
                  <div key={t} style={{ minHeight: 52, padding: "0 16px", display: "flex", alignItems: "center", gap: 10, borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: spaceColor.school }} />
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{t}</span>
                  </div>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: 1.4, color: ink.muted }}>Navi won't interrupt you for anything else until you're done.</p>
            </>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}

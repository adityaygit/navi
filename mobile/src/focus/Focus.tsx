import { useEffect, useRef, useState } from "react";
import type { MFocusResult, MFocusSession } from "@shared/mobile-api-types";
import { api } from "../api/client";
import { feel } from "../native/haptics";
import { cancel, scheduleAt } from "../native/notify";
import { Stone } from "../ui/Stone";
import { useExit } from "../ui/useExit";
import { useToast } from "../ui/Toast";
import { ease } from "../theme/tokens";
import { sceneFor } from "./scenes";

// A focus session (M4-Focus): set up → 3·2·1 → running (break, minimise) →
// end early → done. The server keeps the session; the phone keeps the clock
// and schedules a local notification for the end, so it arrives even if the
// app is closed.

export type FocusTarget = { title: string; taskId: string | null; blockId: string | null; minutes: number; space: string | null };
type Step = "setup" | "count" | "run" | "leave" | "done";
const NOTIFY_ID = 7001;

type Props = { target: FocusTarget; hidden: boolean; onMinimize: (s: { left: number; title: string }) => void; onClose: () => void };

const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.max(0, x % 60)).padStart(2, "0")}`;
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function Focus({ target, hidden, onMinimize, onClose }: Props) {
  const toast = useToast();
  const S = sceneFor(target.space);
  const [step, setStep] = useState<Step>("setup");
  const [mins, setMins] = useState(Math.max(10, Math.min(120, Math.round((target.minutes || 50) / 5) * 5)));
  const [hold, setHold] = useState(true);
  const [count, setCount] = useState(3);
  const [session, setSession] = useState<MFocusSession | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [focused, setFocused] = useState(0);
  const { closing, close } = useExit(320);
  const breakStarted = useRef<number | null>(null);
  const pausedMs = useRef(0);

  const startedAt = session ? Date.parse(session.started_at) : 0;
  const elapsed = session ? Math.max(0, Math.floor((now - startedAt - pausedMs.current - (breakStarted.current ? now - breakStarted.current : 0)) / 1000)) : 0;
  const total = mins * 60;
  const left = Math.max(0, total - elapsed);

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
    if (step === "run" && session && left === 0 && !onBreak) void finish("completed", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, step]);

  async function start() {
    feel("select");
    setStep("count");
    setCount(3);
    feel("count");
    window.setTimeout(() => { setCount(2); feel("count"); }, 900);
    window.setTimeout(() => { setCount(1); feel("count"); }, 1800);
    const began = api<MFocusResult>("/api/m/focus/start", { body: { taskId: target.taskId, blockId: target.blockId, plannedMinutes: mins } });
    window.setTimeout(async () => {
      try {
        const r = await began;
        pausedMs.current = 0;
        setSession(r.session);
        setNow(Date.now());
        setStep("run");
        feel("go");
        void scheduleAt(NOTIFY_ID, new Date(Date.parse(r.session.started_at) + mins * 60000), "Focus done", `${mins} minutes on ${target.title}.`);
      } catch (e) {
        toast(`Couldn't start focus: ${(e as Error).message}`);
        feel("warning");
        setStep("setup");
      }
    }, 2700);
  }

  async function toggleBreak() {
    if (!session) return;
    feel("select");
    if (!onBreak) {
      breakStarted.current = Date.now();
      setOnBreak(true);
      void cancel(NOTIFY_ID);
      await api(`/api/m/focus/${session.id}/pause`, { body: {} }).catch(() => {});
    } else {
      pausedMs.current += Date.now() - (breakStarted.current ?? Date.now());
      breakStarted.current = null;
      setOnBreak(false);
      setNow(Date.now());
      await api(`/api/m/focus/${session.id}/resume`, { body: {} }).catch(() => {});
      void scheduleAt(NOTIFY_ID, new Date(Date.now() + left * 1000), "Focus done", `${mins} minutes on ${target.title}.`);
    }
  }

  async function finish(outcome: "completed" | "progress", natural = false) {
    if (!session) return;
    void cancel(NOTIFY_ID);
    setFocused(Math.max(1, Math.round(elapsed / 60)));
    setStep("done");
    feel("success");
    if (!natural && outcome === "completed") return; // decided on the done screen
    try {
      await api(`/api/m/focus/${session.id}/end`, { body: { outcome: natural ? "completed" : "progress" } });
    } catch (e) {
      toast(`Couldn't save the session: ${(e as Error).message}`);
    }
  }

  async function wrapUp(taskDone: boolean) {
    feel(taskDone ? "success" : "select");
    if (taskDone && target.taskId) await api(`/api/m/tasks/${target.taskId}/complete`, { body: {} }).catch(() => {});
    close(onClose);
  }

  const endsAt = clock(new Date((session ? startedAt + pausedMs.current : Date.now()) + mins * 60000));
  const kicker = `FOCUS${target.space ? " · " + target.space.toUpperCase() : ""}`;
  const pct = Math.round((1 - left / total) * 100);

  return (
    <div aria-hidden={hidden} style={{ position: "absolute", inset: 0, zIndex: 20, overflow: "hidden", background: "#000", color: "#fff", visibility: hidden ? "hidden" : "visible", animation: closing ? `nSink 0.32s ${ease} both` : `nFade 0.35s ease both` }}>
      {/* the scene */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: S.sky, filter: onBreak ? "saturate(0.4) brightness(0.6)" : step === "setup" ? "saturate(0.8) brightness(0.75)" : step === "done" ? "saturate(1.15) brightness(1.1)" : "none", transition: "filter 0.6s" }} />
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: step === "done" ? 150 : 200, width: 360, height: 360, marginLeft: -180, borderRadius: "50%", background: `radial-gradient(circle, ${S.sun} 0%, rgba(0,0,0,0) 62%)`, transition: `top 0.8s ${ease}` }} />
      <div aria-hidden="true" style={{ position: "absolute", left: -40, right: -40, top: "43%", height: 180, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: S.h1 }} />
      <div aria-hidden="true" style={{ position: "absolute", left: -120, right: 60, top: "48%", height: 220, borderRadius: "50% 50% 0 0 / 100% 100% 0 0", background: S.h2 }} />
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 420, background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.85) 100%)" }} />

      {step === "setup" ? (
        <>
          <button type="button" aria-label="Close" onClick={() => close(onClose)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", animation: "nFade 0.3s ease both" }} />
          <section aria-label="Set up focus" style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: "32px 32px 0 0", background: "rgba(22,22,26,0.94)", borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 16px var(--sab)", display: "flex", flexDirection: "column", gap: 12, animation: `nUp 0.42s ${ease} both` }}>
            <span aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.25)" }} />
            <div style={{ margin: "12px 0 4px", display: "flex", flexDirection: "column", gap: 4, padding: "0 4px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", color: S.tint }}>{kicker}</span>
              <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" }}>{target.title}</span>
            </div>
            <div style={{ borderRadius: 16, background: "rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
              <div style={{ minHeight: 56, display: "flex", alignItems: "center", gap: 8, padding: "0 6px 0 16px" }}>
                <span style={{ flex: 1, fontSize: 17 }}>Length</span>
                <button type="button" aria-label="Shorter" onClick={() => { feel("select"); setMins((m) => Math.max(10, m - 5)); }} style={stepBtn}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
                <span aria-live="polite" style={{ width: 72, textAlign: "center", fontSize: 17, fontWeight: 600 }}>{mins} min</span>
                <button type="button" aria-label="Longer" onClick={() => { feel("select"); setMins((m) => Math.min(180, m + 5)); }} style={stepBtn}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
              </div>
              <div style={{ height: 1, marginLeft: 16, background: "rgba(255,255,255,0.07)" }} />
              <div style={{ minHeight: 52, display: "flex", alignItems: "center", padding: "0 16px" }}><span style={{ flex: 1, fontSize: 17 }}>Ends at</span><span style={{ fontSize: 17, color: "rgba(255,255,255,0.6)" }}>{endsAt}</span></div>
            </div>
            <div style={{ borderRadius: 16, background: "rgba(255,255,255,0.06)" }}>
              <button type="button" role="switch" aria-checked={hold} onClick={() => { feel("select"); setHold((h) => !h); }} style={{ width: "100%", minHeight: 64, display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", boxSizing: "border-box" }}>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 17 }}>Hold everything else</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>Navi keeps reminders quiet until you're done</span>
                </span>
                <span aria-hidden="true" style={{ width: 50, height: 30, borderRadius: 15, background: hold ? S.tint : "rgba(255,255,255,0.16)", position: "relative", transition: "background-color 0.2s" }}>
                  <span style={{ position: "absolute", top: 3, left: hold ? 23 : 3, width: 24, height: 24, borderRadius: 12, background: "#fff", transition: `left 0.2s ${ease}` }} />
                </span>
              </button>
            </div>
            <button type="button" onClick={() => void start()} style={{ marginTop: 8, height: 56, borderRadius: 28, background: S.cta, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>Start focus · {mins} min</button>
            <button type="button" onClick={() => close(onClose)} style={{ marginTop: -4, height: 44, fontSize: 15, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Not now</button>
          </section>
        </>
      ) : null}

      {step === "count" ? (
        <div aria-live="polite" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span key={count} style={{ fontSize: 140, fontWeight: 700, animation: "fPop 0.9s ease both" }}>{count}</span>
          <style>{"@keyframes fPop{0%{opacity:0;transform:scale(1.25)}20%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(0.9)}}"}</style>
        </div>
      ) : null}

      {step === "run" || step === "leave" ? (
        <>
          <div style={{ position: "absolute", left: 20, right: 20, top: "calc(var(--sat) + 6px)", display: "flex", alignItems: "center", justifyContent: "space-between", animation: "nFade 0.5s ease both" }}>
            <button type="button" aria-label="Minimise" onClick={() => { feel("select"); onMinimize({ left, title: target.title }); }} style={{ width: 44, height: 44, borderRadius: 22, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {hold ? (
              <span style={{ height: 36, padding: "0 14px 0 12px", borderRadius: 18, background: "rgba(0,0,0,0.25)", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                <Stone w={14} h={13} bg={S.stone} />
                Holding everything else
              </span>
            ) : null}
          </div>
          <div style={{ position: "absolute", left: 20, right: 20, bottom: "var(--sab)", display: "flex", flexDirection: "column", gap: 16, animation: `nRise 0.5s ${ease} 0.1s both` }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", color: S.soft }}>{onBreak ? "ON A BREAK" : kicker}</div>
              <div style={{ marginTop: 8, fontSize: 28, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.02em" }}>{target.title}</div>
              <div style={{ marginTop: 8, fontSize: 17, color: "rgba(255,255,255,0.8)" }}>
                {onBreak ? "Paused" : "Remaining"} <span style={{ fontWeight: 700, color: "#fff" }}>{fmt(left)}</span>
              </div>
            </div>
            <div>
              <div role="progressbar" aria-label={`${Math.round(elapsed / 60)} of ${mins} minutes done`} aria-valuenow={pct} style={{ height: 12, borderRadius: 6, background: "rgba(255,255,255,0.16)", overflow: "hidden" }}>
                <div style={{ height: 12, width: `${pct}%`, background: S.tint, transition: "width 1s linear" }} />
              </div>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                <span>{session ? clock(new Date(startedAt)) : ""}</span>
                <span>{endsAt}</span>
              </div>
            </div>
            <button type="button" onClick={() => void toggleBreak()} style={{ height: 56, borderRadius: 28, background: S.tint, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>{onBreak ? "Back to focus" : "Take a 5-min break"}</button>
            <button type="button" onClick={() => { feel("warning"); setStep("leave"); }} style={{ marginTop: -8, height: 44, fontSize: 15, fontWeight: 600, color: "#FF9A9A", textAlign: "center" }}>End early</button>
          </div>
        </>
      ) : null}

      {step === "leave" ? (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", animation: "nFade 0.25s ease both" }} />
          <section aria-label="End early" style={{ position: "absolute", left: 12, right: 12, bottom: "calc(var(--sab) - 10px)", borderRadius: 28, background: "rgba(28,28,32,0.96)", border: "1px solid rgba(255,255,255,0.1)", padding: "28px 20px 8px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", animation: `nUp 0.4s ${ease} both` }}>
            <Stone w={56} h={51} bg={S.stone} />
            <div style={{ marginTop: 16, fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" }}>End focus now?</div>
            <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.45, color: "rgba(255,255,255,0.75)" }}>
              You focused <span style={{ color: "#fff", fontWeight: 600 }}>{Math.max(1, Math.round(elapsed / 60))} of {mins} minutes</span>. That still counts, and Navi keeps the rest for later.
            </p>
            <button type="button" onClick={() => { feel("select"); setStep("run"); }} style={{ marginTop: 24, alignSelf: "stretch", height: 56, borderRadius: 28, background: S.tint, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>Keep going</button>
            <button type="button" onClick={() => void finish("progress")} style={{ alignSelf: "stretch", height: 48, fontSize: 15, fontWeight: 600, color: "#FF9A9A", textAlign: "center" }}>End and save {Math.max(1, Math.round(elapsed / 60))} minute{Math.max(1, Math.round(elapsed / 60)) === 1 ? "" : "s"}</button>
          </section>
        </>
      ) : null}

      {step === "done" ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: "calc(var(--sat) + 70px)", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 24px", animation: `nRise 0.6s ${ease} both` }}>
            <Stone w={120} h={110} bg={S.stone} shadow={`0 30px 70px ${S.shadow}`} />
            <span style={{ marginTop: 24, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: "#CFF7A6" }}>KEPT</span>
            <div style={{ marginTop: 8, fontSize: 34, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.025em" }}>{focused} minute{focused === 1 ? "" : "s"} on {target.title}.</div>
          </div>
          <div style={{ position: "absolute", left: 20, right: 20, bottom: "var(--sab)", display: "flex", flexDirection: "column", gap: 4 }}>
            {target.taskId ? <p style={{ margin: "0 0 12px", fontSize: 17, lineHeight: 1.45, color: "rgba(255,255,255,0.85)" }}>Is it done, or is there more for later?</p> : null}
            <button type="button" onClick={() => void wrapUp(!!target.taskId)} style={{ height: 56, borderRadius: 28, background: S.tint, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center" }}>{target.taskId ? "Mark it done" : "Done"}</button>
            {target.taskId ? <button type="button" onClick={() => void wrapUp(false)} style={{ height: 48, fontSize: 15, color: "rgba(255,255,255,0.8)", textAlign: "center" }}>Still in progress</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const stepBtn: React.CSSProperties = { width: 44, height: 44, borderRadius: 22, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" };

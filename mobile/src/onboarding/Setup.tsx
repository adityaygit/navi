import { useEffect, useMemo, useRef, useState } from "react";
import type { MDay, MProposal } from "@shared/mobile-api-types";
import type { MWelcome, MWelcomeCompleted, MWelcomeStep, MWelcomeTalk } from "@shared/mobile-api-welcome";
import { api } from "../api/client";
import { useChat } from "../data/chat";
import { clock, weekday } from "../data/time";
import { feel } from "../native/haptics";
import { ensurePermission, notificationsAvailable } from "../native/notify";
import { setSetting } from "../native/settings";
import { blockLook, LockIcon } from "../plan/DayView";
import { SelectRow, TimeRow, clockLabel } from "../settings/parts";
import { Composer } from "../ui/Composer";
import { Orb } from "../ui/Orb";
import { Sheet } from "../ui/Sheet";
import { Thread, buildItems } from "../ui/Thread";
import { useToast } from "../ui/Toast";
import { VoiceScreen } from "../voice/VoiceScreen";
import { useMoment, usePalette } from "../theme/colour";
import { ease, glass, ink, meaning, skyFor } from "../theme/tokens";

// Setup (M6): the conversation sets Navi up. Quick setup (about a minute:
// basics, check-ins, first plan) or Talk it through (about five: say what
// your week looks like by voice or text, then turn on what Navi picked up).
// The step lives on the account, so it resumes anywhere ("Welcome back").
// Same steps and rules as the web's /welcome.

type Mode = "quick" | "talk";
const ORDER: Record<Mode, MWelcomeStep[]> = { talk: ["hello", "basics", "talk", "review", "notify", "plan"], quick: ["hello", "basics", "notify", "plan"] };
const KIND: Record<string, string> = { task: "To do", event: "In your calendar", routine: "Routines", goal: "Goals", project: "Projects", workspace: "Spaces", reminder: "Reminders", note: "Notes", memory: "About you", preference: "How you like things", question: "Questions" };
const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const h1: React.CSSProperties = { margin: 0, fontSize: 40, lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em" };
const black: React.CSSProperties = { height: 58, borderRadius: 29, background: ink.text, color: "#fff", fontSize: 17, fontWeight: 600, textAlign: "center", width: "100%" };
const quiet: React.CSSProperties = { height: 44, fontSize: 17, fontWeight: 600, color: ink.link, textAlign: "center", width: "100%" };

export function Setup({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [w, setW] = useState<MWelcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("talk");
  const [resume, setResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const booted = useRef(false);

  useEffect(() => {
    api<MWelcome>("/api/m/welcome")
      .then((x) => {
        setW(x);
        if (!booted.current) {
          booted.current = true;
          // Came back part-way through talking: offer to pick it up or finish quickly.
          if ((x.step === "talk" || x.step === "review") && (x.status === "in_progress" || x.status === "reviewing")) setResume(true);
          if (!x.step) onDone();
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [onDone]);

  const run = async (fn: () => Promise<MWelcome | void>, feelOk: "select" | "success" | "send" = "select") => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) setW(r);
      feel(feelOk);
    } catch (e) {
      feel("warning");
      toast((e as Error).message || "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const go = (step: MWelcomeStep | "done") => run(() => api<MWelcome>("/api/m/welcome/step", { body: { step } }));
  const finish = (acceptIds: string[]) =>
    run(async () => {
      const r = await api<MWelcomeCompleted>("/api/m/welcome/complete", { body: { acceptIds } });
      if (r.failed.length) toast(`${r.failed.length} couldn't be turned on. They're waiting in Inbox.`);
      return api<MWelcome>("/api/m/welcome");
    }, "success");
  const later = () =>
    run(async () => {
      await api("/api/m/welcome/skip", { body: { step: w?.step ?? "hello" } });
      onDone();
    });

  if (error)
    return (
      <Frame>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
          <h1 style={h1}>
            Setup is <span className="em">on its way</span>.
          </h1>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: ink.muted }}>{/not found/i.test(error) ? "It needs the newest version of Navi's server." : "Couldn't reach Navi. Check your connection."}</p>
        </div>
        <button type="button" onClick={onDone} style={black}>Open Navi for now</button>
      </Frame>
    );
  if (!w) return <Frame>{null}</Frame>;

  const step = w.step ?? "hello";
  const order = ORDER[mode];
  const at = Math.max(0, order.indexOf(step));
  const completed = w.status === "completed";
  const back = resume || step === "hello" || completed ? null : () => (step === "review" ? run(() => api<MWelcome>("/api/m/welcome/restart", { body: {} })) : go(order[Math.max(0, at - 1)]));
  const bar = <TopBar onBack={back} dots={order.length} at={at} onLater={completed ? null : later} />;

  if (resume)
    return (
      <Frame>
        <div style={{ paddingTop: 40, flex: 1, display: "flex", flexDirection: "column" }}>
          <OrbFor size={96} />
          <h1 style={{ ...h1, margin: "34px 0 0", fontSize: 44, lineHeight: 1 }}>
            Welcome back{w.firstName ? <>, <span className="em">{w.firstName}</span></> : null}.
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: 20, lineHeight: 1.35, fontWeight: 500, color: ink.soft }}>
            You stopped at {step === "review" ? "the review" : "Talk it through"}. {w.picked === 1 ? "1 thing" : `${w.picked} things`} picked up so far.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" onClick={() => { feel("select"); setMode("talk"); setResume(false); }} style={black}>Pick up where I left off</button>
          <button type="button" disabled={busy} onClick={() => { setMode("quick"); setResume(false); void finish([]); }} style={{ ...black, background: "#fff", color: ink.text, border: `1px solid ${ink.edge}` }}>
            Finish with quick setup
          </button>
        </div>
      </Frame>
    );

  if (step === "hello")
    return (
      <Frame bar={<TopBar onBack={null} dots={order.length} at={0} onLater={later} />}>
        <div style={{ paddingTop: 30, flex: 1, display: "flex", flexDirection: "column" }}>
          <OrbFor size={120} />
          <h1 style={{ ...h1, margin: "36px 0 0", fontSize: 46, lineHeight: 1 }}>
            Hi, I'm <span className="em">Navi</span>.
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: 20, lineHeight: 1.35, fontWeight: 500, color: ink.soft }}>Tell me about your week. I'll plan it with you.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(
            [
              ["quick", "Quick setup", "About a minute"],
              ["talk", "Talk it through", "About five minutes · the best plan"],
            ] as const
          ).map(([m, t, s], i) => (
            <button key={m} type="button" disabled={busy} onClick={() => { setMode(m); void go("basics"); }} style={{ height: 64, borderRadius: 32, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, ...(i ? { background: "#fff", border: `1px solid ${ink.edge}` } : { background: ink.text, color: "#fff" }) }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{t}</span>
              <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.8 }}>{s}</span>
            </button>
          ))}
        </div>
      </Frame>
    );

  if (step === "basics")
    return (
      <Basics
        bar={bar}
        initial={w.basics}
        busy={busy}
        cta={mode === "quick" ? "Continue" : "Continue to talk"}
        onSave={(b) =>
          run(async () => {
            const r = await api<MWelcome>("/api/m/welcome/basics", { body: b });
            if (mode !== "quick") return r;
            // Quick setup: nothing to review; finish and build the first plan.
            await api<MWelcomeCompleted>("/api/m/welcome/complete", { body: { acceptIds: [] } });
            return api<MWelcome>("/api/m/welcome");
          })
        }
      />
    );

  if (step === "talk") return <Talk bar={bar} busy={busy} onReview={() => run(() => api<MWelcome>("/api/m/welcome/talk-done", { body: {} }))} />;
  if (step === "review") return <Review bar={bar} busy={busy} onKeepTalking={() => run(() => api<MWelcome>("/api/m/welcome/restart", { body: {} }))} onFinish={finish} />;
  if (step === "notify")
    return (
      <Frame bar={bar}>
        <h1 style={h1}>
          When should I <span className="em">check in</span>?
        </h1>
        <div style={{ marginTop: 22, background: "#fff", borderRadius: 22, border: `1px solid ${ink.line}`, overflow: "hidden" }}>
          {[
            ["Morning plan", clockLabel(w.checkIn.morning)],
            ["Evening review", clockLabel(w.checkIn.evening)],
            ["Quiet from", w.checkIn.quietFrom ? clockLabel(w.checkIn.quietFrom) : "Off"],
          ].map(([t, v], i) => (
            <div key={t} style={{ minHeight: 58, padding: "0 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: i ? `1px solid ${ink.line}` : "none" }}>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{t}</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: ink.muted }}>{v}</span>
            </div>
          ))}
        </div>
        <p style={{ margin: "12px 6px 0", fontSize: 15, fontWeight: 500, color: ink.dim }}>You can change these in Settings, or just tell Navi.</p>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (notificationsAvailable) {
                const ok = await ensurePermission();
                setSetting("reminders", ok);
                if (!ok) toast("Notifications are off. You can turn them on in your phone's Settings.");
              }
              return api<MWelcome>("/api/m/welcome/step", { body: { step: "plan" } });
            }, "success")
          }
          style={black}
        >
          {notificationsAvailable ? "Allow notifications" : "Continue"}
        </button>
        {notificationsAvailable ? <button type="button" disabled={busy} onClick={() => void go("plan")} style={quiet}>Not now</button> : null}
      </Frame>
    );
  return <FirstPlan bar={bar} busy={busy} onOpen={() => run(async () => { await api("/api/m/welcome/step", { body: { step: "done" } }); onDone(); }, "success")} />;
}

function OrbFor({ size }: { size: number }) {
  const sky = skyFor(useMoment());
  return <Orb size={size} sky={sky} style={{ animation: `nOrbIn 0.7s ${ease} both` }} />;
}

/** The page: white, the step bar at the top, content, buttons at the bottom. */
function Frame({ bar, children }: { bar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label="Set up Navi" style={{ position: "absolute", inset: 0, zIndex: 30, background: ink.bg, display: "flex", flexDirection: "column", animation: "nFade 0.35s ease both" }}>
      {bar}
      <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: bar ? "20px 20px var(--sab)" : "calc(var(--sat) + 60px) 20px var(--sab)", boxSizing: "border-box", animation: `nRise 0.4s ${ease} both` }}>
        {children}
      </div>
    </section>
  );
}

function TopBar({ onBack, dots, at, onLater }: { onBack: (() => void) | null; dots: number; at: number; onLater: (() => void) | null }) {
  return (
    <div style={{ flex: "none", padding: "calc(var(--sat) + 4px) 16px 0 12px", height: 48, boxSizing: "content-box", display: "flex", alignItems: "center", gap: 12 }}>
      {onBack ? (
        <button type="button" aria-label="Back" onClick={() => { feel("select"); onBack(); }} style={{ ...glass, flex: "none", width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true"><path d="M10 2L3 9l7 7" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ) : (
        <span style={{ width: 48, flex: "none" }} />
      )}
      <div role="img" aria-label={`Step ${at + 1} of ${dots}`} style={{ flex: 1, display: "flex", gap: 5 }}>
        {Array.from({ length: dots }, (_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= at ? ink.text : "rgba(17,20,26,0.12)", transition: "background-color 0.3s" }} />)}
      </div>
      {onLater ? <button type="button" onClick={onLater} style={{ flex: "none", height: 44, padding: "0 4px", fontSize: 16, fontWeight: 600, color: ink.link }}>Later</button> : <span style={{ width: 40, flex: "none" }} />}
    </div>
  );
}

function Basics({ bar, initial, busy, cta, onSave }: { bar: React.ReactNode; initial: MWelcome["basics"]; busy: boolean; cta: string; onSave: (b: { name: string; timezone: string; wake: string; bed: string }) => void }) {
  const [name, setName] = useState(initial.name);
  // New accounts start on UTC; the phone knows better.
  const [timezone, setTimezone] = useState(initial.timezone === "UTC" ? phoneZone : initial.timezone);
  const [wake, setWake] = useState(initial.wake);
  const [bed, setBed] = useState(initial.bed);
  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return Array.from(new Set([timezone, phoneZone, ...list])).map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [timezone]);
  return (
    <Frame bar={bar}>
      <h1 style={h1}>
        The <span className="em">basics</span>.
      </h1>
      <label style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 6, fontSize: 15, fontWeight: 700, color: ink.muted }}>
        Your name
        <input value={name} autoComplete="name" placeholder="What should Navi call you?" onChange={(e) => setName(e.target.value)} style={{ height: 58, borderRadius: 20, border: `1px solid ${ink.edge}`, background: "#fff", padding: "0 18px", fontSize: 18, fontWeight: 600, outline: "none", color: ink.text }} />
      </label>
      <div className="ngroup" style={{ marginTop: 16, background: "#fff", borderRadius: 22, border: `1px solid ${ink.line}`, overflow: "hidden" }}>
        <SelectRow label="Time zone" value={timezone} display={timezone.replace(/_/g, " ").replace(/^.*\//, "")} options={zones} onChange={setTimezone} />
        <TimeRow label="Up at" value={wake} onChange={setWake} />
        <TimeRow label="In bed by" value={bed} onChange={setBed} />
      </div>
      <p style={{ margin: "12px 6px 0", fontSize: 15, fontWeight: 500, color: ink.dim }}>Navi only plans while you're up, and stays quiet after bedtime.</p>
      <div style={{ flex: 1, minHeight: 24 }} />
      <button type="button" disabled={busy || !name.trim()} onClick={() => onSave({ name: name.trim(), timezone, wake, bed })} style={{ ...black, opacity: busy || !name.trim() ? 0.5 : 1 }}>
        {busy ? "Saving…" : cta}
      </button>
    </Frame>
  );
}

function Talk({ bar, busy, onReview }: { bar: React.ReactNode; busy: boolean; onReview: () => void }) {
  const P = usePalette();
  // The setup conversation; `ver` reloads it after a voice session added turns.
  const [ver, setVer] = useState(0);
  const { state, sendText, undo, decide } = useChat(`onboarding-${ver}`, { kind: "onboarding" });
  const [picked, setPicked] = useState<MProposal[]>([]);
  const [tray, setTray] = useState(false);
  const [voice, setVoice] = useState(false);
  const items = buildItems(state.messages, state.actions, state.live);
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && !state.loading) seen.current = new Set(items.map((i) => i.key));
  const refresh = () => void api<MWelcomeTalk>("/api/m/welcome/talk").then((t) => setPicked(t.proposals)).catch(() => {});
  // What Navi picked up, after every answer.
  useEffect(refresh, [state.messages.length]);
  const empty = !items.length && !state.loading;

  return (
    <section aria-label="Talk it through" style={{ position: "absolute", inset: 0, zIndex: 30, background: ink.bg, display: "flex", flexDirection: "column" }}>
      {bar}
      <h1 style={{ ...h1, margin: "20px 20px 0", fontSize: empty ? 40 : 28, transition: `font-size 0.4s ${ease}` }}>
        What does your <span className="em">week</span> look like?
      </h1>
      {empty ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 24px", textAlign: "center" }}>
          <div aria-hidden="true" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {["Classes or work", "People", "Things due", "What you want more of"].map((t) => (
              <span key={t} style={{ height: 36, padding: "0 14px", borderRadius: 18, display: "flex", alignItems: "center", fontSize: 15, fontWeight: 600, background: "#fff", border: `1px solid ${ink.line}` }}>{t}</span>
            ))}
          </div>
          <OrbFor size={150} />
          <p style={{ margin: 0, maxWidth: 300, fontSize: 18, fontWeight: 600, color: ink.muted }}>Hold the orb to talk, or type below. Say it however it comes.</p>
        </div>
      ) : (
        <div className="scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column-reverse", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 24px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 24px)" }}>
          <div style={{ padding: "20px 16px 12px" }}>
            <Thread items={items} P={P} undone={state.undone} onUndo={undo} onDecide={decide} isNew={(k) => !!seen.current && !seen.current.has(k)} />
            {state.error ? <p role="alert" style={{ margin: "10px 4px 0", fontSize: 15, fontWeight: 500, color: meaning.slipping }}>{state.error}</p> : null}
          </div>
        </div>
      )}
      <div style={{ flex: "none", padding: "8px 12px var(--sab)", display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" onClick={() => { feel("select"); setTray(true); }} style={{ ...glass, height: 50, borderRadius: 25, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 16, fontWeight: 700 }}>
          {picked.length === 1 ? "1 thing picked up" : `${picked.length} things picked up`}
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <Composer palette={P} placeholder="Tell Navi about your week" onSend={(t) => void sendText(t, "Setup")} onVoice={() => setVoice(true)} />
      </div>
      {tray ? (
        <Sheet label="What Navi picked up" height="78%" onClose={() => setTray(false)}>
          {(close) => (
            <>
              <h2 style={{ margin: "8px 20px 6px", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>Picked up</h2>
              <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {!picked.length ? <p style={{ margin: "20px 6px", fontSize: 17, fontWeight: 500, color: ink.muted }}>Nothing yet. Tell Navi about a class, a deadline or a habit, and it shows up here.</p> : null}
                {groups(picked).map(([h, list]) => (
                  <div key={h} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ margin: "0 6px", fontSize: 15, fontWeight: 700, color: ink.muted }}>{h}</span>
                    <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden" }}>
                      {list.map((p, i) => (
                        <div key={p.id} style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 3, borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                          <span style={{ fontSize: 17, fontWeight: 600 }}>{p.title}</span>
                          {p.source_excerpt ? <span style={{ fontSize: 15, fontWeight: 500, color: ink.faint }}>“{p.source_excerpt}”</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: "0 16px 12px" }}>
                <button type="button" disabled={busy || !picked.length} onClick={() => { close(); onReview(); }} style={{ ...black, opacity: busy || !picked.length ? 0.5 : 1 }}>That's it for now</button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}
      {voice ? (
        <VoiceScreen
          kind="onboarding"
          conversationId={null}
          onConversation={() => {}}
          onSaved={refresh}
          onClose={() => {
            setVoice(false);
            setVer((v) => v + 1);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function groups(list: MProposal[]): [string, MProposal[]][] {
  const m = new Map<string, MProposal[]>();
  for (const p of list) {
    const h = p.area?.name ?? KIND[p.kind] ?? "Other";
    m.set(h, [...(m.get(h) ?? []), p]);
  }
  return [...m.entries()];
}

function Review({ bar, busy, onKeepTalking, onFinish }: { bar: React.ReactNode; busy: boolean; onKeepTalking: () => void; onFinish: (ids: string[]) => void }) {
  const [list, setList] = useState<MProposal[] | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  useEffect(() => {
    void api<MWelcomeTalk>("/api/m/welcome/talk")
      .then((t) => {
        const pending = t.proposals.filter((p) => p.status === "pending");
        setList(pending);
        // What you said is on; Navi's guesses wait for you to turn them on.
        setOn(new Set(pending.filter((p) => p.origin === "stated").map((p) => p.id)));
      })
      .catch(() => setList([]));
  }, []);
  const toggle = (id: string) => {
    feel("select");
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  return (
    <section aria-label="Review" style={{ position: "absolute", inset: 0, zIndex: 30, background: ink.bg, display: "flex", flexDirection: "column" }}>
      {bar}
      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "20px 16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <h1 style={{ ...h1, margin: "0 4px" }}>
          Turn on what's <span className="em">right</span>.
        </h1>
        {list === null ? <p style={{ margin: "10px 6px", fontSize: 17, fontWeight: 500, color: ink.faint }}>Loading…</p> : null}
        {list && !list.length ? <p style={{ margin: "10px 6px", fontSize: 17, fontWeight: 500, color: ink.muted }}>Nothing to turn on. Keep talking, or finish.</p> : null}
        {list
          ? groups(list).map(([h, items]) => (
              <div key={h} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ margin: "0 6px", fontSize: 15, fontWeight: 700, color: ink.muted }}>{h}</span>
                <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", border: `1px solid ${ink.line}` }}>
                  {items.map((p, i) => {
                    const v = on.has(p.id);
                    return (
                      <button key={p.id} type="button" role="switch" aria-checked={v} onClick={() => toggle(p.id)} style={{ width: "100%", minHeight: 58, padding: "8px 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left", borderTop: i ? `1px solid ${ink.line}` : "none" }}>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</span>
                          {p.origin === "inferred" ? <span style={{ fontSize: 14, fontWeight: 600, color: meaning.needsOk }}>Navi's guess · check it</span> : null}
                        </span>
                        <span aria-hidden="true" style={{ flex: "none", width: 50, height: 30, borderRadius: 15, background: v ? ink.text : "rgba(17,20,26,0.12)", position: "relative", transition: "background-color 0.2s" }}>
                          <span style={{ position: "absolute", top: 3, left: 3, width: 24, height: 24, borderRadius: 12, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transform: `translateX(${v ? 20 : 0}px)`, transition: `transform 0.2s ${ease}` }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          : null}
        <p style={{ margin: "0 6px", fontSize: 15, fontWeight: 500, color: ink.dim }}>Anything you leave off waits in Inbox.</p>
      </div>
      <div style={{ flex: "none", padding: "10px 16px var(--sab)", display: "flex", flexDirection: "column", gap: 4, background: "linear-gradient(180deg, rgba(251,251,253,0), #FBFBFD 30%)" }}>
        <button type="button" disabled={busy || list === null} onClick={() => onFinish([...on])} style={{ ...black, opacity: busy || list === null ? 0.5 : 1 }}>
          {busy ? "Setting up…" : on.size ? `Turn on ${on.size}` : "Finish without these"}
        </button>
        <button type="button" disabled={busy} onClick={onKeepTalking} style={quiet}>Keep talking</button>
      </div>
    </section>
  );
}

function FirstPlan({ bar, busy, onOpen }: { bar: React.ReactNode; busy: boolean; onOpen: () => void }) {
  const [day, setDay] = useState<MDay | null>(null);
  useEffect(() => {
    void api<MDay>("/api/m/day").then(setDay).catch(() => {});
  }, []);
  const items = (day?.items ?? []).filter((i) => !i.done && i.end > (day?.now ?? "")).slice(0, 6);
  return (
    <Frame bar={bar}>
      <h1 style={h1}>
        {day ? (items.length ? <>Your {day.isToday ? weekday(day.date) : "day"} is <span className="em">ready</span>.</> : <>Your day is <span className="em">open</span>.</>) : "Planning your day…"}
      </h1>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => (
          <div key={it.key} style={{ ...blockLook(it), minHeight: 58, borderRadius: 20, padding: "0 16px", display: "flex", alignItems: "center", gap: 12, animation: `nRise 0.4s ${ease} both` }}>
            <span style={{ width: 46, fontSize: 15, fontWeight: 600, color: ink.muted }}>{day ? clock(it.start, day.timezone) : ""}</span>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: it.space?.color || it.color || "#A3A8BF" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</span>
            {it.look === "fixed" ? <LockIcon /> : null}
          </div>
        ))}
        {day && !items.length ? <p style={{ margin: "4px 6px", fontSize: 17, fontWeight: 500, color: ink.muted }}>Nothing's planned yet. Tell Navi what's coming up and it'll find the time.</p> : null}
      </div>
      <div style={{ flex: 1, minHeight: 24 }} />
      <button type="button" disabled={busy} onClick={onOpen} style={black}>Open Navi</button>
    </Frame>
  );
}

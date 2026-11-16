import { useEffect, useRef } from "react";
import type { MDay, MLine } from "@shared/mobile-api-types";
import { useMe } from "../data/me";
import { useChat } from "../data/chat";
import { rememberChat } from "../data/chats";
import { useDay } from "../data/plan";
import { clockAmPm } from "../data/time";
import { Composer } from "../ui/Composer";
import { Thread, buildItems } from "../ui/Thread";
import { skyProps, useSkyOn } from "../ui/sky";
import { ease, glass, ink, momentAt, skyFor, type Palette } from "../theme/tokens";

// The Navi home (M6). With nothing to talk about: a calm, centred greeting
// over the sky, one line about the day, and what's now or next. Once a
// conversation starts it takes over and the sky settles into a wash at the top.

const greetWord = { morning: "Good morning,", afternoon: "Good afternoon,", evening: "Good evening,", night: "Good evening," } as const;

type Props = { palette: Palette; chatId: string | null; onChatId: (id: string | null) => void; onVoice: () => void; onOpenPlan?: () => void; /** Open with the keyboard up (after "Type instead" in voice). */ typeNow?: boolean };

/** The day's sentence, with the words that matter in italic. */
function Headline({ line }: { line: MLine | undefined }) {
  if (!line?.length) return null;
  return (
    <>
      {line.map((s, i) => (s.strong ? <span key={i} className="em">{s.text}</span> : <span key={i}>{s.text}</span>))}
    </>
  );
}

/** "Now · Econ lecture", "Next · Essay at 2:00 PM", or "Free till 1:00 PM". */
export function nowNext(d: MDay | null): string | null {
  if (!d?.isToday) return null;
  const tz = d.timezone;
  const now = d.items.find((it) => it.now && !it.done);
  if (now) return `Now · ${now.title}`;
  const t = new Date(d.now).getTime();
  const next = d.items.filter((it) => it.open && !it.done && new Date(it.start).getTime() > t).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!next) return null;
  const mins = Math.round((new Date(next.start).getTime() - t) / 60000);
  if (mins >= 30) return `Free till ${clockAmPm(next.start, tz)}`;
  return `Next · ${next.title} at ${clockAmPm(next.start, tz)}`;
}

export function ChatPage({ palette: P, chatId, onChatId, onVoice, onOpenPlan, typeNow }: Props) {
  const me = useMe();
  const { state, sendText, undo, decide } = useChat(chatId);
  const day = useDay(null);
  const skyOn = useSkyOn();
  const moment = momentAt();
  const first = me?.name?.split(/\s+/)[0];

  // A new chat gets its id from the server on the first message.
  useEffect(() => {
    if (!chatId && state.conversationId) onChatId(state.conversationId);
    if (state.conversationId) rememberChat(state.conversationId);
  }, [state.conversationId, chatId, onChatId]);

  // Only messages that arrive while you watch animate in.
  const seen = useRef<Set<string> | null>(null);
  const items = buildItems(state.messages, state.actions, state.live);
  if (seen.current === null && !state.loading) seen.current = new Set(items.map((i) => i.key));
  const isNew = (k: string) => !!seen.current && !seen.current.has(k);
  useEffect(() => {
    if (seen.current) items.forEach((i) => seen.current!.add(i.key));
  });

  const fresh = !state.conversationId && state.messages.length === 0 && !state.live;
  const sky = skyProps(skyFor(moment), skyOn);
  const pill = nowNext(day.data);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: ink.bg }}>
      {/* The sky: whole screen while there's nothing to talk about, a washed band once there is. */}
      <div aria-hidden="true" className={sky.className} style={{ ...sky.style, position: "absolute", left: -10, right: -10, top: fresh ? -20 : -70, height: fresh ? "calc(100% + 40px)" : 760, transition: `top 0.6s ${ease}, height 0.6s ${ease}` }} />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: fresh ? "linear-gradient(180deg, rgba(251,251,253,0.12) 0%, rgba(251,251,253,0.05) 40%, rgba(251,251,253,0.45) 72%, rgba(251,251,253,0.92) 92%, #FBFBFD 100%)" : P.scene, transition: "background 0.6s" }} />

      <div style={{ height: "calc(var(--sat) + 60px)", flex: "none" }} />
      {fresh ? (
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 24px 24px", textAlign: "center", animation: "nFade 0.5s ease both" }}>
          <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: 420, height: 300, margin: "-170px 0 0 -210px", background: "radial-gradient(closest-side, rgba(255,255,255,0.7), rgba(255,255,255,0))", filter: "blur(10px)" }} />
          <h1 style={{ position: "relative", margin: 0, fontSize: "clamp(36px, 11vw, 50px)", lineHeight: 1, fontWeight: 700, letterSpacing: "-0.04em", color: "#0E1116" }}>
            {greetWord[moment]}
            <br />
            <span className="em">{first ? `${first}.` : "there."}</span>
          </h1>
          {day.data?.headline?.length ? (
            <p style={{ position: "relative", margin: 0, fontSize: 20, lineHeight: 1.35, fontWeight: 500, color: ink.soft, maxWidth: 330 }}>
              <Headline line={day.data.headline} />
            </p>
          ) : null}
          {pill ? (
            <button type="button" onClick={onOpenPlan} style={{ ...glass, position: "relative", marginTop: 8, height: 44, padding: "0 16px 0 14px", borderRadius: 22, display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#1E9E6A" }} />
              {pill}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="scroll" style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column-reverse", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 28px)", maskImage: "linear-gradient(to bottom, transparent 0, #000 28px)" }}>
          <div style={{ padding: "28px 16px 24px" }}>
            {state.loading && !state.messages.length ? <p style={{ margin: 0, textAlign: "center", color: ink.faint, fontSize: 15, fontWeight: 500 }}>Opening your chat…</p> : null}
            <Thread items={items} P={P} undone={state.undone} onUndo={undo} onDecide={decide} isNew={isNew} />
          </div>
        </div>
      )}
      {state.error ? (
        <p role="alert" style={{ position: "relative", margin: "0 20px 4px", fontSize: 15, fontWeight: 500, color: "#B23A17", animation: "nRise 0.3s ease both" }}>{state.error}</p>
      ) : null}
      <div style={{ position: "relative", flex: "none", padding: "8px 12px var(--sab)" }}>
        <Composer palette={P} autoFocus={typeNow} onSend={(t) => void sendText(t)} onVoice={onVoice} />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { feel } from "../native/haptics";
import { Orb } from "../ui/Orb";
import { useExit } from "../ui/useExit";
import { useMoment } from "../theme/colour";
import { ease, glass, ink, meaning, skyFor } from "../theme/tokens";
import { LiveVoice, type VoiceLine, type VoiceStatus } from "./live";

// Voice (M6): white, Navi's orb in the middle, one line of what's being said,
// and three round buttons: mute, type instead, end. It talks in the same
// conversation as the chat, so everything said here is in the thread after.

type Props = {
  conversationId: string | null;
  /** "onboarding": the setup conversation. */
  kind?: "chat" | "onboarding";
  /** The conversation the voice turns go into (a new chat gets one). */
  onConversation: (id: string) => void;
  /** Something changed (a turn saved, a tool ran). */
  onSaved: () => void;
  /** typeInstead: go back to the chat with the keyboard. */
  onClose: (typeInstead: boolean) => void;
};

const STATUS: Record<VoiceStatus, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Navi is speaking",
  micpaused: "Microphone paused · tap to resume",
  reconnect: "Connection lost",
  ended: "Ended",
  error: "Voice stopped",
};

export function VoiceScreen({ conversationId, kind = "chat", onConversation, onSaved, onClose }: Props) {
  const sky = skyFor(useMoment());
  const { closing, close } = useExit(280);
  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const orb = useRef<HTMLDivElement>(null);
  const engine = useRef<LiveVoice | null>(null);
  const cb = useRef({ onConversation, onSaved });
  cb.current = { onConversation, onSaved };

  useEffect(() => {
    const v = new LiveVoice(conversationId, {
      status: setStatus,
      lines: setLines,
      error: setError,
      // The orb breathes with your voice: written straight to the element, no re-render per chunk.
      level: (l) => {
        if (orb.current) orb.current.style.transform = `scale(${1 + l * 0.09})`;
      },
      conversation: (id) => cb.current.onConversation(id),
      saved: () => cb.current.onSaved(),
    }, kind);
    engine.current = v;
    // A tick later, so a mount that's undone at once (React's dev double-mount) never opens a session.
    const t = window.setTimeout(() => void v.connect(), 0);
    return () => {
      window.clearTimeout(t);
      v.end();
    };
    // One session per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = (typeInstead: boolean) => {
    feel("end");
    engine.current?.end();
    close(() => onClose(typeInstead));
  };
  const toggleMute = () => {
    feel("select");
    const m = !muted;
    setMuted(m);
    engine.current?.setMuted(m);
  };

  const last = lines.at(-1);
  const live = status === "listening" || status === "speaking";
  const shown = muted && live ? "Muted" : STATUS[status];
  const round: React.CSSProperties = { width: 68, height: 68, borderRadius: 34, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${ink.edge}` };

  return (
    <section
      role="dialog"
      aria-label="Talking with Navi"
      onClick={() => engine.current?.resumeAudio()}
      style={{ position: "absolute", inset: 0, zIndex: 20, overflow: "hidden", background: ink.bg, display: "flex", flexDirection: "column", alignItems: "center", padding: "calc(var(--sat) + 4px) 24px var(--sab)", boxSizing: "border-box", animation: closing ? `nDim 0.28s ${ease} both` : "nFade 0.4s ease both" }}
    >
      <button type="button" aria-label="End and go back" onClick={() => leave(false)} style={{ ...glass, alignSelf: "flex-start", width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      <div style={{ flex: 1, minHeight: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 }}>
        <div ref={orb} style={{ transition: "transform 0.12s linear" }}>
          <Orb size={240} sky={sky} mode={muted || !live ? (status === "connecting" ? "idle" : "mute") : "talk"} style={{ animation: `nOrbIn 0.7s ${ease} both`, opacity: status === "connecting" ? 0.75 : 1, transition: "opacity 0.4s" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minHeight: 120, textAlign: "center" }}>
          <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 19, fontWeight: 600, color: ink.muted }}>
            {shown}
            {status === "connecting" ? null : live && !muted ? <span aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, marginLeft: 10, borderRadius: 4, background: status === "speaking" ? "#2B6FFF" : meaning.kept, verticalAlign: "middle", animation: "nPulse 1.4s ease-in-out infinite" }} /> : null}
          </p>
          {error ? (
            <p role="alert" style={{ margin: 0, maxWidth: 320, fontSize: 18, lineHeight: 1.35, fontWeight: 600, color: meaning.slipping }}>{error}</p>
          ) : last ? (
            <p key={lines.length} style={{ margin: 0, maxWidth: 330, fontSize: 22, lineHeight: 1.3, fontWeight: 600, color: last.who === "you" ? ink.soft : ink.text, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", animation: "nFade 0.3s ease both" }}>
              {last.who === "you" ? `“${last.text.trim()}”` : last.text.trim()}
            </p>
          ) : status === "listening" ? (
            <p style={{ margin: 0, fontSize: 22, lineHeight: 1.3, fontWeight: 600 }}>
              Say what's <span className="em">on your mind</span>.
            </p>
          ) : null}
          {status === "reconnect" || status === "error" ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); feel("select"); setError(null); engine.current?.reconnect(); }} style={{ ...glass, height: 46, padding: "0 20px", borderRadius: 23, fontSize: 16, fontWeight: 600 }}>
              Try again
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, paddingBottom: 6 }}>
        <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} style={{ ...round, background: muted ? ink.text : "#F0F2F6" }}>
          <svg width="20" height="22" viewBox="0 0 18 20" aria-hidden="true">
            <rect x="6" y="1.5" width="6" height="11" rx="3" fill="none" stroke={muted ? "#fff" : ink.text} strokeWidth="1.8" />
            <path d="M2.5 9.5a6.5 6.5 0 0013 0M9 16v2.5" fill="none" stroke={muted ? "#fff" : ink.text} strokeWidth="1.8" strokeLinecap="round" />
            {muted ? <path d="M2 2l14 16" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /> : null}
          </svg>
        </button>
        <button type="button" onClick={() => leave(true)} aria-label="Type instead" style={{ ...round, background: "#F0F2F6" }}>
          <svg width="22" height="16" viewBox="0 0 20 14" aria-hidden="true"><rect x="1" y="1" width="18" height="12" rx="3" fill="none" stroke={ink.text} strokeWidth="1.6" /><path d="M5 9.5h10" stroke={ink.text} strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
        <button type="button" onClick={() => leave(false)} aria-label="End" style={{ ...round, background: ink.text, border: "none" }}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 14, fontWeight: 500, color: ink.dim, textAlign: "center" }}>Saved to this chat as text. Audio isn't kept.</p>
    </section>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSpeechRecognition, speechRecognitionSupported, type SpeechRec } from "@/lib/speech";
import type { ToolEvent } from "@/lib/types";

type ToolReply = { id?: string; name?: string; response: Record<string, unknown> };

// Real-time two-way voice. Primary mode: Gemini Live over a WebSocket opened
// directly from the browser with a single-use ephemeral token (16 kHz PCM up,
// 24 kHz PCM down, server-side voice activity detection for natural turn
// taking and barge-in). Fallback mode, clearly labelled: browser speech
// recognition + speech synthesis through the normal text chat (not real-time).
// The microphone only starts on an explicit tap and its state is always shown.
// Raw audio is never stored; transcripts are saved to the shared conversation.

type Kind = "chat" | "onboarding";
type Status = "idle" | "connecting" | "listening" | "speaking" | "reconnect" | "ended" | "error";

// Inline AudioWorklet: forwards mic frames to the main thread.

function downsampleTo16k(input: Float32Array, rate: number): Int16Array {
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the samples that map onto this output sample (cheap low-pass).
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function VoiceSession({ kind, onClose, onTurnSaved }: { kind: Kind; onClose: () => void; onTurnSaved: () => void }) {
  const [mode, setMode] = useState<"live" | "browser" | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lines, setLines] = useState<{ who: "you" | "navi"; text: string }[]>([]);

  return (
    <section className="card flex flex-col gap-3 border-accent" aria-label="Voice conversation">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="h2">Talk to Navi</h2>
        <span className={`badge ${status === "listening" ? "badge-ok" : status === "speaking" ? "badge-accent" : status === "error" || status === "reconnect" ? "badge-danger" : ""}`} role="status" aria-live="polite">
          {mode === "browser" ? "Basic voice · " : ""}
          {{ idle: "Not started", connecting: "Connecting…", listening: muted ? "Muted" : "Listening", speaking: "Navi is speaking", reconnect: "Connection lost", ended: "Ended", error: "Error" }[status]}
        </span>
        {(status === "listening" || status === "speaking") && !muted && (
          <span className="flex items-center gap-1 text-xs text-danger" aria-label="Microphone is on"><span className="h-2 w-2 animate-pulse rounded-full bg-danger" /> mic on</span>
        )}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Close</button>
      </div>
      {mode === null && (
        <ModePicker
          onLive={() => setMode("live")}
          onBrowser={(reason) => { setNotice(reason); setMode("browser"); }}
          kind={kind}
        />
      )}
      {mode === "live" && (
        <LiveVoice
          kind={kind}
          muted={muted}
          setMuted={setMuted}
          setStatus={setStatus}
          setError={setError}
          setLines={setLines}
          onTurnSaved={onTurnSaved}
          onUnavailable={(reason) => { setNotice(reason); setMode("browser"); }}
        />
      )}
      {mode === "browser" && <BrowserVoice kind={kind} setStatus={setStatus} setError={setError} setLines={setLines} onTurnSaved={onTurnSaved} />}
      {notice && <p className="notice notice-warn text-xs">{notice}</p>}
      {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
      {lines.length > 0 && (
        <ol className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm" aria-label="Live transcript">
          {lines.slice(-12).map((l, i) => (
            <li key={i}><span className="font-medium">{l.who === "you" ? "You" : "Navi"}:</span> {l.text}</li>
          ))}
        </ol>
      )}
      <p className="muted text-xs">Voice audio is streamed to the voice provider for processing and isn't stored by Navi; transcripts are saved to this conversation. See Settings → Privacy for provider details.</p>
    </section>
  );
}

let primedOutput: AudioContext | null = null;
function primeOutputAudio() {
  if (primedOutput || typeof AudioContext === "undefined") return;
  primedOutput = new AudioContext({ sampleRate: 24000 });
  void primedOutput.resume().catch(() => {});
}

function ModePicker({ onLive, onBrowser, kind }: { onLive: () => void; onBrowser: (reason: string) => void; kind: Kind }) {
  const [checking, setChecking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={checking}
        onClick={async () => {
          // Create the speaker output inside the tap itself: iOS Safari keeps an
          // AudioContext created later (after awaits) suspended, i.e. silent.
          primeOutputAudio();
          // Probe availability without opening the mic yet.
          setChecking(true);
          const res = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, probe: true }) }).catch(() => null);
          setChecking(false);
          if (res?.ok) return onLive();
          const body = res ? await res.json().catch(() => ({})) : { error: "You appear to be offline. Voice needs an internet connection." };
          if (body.fallback === "browser") onBrowser(`Real-time voice isn't available (${String(body.error).replace(/\.$/, "")}). Using basic voice: your browser's speech recognition, one turn at a time, not real-time.`);
          else onBrowser(body.error ?? "Voice is unavailable right now.");
        }}
      >
        {checking ? "Checking…" : "Start talking"}
      </button>
      <span className="muted text-xs">The microphone turns on only after you tap.</span>
    </div>
  );
}

type Setters = {
  setStatus: (s: Status) => void;
  setError: (e: string | null) => void;
  setLines: React.Dispatch<React.SetStateAction<{ who: "you" | "navi"; text: string }[]>>;
  onTurnSaved: () => void;
};

function LiveVoice({ kind, muted, setMuted, setStatus, setError, setLines, onTurnSaved, onUnavailable }: Setters & { kind: Kind; muted: boolean; setMuted: (m: boolean) => void; onUnavailable: (reason: string) => void }) {
  const sessionRef = useRef<{ close: () => void; sendRealtimeInput: (p: unknown) => void; sendToolResponse: (p: unknown) => void } | null>(null);
  const micRef = useRef<{ stream: MediaStream; ctx: AudioContext; node: AudioWorkletNode } | null>(null);
  const outRef = useRef<{ ctx: AudioContext; next: number; sources: Set<AudioBufferSourceNode> } | null>(null);
  const turnRef = useRef({ user: "", navi: "", tools: [] as ToolEvent[], inSec: 0, outSec: 0 });
  const convRef = useRef<string | null>(null);
  const handleRef = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  const endedByUser = useRef(false);
  const startedRef = useRef(false);
  const connectRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const flushPlayback = useCallback(() => {
    const out = outRef.current;
    if (!out) return;
    for (const s of out.sources) { try { s.stop(); } catch {} }
    out.sources.clear();
    out.next = out.ctx.currentTime;
  }, []);

  const releaseMic = useCallback(() => {
    micRef.current?.node.disconnect();
    micRef.current?.stream.getTracks().forEach((t) => t.stop());
    void micRef.current?.ctx.close();
    micRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    releaseMic();
    flushPlayback();
    void outRef.current?.ctx.close();
    outRef.current = null;
  }, [flushPlayback, releaseMic]);

  const saveTurn = useCallback(async (interrupted = false) => {
    const t = turnRef.current;
    if (!convRef.current || (!t.user.trim() && !t.navi.trim() && !t.tools.length && !t.inSec)) return;
    turnRef.current = { user: "", navi: "", tools: [], inSec: 0, outSec: 0 };
    try {
      const res = await fetch("/api/voice/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: convRef.current, userText: t.user, assistantText: t.navi, toolEvents: t.tools, inputAudioSeconds: t.inSec, outputAudioSeconds: t.outSec, interrupted }),
      });
      const body = await res.json();
      onTurnSaved();
      if (body.budgetExceeded) {
        setError("Today's AI testing budget is used up, so voice was stopped. Your transcript is saved.");
        stopAll();
      }
    } catch {
      setError("Couldn't save the last voice turn (network). Keep talking; it will retry with the next turn.");
      turnRef.current.user = t.user + " " + turnRef.current.user;
      turnRef.current.navi = t.navi + " " + turnRef.current.navi;
    }
  }, [onTurnSaved, setError, stopAll]);


  // Results by call id: a call the service sends again (e.g. after resuming
  // a session) gets the first result instead of running a second time.
  const toolCalls = useRef(new Map<string, Promise<ToolReply>>());
  const runTool = useCallback((fc: { id?: string; name?: string; args?: Record<string, unknown> }) => {
    const seen = fc.id ? toolCalls.current.get(fc.id) : undefined;
    if (seen) return seen;
    const run = (async (): Promise<ToolReply> => {
      try {
        const res = await fetch("/api/voice/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: convRef.current, name: fc.name, args: fc.args ?? {} }) });
        const result = await res.json();
        if (!["get_overview", "recall", "search_items"].includes(fc.name ?? "")) {
          turnRef.current.tools.push({ name: fc.name ?? "tool", ok: Boolean(result.ok), summary: String(result.summary ?? result.error ?? "") });
        }
        if (result.mutated) onTurnSaved();
        return { id: fc.id, name: fc.name, response: { output: { ok: result.ok, summary: result.summary ?? result.error, data: result.data ?? null } } };
      } catch {
        // The request may have reached the server before the connection dropped.
        return { id: fc.id, name: fc.name, response: { error: "The connection dropped during this action, so it may or may not have gone through. Check with get_overview before trying again." } };
      }
    })();
    if (fc.id) toolCalls.current.set(fc.id, run);
    return run;
  }, [onTurnSaved]);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    endedByUser.current = false;
    const res = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, resumeHandle: handleRef.current }) }).catch(() => null);
    if (!res) { setStatus("reconnect"); setError("You're offline. Voice needs an internet connection."); return; }
    const body = await res.json();
    if (!res.ok) {
      if (body.fallback === "browser") return onUnavailable(`Real-time voice isn't available (${String(body.error).replace(/\.$/, "")}). Using basic voice instead.`);
      setStatus("error");
      setError(body.error ?? "Couldn't start voice");
      return;
    }
    convRef.current = body.conversationId;

    // Mic first, so a permission denial is reported before connecting.
    if (!micRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        const ctx = new AudioContext();
        await ctx.audioWorklet.addModule("/pcm-worklet.js");
        const src = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "navi-capture");
        src.connect(node);
        micRef.current = { stream, ctx, node };
        let pending: Float32Array[] = [];
        let pendingLen = 0;
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (mutedRef.current || !sessionRef.current) return;
          pending.push(e.data);
          pendingLen += e.data.length;
          // Send ~100ms chunks.
          if (pendingLen < ctx.sampleRate / 10) return;
          const merged = new Float32Array(pendingLen);
          let o = 0;
          for (const p of pending) { merged.set(p, o); o += p.length; }
          pending = [];
          pendingLen = 0;
          const pcm = downsampleTo16k(merged, ctx.sampleRate);
          turnRef.current.inSec += pcm.length / 16000;
          sessionRef.current.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } });
        };
      } catch (err) {
        setStatus("error");
        setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone permission was denied. Allow it in your browser settings to talk." : "Couldn't open the microphone.");
        return;
      }
    }
    if (!outRef.current) {
      const ctx = primedOutput ?? new AudioContext({ sampleRate: 24000 });
      primedOutput = null;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      outRef.current = { ctx, next: ctx.currentTime, sources: new Set() };
    }

    let mine: unknown = null;
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: body.token });
      const session = await ai.live.connect({
        model: body.model,
        config: body.config,
        callbacks: {
          onopen: () => setStatus("listening"),
          onmessage: (msg) => {
            if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) handleRef.current = msg.sessionResumptionUpdate.newHandle;
            if (msg.goAway) {
              // The service is about to close this session (e.g. ~10 min limit): resume seamlessly.
              void saveTurn().then(() => { sessionRef.current?.close(); sessionRef.current = null; void connectRef.current(); });
              return;
            }
            const sc = msg.serverContent;
            if (msg.toolCall?.functionCalls?.length) {
              void Promise.all(msg.toolCall.functionCalls.map(runTool)).then((functionResponses) => sessionRef.current?.sendToolResponse({ functionResponses }));
            }
            if (!sc) return;
            if (sc.interrupted) {
              // Barge-in: the user started talking, stop speaking immediately.
              flushPlayback();
              setStatus("listening");
              void saveTurn(true);
            }
            if (sc.inputTranscription?.text) {
              turnRef.current.user += sc.inputTranscription.text;
              setLines((l) => (l.at(-1)?.who === "you" ? [...l.slice(0, -1), { who: "you", text: l.at(-1)!.text + sc.inputTranscription!.text }] : [...l, { who: "you", text: sc.inputTranscription!.text! }]));
            }
            if (sc.outputTranscription?.text) {
              turnRef.current.navi += sc.outputTranscription.text;
              setLines((l) => (l.at(-1)?.who === "navi" ? [...l.slice(0, -1), { who: "navi", text: l.at(-1)!.text + sc.outputTranscription!.text }] : [...l, { who: "navi", text: sc.outputTranscription!.text! }]));
            }
            for (const part of sc.modelTurn?.parts ?? []) {
              const data = part.inlineData?.data;
              if (!data || !part.inlineData?.mimeType?.startsWith("audio/") || !outRef.current) continue;
              const bytes = fromBase64(data);
              const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
              const out = outRef.current;
              const buf = out.ctx.createBuffer(1, samples.length, 24000);
              const ch = buf.getChannelData(0);
              for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 0x8000;
              const node = out.ctx.createBufferSource();
              node.buffer = buf;
              node.connect(out.ctx.destination);
              const at = Math.max(out.next, out.ctx.currentTime);
              node.start(at);
              out.next = at + buf.duration;
              out.sources.add(node);
              node.onended = () => {
                out.sources.delete(node);
                if (out.sources.size === 0) setStatus("listening");
              };
              turnRef.current.outSec += buf.duration;
              setStatus("speaking");
            }
            if (sc.turnComplete) void saveTurn();
          },
          onerror: () => setError("Voice connection error."),
          onclose: () => {
            // Closed on purpose (ended, or replaced when resuming): nothing to do.
            if (!mine || sessionRef.current !== mine) return;
            // Lost unexpectedly: don't leave the microphone open while not connected.
            sessionRef.current = null;
            releaseMic();
            setStatus("reconnect");
            setError("Voice connection lost. The microphone is off; tap Reconnect to continue.");
            void saveTurn();
          },
        },
      });
      mine = session;
      sessionRef.current = session as unknown as typeof sessionRef.current;
    } catch (err) {
      setStatus("error");
      setError(`Couldn't connect to the voice service: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [kind, onUnavailable, runTool, saveTurn, flushPlayback, releaseMic, setError, setLines, setStatus]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);
  // Hang up only when this component unmounts. saveTurn/stopAll change
  // identity whenever the parent re-renders (e.g. after a saved turn), so the
  // cleanup reads the latest ones from refs instead of depending on them.
  const saveTurnRef = useRef(saveTurn);
  const stopAllRef = useRef(stopAll);
  useEffect(() => {
    saveTurnRef.current = saveTurn;
    stopAllRef.current = stopAll;
  }, [saveTurn, stopAll]);
  useEffect(() => () => { endedByUser.current = true; void saveTurnRef.current(); stopAllRef.current(); }, []);
  useEffect(() => {
    // The user already tapped "Start talking" to get here, so connect once on mount.
    if (startedRef.current) return;
    startedRef.current = true;
    void connect();
  }, [connect]);

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? "Unmute mic" : "Mute mic"}</button>
      <button type="button" className="btn" onClick={() => { flushPlayback(); }}>Stop Navi talking</button>
      <button type="button" className="btn" onClick={() => { endedByUser.current = false; const old = sessionRef.current; sessionRef.current = null; old?.close(); void connect(); }}>Reconnect</button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={async () => {
          endedByUser.current = true;
          await saveTurn();
          stopAll();
          setStatus("ended");
        }}
      >
        End voice
      </button>
    </div>
  );
}

/** Basic voice: browser speech recognition, one turn at a time, through the text chat. */
function BrowserVoice({ kind, setStatus, setError, setLines, onTurnSaved }: Setters & { kind: Kind }) {
  const recRef = useRef<SpeechRec | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const supported = speechRecognitionSupported();

  useEffect(() => () => { recRef.current?.abort(); window.speechSynthesis?.cancel(); }, []);

  async function send(text: string) {
    setStatus("speaking");
    setLines((l) => [...l, { who: "you", text }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, text, modality: "voice" }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Navi couldn't reply");
      const reply: string = body.assistantMessage.content;
      setLines((l) => [...l, { who: "navi", text: reply }]);
      onTurnSaved();
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(reply.replace(/^\[Simulated AI[^\]]*\]\s*/, ""));
        u.onend = () => setStatus("idle");
        window.speechSynthesis.speak(u);
      } else setStatus("idle");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Navi couldn't reply");
    }
  }

  function start() {
    if (!supported) return;
    window.speechSynthesis?.cancel(); // barge-in: stop Navi speaking when you start
    const rec = createSpeechRecognition();
    if (!rec) return;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setInterim(text);
    };
    rec.onerror = (e) => { setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech recognition error: ${e.error}`); setStatus("error"); };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) void send(finalText.trim());
      else setStatus("idle");
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    setStatus("listening");
    rec.start();
  }

  if (!supported) return <p className="notice notice-warn text-sm">This browser has no speech recognition, and real-time voice isn't configured on the server, so voice isn't available here. Typing works.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {!listening ? (
          <button type="button" className="btn btn-primary" onClick={start}>Tap and speak</button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => recRef.current?.stop()}>Done speaking</button>
        )}
        <button type="button" className="btn" onClick={() => { window.speechSynthesis?.cancel(); setStatus("idle"); }}>Stop Navi talking</button>
      </div>
      {interim && <p className="muted text-sm" aria-live="polite">“{interim}”</p>}
    </div>
  );
}

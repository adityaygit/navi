import type { ToolEvent } from "@shared/types";
import { toolEventOf } from "@shared/tool-events";
import { READ_ONLY_TOOLS } from "@shared/tool-names";
import { ApiError, api } from "../api/client";

// Real-time two-way voice on the phone: the same Gemini Live session as the
// web (src/components/voice-session.tsx). The server mints a single-use
// ephemeral token with the model, instructions and tools locked; the app
// streams 16 kHz PCM up and plays 24 kHz PCM down. Tool calls run on our
// server (/api/voice/tool) with the person's own permissions; each finished
// turn's transcript is saved into the same conversation as text chat
// (/api/voice/turn), so voice and text share one history. Raw audio is never
// stored. The microphone opens only after the person holds Talk.

export type VoiceStatus = "connecting" | "listening" | "speaking" | "micpaused" | "reconnect" | "ended" | "error";
export type VoiceLine = { who: "you" | "navi"; text: string };

type Session = { close: () => void; sendRealtimeInput: (p: unknown) => void; sendToolResponse: (p: unknown) => void };
type ToolReply = { id?: string; name?: string; response: Record<string, unknown> };
type SessionGrant = { token: string; model: string; config: Record<string, unknown>; conversationId: string; voiceSessionId: string | null };

const SILENCE_RMS = 0.0015;

// Audio contexts only run if made inside a gesture (iOS especially). Talk's
// pointer-down primes them; voice picks them up when it opens.
let primedOut: AudioContext | null = null;
let primedMic: AudioContext | null = null;
export function primeVoiceAudio(): void {
  if (typeof AudioContext === "undefined") return;
  if (!primedOut || primedOut.state === "closed") primedOut = new AudioContext({ sampleRate: 24000 });
  if (!primedMic || primedMic.state === "closed") primedMic = new AudioContext();
  void primedOut.resume().catch(() => {});
  void primedMic.resume().catch(() => {});
}
export function discardPrimedAudio(): void {
  void primedOut?.close().catch(() => {});
  void primedMic?.close().catch(() => {});
  primedOut = primedMic = null;
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}
function downsampleTo16k(input: Float32Array, rate: number): Int16Array {
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
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
/** How much of an interrupted reply had started playing. */
function heardLength(marks: { len: number; at: number }[], playedTo: number): number {
  let len = 0;
  for (const m of marks) {
    if (m.at > playedTo) break;
    len = m.len;
  }
  return len;
}

export type VoiceEvents = {
  status: (s: VoiceStatus) => void;
  lines: (l: VoiceLine[]) => void;
  error: (e: string | null) => void;
  /** 0..1, the microphone's level (for the orb). Only levels, never audio. */
  level: (v: number) => void;
  /** The conversation the turns are saved into (a new chat gets one on connect). */
  conversation: (id: string) => void;
  /** A turn was saved or a tool changed something: chat and plan should refresh. */
  saved: () => void;
};

export class LiveVoice {
  private status: VoiceStatus = "connecting";
  private lines: VoiceLine[] = [];
  private session: Session | null = null;
  private mic: { stream: MediaStream; ctx: AudioContext; node: AudioWorkletNode } | null = null;
  private out: { ctx: AudioContext; next: number; sources: Set<AudioBufferSourceNode> } | null = null;
  private turn = { user: "", navi: "", tools: [] as ToolEvent[], inSec: 0, outSec: 0, inTok: 0, outTok: 0, marks: [] as { len: number; at: number }[] };
  private conv: string | null;
  private voiceSession: string | null = null;
  private handle: string | null = null;
  private unsavedTurnId: string | null = null;
  private toolCalls = new Map<string, Promise<ToolReply>>();
  private muted = false;
  private ended = false;
  private peak = 0;

  constructor(conversationId: string | null, private on: VoiceEvents, private kind: "chat" | "onboarding" = "chat") {
    this.conv = conversationId;
  }

  private setStatus(s: VoiceStatus) {
    this.status = s;
    this.on.status(s);
  }
  private idle(): VoiceStatus {
    return this.mic && this.mic.ctx.state !== "running" ? "micpaused" : "listening";
  }
  private push(who: VoiceLine["who"], text: string) {
    const last = this.lines.at(-1);
    this.lines = last?.who === who ? [...this.lines.slice(0, -1), { who, text: last.text + text }] : [...this.lines, { who, text }];
    this.on.lines(this.lines);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.on.level(0);
  }

  /** From a tap: iOS only lets a paused audio context resume inside a gesture. */
  resumeAudio() {
    void this.out?.ctx.resume().catch(() => {});
    const mic = this.mic;
    if (!mic) return;
    void mic.ctx.resume().then(() => {
      if (this.mic === mic && mic.ctx.state === "running" && this.status === "micpaused") this.setStatus("listening");
    }).catch(() => {});
  }

  async connect(): Promise<void> {
    this.on.error(null);
    this.setStatus("connecting");
    let grant: SessionGrant;
    try {
      grant = await api<SessionGrant>("/api/voice/session", { body: { kind: this.kind, conversationId: this.conv, resumeHandle: this.handle } });
    } catch (e) {
      this.setStatus("error");
      if (e instanceof ApiError) this.on.error(e.status === 503 ? "Voice isn't switched on for Navi yet. You can type instead." : e.message);
      else this.on.error("You're offline. Voice needs a connection.");
      return;
    }
    if (this.ended) return void this.reportEnd(grant.voiceSessionId);
    this.conv = grant.conversationId;
    this.on.conversation(grant.conversationId);
    if (this.voiceSession && this.voiceSession !== grant.voiceSessionId) this.reportEnd(this.voiceSession);
    this.voiceSession = grant.voiceSessionId;

    if (!this.mic && !(await this.openMic())) return;
    if (!this.out) {
      const ctx = primedOut && primedOut.state !== "closed" ? primedOut : new AudioContext({ sampleRate: 24000 });
      primedOut = null;
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      this.out = { ctx, next: ctx.currentTime, sources: new Set() };
    }

    let mine: unknown = null;
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: grant.token, httpOptions: { apiVersion: "v1alpha" } });
      const session = await ai.live.connect({
        model: grant.model,
        config: grant.config,
        callbacks: {
          onopen: () => this.setStatus(this.idle()),
          onmessage: (msg) => this.onMessage(msg),
          onerror: () => this.on.error("Voice connection error."),
          onclose: () => {
            if (!mine || this.session !== mine) return; // closed on purpose
            this.session = null;
            this.releaseMic();
            void this.saveTurn();
            if (this.ended) return;
            this.setStatus("reconnect");
            this.on.error("The connection dropped. The microphone is off.");
          },
        },
      });
      mine = session;
      this.session = session as unknown as Session;
      if (this.ended) this.stopAll();
    } catch (e) {
      this.setStatus("error");
      this.on.error(`Couldn't reach the voice service: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async openMic(): Promise<boolean> {
    let ctx: AudioContext | null = primedMic && primedMic.state !== "closed" ? primedMic : null;
    primedMic = null;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      ctx ??= new AudioContext();
      await ctx.audioWorklet.addModule(new URL("./pcm-worklet.js", document.baseURI).href);
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "navi-capture");
      src.connect(node);
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the node rendered without sending the mic to the speaker
      node.connect(sink).connect(ctx.destination);
      const mic = { stream, ctx, node };
      this.mic = mic;
      ctx.onstatechange = () => {
        if (this.mic !== mic) return;
        if (mic.ctx.state !== "running" && (this.status === "listening" || this.status === "speaking")) this.setStatus("micpaused");
        else if (mic.ctx.state === "running" && this.status === "micpaused") this.setStatus("listening");
      };
      if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
      const rate = ctx.sampleRate;
      let pending: Float32Array[] = [];
      let len = 0;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (this.muted || !this.session) return;
        pending.push(e.data);
        len += e.data.length;
        if (len < rate / 10) return; // ~100 ms chunks
        const merged = new Float32Array(len);
        let o = 0;
        for (const p of pending) {
          merged.set(p, o);
          o += p.length;
        }
        pending = [];
        len = 0;
        const rms = rmsOf(merged);
        const lvl = rms < SILENCE_RMS ? 0 : Math.max(0.05, Math.min(1, (20 * Math.log10(rms) + 60) / 50));
        this.peak = Math.max(lvl, this.peak * 0.7);
        this.on.level(this.peak);
        const pcm = downsampleTo16k(merged, rate);
        this.turn.inSec += pcm.length / 16000;
        this.session.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } });
      };
      return true;
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      this.setStatus("error");
      this.on.error(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Navi can't use the microphone. Allow it in Settings to talk."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No microphone was found."
            : "Couldn't open the microphone.",
      );
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onMessage(msg: any) {
    const usage = msg.usageMetadata;
    if (usage) {
      this.turn.inTok += (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
      this.turn.outTok += (usage.responseTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    }
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) this.handle = msg.sessionResumptionUpdate.newHandle;
    if (msg.goAway) {
      // The service is about to close (session time limit): carry on in a new one.
      void this.saveTurn().then(() => {
        const s = this.session;
        this.session = null;
        s?.close();
        if (!this.ended) void this.connect();
      });
      return;
    }
    if (msg.toolCall?.functionCalls?.length) {
      void Promise.all(msg.toolCall.functionCalls.map((fc: { id?: string; name?: string; args?: Record<string, unknown> }) => this.runTool(fc))).then((functionResponses) => this.session?.sendToolResponse({ functionResponses }));
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      // Barge-in: stop speaking; keep only the part of the reply that was heard.
      const out = this.out;
      if (out) {
        const heard = heardLength(this.turn.marks, out.ctx.currentTime);
        const unheard = this.turn.navi.slice(heard);
        if (unheard.trim()) {
          this.turn.navi = this.turn.navi.slice(0, heard).trimEnd();
          const last = this.lines.at(-1);
          if (last?.who === "navi" && last.text.endsWith(unheard)) {
            this.lines = [...this.lines.slice(0, -1), { who: "navi", text: `${last.text.slice(0, -unheard.length).trimEnd()} …` }];
            this.on.lines(this.lines);
          }
        }
      }
      this.flush();
      this.setStatus(this.idle());
      void this.saveTurn(true);
    }
    if (sc.inputTranscription?.text) {
      this.turn.user += sc.inputTranscription.text;
      this.push("you", sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      this.turn.navi += sc.outputTranscription.text;
      const out = this.out;
      this.turn.marks.push({ len: this.turn.navi.length, at: out ? Math.max(out.next, out.ctx.currentTime) : 0 });
      this.push("navi", sc.outputTranscription.text);
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      const out = this.out;
      if (!data || !part.inlineData?.mimeType?.startsWith("audio/") || !out) continue;
      const bytes = fromBase64(data);
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
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
        if (out.sources.size === 0 && this.status === "speaking") this.setStatus(this.idle());
      };
      this.turn.outSec += buf.duration;
      if (this.status !== "speaking") this.setStatus("speaking");
    }
    if (sc.turnComplete) void this.saveTurn();
  }

  private runTool(fc: { id?: string; name?: string; args?: Record<string, unknown> }): Promise<ToolReply> {
    const seen = fc.id ? this.toolCalls.get(fc.id) : undefined;
    if (seen) return seen;
    const run = (async (): Promise<ToolReply> => {
      try {
        const result = await api<Record<string, unknown>>("/api/voice/tool", { body: { conversationId: this.conv, name: fc.name, args: fc.args ?? {}, userTranscript: this.turn.user } }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "failed" }) as Record<string, unknown>);
        if (!READ_ONLY_TOOLS.includes(fc.name ?? "")) {
          this.turn.tools.push(
            toolEventOf(fc.name ?? "tool", {
              ...(result as object),
              ok: Boolean(result.ok),
              summary: String(result.summary ?? result.error ?? "").slice(0, 500),
              actionId: typeof result.actionId === "string" ? result.actionId : null,
              undo: Array.isArray(result.undo) ? result.undo.map(String) : undefined,
            }),
          );
        }
        if (result.mutated) this.on.saved();
        return { id: fc.id, name: fc.name, response: { output: { ok: result.ok, summary: result.summary ?? result.error, action_id: result.actionId ?? null, data: result.data ?? null } } };
      } catch {
        return { id: fc.id, name: fc.name, response: { error: "The connection dropped during this action, so it may or may not have gone through. Check with get_inbox before trying again." } };
      }
    })();
    if (fc.id) this.toolCalls.set(fc.id, run);
    return run;
  }

  /** Saves the turn so far into the conversation; on failure it's kept and retried with the next turn. */
  private async saveTurn(interrupted = false): Promise<void> {
    const t = this.turn;
    if (!this.conv || (!t.user.trim() && !t.navi.trim() && !t.tools.length && !t.inSec && !t.inTok)) return;
    this.turn = { user: "", navi: "", tools: [], inSec: 0, outSec: 0, inTok: 0, outTok: 0, marks: [] };
    const clientTurnId = this.unsavedTurnId ?? crypto.randomUUID();
    this.unsavedTurnId = null;
    try {
      const body = await api<{ budgetExceeded?: boolean }>("/api/voice/turn", {
        body: { conversationId: this.conv, voiceSessionId: this.voiceSession, clientTurnId, userText: t.user, assistantText: t.navi, toolEvents: t.tools, inputAudioSeconds: t.inSec, outputAudioSeconds: t.outSec, inputTokens: t.inTok, outputTokens: t.outTok, interrupted },
      });
      this.on.saved();
      if (body.budgetExceeded) {
        this.on.error("Today's AI budget is used up, so voice stopped. What you said is saved.");
        this.end();
      }
    } catch (e) {
      this.unsavedTurnId ??= clientTurnId;
      this.on.error(`Couldn't save the last turn (${e instanceof Error ? e.message : "error"}). It will retry.`);
      const now = this.turn;
      this.turn = { user: `${t.user} ${now.user}`.trim(), navi: `${t.navi} ${now.navi}`.trim(), tools: [...t.tools, ...now.tools], inSec: t.inSec + now.inSec, outSec: t.outSec + now.outSec, inTok: t.inTok + now.inTok, outTok: t.outTok + now.outTok, marks: [] };
    }
  }

  private flush() {
    const out = this.out;
    if (!out) return;
    for (const s of out.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    out.sources.clear();
    out.next = out.ctx.currentTime;
  }
  private releaseMic() {
    this.mic?.node.disconnect();
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    void this.mic?.ctx.close().catch(() => {});
    this.mic = null;
    this.on.level(0);
  }
  private reportEnd(id: string | null) {
    if (id) void api("/api/voice/end", { body: { voiceSessionId: id } }).catch(() => {});
  }
  private stopAll() {
    const s = this.session;
    this.session = null;
    s?.close();
    this.releaseMic();
    this.flush();
    void this.out?.ctx.close().catch(() => {});
    this.out = null;
  }

  /** Hang up: the last turn is saved, then the session's budget reservation settles. */
  end() {
    if (this.ended) return;
    this.ended = true;
    const id = this.voiceSession;
    this.voiceSession = null;
    const saved = this.saveTurn();
    this.stopAll();
    void saved.finally(() => this.reportEnd(id));
    this.setStatus("ended");
  }

  /** After the connection dropped: a fresh microphone and session, from a tap. */
  reconnect() {
    primeVoiceAudio();
    this.resumeAudio();
    void this.connect();
  }
}

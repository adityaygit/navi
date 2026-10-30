// The browser's built-in speech recognition (Web Speech API). Audio is
// handled by the browser/OS speech service; Navi only receives the text.

export type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type SpeechWindow = { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };

/** A new recognizer, or null when this browser has none. */
export function createSpeechRecognition(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as SpeechWindow;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  return rec;
}

export function speechRecognitionSupported(): boolean {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

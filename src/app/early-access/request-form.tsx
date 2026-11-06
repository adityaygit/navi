"use client";
import { useState } from "react";

export function RequestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email"), website: form.get("website") }) });
      if (!res.ok) { setError((await res.json()).error ?? "Something went wrong. Try again."); setState("error"); return; }
      setState("sent");
    } catch {
      setError("You seem to be offline. Try again when you’re connected."); setState("error");
    }
  }
  if (state === "sent") return <p role="status" className="notice text-[15px] leading-relaxed">Check your inbox. We’ve sent a link to a short application. It expires in 14 days.</p>;
  return (
    <form onSubmit={submit} className="mt-2">
      <label htmlFor="ea-email" className="sr-only">Email address</label>
      <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 p-1 pl-5 focus-within:border-[rgba(143,184,255,0.6)]">
        <input id="ea-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#8b8e95] md:text-[15px]" />
        <button type="submit" disabled={state === "sending"} className="h-11 shrink-0 rounded-full bg-[#f2f2f2] px-5 text-sm font-semibold text-black transition-colors hover:bg-white disabled:opacity-60">{state === "sending" ? "Sending…" : "Request access"}</button>
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      {state === "error" && <p role="alert" className="mt-3 text-sm text-[#ff8f8a]">{error}</p>}
    </form>
  );
}

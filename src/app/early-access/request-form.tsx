"use client";
import { useState } from "react";
import { ArrowIcon, MailIcon } from "./icons";

export function RequestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
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
  if (state === "sent") {
    return (
      <div role="status" className="sky-ok">
        <span className="badge"><MailIcon /></span>
        <h2>Check your inbox.</h2>
        <p>We’ve sent a link to a short application to <b>{email.trim()}</b>. It expires in 14 days.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit}>
      <div className="sky-inline">
        <label htmlFor="ea-email" className="sr-only">Email address</label>
        <input id="ea-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="sky-btn" disabled={state === "sending"}>{state === "sending" ? "Sending…" : <>Join early access <ArrowIcon /></>}</button>
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sky-honeypot" />
      {state === "error" && <p role="alert" className="sky-err">{error}</p>}
    </form>
  );
}

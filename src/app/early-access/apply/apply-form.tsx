"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowIcon, CheckIcon, ClockIcon } from "../icons";

export function ApplyForm({ token, email }: { token: string; email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "approved" | "error">("idle");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("/api/waitlist/apply", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: f.get("name"), reason: f.get("reason"), use_case: f.get("use_case"), timezone: f.get("timezone"), referral: f.get("referral") }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Something went wrong. Try again."); setState("error"); return; }
      setState(json.outcome === "approved" ? "approved" : "done");
    } catch {
      setError("You seem to be offline. Try again when you’re connected."); setState("error");
    }
  }
  if (state === "approved") {
    return (
      <div role="status" className="sky-ok">
        <span className="badge"><CheckIcon /></span>
        <h2>You’re in.</h2>
        <p>We’ve emailed a sign-in link to <b>{email}</b>. Open it on this device to start.</p>
        <Link href="/login" className="sky-btn">Sign in to Navi <ArrowIcon /></Link>
      </div>
    );
  }
  if (state === "done") {
    return (
      <div role="status" className="sky-ok">
        <span className="badge wait"><ClockIcon /></span>
        <h2>Thanks. Your application is in.</h2>
        <p>We’ll email <b>{email}</b> when you’re approved. Nothing else to do for now.</p>
      </div>
    );
  }
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  return (
    <form onSubmit={submit} className="sky-form">
      <div className="sky-field"><label htmlFor="ap-name">Your name</label><input id="ap-name" name="name" required maxLength={120} autoComplete="name" /></div>
      <div className="sky-field"><label htmlFor="ap-reason">Why do you want Navi?</label><textarea id="ap-reason" name="reason" required minLength={10} maxLength={2000} /></div>
      <div className="sky-field"><label htmlFor="ap-use">What would you use it for first?</label><textarea id="ap-use" name="use_case" required minLength={10} maxLength={2000} placeholder="Work, a big goal, routines, keeping track of family plans…" /></div>
      <div className="sky-field"><label htmlFor="ap-tz">Your timezone</label><p id="ap-tz-hint" className="hint">We filled this in from your device. Change it if it’s wrong.</p><input id="ap-tz" name="timezone" required maxLength={64} defaultValue={tz} aria-describedby="ap-tz-hint" /></div>
      <div className="sky-field"><label htmlFor="ap-ref">How did you hear about Navi?<span className="opt">Optional</span></label><input id="ap-ref" name="referral" maxLength={300} /></div>
      {state === "error" && <p role="alert" className="sky-err" style={{ margin: 0 }}>{error}</p>}
      <div className="sky-form-foot">
        <button type="submit" className="sky-btn" disabled={state === "sending"}>{state === "sending" ? "Sending…" : <>Send application <ArrowIcon /></>}</button>
        <p>You can only send this once.</p>
      </div>
    </form>
  );
}

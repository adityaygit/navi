"use client";
import { useState } from "react";

const field = "w-full rounded-xl border border-[#2a2c31] bg-[#070708] px-4 py-3 text-base md:text-[15px] outline-none placeholder:text-[#6c6f76] focus:border-[#6c6f76]";
const label = "mb-2 block text-[15px] font-semibold";

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
  if (state === "approved") return <p role="status" className="text-[17px] leading-relaxed text-[#8f949b]">You’re in. We’ve emailed a sign-in link to {email}.</p>;
  if (state === "done") return <p role="status" className="text-[17px] leading-relaxed text-[#8f949b]">Thanks. Your application is in. We’ll email {email} when you’re approved.</p>;
  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  return (
    <form onSubmit={submit} className="grid gap-7">
      <div><label htmlFor="ap-name" className={label}>Your name</label><input id="ap-name" name="name" required maxLength={120} autoComplete="name" className={field} /></div>
      <div><label htmlFor="ap-reason" className={label}>Why do you want Navi?</label><textarea id="ap-reason" name="reason" required minLength={10} maxLength={2000} rows={4} className={field} /></div>
      <div><label htmlFor="ap-use" className={label}>What would you use it for first?</label><textarea id="ap-use" name="use_case" required minLength={10} maxLength={2000} rows={4} placeholder="Work, a big goal, routines, keeping track of family plans…" className={field} /></div>
      <div><label htmlFor="ap-tz" className={label}>Your timezone</label><input id="ap-tz" name="timezone" required maxLength={64} defaultValue={tz} className={field} /></div>
      <div><label htmlFor="ap-ref" className={label}>How did you hear about Navi? <span className="font-normal text-[#6c6f76]">Optional</span></label><input id="ap-ref" name="referral" maxLength={300} className={field} /></div>
      {state === "error" && <p role="alert" className="text-sm text-[#ff8f8a]">{error}</p>}
      <div><button type="submit" disabled={state === "sending"} className="h-11 rounded-full bg-[#f2f2f2] px-6 text-[15px] font-semibold text-black hover:bg-white disabled:opacity-60">{state === "sending" ? "Sending…" : "Send application"}</button></div>
    </form>
  );
}

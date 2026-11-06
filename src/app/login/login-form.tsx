"use client";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { clearDevicePrivateData } from "@/lib/device-privacy";
import { LOGIN_ERRORS, safeNext } from "@/lib/safe-next";

export function LoginForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const supabase = createSupabaseBrowser();
  // Whoever signs in next shouldn't see pages cached for someone whose session
  // ended without signing out (e.g. it expired).
  useEffect(clearDevicePrivateData, []);
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  // Fixed messages only: provider error text is never shown as-is.
  function explain(err: { message: string; status?: number; code?: string }) {
    if (err.status === 403 || /invite-only|access list|signups? not allowed|user not found/i.test(`${err.code ?? ""} ${err.message}`)) {
      return LOGIN_ERRORS.not_invited;
    }
    if (err.status === 429 || /rate limit|too many/i.test(err.message)) return "Too many attempts. Wait a minute and try again.";
    return "Sign-in didn't work. Check your connection and try again.";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    if (mode === "link") {
      // Existing (invited) accounts only: accounts are created by the owner,
      // server-side (scripts/allow-email.mjs add), never from this page.
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: false } });
      setMessage(error ? { kind: "error", text: explain(error) } : { kind: "ok", text: "Check your email for a sign-in link." });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error && /invalid login credentials/i.test(error.message)) {
        setMessage({ kind: "error", text: "Wrong email or password. No password yet? Sign in with an email link, then set one in Settings." });
      } else if (error) {
        setMessage({ kind: "error", text: explain(error) });
      } else {
        window.location.assign(safeNext(next, window.location.origin));
      }
    }
    setBusy(false);
  }

  async function google() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setMessage({ kind: "error", text: explain(error) });
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {googleEnabled && (
        <>
          <button type="button" className="btn w-full" onClick={google} disabled={busy}>
            <svg aria-hidden width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
            Continue with Google
          </button>
          <div className="flex items-center gap-3 text-[13px] text-dim" aria-hidden>
            <span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode === "password" && (
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <button type="submit" className="btn btn-primary mt-1 w-full" disabled={busy}>
          {busy ? "Working…" : mode === "link" ? "Email me a sign-in link" : "Sign in"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm self-center text-muted" onClick={() => { setMode(mode === "link" ? "password" : "link"); setMessage(null); }}>
          {mode === "link" ? "Use a password instead" : "Use an email link instead"}
        </button>
      </form>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`notice ${message.kind === "error" ? "notice-danger" : ""}`}>
          {message.text}
        </p>
      )}
      {!googleEnabled && <p className="dim text-center text-[13px]">Google sign-in appears here once it is configured for this deployment.</p>}
    </div>
  );
}

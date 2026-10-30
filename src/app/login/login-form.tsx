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
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <>
          <button type="button" className="btn w-full" onClick={google} disabled={busy}>
            Continue with Google
          </button>
          <div className="muted text-center text-xs">or</div>
        </>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode === "password" && (
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input id="password" type="password" required minLength={8} autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Working…" : mode === "link" ? "Email me a sign-in link" : "Sign in"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm self-center" onClick={() => setMode(mode === "link" ? "password" : "link")}>
          {mode === "link" ? "Use a password instead" : "Use an email link instead"}
        </button>
      </form>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`notice ${message.kind === "error" ? "notice-danger" : ""}`}>
          {message.text}
        </p>
      )}
      {!googleEnabled && <p className="muted text-xs">Google sign-in appears here once it is configured for this deployment.</p>}
    </div>
  );
}

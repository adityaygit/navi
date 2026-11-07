"use client";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { clearDevicePrivateData } from "@/lib/device-privacy";
import { LOGIN_ERRORS, safeNext } from "@/lib/safe-next";
import { Stone } from "@/components/shell/stone";

type Mode = "email" | "code" | "password";
const input = "h-[52px] w-full rounded-[26px] border border-white/[0.1] bg-[#0E0E10] px-5 text-[16px] text-text outline-none placeholder:text-dim focus:border-[color-mix(in_srgb,var(--navi-text)_55%,transparent)]";
const primary = "flex h-[52px] w-full items-center justify-center rounded-[26px] bg-text text-[16px] font-semibold text-black disabled:opacity-50";
const link = "text-[14px] text-muted underline underline-offset-4 hover:text-text";

/**
 * Sign in (Navi 1.5): Google, or email with a 6-digit code (default), or a
 * password (optional second way). No email links. Invite-only: accounts are
 * created by the owner (scripts/allow-email.mjs), never from this page.
 */
export function LoginForm({ next, googleEnabled, error }: { next: string; googleEnabled: boolean; error: string | null }) {
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(error ? { kind: "error", text: error } : null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const supabase = createSupabaseBrowser();
  // Whoever signs in next shouldn't see pages cached for someone whose session
  // ended without signing out (e.g. it expired).
  useEffect(clearDevicePrivateData, []);

  // Fixed messages only: provider error text is never shown as-is.
  function explain(err: { message: string; status?: number; code?: string }) {
    if (err.status === 403 || /invite-only|access list|signups? not allowed|user not found/i.test(`${err.code ?? ""} ${err.message}`)) return LOGIN_ERRORS.not_invited;
    if (err.status === 429 || /rate limit|too many/i.test(err.message)) return "Too many attempts. Wait a minute and try again.";
    if (/expired|invalid|otp/i.test(`${err.code ?? ""} ${err.message}`)) return "That code didn't work. Check it, or send a new one.";
    return "Sign-in didn't work. Check your connection and try again.";
  }
  const done = () => window.location.assign(safeNext(next, window.location.origin));

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: explain(error) });
    setDigits(["", "", "", "", "", ""]);
    setMode("code");
    setTimeout(() => boxes.current[0]?.focus(), 0);
  }

  async function verify(code: string) {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    if (error) {
      setBusy(false);
      setMessage({ kind: "error", text: explain(error) });
      setDigits(["", "", "", "", "", ""]);
      boxes.current[0]?.focus();
      return;
    }
    done();
  }

  function setDigit(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    const next = [...digits];
    if (clean.length > 1) {
      // A pasted (or autofilled) code fills the boxes from here on.
      for (let k = 0; k < clean.length && i + k < 6; k++) next[i + k] = clean[k];
    } else next[i] = clean;
    setDigits(next);
    const filled = next.findIndex((d) => !d);
    if (filled === -1) void verify(next.join(""));
    else if (clean) boxes.current[Math.min(5, clean.length > 1 ? filled : i + 1)]?.focus();
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return done();
    setBusy(false);
    setMessage({ kind: "error", text: /invalid login credentials/i.test(error.message) ? "Wrong email or password. No password yet? Sign in with a code, then add one in Settings." : explain(error) });
  }

  async function google() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) {
      setMessage({ kind: "error", text: explain(error) });
      setBusy(false);
    }
  }

  const note = message && (
    <p role={message.kind === "error" ? "alert" : "status"} className={`rounded-[16px] border px-4 py-3 text-[14px] ${message.kind === "error" ? "border-[rgba(255,143,138,0.4)] bg-[rgba(255,143,138,0.08)]" : "border-white/10 bg-white/[0.04]"}`}>
      {message.text}
    </p>
  );

  if (mode === "code") {
    return (
      <div className="flex flex-col items-center gap-6 text-center">
        <button type="button" onClick={() => { setMode("email"); setMessage(null); }} className="fixed left-6 top-6 flex h-10 items-center gap-1.5 rounded-[20px] bg-white/[0.06] px-4 text-[15px] md:left-10 md:top-8">
          <span aria-hidden="true">‹</span> Back
        </button>
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--navi-text)_10%,transparent)] text-[var(--navi-text)]" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
        </span>
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">Check your email</h1>
          <p className="mt-2 text-[17px] text-muted">We sent a 6-digit code to <span className="text-text">{email.trim()}</span></p>
        </div>
        <fieldset className="flex items-center gap-2.5" disabled={busy}>
          <legend className="sr-only">Your 6-digit code</legend>
          {digits.map((d, i) => (
            <span key={i} className="contents">
              {i === 3 && <span className="text-dim" aria-hidden="true">–</span>}
              <input
                ref={(el) => { boxes.current[i] = el; }}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  setDigit(i, e.clipboardData.getData("text"));
                }}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${i + 1}`}
                maxLength={6}
                className="h-[72px] w-[60px] rounded-[16px] border border-white/[0.1] bg-[#0E0E10] text-center text-[28px] font-semibold outline-none focus:border-[var(--navi-text)]"
              />
            </span>
          ))}
        </fieldset>
        <p className="text-[14px] text-dim">{busy ? "Signing you in…" : "You're signed in as soon as the last digit goes in. The code works for 10 minutes."}</p>
        {note}
        <div className="flex gap-6">
          <button type="button" className={link} disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
          <button type="button" className={link} onClick={() => { setMode("email"); setMessage(null); }}>Use a different email</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <Stone size={78} lit />
      <h1 className="mt-7 text-[36px] font-bold tracking-[-0.03em]">{mode === "password" ? "Welcome back" : "Welcome to Navi"}</h1>
      <p className="mt-2 text-[17px] text-muted">{mode === "password" ? "Sign in with your password." : "Your days, planned with you."}</p>
      <div className="mt-9 flex w-full flex-col gap-3">
        {note}
        {mode === "email" && googleEnabled && (
          <>
            <button type="button" onClick={google} disabled={busy} className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[26px] border border-white/[0.1] bg-[#1C1C1F] text-[16px] font-semibold disabled:opacity-50">
              <svg aria-hidden width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
              Continue with Google
            </button>
            <div className="my-1 flex items-center gap-3 text-[13px] text-dim" aria-hidden="true">
              <span className="h-px flex-1 bg-white/10" />or with email<span className="h-px flex-1 bg-white/10" />
            </div>
          </>
        )}
        {mode === "email" ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
            <label htmlFor="email" className="sr-only">Email</label>
            <input id="email" type="email" required autoComplete="email" placeholder="you@example.com" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className={primary} disabled={busy}>{busy ? "Sending…" : "Send me a code"}</button>
            <button type="button" className={`${link} mt-3 self-center`} onClick={() => { setMode("password"); setMessage(null); }}>Use a password instead</button>
          </form>
        ) : (
          <form className="flex flex-col gap-3 text-left" onSubmit={signInWithPassword}>
            <label htmlFor="email" className="pl-5 text-[13px] text-muted">Email</label>
            <input id="email" type="email" required autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password" className="mt-1 pl-5 text-[13px] text-muted">Password</label>
            <input id="password" type="password" required minLength={6} autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className={`${primary} mt-2`} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            <div className="mt-3 flex justify-between">
              <button type="button" className={link} onClick={() => { setMode("email"); setMessage(null); }}>Use a code instead</button>
              <button type="button" className={link} onClick={() => { setMode("email"); setMessage({ kind: "ok", text: "Forgot it? Sign in with a code, then set a new password in Settings." }); }}>Forgot password?</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

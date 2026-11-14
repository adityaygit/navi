import { useRef, useState } from "react";
import { supabase } from "./supabase";
import { feel } from "../native/haptics";
import { Stone } from "../ui/Stone";
import { ease, ink, momentAt, palettes } from "../theme/tokens";

// Same sign-in as the website: a 6-digit code by email, or a password.
// Navi is invite-only, so no account is created here.
type Step = "email" | "code" | "password";

export function SignIn() {
  const P = palettes[momentAt()];
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const fail = (msg: string) => {
    setError(msg);
    feel("warning");
  };

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/.+@.+\..+/.test(email.trim())) return fail("Enter the email you use for Navi.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return fail(/not found|signups not allowed|invite/i.test(error.message) ? "That email isn't on Navi yet." : error.message);
    feel("send");
    setStep("code");
    setTimeout(() => codeRef.current?.focus(), 350);
  }

  async function verify(token: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    setBusy(false);
    if (error) {
      setCode("");
      return fail("That code didn't work. Check the newest email, or send a new one.");
    }
    feel("success");
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return fail("Email or password didn't match.");
    feel("success");
  }

  const field: React.CSSProperties = { height: 56, boxSizing: "border-box", width: "100%", padding: "0 20px", borderRadius: 28, background: ink.field, border: `1px solid ${ink.edge}`, outline: "none", fontSize: 17 };
  const primary: React.CSSProperties = { height: 56, width: "100%", borderRadius: 28, background: P.cta, color: "#0B0B0C", fontSize: 17, fontWeight: 600, textAlign: "center", opacity: busy ? 0.6 : 1 };
  const quiet: React.CSSProperties = { height: 44, width: "100%", fontSize: 15, color: ink.muted, textAlign: "center" };

  return (
    <main style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "calc(var(--sat) + 24px) 24px calc(var(--sab) + 8px)", boxSizing: "border-box" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 520, background: P.scene, pointerEvents: "none" }} />
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <Stone w={96} h={88} bg={P.stone} shadow={`0 22px 50px ${P.stoneShadow}`} />
        <h1 style={{ margin: "24px 0 0", fontSize: 30, lineHeight: 1.22, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {step === "code" ? "Check your email." : "Welcome to Navi."}
        </h1>
        <p style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.45, color: ink.muted, maxWidth: 300 }}>
          {step === "code" ? `We sent a 6-digit code to ${email.trim()}.` : step === "password" ? "Sign in with your password." : "Sign in with the email you use for Navi."}
        </p>
      </div>

      <div key={step} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, animation: `nRise 0.32s ${ease} both` }}>
        {error ? (
          <p role="alert" style={{ margin: "0 0 4px", fontSize: 15, color: "#FF9A9A", textAlign: "center" }}>
            {error}
          </p>
        ) : null}
        {step === "email" ? (
          <form onSubmit={sendCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
            <button type="submit" disabled={busy} style={primary}>{busy ? "Sending…" : "Email me a code"}</button>
            <button type="button" onClick={() => { setError(null); setStep("password"); }} style={quiet}>Use a password instead</button>
          </form>
        ) : null}
        {step === "code" ? (
          <>
            <label style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} htmlFor="code">6-digit code</label>
            <input
              id="code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              style={{ ...field, textAlign: "center", fontSize: 28, fontWeight: 600, letterSpacing: "0.3em" }}
            />
            <button type="button" disabled={busy || code.length < 6} onClick={() => verify(code)} style={{ ...primary, opacity: busy || code.length < 6 ? 0.5 : 1 }}>{busy ? "Checking…" : "Sign in"}</button>
            <button type="button" onClick={() => sendCode()} style={quiet}>Send a new code</button>
            <button type="button" onClick={() => { setError(null); setCode(""); setStep("email"); }} style={{ ...quiet, marginTop: -8 }}>Use a different email</button>
          </>
        ) : null}
        {step === "password" ? (
          <form onSubmit={withPassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input aria-label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
            <input aria-label="Password" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
            <button type="submit" disabled={busy} style={primary}>{busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" onClick={() => { setError(null); setStep("email"); }} style={quiet}>Email me a code instead</button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

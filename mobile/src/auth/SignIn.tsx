import { useRef, useState } from "react";
import { supabase } from "./supabase";
import { feel } from "../native/haptics";
import { skyProps, useSkyOn } from "../ui/sky";
import { ease, glass, ink, meaning } from "../theme/tokens";

// Sign in (M6): the one setup screen with sky. Same sign-in as the website:
// a 6-digit code by email, or a password. Navi is invite-only, so no account
// is created here.
type Step = "start" | "email" | "code" | "password";

export function SignIn() {
  const skyOn = useSkyOn();
  const [step, setStep] = useState<Step>("start");
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

  const field: React.CSSProperties = { height: 58, boxSizing: "border-box", width: "100%", padding: "0 18px", borderRadius: 20, background: "#fff", border: `1px solid ${ink.edge}`, outline: "none", fontSize: 18, fontWeight: 500, color: ink.text };
  const primary: React.CSSProperties = { height: 58, width: "100%", borderRadius: 29, background: ink.text, color: "#FFFFFF", fontSize: 17, fontWeight: 600, textAlign: "center", opacity: busy ? 0.6 : 1 };
  const quiet: React.CSSProperties = { height: 44, width: "100%", fontSize: 17, fontWeight: 600, color: ink.link, textAlign: "center" };
  const label: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 15, fontWeight: 700, color: ink.muted };
  const h1: React.CSSProperties = { margin: 0, fontSize: 40, lineHeight: 1.02, fontWeight: 700, letterSpacing: "-0.035em" };
  const sky = skyProps("day", skyOn);
  const err = error ? <p role="alert" style={{ margin: 0, fontSize: 16, fontWeight: 500, color: meaning.slipping }}>{error}</p> : null;
  const goBack = () => {
    feel("select");
    setError(null);
    setCode("");
    setStep(step === "email" ? "start" : step === "password" ? "email" : "email");
  };

  if (step === "start")
    return (
      <main style={{ position: "absolute", inset: 0, background: ink.bg, overflow: "hidden" }}>
        <div aria-hidden="true" className={sky.className} style={{ ...sky.style, position: "absolute", left: 0, right: 0, top: 0, height: "66%" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "66%", background: "linear-gradient(180deg, rgba(251,251,253,0) 40%, rgba(251,251,253,0.85) 82%, #FBFBFD 100%)" }} />
        <div style={{ position: "absolute", left: 24, right: 24, top: "36%", display: "flex", flexDirection: "column", gap: 10, animation: `nRise 0.6s ${ease} both` }}>
          <h1 style={{ margin: 0, fontSize: 60, lineHeight: 0.95, fontWeight: 800, letterSpacing: "-0.05em", color: "#0E1116" }}>Navi</h1>
          <p style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.015em" }}>
            Your week, <span className="em">planned with you</span>.
          </p>
        </div>
        <div style={{ position: "absolute", left: 20, right: 20, bottom: "var(--sab)", display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" onClick={() => { feel("select"); setStep("email"); }} style={primary}>Continue with email</button>
          <p style={{ margin: "4px 0 0", textAlign: "center", fontSize: 15, fontWeight: 500, color: ink.dim }}>Navi is invite-only for now.</p>
        </div>
      </main>
    );

  return (
    <main style={{ position: "absolute", inset: 0, background: ink.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "none", padding: "calc(var(--sat) + 4px) 12px 0" }}>
        <button type="button" aria-label="Back" onClick={goBack} style={{ ...glass, width: 48, height: 48, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true"><path d="M10 2L3 9l7 7" fill="none" stroke={ink.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div key={step} className="scroll" style={{ flex: 1, minHeight: 0, padding: "28px 20px var(--sab)", display: "flex", flexDirection: "column", gap: 18, animation: `nRise 0.32s ${ease} both` }}>
        {step === "email" ? (
          <form onSubmit={sendCode} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
            <h1 style={h1}>
              What's your <span className="em">email</span>?
            </h1>
            <label style={label}>
              Email
              <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field} autoFocus />
            </label>
            {err}
            <div style={{ flex: 1 }} />
            <button type="submit" disabled={busy} style={primary}>{busy ? "Sending…" : "Send me a code"}</button>
            <button type="button" onClick={() => { setError(null); setStep("password"); }} style={quiet}>Use a password instead</button>
          </form>
        ) : null}
        {step === "code" ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 style={h1}>
                Check your <span className="em">email</span>.
              </h1>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: ink.muted }}>6 digits, sent to {email.trim()}</p>
            </div>
            <label style={{ position: "relative", display: "block" }}>
              <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>6-digit code</span>
              <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8 }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} style={{ height: 64, borderRadius: 18, background: "#fff", border: i === code.length ? `2px solid ${ink.text}` : `1px solid ${ink.edge}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>{code[i] ?? ""}</span>
                ))}
              </span>
              <input
                id="code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void verify(v);
                }}
                style={{ position: "absolute", inset: 0, opacity: 0, fontSize: 16, width: "100%", height: "100%", border: 0 }}
              />
            </label>
            {err}
            <button type="button" onClick={() => sendCode()} style={{ ...quiet, width: "auto", alignSelf: "flex-start" }}>Send a new code</button>
            <div style={{ flex: 1 }} />
            <button type="button" disabled={busy || code.length < 6} onClick={() => verify(code)} style={{ ...primary, opacity: busy || code.length < 6 ? 0.5 : 1 }}>{busy ? "Checking…" : "Continue"}</button>
          </>
        ) : null}
        {step === "password" ? (
          <form onSubmit={withPassword} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
            <h1 style={{ ...h1, marginBottom: 6 }}>Sign in</h1>
            <label style={label}>
              Email
              <input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
            </label>
            <label style={label}>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
            </label>
            {err}
            <div style={{ flex: 1 }} />
            <button type="submit" disabled={busy} style={primary}>{busy ? "Signing in…" : "Sign in"}</button>
            <button type="button" onClick={() => { setError(null); setStep("email"); }} style={quiet}>Email me a code instead</button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

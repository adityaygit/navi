import { useState } from "react";
import { supabase } from "../auth/supabase";
import { feel } from "../native/haptics";
import { useExit } from "../ui/useExit";
import { ease, ink, meaning, type Palette } from "../theme/tokens";

// Set or change the password (accounts start without one; the emailed code
// always works). Same rules and messages as the website.

export function PasswordSheet({ palette: P, onClose, onSaved }: { palette: Palette; onClose: () => void; onSaved: () => void }) {
  const { closing, close } = useExit(280);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shut = (after?: () => void) => close(() => { onClose(); after?.(); });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    if (pw !== again) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (!error) {
        feel("success");
        shut(onSaved);
        return;
      }
      const m = `${error.code ?? ""} ${error.message}`;
      if (/reauthenticat|recent/i.test(m)) setErr("For safety, sign out and back in with an emailed code, then set your password straight away.");
      else if (/same|different from the old/i.test(m)) setErr("That's already your password.");
      else if (/weak|short|characters/i.test(m)) setErr("That password is too weak. Try a longer one.");
      else setErr("Couldn't save the password. Try again.");
      feel("warning");
    } catch {
      setErr("No connection. Check your internet and try again.");
      feel("warning");
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { height: 56, boxSizing: "border-box", width: "100%", padding: "0 20px", borderRadius: 16, background: ink.field, border: `1px solid ${ink.edge}`, outline: "none", fontSize: 17, color: ink.text };
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
      <button type="button" aria-label="Close" onClick={() => shut()} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", animation: closing ? "nFadeOut 0.28s ease both" : "nFade 0.3s ease both" }} />
      <form role="dialog" aria-label="Password" onSubmit={submit} style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 20px calc(var(--sab) + 12px)", borderRadius: "32px 32px 0 0", background: "#141416", display: "flex", flexDirection: "column", gap: 12, animation: closing ? `nDown 0.28s ${ease} both` : `nUp 0.36s ${ease} both` }}>
        <span aria-hidden="true" style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.2)", marginBottom: 6 }} />
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" }}>Password</h2>
        <p style={{ margin: "0 0 4px", fontSize: 15, lineHeight: 1.45, color: ink.muted }}>Optional. The emailed code always works; a password lets you sign in without checking email.</p>
        <input aria-label="New password" placeholder="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={field} autoFocus />
        <input aria-label="Repeat new password" placeholder="Repeat new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} style={field} />
        {err ? <p role="alert" style={{ margin: 0, fontSize: 15, color: meaning.slipping }}>{err}</p> : null}
        <button type="submit" disabled={busy} style={{ height: 56, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 28, background: P.cta, color: "#0B0B0C", fontSize: 17, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </div>
  );
}

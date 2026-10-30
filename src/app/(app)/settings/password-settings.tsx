"use client";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { connectionError } from "@/lib/connection";

/**
 * Set or change the account password. Accounts are created without one
 * (server-side invite), so after signing in with an email link this is how
 * someone adds a password for next time.
 */
export function PasswordSettings() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) return setMsg({ kind: "error", text: "Use at least 8 characters." });
    if (password !== again) return setMsg({ kind: "error", text: "The two passwords don't match." });
    setBusy(true);
    try {
      const { error } = await createSupabaseBrowser().auth.updateUser({ password });
      if (!error) {
        setPassword("");
        setAgain("");
        setMsg({ kind: "ok", text: "Password saved. You can now sign in with it." });
      } else if (/reauthenticat|recent/i.test(`${error.code ?? ""} ${error.message}`)) {
        setMsg({ kind: "error", text: "For safety, sign out and sign back in with an email link, then set your password straight away." });
      } else if (/same|different from the old/i.test(error.message)) {
        setMsg({ kind: "error", text: "That's already your password." });
      } else if (/weak|short|characters/i.test(error.message)) {
        setMsg({ kind: "error", text: "That password is too weak. Try a longer one." });
      } else {
        setMsg({ kind: "error", text: "Couldn't save the password. Try again." });
      }
    } catch {
      setMsg({ kind: "error", text: connectionError() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex flex-col gap-2" aria-labelledby="pw-h">
      <h2 id="pw-h" className="h2">Password</h2>
      <p className="muted text-sm">Optional. Email links always work; a password lets you sign in without checking email.</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <div>
          <label htmlFor="new-password" className="label">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={8} required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-password-again" className="label">Repeat new password</label>
          <input id="new-password-again" type="password" autoComplete="new-password" minLength={8} required className="input" value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <button className="btn btn-sm self-start" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-danger" : ""}`}>{msg.text}</p>}
    </section>
  );
}

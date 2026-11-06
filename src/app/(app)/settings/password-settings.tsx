"use client";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { connectionError } from "@/lib/connection";
import { GROUP, Row, SectionHead } from "@/components/settings-ui";

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
    <section id="password" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="pw-h">
      <SectionHead id="pw-h" title="Password" desc="Optional. Email links always work; a password lets you sign in without checking email." />
      <form onSubmit={submit} className={GROUP}>
        <Row label="New password" htmlFor="new-password">
          <input id="new-password" type="password" autoComplete="new-password" minLength={8} required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Row>
        <Row label="Repeat new password" htmlFor="new-password-again">
          <input id="new-password-again" type="password" autoComplete="new-password" minLength={8} required className="input" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Row>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
          <button className="btn btn-sm" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
          {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-danger" : "text-focus"}`}>{msg.text}</p>}
        </div>
      </form>
    </section>
  );
}

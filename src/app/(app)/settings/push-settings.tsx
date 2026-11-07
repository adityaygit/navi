"use client";
import { connectionError } from "@/lib/connection";
import { useEffect, useState } from "react";
import { enablePush, pushSupport } from "@/lib/push-client";

/** Opt-in web push for this device, with honest platform guidance. */
export function PushSettings({ configured }: { configured: boolean }) {
  const [state, setState] = useState<"checking" | "unsupported" | "needs-install" | "denied" | "off" | "on">("checking");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushSupport().then(setState);
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next !== "on") return;
      setMsg("Notifications enabled on this device.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // Tell the server first, so it stops sending even if this device can't unsubscribe.
        const res = await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (!res.ok) throw new Error("Couldn't turn off notifications on the server");
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setMsg(err instanceof TypeError ? connectionError() : err instanceof Error ? err.message : connectionError());
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = await res.json();
      setMsg(res.ok ? `Test sent to ${body.sent} device(s)${body.failed ? `, ${body.failed} failed` : ""}.` : body.error);
    } catch {
      setMsg(connectionError());
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return <p className="px-4 py-3.5 text-sm text-recovery sm:px-5">Push isn&apos;t configured on this server yet (VAPID keys missing). Briefings still appear in the app.</p>;
  const status = state === "checking" ? "Checking…" : state === "on" ? "Notifications on" : state === "off" ? "Notifications off" : state === "denied" ? "Blocked in browser/OS settings" : state === "needs-install" ? "On iPhone, install Navi to your Home Screen first (Share → Add to Home Screen), then open it from there" : "This browser doesn't support web push";
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium">This device</span>
        <span role="status" className={`text-[13px] leading-snug ${state === "on" ? "text-focus" : state === "denied" ? "text-recovery" : "muted"}`}>{status}</span>
        {msg && <span role="status" className="text-[13px] leading-snug">{msg}</span>}
      </div>
      {(state === "off" || state === "on") && <div className="flex shrink-0 flex-wrap gap-2">
        {state === "off" && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={enable}>Enable notifications</button>}
        {state === "on" && <><button type="button" className="btn btn-sm" disabled={busy} onClick={test}>Send test</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={disable}>Turn off on this device</button></>}
      </div>}
    </div>
  );
}

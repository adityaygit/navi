"use client";
import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Opt-in web push for this device, with honest platform guidance. */
export function PushSettings({ configured }: { configured: boolean }) {
  const [state, setState] = useState<"checking" | "unsupported" | "needs-install" | "denied" | "off" | "on">("checking");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save subscription");
      setState("on");
      setMsg("Notifications enabled on this device.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = await res.json();
    setMsg(res.ok ? `Test sent to ${body.sent} device(s)${body.failed ? `, ${body.failed} failed` : ""}.` : body.error);
    setBusy(false);
  }

  if (!configured) return <p className="notice notice-warn text-sm">Push isn't configured on this server yet (VAPID keys missing). Briefings still appear in the app.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" role="status">
        This device:{" "}
        {state === "checking" ? "checking…" : state === "on" ? "notifications on" : state === "off" ? "notifications off" : state === "denied" ? "blocked in browser/OS settings" : state === "needs-install" ? "on iPhone, install Navi to your Home Screen first (Share → Add to Home Screen), then open it from there" : "this browser doesn't support web push"}
      </p>
      <div className="flex flex-wrap gap-2">
        {state === "off" && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={enable}>Enable notifications</button>}
        {state === "on" && <><button type="button" className="btn btn-sm" disabled={busy} onClick={test}>Send test</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={disable}>Turn off on this device</button></>}
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}

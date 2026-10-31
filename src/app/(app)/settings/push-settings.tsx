"use client";
import { connectionError } from "@/lib/connection";
import { useEffect, useState } from "react";
import { publicEnv } from "@/lib/env";
import { NOTIFICATION_STATUS_TEXT, type NotificationStatus } from "@/lib/push-diagnostics";

type Device = { id: string; service: string; device: string; addedAt: string; lastSuccessAt: string | null; lastError: string | null; thisDevice: boolean };
type Recent = { id: string; kind: string; title: string; status: NotificationStatus; attempts: number; last_error: string | null; created_at: string; deliver_after: string; sent_at: string | null };
type Status = { thisDeviceRegistered: boolean; devices: Device[]; recent: Recent[] };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function fetchStatus(endpoint: string | null): Promise<Status> {
  const res = await fetch("/api/push/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }) });
  if (!res.ok) throw new Error("Couldn't load delivery details");
  return res.json();
}

async function saveSubscription(sub: PushSubscription) {
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save subscription");
}

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
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);

  async function refresh(endpoint: string | null) {
    try {
      setStatus(await fetchStatus(endpoint));
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }

  async function currentSubscription() {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  }

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "needs-install" : "unsupported");
        if (configured) await refresh(null);
        return;
      }
      if (Notification.permission === "denied") setState("denied");
      const sub = await currentSubscription();
      if (Notification.permission !== "denied") setState(sub ? "on" : "off");
      if (!configured) return;
      let s: Status;
      try {
        s = await fetchStatus(sub?.endpoint ?? null);
      } catch {
        setStatusError(true);
        return;
      }
      // The browser still has a subscription but Navi lost it (removed after a
      // failure, or from another device): register it again so pushes arrive.
      if (sub && !s.thisDeviceRegistered && Notification.permission === "granted") {
        try {
          await saveSubscription(sub);
          s = await fetchStatus(sub.endpoint);
          setMsg("This device had dropped off Navi's delivery list, so it was registered again.");
        } catch {
          setMsg("This device isn't on Navi's delivery list. Turn notifications off and on again to fix it.");
        }
      }
      setStatus(s);
    })();
  }, [configured]);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicEnv.vapidPublicKey) });
      await saveSubscription(sub);
      setState("on");
      setMsg("Notifications enabled on this device.");
      await refresh(sub.endpoint);
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
      await refresh(null);
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
      await refresh((await currentSubscription())?.endpoint ?? null);
    } catch {
      setMsg(connectionError());
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(d: Device) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/push/status", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: d.id }) });
      if (!res.ok) throw new Error();
      if (d.thisDevice) {
        await (await currentSubscription())?.unsubscribe();
        setState("off");
      }
      await refresh(d.thisDevice ? null : ((await currentSubscription())?.endpoint ?? null));
    } catch {
      setMsg("Couldn't remove that device. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
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
      <details className="text-sm">
        <summary className="cursor-pointer py-2">Delivery details</summary>
        {statusError && <p className="notice notice-warn">Couldn&apos;t load delivery details. Check your connection.</p>}
        {!status && !statusError && <p className="text-muted">Loading…</p>}
        {status && (
          <div className="flex flex-col gap-3 pt-1">
            <section aria-label="Devices with notifications on">
              <h3 className="font-medium">Devices ({status.devices.length})</h3>
              {status.devices.length === 0 ? (
                <p className="text-muted">No device has notifications on. Briefings still appear in the app.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {status.devices.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {d.device} · {d.service}{d.thisDevice ? " (this device)" : ""}
                        <br />
                        <span className="text-muted">
                          Added {when(d.addedAt)} · {d.lastSuccessAt ? `last delivered ${when(d.lastSuccessAt)}` : "nothing delivered yet"}
                          {d.lastError ? ` · last problem: ${d.lastError}` : ""}
                        </span>
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeDevice(d)} aria-label={`Remove ${d.device}${d.thisDevice ? " (this device)" : ""}`}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Recent notifications">
              <h3 className="font-medium">Recent notifications</h3>
              {status.recent.length === 0 ? (
                <p className="text-muted">None yet. Briefings, reviews and deadline reminders will show here.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {status.recent.map((n) => (
                    <li key={n.id}>
                      {n.title} <span className="text-muted">· {when(n.created_at)} · {NOTIFICATION_STATUS_TEXT[n.status] ?? n.status}{n.status === "failed" && n.last_error ? ` (${n.last_error})` : ""}{n.status === "held_quiet_hours" ? `, sends after ${when(n.deliver_after)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </details>
    </div>
  );
}

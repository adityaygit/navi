"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { flushQueue } from "@/lib/offline-queue";
import { adoptBrowserTimezoneAction } from "@/app/(app)/client-actions";

// Keeps every open view in sync with persisted data: refreshes after changes
// made elsewhere (chat, voice, other tabs), syncs the offline queue when the
// connection returns, and registers the service worker.
export function LiveRefresh({ adoptTimezone }: { adoptTimezone: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const online = () => void flushQueue().then(refresh);
    const visible = () => document.visibilityState === "visible" && online();
    window.addEventListener("navi:changed", refresh);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("navi");
      channel.onmessage = refresh;
    } catch {}
    void flushQueue();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    if (adoptTimezone) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone && zone !== "UTC") void adoptBrowserTimezoneAction(zone).then(refresh);
    }
    return () => {
      window.removeEventListener("navi:changed", refresh);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [router, adoptTimezone]);
  return null;
}

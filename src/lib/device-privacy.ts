"use client";
import { clearOwnQueue } from "./offline-queue";

/**
 * Forget this person's private data on this device: cached pages and drafts.
 * The page cache is cleared from here as well as by the service worker, so it
 * also works when the page isn't (yet) controlled by the worker.
 */
export function clearDevicePrivateData() {
  navigator.serviceWorker?.controller?.postMessage("clear-private-cache");
  if ("caches" in window) {
    void caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.endsWith("-pages")).map((k) => caches.delete(k))))
      .catch(() => {});
  }
  try {
    for (const key of ["navi:capture-draft", "navi:chat-draft:chat", "navi:chat-draft:onboarding"]) localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): nothing stored to clear.
  }
}

/** After deleting the account, also drop its unsent offline captures. */
export async function clearDeviceDataForDeletedAccount() {
  clearDevicePrivateData();
  await clearOwnQueue().catch(() => {});
}

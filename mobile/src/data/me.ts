import { useEffect, useSyncExternalStore } from "react";
import type { MMe, MSettingsPatch } from "@shared/mobile-api-types";
import { api } from "../api/client";
import { supabase } from "../auth/supabase";
import { rememberColour } from "../theme/colour";

// The signed-in person's profile and settings, shared by every screen.
// Settings save optimistically: the screen changes at once and rolls back
// (with the server's message) if the save fails.

export type Me = MMe;

let current: MMe | null = null;
let fallbackName: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: MMe | null) {
  current = next;
  if (next) rememberColour({ followsDay: next.colourFollowsDay !== false, color: next.naviColor });
  listeners.forEach((l) => l());
}

export function refreshMe(): Promise<void> {
  loading ??= api<MMe>("/api/m/me")
    .then(set)
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The full profile, or null until the server answers. */
export function useProfile(): MMe | null {
  const me = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!current) void refreshMe();
  }, []);
  return me;
}

/** Name and time zone, with the sign-in record as a stand-in until the server answers. */
export function useMe(): { name: string | null; timezone: string } | null {
  const me = useProfile();
  useEffect(() => {
    if (fallbackName !== null) return;
    void supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata as { full_name?: string; name?: string } | undefined;
      fallbackName = meta?.full_name ?? meta?.name ?? "";
      listeners.forEach((l) => l());
    });
  }, []);
  if (me) return { name: me.displayName, timezone: me.timezone };
  return fallbackName !== null ? { name: fallbackName || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null;
}

/** Applies a change at once, saves it, and rolls back if the server refuses. */
export async function saveSettings(patch: MSettingsPatch, optimistic?: Partial<MMe>): Promise<void> {
  const before = current;
  if (current && optimistic) set({ ...current, ...optimistic });
  try {
    set(await api<MMe>("/api/m/settings", { method: "PATCH", body: patch }));
  } catch (e) {
    set(before);
    throw e;
  }
}

/** Sign-out clears the cached profile. */
export function forgetMe() {
  set(null);
}


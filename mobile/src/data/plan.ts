import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { MDay, MInbox, MTaskGroups, MWeek, MOk, MTaskChange, MBlockOutcome } from "@shared/mobile-api-types";

// Plan data: one small hook per view. Each keeps the last good answer while it
// refreshes, so switching views never flashes an empty screen.

type Res<T> = { data: T | null; error: string | null; loading: boolean; refresh: () => Promise<void> };

function useResource<T>(path: string | null): Res<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const latest = useRef(path);
  latest.current = path;
  const refresh = useCallback(async () => {
    const p = latest.current;
    if (!p) return;
    setLoading(true);
    try {
      const d = await api<T>(p);
      if (latest.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (latest.current === p) setError((e as Error).message);
    } finally {
      if (latest.current === p) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [path, refresh]);
  return { data, error, loading, refresh };
}

export const useDay = (date: string | null) => useResource<MDay>(date ? `/api/m/day?date=${date}` : "/api/m/day");
export const useWeek = (start: string | null) => useResource<MWeek>(start ? `/api/m/week?start=${start}` : "/api/m/week");
export const useTasks = (on: boolean) => useResource<MTaskGroups>(on ? "/api/m/tasks" : null);
export const useInbox = () => useResource<MInbox>("/api/m/inbox");

export const planActions = {
  placeTask: (taskId: string, startsAt: string, minutes: number) => api<MOk>(`/api/m/tasks/${taskId}/place`, { body: { startsAt, minutes } }),
  blockOutcome: (blockId: string, body: MBlockOutcome) => api<MOk>(`/api/m/blocks/${blockId}/outcome`, { body }),
  completeTask: (taskId: string) => api<MTaskChange>(`/api/m/tasks/${taskId}/complete`, { body: {} }),
  uncompleteTask: (taskId: string) => api<MTaskChange>(`/api/m/tasks/${taskId}/uncomplete`, { body: {} }),
};

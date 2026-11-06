"use client";
import { useMemo, useState } from "react";
import type { ActionView } from "@/lib/actions";
import { ActionCard, ActionsContext } from "./action-card";

/** Action cards outside the chat (Activity): same card, same behaviour. */
export function ActionList({ views }: { views: ActionView[] }) {
  const [actions, setActions] = useState<Record<string, ActionView>>(() => Object.fromEntries(views.map((v) => [v.id, v])));
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(views);
  if (seen !== views) {
    setSeen(views);
    setActions((a) => ({ ...a, ...Object.fromEntries(views.map((v) => [v.id, v])) }));
  }
  const state = useMemo(
    () => ({
      actions,
      setAction: (v: ActionView) => setActions((a) => ({ ...a, [v.id]: v })),
      undone,
      markUndone: (ids: string[]) => setUndone((u) => new Set([...u, ...ids])),
      latest: new Map<string, string>(),
    }),
    [actions, undone],
  );
  return (
    <ActionsContext.Provider value={state}>
      <div className="flex flex-col gap-3">
        {views.map((v) => (
          <ActionCard key={v.id} view={actions[v.id] ?? v} />
        ))}
      </div>
    </ActionsContext.Provider>
  );
}

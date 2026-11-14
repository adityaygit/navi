"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectionError } from "@/lib/connection";
import { announceChange } from "@/lib/offline-queue";
import { Switch } from "@/components/settings-ui";
import { hideCanvasItemAction, resolveCanvasDuplicateAction, setCanvasCourseExcludedAction, setCanvasCourseLinkAction } from "../canvas-actions";

type Res = { ok: true; message?: string } | { ok: false; error: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<Res>) =>
    start(async () => {
      setError(null);
      const r = await fn().catch(() => ({ ok: false as const, error: connectionError() }));
      if (!r.ok) return setError(r.error);
      announceChange();
      router.refresh();
    });
  return { pending, error, act };
}

const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="text-[13px] text-danger">{e}</p> : null);

export function CourseControls({ id, name, excluded, link, options }: { id: string; name: string; excluded: boolean; link: string; options: { value: string; label: string; group: "Spaces" | "Projects" }[] }) {
  const { pending, error, act } = useAct();
  const groups = ["Spaces", "Projects"] as const;
  return (
    <div className="flex flex-col">
      <Switch id={`course-${id}`} checked={!excluded} disabled={pending} label={name} hint={excluded ? "Excluded: its items are set aside and new ones aren't added." : "Included"} onChange={(on) => act(() => setCanvasCourseExcludedAction(id, !on))} />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3.5 sm:px-5">
        <label htmlFor={`link-${id}`} className="muted text-[13px]">Put its tasks in</label>
        <select id={`link-${id}`} className="input max-w-[16rem]" value={link} disabled={pending || excluded} onChange={(e) => act(() => setCanvasCourseLinkAction(id, e.target.value))}>
          <option value="">No space or project</option>
          {groups.map((g) => {
            const opts = options.filter((o) => o.group === g);
            return opts.length ? (
              <optgroup key={g} label={g}>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ) : null;
          })}
        </select>
      </div>
      <div className="px-4 sm:px-5"><Err e={error} /></div>
    </div>
  );
}

export function HideButton({ id, hidden, title }: { id: string; hidden: boolean; title: string }) {
  const { pending, error, act } = useAct();
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} aria-label={`${hidden ? "Show" : "Hide"} “${title}”`} onClick={() => act(() => hideCanvasItemAction(id, !hidden))}>
        {hidden ? "Show" : "Hide"}
      </button>
      <Err e={error} />
    </span>
  );
}

export function DuplicateChoice({ id, title }: { id: string; title: string }) {
  const { pending, error, act } = useAct();
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" disabled={pending} aria-label={`Import “${title}” as well`} onClick={() => act(() => resolveCanvasDuplicateAction(id, "keep_both"))}>Import it too</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending} aria-label={`Keep only my task for “${title}”`} onClick={() => act(() => resolveCanvasDuplicateAction(id, "use_mine"))}>Keep mine only</button>
      </span>
      <Err e={error} />
    </span>
  );
}

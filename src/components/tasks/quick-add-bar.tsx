"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { createTaskAction, newSubmitId } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { endOfDayIso, parseQuickAdd } from "@/lib/quick-add";

type SpaceOpt = { id: string; name: string; color: string };

/**
 * "+ pick up concert tickets fri" → a task due Friday. The day and space it
 * spotted show as chips; tapping a chip drops it. Enter adds.
 */
export function QuickAddBar({ zone, spaces, defaultSpaceId, someday }: { zone: string; spaces: SpaceOpt[]; defaultSpaceId: string | null; someday: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [dropDue, setDropDue] = useState(false);
  const [dropSpace, setDropSpace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // One id per submit, reused when that same submit is retried (no duplicates).
  const submit = useRef<{ id: string; text: string } | null>(null);
  const parsed = useMemo(() => parseQuickAdd(text, spaces, DateTime.now().setZone(zone)), [text, spaces, zone]);
  const due = dropDue ? null : parsed.due;
  const detected = dropSpace ? null : parsed.space;
  const spaceId = detected?.id ?? defaultSpaceId;
  const spaceChip = spaces.find((s) => s.id === spaceId) ?? null;
  const title = dropDue && parsed.due ? text.trim() : parsed.title;

  function add() {
    const t = title.trim();
    if (!t || pending) return;
    setError(null);
    const id = submit.current?.text === text ? submit.current.id : newSubmitId();
    submit.current = { id, text };
    start(async () => {
      const r = await createTaskAction({
        id,
        title: t,
        workspace_id: spaceId,
        due_at: due ? endOfDayIso(due.date, zone) : null,
        ...(someday ? { priority: 4 } : {}),
      });
      if (!r.ok) return setError(r.error);
      submit.current = null;
      setText("");
      setDropDue(false);
      setDropSpace(false);
      announceChange();
      router.refresh();
    });
  }

  return (
    <div className="mt-[18px]">
      <form
        className="flex min-h-[50px] items-center gap-2.5 rounded-[25px] border border-white/[0.08] bg-white/[0.05] py-1.5 pl-[18px] pr-2 focus-within:border-white/20"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span aria-hidden="true" className="text-[20px] leading-none text-[var(--navi-text)]">+</span>
        <label htmlFor="quick-add" className="sr-only">Add a task</label>
        <input
          id="quick-add"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={someday ? "Something for someday…" : "Add a task — try “call the dentist fri”"}
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-dim focus-visible:outline-none"
          autoComplete="off"
          aria-describedby="quick-add-chips"
          // The bar's border shows focus; the global ring would draw a box inside it.
          style={{ outline: "none" }}
        />
        <span id="quick-add-chips" className="flex shrink-0 items-center gap-1.5" aria-live="polite">
          {text.trim() && due && (
            <button type="button" onClick={() => setDropDue(true)} className="flex h-[30px] items-center gap-1.5 rounded-[15px] bg-white/[0.07] px-3 text-[13px] text-[#C8C8CE] hover:bg-white/[0.12]" aria-label={`Due ${due.label}. Remove the date`}>
              {due.label}
            </button>
          )}
          {text.trim() && spaceChip && (
            <button
              type="button"
              onClick={() => setDropSpace(true)}
              disabled={!detected}
              className="flex h-[30px] items-center gap-1.5 rounded-[15px] px-3 text-[13px] disabled:cursor-default"
              style={{ background: `color-mix(in srgb, ${spaceChip.color} 14%, transparent)`, color: `color-mix(in srgb, ${spaceChip.color} 45%, white)` }}
              aria-label={detected ? `In ${spaceChip.name}. Remove the space` : `In ${spaceChip.name}`}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: spaceChip.color }} aria-hidden="true" />
              {spaceChip.name}
            </button>
          )}
          {text.trim() && (
            <button type="submit" disabled={pending} className="px-2 text-[12.5px] text-dim hover:text-text disabled:opacity-50">
              {pending ? "Adding…" : "↵ add"}
            </button>
          )}
        </span>
      </form>
      {error && <p role="alert" className="mt-2 px-4 text-[13px] text-clash">{error} Press Enter to try again.</p>}
    </div>
  );
}

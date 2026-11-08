"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlannerPrefsAction } from "@/app/(app)/planner/plan-actions";
import { announceChange } from "@/lib/offline-queue";
import { GROUP, SectionHead } from "@/components/settings-ui";
import type { PlanningPrefs } from "@/lib/planner-flag";

const FULLNESS: { value: number; label: string }[] = [
  { value: 0.7, label: "Leave some breathing room (about 70%)" },
  { value: 0.85, label: "Fuller days (about 85%)" },
  { value: 1, label: "Use all my free time" },
];

/**
 * The constraint-first planner (preview, per account) and its two settings:
 * whether Navi may plan in awake time you haven't confirmed (always saying
 * so), and how full a day may get. Everything else is set by talking to Navi.
 */
export function PlannerSettings({ saved }: { saved: PlanningPrefs }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(saved);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (patch: Partial<{ planner_v2: boolean; assume_free_time: boolean; plan_load_cap: number }>, next: PlanningPrefs) =>
    start(async () => {
      const r = await setPlannerPrefsAction(patch);
      setMsg(r.ok ? "Saved." : r.error);
      if (r.ok) {
        setPrefs(next);
        announceChange();
        router.refresh();
      }
    });
  return (
    <section id="planner" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="planner-h">
      <SectionHead id="planner-h" title="How Navi plans (preview)" desc="The new planner works out your free time from what it knows (sleep, school, events, what you tell it) and says what it assumes. No free-time setup needed." />
      <div className={GROUP}>
        <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 sm:px-5">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--navi-mid)]" checked={prefs.v2} disabled={pending} onChange={(e) => save({ planner_v2: e.target.checked }, { ...prefs, v2: e.target.checked })} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-medium">Use the new planner</span>
            <span className="muted text-[13px]">Turning it off goes back to the old planner; your plans stay as they are.</span>
          </span>
        </label>
        {prefs.v2 && (
          <>
            <label className="flex cursor-pointer items-start gap-3 px-4 py-3.5 sm:px-5">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--navi-mid)]" checked={prefs.assumeFreeTime} disabled={pending} onChange={(e) => save({ assume_free_time: e.target.checked }, { ...prefs, assumeFreeTime: e.target.checked })} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-medium">Plan in time I haven&apos;t confirmed</span>
                <span className="muted text-[13px]">Navi says each assumption so you can correct it. Off: Navi asks before using time you haven&apos;t told it about.</span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5 px-4 py-3.5 sm:px-5">
              <span className="text-[15px] font-medium">How full a day can get</span>
              <select className="input" value={prefs.loadCap} disabled={pending} onChange={(e) => save({ plan_load_cap: Number(e.target.value) }, { ...prefs, loadCap: Number(e.target.value) })}>
                {FULLNESS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <span className="muted text-[13px]">Must-complete work is always planned, whatever this says.</span>
            </label>
          </>
        )}
      </div>
      <p role="status" className={msg ? "text-[13px] text-dim" : "sr-only"}>{msg ?? ""}</p>
    </section>
  );
}

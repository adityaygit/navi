"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Proposal } from "@/lib/types";
import { ProposalCard } from "@/components/proposal-card";
import { completeOnboardingAction, restartOnboardingAction } from "../actions";
import { announceChange } from "@/lib/offline-queue";

const GROUPS: [string, string[]][] = [
  ["Areas of your life", ["workspace"]],
  ["Goals & projects", ["goal", "project"]],
  ["Fixed commitments & routines", ["event", "routine"]],
  ["Tasks", ["task", "reminder"]],
  ["Schedule preferences", ["preference"]],
  ["Things Navi will remember", ["memory", "note", "question"]],
];

export function OnboardingReview({ proposals, zone }: { proposals: Proposal[]; zone: string }) {
  const router = useRouter();
  // Uncertain inferences start unchecked so they stay in review rather than becoming commitments.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(proposals.filter((p) => p.origin === "stated" || p.confidence >= 0.5).map((p) => p.id)),
  );
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const grouped = useMemo(() => GROUPS.map(([label, kinds]) => [label, proposals.filter((p) => kinds.includes(p.kind))] as const).filter(([, list]) => list.length), [proposals]);

  return (
    <div className="flex flex-col gap-5">
      {grouped.map(([label, list]) => (
        <section key={label} aria-label={label} className="flex flex-col gap-2">
          <h2 className="h2">{label}</h2>
          {list.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              zone={zone}
              selectable
              selected={selected.has(p.id)}
              onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(p.id); else n.delete(p.id); return n; })}
            />
          ))}
        </section>
      ))}
      <div className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 shadow md:bottom-4">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await completeOnboardingAction([...selected]);
              if (!r.ok) { setResult(r.error); return; }
              const d = r.data as { accepted: number; failed: { error?: string }[]; plannedBlocks: number };
              announceChange();
              if (d.failed.length) setResult(`Activated ${d.accepted}. ${d.failed.length} need fixing: ${d.failed.map((f) => f.error).join("; ")}`);
              router.push("/");
            })
          }
        >
          {pending ? "Activating…" : `Activate ${selected.size} item${selected.size === 1 ? "" : "s"} and plan my week`}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => { await restartOnboardingAction(); router.refresh(); })}>
          Keep talking
        </button>
        <span className="muted text-xs">Unchecked items stay in your inbox for later.</span>
        {result && <p role="alert" className="w-full text-sm text-danger">{result}</p>}
      </div>
    </div>
  );
}

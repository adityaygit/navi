"use client";
import { useState, useTransition } from "react";
import type { Autonomy } from "@/lib/actions";
import { setAutonomyAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { GROUP, SectionHead } from "@/components/settings-ui";

const OPTIONS: { value: Autonomy; label: string; hint: string }[] = [
  {
    value: "auto",
    label: "Just do low-risk things",
    hint: "When you ask, Navi adds and edits ordinary tasks and items right away. Each change shows in the chat with Undo.",
  },
  {
    value: "ask",
    label: "Ask me before every change",
    hint: "Every change Navi would make shows as a card in the chat first. Nothing happens until you tap Approve.",
  },
];

/** How much Navi does without asking. Deleting, cancelling, hard deadlines, fixed commitments and anything outside Navi always ask. */
export function AutonomySettings({ saved }: { saved: Autonomy }) {
  const [value, setValue] = useState<Autonomy>(saved);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section id="autonomy" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="auto-h">
      <SectionHead id="auto-h" title="What Navi does on its own" desc="Deleting, cancelling, changing hard deadlines or fixed commitments, and anything that reaches outside Navi always wait for your OK." />
      <fieldset className={GROUP}>
        <legend className="sr-only">What Navi does on its own</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3 px-4 py-3.5 sm:px-5">
            <input
              type="radio"
              name="autonomy"
              value={o.value}
              checked={value === o.value}
              disabled={pending}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--navi-mid)]"
              onChange={() => {
                const previous = value;
                setValue(o.value);
                setMsg(null);
                start(async () => {
                  const r = await setAutonomyAction(o.value);
                  if (!r.ok) {
                    setValue(previous);
                    setMsg(r.error);
                  } else {
                    setMsg("Saved");
                    announceChange();
                  }
                });
              }}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-medium">{o.label}</span>
              <span className="muted text-[13px] leading-snug">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" className={msg ? "px-1 text-[13px] muted" : "sr-only"}>{msg ?? ""}</p>
    </section>
  );
}

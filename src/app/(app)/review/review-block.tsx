"use client";
import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { blockOutcomeAction } from "@/app/(app)/client-actions";
import { OUTCOMES, withNote, type OutcomeChoice } from "@/lib/outcomes";

const CHOICES: [OutcomeChoice, string][] = [
  ["done", "Done"],
  ["partial", "Partly done"],
  ["rest", OUTCOMES.rest.label],
  ["interrupted", OUTCOMES.interrupted.label],
  ["missing_info", OUTCOMES.missing_info.label],
  ["estimate", OUTCOMES.estimate.label],
  ["avoided", OUTCOMES.avoided.label],
];

/** One unmarked block in the evening review: say what happened, with an optional note. */
export function ReviewBlock({ id, title, time }: { id: string; title: string; time: string }) {
  const [note, setNote] = useState("");
  const mark = (choice: OutcomeChoice) => {
    if (choice === "done") return blockOutcomeAction(id, "done", note.trim() || null);
    if (choice === "partial") return blockOutcomeAction(id, "partial", withNote("Made progress", note));
    const o = OUTCOMES[choice];
    return blockOutcomeAction(id, o.status, withNote(o.reason, note));
  };
  return (
    <li className="well flex flex-col gap-3 p-3.5 md:p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="num text-sm text-muted">{time}</span>
        <span className="text-base font-medium">{title}</span>
      </div>
      <div>
        <label htmlFor={`note-${id}`} className="label">Note (optional)</label>
        <input id={`note-${id}`} className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. waiting on the rubric" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`How did “${title}” go?`}>
        {CHOICES.map(([choice, label]) => (
          <ActionButton
            key={choice}
            className={choice === "done" ? "btn btn-primary btn-sm" : choice === "avoided" ? "btn btn-sm border-clash/40 text-clash" : "btn btn-sm"}
            action={() => mark(choice)}
          >
            {label}
          </ActionButton>
        ))}
      </div>
    </li>
  );
}

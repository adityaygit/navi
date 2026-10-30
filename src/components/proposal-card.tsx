"use client";
import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import type { Proposal } from "@/lib/types";
import { acceptProposalAction, editProposalAction, mergeProposalAction, setProposalStatusAction } from "@/app/(app)/actions";
import { announceChange } from "@/lib/offline-queue";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_LABEL: Record<string, string> = {
  workspace: "Area",
  project: "Project",
  goal: "Goal",
  routine: "Routine",
  event: "Commitment",
  task: "Task",
  reminder: "Reminder",
  note: "Note",
  question: "Question",
  memory: "Memory",
  preference: "Preferences",
};

function toLocalInput(iso: unknown, zone: string): string {
  if (typeof iso !== "string" || !iso) return "";
  const dt = DateTime.fromISO(iso).setZone(zone);
  return dt.isValid ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : "";
}
function fromLocalInput(v: string, zone: string): string | null {
  if (!v) return null;
  return DateTime.fromFormat(v, "yyyy-LL-dd'T'HH:mm", { zone }).toISO();
}

export function proposalSummary(p: Proposal, zone: string): string {
  const pl = p.payload as Record<string, unknown>;
  const parts: string[] = [];
  if (pl.due_at) parts.push(`due ${DateTime.fromISO(String(pl.due_at)).setZone(zone).toFormat("ccc LLL d, h:mm a")}`);
  if (pl.starts_at) parts.push(DateTime.fromISO(String(pl.starts_at)).setZone(zone).toFormat("ccc h:mm a"));
  const rec = pl.recurrence as { days?: number[] } | null | undefined;
  if (rec?.days) parts.push(`every ${rec.days.map((d) => DAY_NAMES[d]).join(", ")}`);
  if (Array.isArray(pl.days)) parts.push(`${(pl.days as number[]).map((d) => DAY_NAMES[d]).join(", ")}${pl.start_time ? ` at ${pl.start_time}` : ""}`);
  if (pl.estimate_minutes) parts.push(`~${pl.estimate_minutes} min`);
  if (pl.priority && pl.priority !== 3) parts.push(`P${pl.priority}`);
  if (pl.target_date) parts.push(`by ${pl.target_date}`);
  if (pl.due_date) parts.push(`due ${pl.due_date}`);
  if (p.kind === "preference") {
    if (pl.timezone) parts.push(`time zone ${pl.timezone}`);
    if (pl.quiet_hours_start) parts.push(`quiet ${pl.quiet_hours_start}–${pl.quiet_hours_end}`);
    const av = pl.availability as { days: number[]; start: string; end: string }[] | undefined;
    if (av?.length) parts.push(`free ${av.map((w) => `${w.days.map((d) => DAY_NAMES[d]).join("/")} ${w.start}–${w.end}`).join("; ")}`);
  }
  return parts.join(" · ");
}

export function titleOf(p: Proposal): string {
  const pl = p.payload as Record<string, unknown>;
  return String(pl.title ?? pl.name ?? pl.question ?? pl.content ?? pl.body ?? KIND_LABEL[p.kind] ?? p.kind);
}

export function ProposalCard({
  proposal,
  zone,
  openTasks = [],
  selectable,
  selected,
  onSelect,
}: {
  proposal: Proposal;
  zone: string;
  openTasks?: { id: string; title: string }[];
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [payload, setPayload] = useState<Record<string, unknown>>(proposal.payload);
  const [mergeTarget, setMergeTarget] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titleKey = "title" in payload || ["task", "reminder", "goal", "routine", "event", "note"].includes(proposal.kind) ? "title" : proposal.kind === "question" ? "question" : proposal.kind === "memory" ? "content" : "name";

  function run(fn: () => Promise<{ ok: boolean; error?: string } | unknown>) {
    setError(null);
    start(async () => {
      const r = (await fn()) as { ok: boolean; error?: string };
      if (r && !r.ok) setError(r.error ?? "Something went wrong");
      else announceChange();
    });
  }
  const set = (k: string, v: unknown) => setPayload((p) => ({ ...p, [k]: v }));
  const taskLike = proposal.kind === "task" || proposal.kind === "reminder";

  return (
    <article className="card flex flex-col gap-2" aria-label={`${KIND_LABEL[proposal.kind]}: ${titleOf(proposal)}`}>
      <div className="flex items-start gap-2">
        {selectable && (
          <input type="checkbox" className="mt-1.5 h-5 w-5" checked={selected} onChange={(e) => onSelect?.(e.target.checked)} aria-label={`Include ${titleOf(proposal)}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="badge">{KIND_LABEL[proposal.kind]}</span>
            <span className={`badge ${proposal.origin === "stated" ? "badge-ok" : "badge-warn"}`}>{proposal.origin === "stated" ? "You said this" : "Navi inferred"}</span>
            <span className="badge" title="Navi's confidence">{Math.round(proposal.confidence * 100)}% sure</span>
            {proposal.status === "deferred" && <span className="badge">deferred</span>}
          </div>
          {!editing ? (
            <>
              <div className="mt-1 font-medium">{titleOf({ ...proposal, payload })}</div>
              {proposalSummary({ ...proposal, payload }, zone) && <div className="muted text-sm">{proposalSummary({ ...proposal, payload }, zone)}</div>}
            </>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {proposal.kind !== "preference" && (
                <div className="sm:col-span-2">
                  <label className="label" htmlFor={`t-${proposal.id}`}>Title</label>
                  <input id={`t-${proposal.id}`} className="input" value={String(payload[titleKey] ?? "")} onChange={(e) => set(titleKey, e.target.value)} />
                </div>
              )}
              {taskLike && (
                <>
                  <div>
                    <label className="label" htmlFor={`d-${proposal.id}`}>Due</label>
                    <input id={`d-${proposal.id}`} type="datetime-local" className="input" value={toLocalInput(payload.due_at, zone)} onChange={(e) => set("due_at", fromLocalInput(e.target.value, zone))} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`e-${proposal.id}`}>Estimate (min)</label>
                    <input id={`e-${proposal.id}`} type="number" min={1} max={1440} className="input" value={String(payload.estimate_minutes ?? "")} onChange={(e) => set("estimate_minutes", e.target.value ? Number(e.target.value) : null)} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`p-${proposal.id}`}>Priority</label>
                    <select id={`p-${proposal.id}`} className="input" value={String(payload.priority ?? 3)} onChange={(e) => set("priority", Number(e.target.value))}>
                      <option value="1">P1 — critical</option>
                      <option value="2">P2 — high</option>
                      <option value="3">P3 — normal</option>
                      <option value="4">P4 — low</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(payload.due_is_hard)} onChange={(e) => set("due_is_hard", e.target.checked)} /> Hard deadline
                  </label>
                </>
              )}
              {proposal.kind === "event" && (
                <>
                  <div>
                    <label className="label" htmlFor={`s-${proposal.id}`}>Starts</label>
                    <input id={`s-${proposal.id}`} type="datetime-local" className="input" value={toLocalInput(payload.starts_at, zone)} onChange={(e) => set("starts_at", fromLocalInput(e.target.value, zone))} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`en-${proposal.id}`}>Ends</label>
                    <input id={`en-${proposal.id}`} type="datetime-local" className="input" value={toLocalInput(payload.ends_at, zone)} onChange={(e) => set("ends_at", fromLocalInput(e.target.value, zone))} />
                  </div>
                </>
              )}
              {(proposal.kind === "routine" || (proposal.kind === "event" && payload.recurrence)) && (
                <fieldset className="sm:col-span-2">
                  <legend className="label">Repeats on</legend>
                  <div className="flex flex-wrap gap-1">
                    {DAY_NAMES.map((d, i) => {
                      const days: number[] = proposal.kind === "routine" ? ((payload.days as number[]) ?? []) : (((payload.recurrence as { days: number[] }) ?? { days: [] }).days ?? []);
                      const on = days.includes(i);
                      const next = on ? days.filter((x) => x !== i) : [...days, i].sort();
                      return (
                        <button key={d} type="button" aria-pressed={on} className={`btn btn-sm ${on ? "btn-primary" : ""}`} onClick={() => (proposal.kind === "routine" ? set("days", next) : set("recurrence", { ...(payload.recurrence as object), freq: "weekly", days: next }))}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {proposal.kind === "routine" && (
                <>
                  <div>
                    <label className="label" htmlFor={`rt-${proposal.id}`}>Start time (blank = flexible)</label>
                    <input id={`rt-${proposal.id}`} type="time" className="input" value={String(payload.start_time ?? "")} onChange={(e) => set("start_time", e.target.value || null)} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`rd-${proposal.id}`}>Minutes</label>
                    <input id={`rd-${proposal.id}`} type="number" min={1} className="input" value={String(payload.duration_minutes ?? 30)} onChange={(e) => set("duration_minutes", Number(e.target.value))} />
                  </div>
                </>
              )}
              {proposal.kind === "preference" && (
                <p className="muted text-sm sm:col-span-2">Accept these, then fine-tune them in Settings.</p>
              )}
            </div>
          )}
          {proposal.source_excerpt && <blockquote className="muted mt-2 border-l-2 border-border pl-2 text-sm">“{proposal.source_excerpt}”</blockquote>}
          {proposal.rationale && <p className="muted mt-1 text-xs">Why: {proposal.rationale}</p>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {(proposal.status === "pending" || proposal.status === "deferred") && (
        <div className="flex flex-wrap gap-1.5">
          {!selectable && (
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => acceptProposalAction(proposal.id, editing ? payload : undefined))}>
              {proposal.kind === "question" ? "Mark handled" : "Accept"}
            </button>
          )}
          {editing ? (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(async () => { const r = await editProposalAction(proposal.id, payload); if (r.ok) setEditing(false); return r; })}>
              Save edits
            </button>
          ) : (
            proposal.kind !== "question" && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
          )}
          {!selectable && (
            <>
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => setProposalStatusAction(proposal.id, proposal.status === "deferred" ? "pending" : "deferred"))}>
                {proposal.status === "deferred" ? "Un-defer" : "Later"}
              </button>
              <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => run(() => setProposalStatusAction(proposal.id, "rejected"))}>
                Reject
              </button>
            </>
          )}
          {taskLike && openTasks.length > 0 && !selectable && (
            <span className="flex items-center gap-1">
              <label htmlFor={`m-${proposal.id}`} className="sr-only">Merge into existing task</label>
              <select id={`m-${proposal.id}`} className="input min-h-9 w-44 text-sm" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                <option value="">Merge into…</option>
                {openTasks.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 50)}</option>)}
              </select>
              {mergeTarget && <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => mergeProposalAction(proposal.id, mergeTarget))}>Merge</button>}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

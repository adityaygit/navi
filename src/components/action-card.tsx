"use client";
import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionView } from "@/lib/actions";
import { announceChange } from "@/lib/offline-queue";
import { decideApprovalAction, undoChangesAction } from "@/app/(app)/client-actions";
import { Pebble } from "./pebble";

// An action Navi wants to take, shown right in the conversation: what it is,
// the exact details, and Approve / Decline. The same card then shows what
// really happened (done, with Undo when possible; declined; failed; expired).
// The person can also change it by just telling Navi ("make it Friday"):
// the card updates in place. The server is the source of truth; every tap
// answers with the card's real state, so a double tap or retry is harmless.

type ActionsState = {
  actions: Record<string, ActionView>;
  setAction: (view: ActionView) => void;
  /** Activity entries already undone (automatic changes). */
  undone: Set<string>;
  markUndone: (ids: string[]) => void;
  /** For each action, the message that shows it in full (older mentions stay one line). */
  latest: Map<string, string>;
};

export const ActionsContext = createContext<ActionsState>({ actions: {}, setAction: () => {}, undone: new Set(), markUndone: () => {}, latest: new Map() });

export function useActions() {
  return useContext(ActionsContext);
}

function Icon({ kind }: { kind: "ok" | "no" | "wait" }) {
  const cls = kind === "ok" ? "bg-[rgba(95,211,154,0.14)] text-focus" : kind === "no" ? "bg-[rgba(255,143,138,0.14)] text-clash" : "bg-white/[0.07] text-muted";
  return (
    <span aria-hidden="true" className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${cls}`}>
      {kind === "ok" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
      ) : kind === "no" ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12h14" /></svg>
      )}
    </span>
  );
}

/** Undo for something already done; shows "Undone" once it is. */
export function UndoButton({ ids, done, label = "Undo", onDone }: { ids: string[]; done: boolean; label?: string; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) return <span className="dim text-[13px]">Undone</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        className="btn btn-ghost btn-sm -my-1.5"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await undoChangesAction(ids);
          setBusy(false);
          if (!r.ok) return setError(r.error);
          onDone();
          announceChange();
          router.refresh();
        }}
      >
        {busy ? "…" : label}
      </button>
      {error && <span role="alert" className="mt-1 max-w-xs text-right text-xs text-clash">{error}</span>}
    </span>
  );
}

function Fields({ view }: { view: ActionView }) {
  if (!view.fields.length) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px] leading-snug">
      {view.fields.map((f) => (
        <div key={f.label} className="contents">
          <dt className="muted">{f.label}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {f.from !== undefined && f.from !== f.value && (
              <>
                <span className="dim line-through">{f.from}</span>
                <span className="dim" aria-hidden="true"> → </span>
                <span className="sr-only"> changes to </span>
              </>
            )}
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One line for an older mention of an action that is shown in full further down. */
function ActionLine({ view }: { view: ActionView }) {
  const word = { proposed: "waiting for your OK below", approved: "running", executing: "running", completed: "done", declined: "declined", failed: "didn't go through", expired: "expired" }[view.status];
  return (
    <p className="muted flex items-center gap-2 text-[13px]">
      <Icon kind={view.status === "completed" ? "ok" : view.status === "failed" ? "no" : "wait"} />
      <span className="[overflow-wrap:anywhere]">
        {view.verb} “{view.subject}”: {word}
      </span>
    </p>
  );
}

export function ActionCard({ view, compact = false }: { view: ActionView; compact?: boolean }) {
  const router = useRouter();
  const { setAction, undone, markUndone } = useActions();
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState<string | null>(null);
  if (compact) return <ActionLine view={view} />;
  const label = `${view.verb}: ${view.subject}`;

  async function decide(decision: "approve" | "reject") {
    if (busy) return;
    setBusy(decision);
    setNote(null);
    const r = await decideApprovalAction(view.id, decision, view.revision);
    setBusy(null);
    if (!r.ok) {
      // It may or may not have reached the server: show the real state once known.
      setNote(r.error);
      router.refresh();
      return;
    }
    const next = r.data!;
    if (decision === "approve" && next.status === "proposed" && next.revision !== view.revision) setNote("Navi changed this just now. Check the new details, then approve.");
    setAction(next);
    announceChange();
    router.refresh();
  }

  if (view.status === "proposed") {
    return (
      <div role="group" aria-label={label} className="lg lg-ask flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <Pebble size={28} mood="ask" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="muted flex flex-wrap items-center gap-x-2 text-[13px]">
              {view.verb} · needs your OK
              {view.revision > 1 && <span className="badge badge-accent">Updated</span>}
            </span>
            <span className="text-[17px] font-semibold leading-snug [overflow-wrap:anywhere]">{view.subject}</span>
          </div>
        </div>
        <Fields view={view} />
        {view.external && <p className="notice notice-warn text-[13px]">This reaches outside Navi. It only runs if that service is connected, and Navi reports the real result.</p>}
        <p className="dim text-[13px] leading-snug">
          {view.reason ? `Asking first because ${view.reason}. ` : ""}You can also tell Navi what to change.
        </p>
        <div className="flex gap-2.5">
          <button type="button" className="btn btn-primary min-w-28 flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void decide("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button type="button" className="btn min-w-28 flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void decide("reject")}>
            {busy === "reject" ? "…" : "Decline"}
          </button>
        </div>
        <p role="status" className={note ? "text-[13px] text-recovery" : "sr-only"}>{note ?? ""}</p>
      </div>
    );
  }

  const running = view.status === "approved" || view.status === "executing";
  const kind = view.status === "completed" ? "ok" : view.status === "failed" ? "no" : "wait";
  const text = running
    ? view.error ?? "Doing it…"
    : view.status === "completed"
      ? view.result ?? `${view.verb}: done`
      : view.status === "declined"
        ? `Declined. I left “${view.subject}” as it was.`
        : view.status === "failed"
          ? `Didn't go through: ${view.error ?? "unknown error"}`
          : `Expired, so nothing was done. ${view.error ?? ""}`.trim();
  const isUndone = view.undone || (view.undo.length > 0 && view.undo.every((id) => undone.has(id)));
  return (
    <div role="group" aria-label={label} className="well flex items-start gap-3 px-4 py-3">
      {running ? <Pebble size={24} mood="working" /> : <Icon kind={kind} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`dim text-[13px] ${view.status === "failed" ? "text-clash" : ""}`}>{view.verb}{view.status === "expired" || view.status === "failed" ? ` “${view.subject}”` : ""}</span>
        <span role="status" className={`text-[15px] leading-snug [overflow-wrap:anywhere] ${view.status === "completed" ? "font-medium" : "muted"} ${running ? "shimmer-text" : ""}`}>{text}</span>
        {note && <span className="text-[13px] text-recovery">{note}</span>}
      </div>
      {view.status === "completed" && view.undo.length > 0 && (
        <UndoButton
          ids={view.undo}
          done={isUndone}
          onDone={() => {
            markUndone(view.undo);
            setAction({ ...view, undone: true });
          }}
        />
      )}
    </div>
  );
}

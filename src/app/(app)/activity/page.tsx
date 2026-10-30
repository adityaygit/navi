import { requireCtx } from "@/server/context";
import type { ActivityEntry, Approval } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { decideApprovalAction, revertActivityAction } from "../actions";

export const metadata = { title: "Activity · Navi" };

const STATUS_BADGE: Record<Approval["status"], string> = {
  pending: "badge-accent", approved: "badge-accent", executing: "badge-accent", executed: "badge-ok", rejected: "", failed: "badge-danger", expired: "",
};

export default async function ActivityPage() {
  const ctx = await requireCtx();
  const [apprRes, actRes] = await Promise.all([
    ctx.db.from("approvals").select("*").order("created_at", { ascending: false }).limit(50),
    ctx.db.from("activity_log").select("id,actor,action,entity_type,entity_id,summary,reversible,reverted_at,created_at").order("created_at", { ascending: false }).limit(150),
  ]);
  const approvals = (apprRes.data ?? []) as Approval[];
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");
  const activity = (actRes.data ?? []) as ActivityEntry[];
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: ctx.timezone, dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="h1">Activity & approvals</h1>
        <p className="muted text-sm">Navi organizes your plans on its own, but anything consequential waits here for you. Every change is logged; many can be undone.</p>
      </header>

      <section aria-labelledby="ap-h" className="flex flex-col gap-2">
        <h2 id="ap-h" className="h2">Waiting for your approval ({pending.length})</h2>
        {pending.length === 0 ? <p className="muted text-sm">Nothing waiting.</p> : pending.map((a) => (
          <article key={a.id} className="card flex flex-col gap-2 border-accent">
            <p className="font-medium">{a.summary}</p>
            <details className="text-xs"><summary className="muted cursor-pointer">Exactly what will happen</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-surface-2 p-2">{a.action_type}{"\n"}{JSON.stringify(a.details, null, 2)}</pre></details>
            {a.action_type.startsWith("external.") && <p className="notice notice-warn text-xs">This affects an outside service. It only runs if that service is connected, and Navi will report the real result.</p>}
            <div className="flex gap-2">
              <ActionButton className="btn btn-primary btn-sm" action={() => decideApprovalAction(a.id, "approve")}>Approve</ActionButton>
              <ActionButton className="btn btn-sm" action={() => decideApprovalAction(a.id, "reject")}>Reject</ActionButton>
            </div>
            <span className="muted text-xs">Requested {fmt(a.created_at)}</span>
          </article>
        ))}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="ad-h" className="flex flex-col gap-2">
          <h2 id="ad-h" className="h2">Past decisions</h2>
          <ul className="card flex flex-col p-0">
            {decided.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm last:border-0">
                <span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                <span className="min-w-0 flex-1">{a.summary}</span>
                {a.error && <span className="w-full text-xs text-danger">{a.error}</span>}
                <span className="muted text-xs">{fmt(a.decided_at ?? a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="log-h" className="flex flex-col gap-2">
        <h2 id="log-h" className="h2">Activity log</h2>
        {activity.length === 0 ? <p className="muted text-sm">No activity yet.</p> : (
          <ul className="card flex flex-col p-0">
            {activity.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm last:border-0">
                <span className={`badge ${e.actor === "navi" ? "badge-accent" : ""}`}>{e.actor === "navi" ? "Navi" : e.actor === "system" ? "Scheduler" : "You"}</span>
                <span className={`min-w-0 flex-1 ${e.reverted_at ? "muted line-through" : ""}`}>{e.summary}</span>
                <span className="muted text-xs">{fmt(e.created_at)}</span>
                {e.reversible && !e.reverted_at && (
                  <ActionButton className="btn btn-ghost btn-sm" confirm={`Undo: ${e.summary}?`} action={() => revertActivityAction(e.id)}>Undo</ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

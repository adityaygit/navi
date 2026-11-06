import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { ActivityEntry, Approval } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { Pebble } from "@/components/pebble";
import { GROUP, SectionHead } from "@/components/settings-ui";
import { decideApprovalAction, revertActivityAction } from "../actions";

export const metadata = { title: "Activity · Navi" };

const STATUS_BADGE: Record<Approval["status"], string> = {
  pending: "badge-accent", approved: "badge-accent", executing: "badge-accent", executed: "badge-ok", rejected: "", failed: "badge-danger", expired: "",
};

const ACTOR: Record<string, [string, string]> = {
  navi: ["Navi", "badge-navi"],
  system: ["Scheduler", ""],
  user: ["You", "badge-accent"],
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
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeZone: ctx.timezone, timeStyle: "short" });

  // The log, grouped by local day.
  const today = DateTime.now().setZone(ctx.timezone).startOf("day");
  const days: { key: string; label: string; entries: ActivityEntry[] }[] = [];
  for (const e of activity) {
    const d = DateTime.fromISO(e.created_at).setZone(ctx.timezone).startOf("day");
    const key = d.toISODate()!;
    if (days.at(-1)?.key !== key) {
      const ago = Math.round(today.diff(d, "days").days);
      days.push({ key, label: ago === 0 ? "Today" : ago === 1 ? "Yesterday" : d.toFormat(d.year === today.year ? "cccc, LLL d" : "LLL d, yyyy"), entries: [] });
    }
    days.at(-1)!.entries.push(e);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-9">
      <header className="flex flex-col gap-3">
        <h1 className="h1">Activity &amp; approvals</h1>
        <p className="muted max-w-prose text-[15px]">Navi organizes your plans on its own, but anything consequential waits here for you. Every change is logged; many can be undone.</p>
      </header>

      <section aria-labelledby="ap-h" className="flex flex-col gap-3">
        <SectionHead
          id="ap-h"
          title={<span className="num">Waiting for your approval ({pending.length})</span>}
          aside={pending.length > 0 ? <Pebble size={36} mood="ask" /> : undefined}
        />
        {pending.length === 0 ? (
          <p className="surf muted px-4 py-4 text-sm sm:px-5">Nothing waiting.</p>
        ) : (
          pending.map((a) => (
            <article key={a.id} className="lg lg-ask flex flex-col gap-3 p-4 sm:p-5">
              <p className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">{a.summary}</p>
              {a.action_type.startsWith("external.") && <p className="notice notice-warn text-[13px]">This affects an outside service. It only runs if that service is connected, and Navi will report the real result.</p>}
              <details className="text-[13px]">
                <summary className="muted inline-flex cursor-pointer items-center hover:text-text">Exactly what will happen</summary>
                <pre className="well mt-2 overflow-x-auto whitespace-pre-wrap break-words p-3 text-[12px] leading-relaxed text-muted">{a.action_type}{"\n"}{JSON.stringify(a.details, null, 2)}</pre>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                <span className="dim text-[13px]">Requested {fmt(a.created_at)}</span>
                <div className="flex gap-2">
                  <ActionButton className="btn btn-sm" action={decideApprovalAction} args={[a.id, "reject"]}>Reject</ActionButton>
                  <ActionButton className="btn btn-primary btn-sm" action={decideApprovalAction} args={[a.id, "approve"]}>Approve</ActionButton>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="ad-h" className="flex flex-col gap-3">
          <SectionHead id="ad-h" title="Past decisions" />
          <ul className={GROUP}>
            {decided.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm sm:px-5">
                <span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                <span className="min-w-0 flex-1 basis-48 break-words">{a.summary}</span>
                <span className="dim num text-[13px]">{fmt(a.decided_at ?? a.created_at)}</span>
                {a.error && <span className="w-full text-[13px] text-danger">{a.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="log-h" className="flex flex-col gap-3">
        <SectionHead id="log-h" title="Activity log" />
        {activity.length === 0 ? (
          <p className="surf muted px-4 py-4 text-sm sm:px-5">No activity yet.</p>
        ) : (
          days.map((day) => (
            <div key={day.key} className="flex flex-col gap-2">
              <h3 className="eyebrow px-1 text-[12px]">{day.label}</h3>
              <ul className={GROUP}>
                {day.entries.map((e) => {
                  const [who, cls] = ACTOR[e.actor] ?? ACTOR.user;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm sm:px-5">
                      <span className={`badge w-[4.75rem] justify-center ${cls}`}>{who}</span>
                      <span className={`min-w-0 flex-1 basis-48 break-words ${e.reverted_at ? "muted line-through" : ""}`}>{e.summary}</span>
                      <span className="dim num text-[13px]">{time(e.created_at)}{e.reverted_at ? " · undone" : ""}</span>
                      {e.reversible && !e.reverted_at && (
                        <ActionButton className="btn btn-ghost btn-sm -my-1" confirm={`Undo: ${e.summary}?`} action={revertActivityAction} args={[e.id]}>Undo</ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

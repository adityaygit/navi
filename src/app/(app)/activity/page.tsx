import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { ActivityEntry, Approval } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { Pebble } from "@/components/pebble";
import { GROUP, SectionHead } from "@/components/settings-ui";
import { revertActivityAction } from "../actions";
import { actionView, revertedAmong } from "@/server/domain/approvals";
import { isOpen } from "@/lib/actions";
import { ActionList } from "@/components/action-list";
import { plainActivity } from "@/lib/plain-text";

export const metadata = { title: "Activity · Navi" };

const STATUS_BADGE: Record<Approval["status"], [string, string]> = {
  proposed: ["waiting", "badge-accent"], approved: ["running", "badge-accent"], executing: ["running", "badge-accent"], completed: ["done", "badge-ok"], declined: ["declined", ""], failed: ["failed", "badge-danger"], expired: ["expired", ""],
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
  const reverted = await revertedAmong(ctx, approvals.flatMap((a) => (Array.isArray((a.result as { undo?: unknown } | null)?.undo) ? (a.result as { undo: string[] }).undo : [])));
  const views = approvals.map((a) => actionView(a, ctx.timezone, reverted));
  const pending = views.filter((v) => isOpen(v.status));
  const decided = views.filter((v) => !isOpen(v.status));
  const byId = new Map(approvals.map((a) => [a.id, a]));
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
        <p className="muted max-w-prose text-[15px]">Navi makes low-risk changes on its own and asks first for anything consequential, usually right in the chat. Everything it did is logged here; most changes can be undone.</p>
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
          <ActionList views={pending} />
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="ad-h" className="flex flex-col gap-3">
          <SectionHead id="ad-h" title="Past decisions" />
          <ul className={GROUP}>
            {decided.map((v) => {
              const a = byId.get(v.id)!;
              const [word, cls] = STATUS_BADGE[v.status];
              return (
                <li key={v.id} className="flex items-start gap-3 px-4 py-3 text-sm sm:px-5">
                  <span className={`badge mt-px w-[4.5rem] shrink-0 justify-center ${cls}`}>{word}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="break-words">{v.status === "completed" && v.result ? v.result : a.summary}</span>
                      <span className="dim num shrink-0 text-[13px]">{fmt(a.decided_at ?? a.updated_at ?? a.created_at)}{v.undone ? " · undone" : ""}</span>
                    </div>
                    {v.error && v.status !== "completed" && <span className="text-[13px] text-danger">{v.error}</span>}
                  </div>
                </li>
              );
            })}
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
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm sm:px-5">
                      <span className={`badge mt-px w-[4.5rem] shrink-0 justify-center ${cls}`}>{who}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                        <span className={`break-words ${e.reverted_at ? "muted line-through" : ""}`}>{plainActivity(e.summary, ctx.timezone)}</span>
                        <span className="dim num shrink-0 text-[13px]">{time(e.created_at)}{e.reverted_at ? " · undone" : ""}</span>
                      </div>
                      {e.reversible && !e.reverted_at && (
                        <ActionButton className="btn btn-ghost btn-sm -my-1.5 shrink-0" confirm={`Undo: ${plainActivity(e.summary, ctx.timezone)}?`} action={revertActivityAction} args={[e.id]}>Undo</ActionButton>
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

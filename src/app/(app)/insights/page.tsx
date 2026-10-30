import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import { weekInsights } from "@/server/domain/insights";
import { nowIn } from "@/lib/time";
import type { Briefing } from "@/lib/types";
import { ActionButton } from "@/components/action-button";
import { generateBriefingAction } from "../actions";

export const metadata = { title: "Insights · Navi" };

export default async function InsightsPage() {
  const ctx = await requireCtx();
  const today = nowIn(ctx.timezone).toISODate()!;
  const [week, briefRes] = await Promise.all([
    weekInsights(ctx.db, ctx.userId, ctx.timezone, today),
    ctx.db.from("briefings").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  const briefings = (briefRes.data ?? []) as Briefing[];
  const todayReview = week.days[week.days.length - 1];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-2">
        <div className="mr-auto">
          <h1 className="h1">Insights & reviews</h1>
          <p className="muted text-sm">Built only from what you actually planned, did and recorded. Rest, interruptions and missing information never count against you.</p>
        </div>
        <ActionButton className="btn btn-sm" action={generateBriefingAction} args={["evening"]}>Review today now</ActionButton>
        <ActionButton className="btn btn-sm" action={generateBriefingAction} args={["weekly"]}>Weekly review now</ActionButton>
      </header>

      <section className="card" aria-labelledby="today-h">
        <h2 id="today-h" className="h2">Today so far</h2>
        <p className="mt-1">{todayReview.explanation}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Done", todayReview.done], ["Partly done", todayReview.partial], ["Rest / interrupted", todayReview.rest + todayReview.interrupted], ["Skipped (no outside reason)", todayReview.avoided],
            ["Not marked yet", todayReview.unmarked], ["Focus minutes", todayReview.focusMinutes], ["Tasks completed", todayReview.tasksCompleted], ["Blocked on info", todayReview.skippedMissingInfo],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg bg-surface-2 p-2"><dt className="muted text-xs">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
        {todayReview.findings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{todayReview.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      </section>

      <section className="card" aria-labelledby="week-h">
        <h2 id="week-h" className="h2">Last 7 days</h2>
        <p className="muted text-sm">{week.tasksCompleted} tasks completed · {week.focusMinutes} focus minutes{week.estimate.medianRatio !== null ? ` · tasks take ~${week.estimate.medianRatio.toFixed(1)}× estimates (${week.estimate.samples} samples)` : ""}</p>
        <ul className="mt-3 flex items-end gap-2" aria-label="Daily completion of counted blocks">
          {week.days.map((d) => {
            const pct = d.completionRate === null ? null : Math.round(d.completionRate * 100);
            return (
              <li key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end rounded bg-surface-2" title={pct === null ? "No counted blocks" : `${pct}%`}>
                  {pct !== null && <div className="w-full rounded bg-accent" style={{ height: `${Math.max(pct, 3)}%` }} />}
                </div>
                <span className="text-xs tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
                <span className="muted text-xs">{DateTime.fromISO(d.date).toFormat("ccc")}</span>
              </li>
            );
          })}
        </ul>
        <ul className="mt-3 list-disc pl-5 text-sm">{week.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </section>

      <section aria-labelledby="br-h" className="flex flex-col gap-2">
        <h2 id="br-h" className="h2">Briefings & reviews</h2>
        {briefings.length === 0 ? <p className="muted text-sm">None yet. Morning briefings and evening reviews are saved here automatically at your configured times.</p> : briefings.map((b) => (
          <details key={b.id} className="card" open={b === briefings[0]}>
            <summary className="cursor-pointer font-medium">{b.title} <span className="badge ml-1">{b.kind}</span></summary>
            <p className="mt-2 whitespace-pre-wrap text-sm">{b.body}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

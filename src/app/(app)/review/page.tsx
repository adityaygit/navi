import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine } from "@/lib/types";
import { dayReview } from "@/server/domain/insights";
import { buildDayAgenda } from "@/server/planner/agenda";
import { formatDay, formatTime, nowIn } from "@/lib/time";
import { blockCategory } from "@/lib/outcomes";
import { ActionButton } from "@/components/action-button";
import { blockOutcomeAction, planDayAction } from "../actions";
import { ReviewBlock } from "./review-block";

export const metadata = { title: "Daily review · Navi" };

const CATEGORY_LABEL: Record<string, string> = {
  done: "done",
  partial: "partly done",
  rest: "rest",
  interrupted: "interrupted",
  missing_info: "missing info",
  estimate: "took longer than estimated",
  avoided: "skipped (no outside reason)",
  missed: "missed",
};

/**
 * The guided daily review: mark what happened to each block, see the
 * computed review (it updates as you mark), then plan the next day.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = nowIn(zone);
  const today = now.toISODate()!;
  const sp = await searchParams;
  const asked = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && DateTime.fromISO(sp.date, { zone }).isValid ? sp.date : today;
  const date = asked > today ? today : asked;
  const dt = DateTime.fromISO(date, { zone });
  const next = dt.plus({ days: 1 }).toISODate()!;
  const prev = dt.minus({ days: 1 }).toISODate()!;

  const [blocksRes, review, eventsRes, routinesRes, dueNextRes] = await Promise.all([
    ctx.db.from("plan_blocks").select("*").eq("plan_date", date).order("starts_at"),
    dayReview(ctx.db, ctx.userId, zone, date),
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
    ctx.db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["todo", "in_progress", "blocked"])
      .gte("due_at", DateTime.fromISO(next, { zone }).startOf("day").toISO()!)
      .lte("due_at", DateTime.fromISO(next, { zone }).endOf("day").toISO()!),
  ]);
  const blocks = (blocksRes.data ?? []) as PlanBlock[];
  const unmarked = blocks.filter((b) => blockCategory(b) === "unmarked");
  const marked = blocks.filter((b) => blockCategory(b) !== "unmarked");
  const nextFixed = buildDayAgenda({ date: next, zone, events: (eventsRes.data ?? []) as CalendarEvent[], routines: (routinesRes.data ?? []) as Routine[], blocks: [], tasks: [] }).entries.filter((e) => e.start);
  const nextLabel = next === today ? "the rest of today" : next === now.plus({ days: 1 }).toISODate() ? "tomorrow" : formatDay(next, zone);
  const time = (b: PlanBlock) => `${formatTime(b.starts_at, zone)}–${formatTime(b.ends_at, zone)}`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-2">
        <div className="mr-auto">
          <h1 className="h1">{date === today ? "Today's review" : `Review of ${formatDay(date, zone)}`}</h1>
          <p className="muted text-sm">{formatDay(date, zone)}. Say what happened to each block; rest, interruptions, missing information and bad estimates don't count against you.</p>
        </div>
        <nav aria-label="Review day" className="flex gap-1">
          <Link href={`/review?date=${prev}`} className="btn btn-sm">← Previous day</Link>
          {date < today && <Link href={`/review?date=${next}`} className="btn btn-sm">Next day →</Link>}
        </nav>
      </header>

      <section className="card" aria-labelledby="mark-h">
        <h2 id="mark-h" className="h2">1. What happened?</h2>
        {blocks.length === 0 ? (
          <p className="muted mt-2 text-sm">Nothing was planned for this day.</p>
        ) : unmarked.length === 0 ? (
          <p className="mt-2 text-sm">Every block is marked.</p>
        ) : (
          <>
            <p className="muted mt-1 text-sm">{unmarked.length} block{unmarked.length === 1 ? "" : "s"} not marked yet.</p>
            <ul className="mt-1 flex flex-col">
              {unmarked.map((b) => <ReviewBlock key={b.id} id={b.id} title={b.title} time={time(b)} />)}
            </ul>
          </>
        )}
        {marked.length > 0 && (
          <>
            <h3 className="mt-4 text-sm font-semibold">Already marked</h3>
            <ul className="mt-1 flex flex-col">
              {marked.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 text-sm last:border-0">
                  <span className="w-36 shrink-0 tabular-nums muted">{time(b)}</span>
                  <span className="min-w-0 flex-1">
                    {b.title} <span className="badge">{CATEGORY_LABEL[blockCategory(b)] ?? b.status}</span>
                    {b.outcome_reason && <span className="muted block text-xs">Note: {b.outcome_reason}</span>}
                  </span>
                  <ActionButton className="btn btn-ghost btn-sm" action={blockOutcomeAction} args={[b.id, "planned", null]} label={`Change how “${b.title}” went`}>Change</ActionButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="score-h">
        <h2 id="score-h" className="h2">2. How the day went</h2>
        <p className="mt-1">{review.explanation}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Done", review.done],
            ["Partly done", review.partial],
            ["Rest / interrupted", review.rest + review.interrupted],
            ["Missing info", review.skippedMissingInfo],
            ["Took longer than estimated", review.overran],
            ["Skipped (no outside reason)", review.avoided],
            ["Not marked yet", review.unmarked],
            ["Focus minutes", review.focusMinutes],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg bg-surface-2 p-2"><dt className="muted text-xs">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>
          ))}
        </dl>
        {review.findings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{review.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        {review.carryOver.length > 0 && <p className="muted mt-2 text-sm">Still open and kept on your list: {[...new Set(review.carryOver.map((c) => c.title))].join("; ")}.</p>}
      </section>

      {next >= today && (
        <section className="card" aria-labelledby="next-h">
          <h2 id="next-h" className="h2">3. Plan {nextLabel}</h2>
          <p className="muted mt-1 text-sm">
            {nextFixed.length ? `Fixed: ${nextFixed.map((e) => `${e.title} ${formatTime(e.start!, zone)}`).join("; ")}.` : "No fixed commitments."}{" "}
            {(dueNextRes.count ?? 0) > 0 ? `${dueNextRes.count} task${dueNextRes.count === 1 ? "" : "s"} due.` : ""}
            {profile.availability.length === 0 && " Navi doesn't know when you're free yet, so set your availability in Settings first."}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <ActionButton className="btn btn-primary btn-sm" action={planDayAction} args={[next]} showResult>{next === today ? "Plan the rest of today" : "Plan tomorrow"}</ActionButton>
            <Link href={`/planner?start=${next}&view=day`} className="btn btn-sm">Open in planner</Link>
          </div>
        </section>
      )}
    </div>
  );
}

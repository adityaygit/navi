import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine } from "@/lib/types";
import { dayReview } from "@/server/domain/insights";
import { buildDayAgenda } from "@/server/planner/agenda";
import { formatDay, formatTime, nowIn } from "@/lib/time";
import { blockCategory } from "@/lib/outcomes";
import { ActionButton } from "@/components/action-button";
import { Pebble } from "@/components/pebble";
import { blockOutcomeAction, planDayAction } from "../actions";
import { ReviewBlock } from "./review-block";
import { statusWord } from "@/lib/follow-through";
import { DayStrip } from "@/components/insights-day-strip";

export const metadata = { title: "Daily review · Navi" };

const CATEGORY_BADGE: Record<string, string> = {
  done: "badge-ok",
  partial: "badge-accent",
  rest: "badge-warn",
  avoided: "badge-danger",
  missed: "badge-danger",
};
const TONE_BADGE = { good: "badge-ok", okay: "badge-warn", low: "badge-danger", none: "" } as const;

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

  const pct = review.completionRate === null ? null : Math.round(review.completionRate * 100);
  const word = statusWord(pct);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="eyebrow">Daily review</span>
          <nav aria-label="Review day" className="glass flex items-center gap-0.5 rounded-full p-0.5">
            <Link href={`/review?date=${prev}`} className="btn btn-ghost btn-sm">← Previous day</Link>
            {date < today && <Link href={`/review?date=${next}`} className="btn btn-ghost btn-sm">Next day →</Link>}
          </nav>
        </div>
        <h1 className="h1">{date === today ? "Today's review" : `Review of ${formatDay(date, zone)}`}</h1>
        <p className="text-[15px] text-muted">{formatDay(date, zone)}. Say what happened to each block; rest, interruptions, missing information and bad estimates don't count against you.</p>
      </header>

      <section className="surf flex flex-col gap-3 p-5 md:p-6" aria-labelledby="mark-h">
        <h2 id="mark-h" className="h2">1. What happened?</h2>
        {blocks.length === 0 ? (
          <p className="text-[15px] text-muted">Nothing was planned for this day.</p>
        ) : unmarked.length === 0 ? (
          <p className="text-[15px]">Every block is marked.</p>
        ) : (
          <>
            <p className="text-[15px] text-muted">{unmarked.length} block{unmarked.length === 1 ? "" : "s"} not marked yet.</p>
            <ul className="flex flex-col gap-2.5">
              {unmarked.map((b) => <ReviewBlock key={b.id} id={b.id} title={b.title} time={time(b)} />)}
            </ul>
          </>
        )}
        {marked.length > 0 && (
          <>
            <h3 className="eyebrow mt-3">Already marked</h3>
            <ul className="flex flex-col">
              {marked.map((b) => {
                const cat = blockCategory(b);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2.5 text-[15px] first:border-0">
                    <span className="num w-full shrink-0 text-sm text-muted sm:w-32">{time(b)}</span>
                    <span className="min-w-0 flex-1">
                      {b.title} <span className={`badge ml-1 ${CATEGORY_BADGE[cat] ?? ""}`}>{CATEGORY_LABEL[cat] ?? b.status}</span>
                      {b.outcome_reason && <span className="block text-[13px] text-muted">Note: {b.outcome_reason}</span>}
                    </span>
                    <ActionButton className="btn btn-ghost btn-sm" action={blockOutcomeAction} args={[b.id, "planned", null]} label={`Change how “${b.title}” went`}>Change</ActionButton>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="surf flex flex-col gap-4 p-5 md:p-6" aria-labelledby="score-h">
        <h2 id="score-h" className="h2">2. How the day went</h2>
        {pct !== null && (
          <div className="flex items-end gap-3">
            <span className="gh num display text-[64px] leading-[0.9] md:text-[80px]" aria-hidden>{pct}%</span>
            <span className={`badge mb-2 ${TONE_BADGE[word.tone]}`}>{word.word}</span>
            <span className="sr-only">Completion {pct}%, {word.word}.</span>
          </div>
        )}
        <p className="text-[15px] md:text-base">{review.explanation}</p>
        <DayStrip blocks={blocks} />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            ["Done", review.done],
            ["Partly done", review.partial],
            ["Rest / interrupted", review.rest + review.interrupted],
            ["Missing info", review.skippedMissingInfo],
            ["Took longer than estimated", review.overran],
            ["Skipped (no outside reason)", review.avoided, review.avoided > 0 ? "text-clash" : ""],
            ["Not marked yet", review.unmarked],
            ["Focus minutes", review.focusMinutes],
          ] as [string, number, string?][]).map(([k, v, cls]) => (
            <div key={k} className="well flex flex-col gap-0.5 px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className={`num text-lg font-semibold ${cls ?? ""}`}>{v}</dd></div>
          ))}
        </dl>
        {review.findings.length > 0 && (
          <div className="flex gap-3 rounded-[12px] border border-border bg-white/[0.03] p-3.5">
            <Pebble size={36} mood="nudge" />
            <ul className="flex min-w-0 flex-col gap-1.5 text-[15px]">{review.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        )}
        {review.carryOver.length > 0 && <p className="text-sm text-muted">Still open and kept on your list: {[...new Set(review.carryOver.map((c) => c.title))].join("; ")}.</p>}
      </section>

      {next >= today && (
        <section className="lg flex flex-col gap-3 p-5 md:p-6" aria-labelledby="next-h">
          <h2 id="next-h" className="h2">3. Plan {nextLabel}</h2>
          <p className="text-[15px] text-muted">
            {nextFixed.length ? `Fixed: ${nextFixed.map((e) => `${e.title} ${formatTime(e.start!, zone)}`).join("; ")}.` : "No fixed commitments."}{" "}
            {(dueNextRes.count ?? 0) > 0 ? `${dueNextRes.count} task${dueNextRes.count === 1 ? "" : "s"} due.` : ""}
            {profile.availability.length === 0 && " Navi doesn't know when you're free yet, so set your availability in Settings first."}
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <ActionButton className="btn btn-primary" action={planDayAction} args={[next]} showResult>{next === today ? "Plan the rest of today" : "Plan tomorrow"}</ActionButton>
            <Link href={`/planner?start=${next}&view=day`} className="btn">Open in planner</Link>
          </div>
        </section>
      )}
    </div>
  );
}

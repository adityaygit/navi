import { DateTime } from "luxon";
import Link from "next/link";
import { requireCtx } from "@/server/context";
import { weekInsights, ENOUGH_BLOCKS, ENOUGH_DAYS, INTERRUPTIONS_AT_TIME, PART_OF_DAY_HOURS } from "@/server/domain/insights";
import { nowIn } from "@/lib/time";
import type { Briefing } from "@/lib/types";
import { followThrough } from "@/lib/follow-through";
import { describeDisruptions } from "@/lib/outcomes";
import { ActionButton } from "@/components/action-button";
import { generateBriefingAction, planWeekAction } from "../actions";
import { InsightsHero } from "@/components/insights-hero";
import { PlannedDoneChart } from "@/components/insights-chart";
import { NaviLearning, NaviNoticed } from "@/components/insights-noticed";
import { InsightsStory, type StorySlide } from "@/components/insights-story";
import { dayBars, hm, learnings, noticed, readWeek, type WeekBlock } from "@/components/insights-week";

export const metadata = { title: "Insights · Navi" };

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ end?: string; report?: string }> }) {
  const ctx = await requireCtx();
  const zone = ctx.timezone;
  const today = nowIn(zone).toISODate()!;
  const sp = await searchParams;
  const asked = sp.end && /^\d{4}-\d{2}-\d{2}$/.test(sp.end) && DateTime.fromISO(sp.end, { zone }).isValid ? sp.end : today;
  const end = asked > today ? today : asked;
  const current = end === today;
  const endDt = DateTime.fromISO(end, { zone });
  const start = endDt.minus({ days: 6 }).toISODate()!;
  const prevEnd = endDt.minus({ days: 7 }).toISODate()!;
  const nextEnd = endDt.plus({ days: 7 }).toISODate()!;
  const tomorrow = DateTime.fromISO(today, { zone }).plus({ days: 1 }).toISODate()!;

  const [week, prevWeek, briefRes, blocksRes, memRes] = await Promise.all([
    weekInsights(ctx.db, ctx.userId, zone, end),
    weekInsights(ctx.db, ctx.userId, zone, prevEnd),
    ctx.db.from("briefings").select("*").order("created_at", { ascending: false }).limit(20),
    ctx.db.from("plan_blocks").select("plan_date,status,outcome_reason,starts_at,ends_at").gte("plan_date", start).lte("plan_date", end),
    ctx.db.from("memories").select("id,content,origin,confidence,evidence,last_confirmed_at").eq("kind", "behavioral").eq("status", "active").order("confidence", { ascending: false }).limit(6),
  ]);
  const briefings = (briefRes.data ?? []) as Briefing[];
  const ft = followThrough(week);
  const previous = followThrough(prevWeek).score;
  const bars = dayBars(week.days.map((d) => d.date), (blocksRes.data ?? []) as WeekBlock[], today);
  const anyPlan = bars.some((b) => b.kind !== "none");
  const reading = readWeek(bars, Object.fromEntries(week.days.map((d) => [d.date, d.disruptions])));
  const minutes = {
    planned: bars.reduce((s, b) => s + b.planned, 0),
    done: bars.reduce((s, b) => s + b.done, 0),
    partial: bars.reduce((s, b) => s + b.partial, 0),
    rest: bars.reduce((s, b) => s + b.rest, 0),
  };
  const notes = noticed(week, current, PART_OF_DAY_HOURS, INTERRUPTIONS_AT_TIME);
  const learning = learnings(memRes.data ?? []);
  const todayReview = week.days[week.days.length - 1];
  const fmt = (d: string) => DateTime.fromISO(d).toFormat("LLL d");
  const rangeLabel = `${fmt(start)} – ${fmt(end)}`;
  const ratedDays = week.days.filter((d) => d.completionRate !== null).length;
  const plannedBlocks = week.days.reduce((s, d) => s + d.planned, 0);

  const story = storySlides({ rangeLabel, current, ft, previous, minutes, reading, bars, notes, learningCount: learning.length, focus: week.focusMinutes, focusDays: week.days.map((d) => ({ long: DateTime.fromISO(d.date).toFormat("cccc"), minutes: d.focusMinutes })), next: current ? week.nextWeek : null });

  return (
    <div className="flex flex-col gap-5">
      <InsightsHero
        ft={ft}
        previous={previous}
        current={current}
        rangeLabel={rangeLabel}
        prevHref={`/insights?end=${prevEnd}`}
        nextHref={current ? null : nextEnd >= today ? "/insights" : `/insights?end=${nextEnd}`}
        minutes={minutes}
        enough={{ days: ratedDays, blocks: plannedBlocks, needDays: ENOUGH_DAYS, needBlocks: ENOUGH_BLOCKS }}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Reviews">
        <InsightsStory slides={story} rangeLabel={rangeLabel} autoOpen={sp.report === "1"} />
        <Link href={`/review?date=${today}`} className="btn btn-sm">Daily review</Link>
        <ActionButton className="btn btn-sm" action={generateBriefingAction} args={["evening"]}>Review today now</ActionButton>
        <ActionButton className="btn btn-sm" action={generateBriefingAction} args={["weekly"]}>Weekly review now</ActionButton>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <section aria-labelledby="pvd-h" className="surf flex min-w-0 flex-col gap-4 p-5 md:p-6">
          <h2 id="pvd-h" className="h2 md:text-[22px]">Planned vs done</h2>
          {anyPlan && <PlannedDoneChart bars={bars} />}
          <div className={`flex flex-col gap-2 ${anyPlan ? "border-t border-border pt-4" : ""} text-[15px] leading-relaxed text-muted md:text-base`}>
            {reading.map((r, i) => <p key={i} className={i === 0 ? "text-text" : ""}>{r}</p>)}
          </div>
          {!anyPlan && current && <Link href="/planner" className="btn btn-sm self-start">Open the planner</Link>}
        </section>
        <div className="flex min-w-0 flex-col gap-5">
          <NaviNoticed items={notes} enoughData={week.enoughData} planFrom={current ? tomorrow : null} />
          <NaviLearning items={learning} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {current && (
          <section aria-labelledby="today-h" className="surf flex flex-col gap-3 p-5">
            <h2 id="today-h" className="h2">Today so far</h2>
            <p className="text-[15px]">{todayReview.explanation}</p>
            <Stats
              items={[
                ["Done", todayReview.done],
                ["Partly done", todayReview.partial],
                ["Rest / interrupted", todayReview.rest + todayReview.interrupted],
                ["Skipped (no outside reason)", todayReview.avoided, todayReview.avoided > 0 ? "text-clash" : ""],
                ["Not marked yet", todayReview.unmarked],
                ["Focus minutes", todayReview.focusMinutes],
                ["Tasks completed", todayReview.tasksCompleted],
                ["Blocked on info", todayReview.skippedMissingInfo],
                ["Took longer than estimated", todayReview.overran],
              ]}
            />
            {todayReview.findings.length > 0 && <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">{todayReview.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            <Link href={`/review?date=${today}`} className="btn btn-sm self-start">Open today's review</Link>
          </section>
        )}

        <section aria-labelledby="week-h" className="surf flex flex-col gap-3 p-5">
          <h2 id="week-h" className="h2">{current ? "Last 7 days" : `${rangeLabel} in numbers`}</h2>
          <p className="text-sm text-muted">
            {week.tasksCompleted} task{week.tasksCompleted === 1 ? "" : "s"} completed · {week.focusMinutes} focus minute{week.focusMinutes === 1 ? "" : "s"}
            {week.estimate.medianRatio !== null ? ` · tasks take ~${week.estimate.medianRatio.toFixed(1)}× estimates (${week.estimate.samples} samples)` : ""}
          </p>
          <Stats
            items={[
              ["Planned work", hm(minutes.planned)],
              ["Marked done", hm(minutes.done)],
              ["Partly done", hm(minutes.partial)],
              ["Rest planned", hm(minutes.rest)],
              ["Measured focus", hm(week.minutes.focus)],
              ["Took longer than estimated", week.overran],
            ]}
          />
          <p className="text-sm text-muted">Plan broke this week: {describeDisruptions(week.disruptions) || "never"}.</p>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Everything the review found ({week.findings.length})</summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted">{week.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </details>
        </section>

        <section aria-labelledby="progress-h" className="surf flex flex-col gap-2 p-5">
          <h2 id="progress-h" className="h2">Projects & goals {current ? "this week" : "that week"}</h2>
          {week.progress.length === 0 ? (
            <p className="text-sm text-muted">No tasks linked to a project or goal yet.</p>
          ) : (
            <ul className="flex flex-col">
              {week.progress.map((p) => {
                const total = p.completed + p.open;
                return (
                  <li key={p.kind + p.id} className="flex flex-col gap-1.5 border-b border-border py-3 text-sm last:border-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-[15px]">{p.name} <span className="badge ml-1">{p.kind}</span></span>
                      <span className="num text-muted">{p.completed} done · {p.open} open</span>
                    </div>
                    {total > 0 && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                        <div className={`h-full rounded-full ${p.completed ? "bg-focus" : ""}`} style={{ width: `${(p.completed / total) * 100}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {current && (
          <section aria-labelledby="nextweek-h" className="surf flex flex-col gap-2 p-5">
            <h2 id="nextweek-h" className="h2">Next 7 days</h2>
            <p className="text-[15px]">
              Work due needs about {hm(week.nextWeek.loadMinutes)}{week.nextWeek.unestimated ? ` (${week.nextWeek.unestimated} without an estimate, 30 min assumed)` : ""}; you have about {hm(week.nextWeek.freeMinutes)} free after fixed commitments.
              {week.nextWeek.overloaded && <strong className="text-clash"> That's more than your free time.</strong>}
            </p>
            {week.nextWeek.deadlines.length === 0 ? (
              <p className="text-sm text-muted">No deadlines in the next 7 days.</p>
            ) : (
              <ul className="flex flex-col text-sm">
                {week.nextWeek.deadlines.map((d) => (
                  <li key={d.id} className="flex flex-wrap gap-2 border-b border-border py-2.5 last:border-0">
                    <span className="min-w-0 flex-1">{d.title}{d.due_is_hard && <span className="badge badge-warn ml-2">hard</span>}</span>
                    <span className="num text-muted">{DateTime.fromISO(d.due_at).setZone(zone).toFormat("ccc LLL d, h:mm a")}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1">
              <ActionButton className="btn btn-primary btn-sm" action={planWeekAction} args={[tomorrow]} showResult>Plan next week</ActionButton>
            </div>
          </section>
        )}
      </div>

      <section aria-labelledby="br-h" className="flex flex-col gap-2">
        <h2 id="br-h" className="h2">Briefings & reviews</h2>
        {briefings.length === 0 ? (
          <p className="text-sm text-muted">None yet. Morning briefings and evening reviews are saved here automatically at your configured times.</p>
        ) : (
          <div className="surf flex flex-col divide-hair px-5">
            {briefings.map((b) => (
              <details key={b.id} className="py-3" open={b === briefings[0]}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-medium">
                  <span>{b.title}</span>
                  <span className="badge">{b.kind}</span>
                  <span className="num ml-auto text-xs font-normal text-muted">{DateTime.fromISO(b.created_at).setZone(zone).toFormat("ccc LLL d")}</span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[#d8d9dc]">{b.body}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stats({ items }: { items: [string, string | number, string?][] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([k, v, cls]) => (
        <div key={k} className="well flex flex-col gap-0.5 px-3 py-2">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={`num text-lg font-semibold ${cls ?? ""}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The weekly report as a story: one real insight per screen, only the ones the data supports. */
function storySlides(s: {
  rangeLabel: string;
  current: boolean;
  ft: ReturnType<typeof followThrough>;
  previous: number | null;
  minutes: { planned: number; done: number; partial: number };
  reading: string[];
  bars: ReturnType<typeof dayBars>;
  notes: ReturnType<typeof noticed>;
  learningCount: number;
  focus: number;
  focusDays: { long: string; minutes: number }[];
  next: { loadMinutes: number; freeMinutes: number; overloaded: boolean; deadlines: unknown[] } | null;
}): StorySlide[] {
  const slides: StorySlide[] = [];
  const delta = s.ft.score !== null && s.previous !== null ? s.ft.score - s.previous : null;
  slides.push(
    s.ft.score !== null
      ? { kind: "score", title: `Your follow-through ${s.current ? "this week" : "that week"} was ${s.ft.score}.`, body: delta === null ? "There's no score for the week before to compare with." : delta === 0 ? "The same as the week before." : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} on the week before (${s.previous}).`, big: String(s.ft.score) }
      : { kind: "text", title: "Not enough days yet for a score.", body: "Keep marking how your blocks went. Navi only scores a week once there's enough recorded to be fair." },
  );
  if (s.minutes.planned > 0) {
    slides.push({ kind: "chart", title: `You finished ${hm(s.minutes.done)} of the ${hm(s.minutes.planned)} you planned.`, body: s.reading[0] ?? "", bars: s.bars });
    if (s.reading.length > 1) slides.push({ kind: "text", title: "The rest of the week", body: s.reading.slice(1).join(" ") });
  }
  const focusDay = [...s.focusDays].sort((a, b) => b.minutes - a.minutes)[0];
  if (s.focus > 0) slides.push({ kind: "text", title: `You spent ${hm(s.focus)} in focus sessions.`, body: `Your most focused day was ${focusDay.long}, with ${hm(focusDay.minutes)}.` });
  for (const n of s.notes.slice(0, 2)) slides.push({ kind: "noticed", title: "Navi noticed", body: n.text });
  if (s.next) {
    slides.push({ kind: "text", title: s.next.overloaded ? "Next week is more than you have time for." : "Next week fits your free time.", body: `Work due needs about ${hm(s.next.loadMinutes)}; you have about ${hm(s.next.freeMinutes)} free after fixed commitments. ${s.next.deadlines.length} deadline${s.next.deadlines.length === 1 ? "" : "s"} in the next 7 days.` });
  }
  if (s.learningCount > 0) slides.push({ kind: "text", title: `Navi is learning ${s.learningCount} thing${s.learningCount === 1 ? "" : "s"} about how you work.`, body: "You can see the evidence, correct or delete any of them in Memory." });
  return slides;
}

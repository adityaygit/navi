import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import type { CalendarEvent, PlanBlock, Routine } from "@/lib/types";
import { eventOccurrence } from "@/server/planner/scheduler";
import { formatTime, nowIn } from "@/lib/time";
import { ActionButton } from "@/components/action-button";
import { PlanBlockRow } from "@/components/plan-block";
import { planDayAction, planWeekAction } from "../actions";
import { AddCommitment } from "./add-commitment";

export const metadata = { title: "Planner · Navi" };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ start?: string; view?: string }> }) {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const sp = await searchParams;
  const today = nowIn(zone).toISODate()!;
  const view = sp.view === "day" ? "day" : "week";
  const start = sp.start && /^\d{4}-\d{2}-\d{2}$/.test(sp.start) ? sp.start : today;
  const startDt = DateTime.fromISO(start, { zone });
  const days = Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => startDt.plus({ days: i }).toISODate()!);
  const [blocksRes, eventsRes, routinesRes, focusRes] = await Promise.all([
    ctx.db.from("plan_blocks").select("*").gte("plan_date", days[0]).lte("plan_date", days[days.length - 1]).order("starts_at"),
    ctx.db.from("events").select("*").neq("status", "cancelled"),
    ctx.db.from("routines").select("*").eq("active", true),
    ctx.db.from("focus_sessions").select("id").is("ended_at", null).maybeSingle(),
  ]);
  const blocks = (blocksRes.data ?? []) as PlanBlock[];
  const events = (eventsRes.data ?? []) as CalendarEvent[];
  const routines = (routinesRes.data ?? []) as Routine[];
  const step = view === "day" ? 1 : 7;
  const nav = (d: string, v = view) => `/planner?start=${d}&view=${v}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="h1 mr-auto">Planner</h1>
        <div className="flex gap-1" role="group" aria-label="View">
          <Link href={nav(start, "day")} className={`btn btn-sm ${view === "day" ? "btn-primary" : ""}`} aria-current={view === "day" ? "page" : undefined}>Day</Link>
          <Link href={nav(start, "week")} className={`btn btn-sm ${view === "week" ? "btn-primary" : ""}`} aria-current={view === "week" ? "page" : undefined}>Week</Link>
        </div>
        <div className="flex gap-1">
          <Link href={nav(startDt.minus({ days: step }).toISODate()!)} className="btn btn-sm" aria-label="Previous">←</Link>
          <Link href={nav(today)} className="btn btn-sm">Today</Link>
          <Link href={nav(startDt.plus({ days: step }).toISODate()!)} className="btn btn-sm" aria-label="Next">→</Link>
        </div>
        {view === "day" ? (
          <ActionButton className="btn btn-primary btn-sm" action={planDayAction} args={[start]}>Plan this day</ActionButton>
        ) : (
          <ActionButton className="btn btn-primary btn-sm" action={planWeekAction}>Plan next 7 days</ActionButton>
        )}
      </header>
      {profile.availability.length === 0 && (
        <p className="notice notice-warn text-sm">
          Navi won't invent free time. Set when you're available in <Link className="underline" href="/settings">Settings</Link> (or tell Navi) so it can schedule flexible work.
        </p>
      )}
      <p className="muted text-xs">Fixed commitments never move automatically. Flexible blocks are placed by Navi and can be re-planned any time. Due dates are deadlines, not scheduled times.</p>
      <div className={view === "week" ? "grid gap-3 lg:grid-cols-2" : ""}>
        {days.map((d) => {
          const dt = DateTime.fromISO(d, { zone });
          const fixed = [
            ...events.map((e) => ({ e, iv: eventOccurrence(e, d, zone) })).filter((x) => x.iv).map((x) => ({ id: x.e.id, title: x.e.title, start: x.iv!.start!.toISO()!, end: x.iv!.end!.toISO()!, external: Boolean(x.e.external_ref) })),
            ...routines.filter((r) => r.start_time && r.days.includes(dt.weekday % 7)).map((r) => {
              const s = dt.set({ hour: Number(r.start_time!.slice(0, 2)), minute: Number(r.start_time!.slice(3, 5)) });
              return { id: r.id, title: r.title, start: s.toISO()!, end: s.plus({ minutes: r.duration_minutes }).toISO()!, external: false };
            }),
          ].sort((a, b) => a.start.localeCompare(b.start));
          const dayBlocks = blocks.filter((b) => b.plan_date === d);
          return (
            <section key={d} className="card" aria-label={dt.toFormat("cccc LLL d")}>
              <div className="flex items-center gap-2">
                <h2 className={`font-semibold ${d === today ? "text-accent" : ""}`}>{dt.toFormat("cccc, LLL d")}{d === today ? " · today" : ""}</h2>
                {view === "week" && <Link href={nav(d, "day")} className="btn btn-ghost btn-sm ml-auto">Open</Link>}
              </div>
              {fixed.length === 0 && dayBlocks.length === 0 && <p className="muted mt-2 text-sm">Nothing scheduled.</p>}
              {(fixed.length > 0 || dayBlocks.length > 0) && (
                // One timeline: fixed commitments and flexible blocks in time order.
                <ul className="mt-2 flex flex-col">
                  {[
                    ...fixed.map((f) => ({ at: Date.parse(f.start), fixed: f, block: null })),
                    ...dayBlocks.map((b) => ({ at: Date.parse(b.starts_at), fixed: null, block: b })),
                  ]
                    .sort((a, b) => a.at - b.at)
                    .map(({ fixed: f, block: b }) =>
                      f ? (
                        <li key={f.id + f.start} className="my-1 flex gap-3 rounded-lg bg-surface-2 px-2 py-1.5 text-sm">
                          <span className="w-32 shrink-0 tabular-nums">{formatTime(f.start, zone)}–{formatTime(f.end, zone)}</span>
                          <span className="flex-1">{f.title}</span>
                          <span className="badge">{f.external ? "external" : "fixed"}</span>
                        </li>
                      ) : (
                        <PlanBlockRow key={b!.id} block={b!} time={`${formatTime(b!.starts_at, zone)}–${formatTime(b!.ends_at, zone)}`} canFocus={!focusRes.data && d === today} />
                      ),
                    )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <AddCommitment zone={zone} defaultDate={start} />
    </div>
  );
}

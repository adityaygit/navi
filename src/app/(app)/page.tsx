import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx, getProfile } from "@/server/context";
import type { Briefing, Task } from "@/lib/types";
import { Stone } from "@/components/shell/stone";
import { spaceColor } from "@/lib/space-color";
import { HomeComposer, Insight, StartFocusButton, type InsightView } from "@/components/home/home-parts";
import { awakeSpan, dayFrom, loadSources, zoneHelpers, wakeBed } from "@/server/day";
import { greeting, homeSummary, lastWorkedText, partOf, type DayPart, type Line } from "@/lib/sentences";
import { formatTime } from "@/lib/time";

export const metadata = { title: "Home · Navi" };

const OCCASION = /\b(birthday|bday|anniversary|wedding|graduation)\b/i;

function Sentence({ line }: { line: Line }) {
  return (
    <>
      {line.map((s, i) => (
        <span key={i} className={s.strong ? "text-text" : "text-faint"}>{s.text}</span>
      ))}
    </>
  );
}

/**
 * Home: companion-first and work-centred. A greeting and one line about today
 * (from real counts), the day at a glance, where to pick up, and at most one
 * suggestion. Every sentence follows the sources contract (src/lib/sentences.ts).
 */
export default async function HomePage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  const nowMs = now.toMillis();
  const today = now.toISODate()!;
  const yesterday = now.minus({ days: 1 }).toISODate()!;
  const dayStart = now.startOf("day").toISO()!;
  const dayEnd = now.endOf("day").toISO()!;
  const z = zoneHelpers(zone);

  const [src, dueTodayRes, focusOpenRes, lastFocusRes, briefingRes, unmarkedRes, dismissedRes, nextDueRes, openTasksRes] = await Promise.all([
    loadSources(ctx, today, today),
    ctx.db.from("tasks").select("id,status,parent_task_id").is("parent_task_id", null).neq("status", "cancelled").gte("due_at", dayStart).lte("due_at", dayEnd),
    ctx.db.from("focus_sessions").select("id,started_at,task_id,tasks(title)").is("ended_at", null).maybeSingle(),
    ctx.db.from("focus_sessions").select("ended_at,actual_minutes,task_id,tasks(id,title,status,estimate_minutes)").eq("outcome", "progress").not("task_id", "is", null).gte("ended_at", now.minus({ days: 7 }).toISO()!).order("ended_at", { ascending: false }).limit(5),
    ctx.db.from("briefings").select("*").is("read_at", null).eq("local_date", today).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.db.from("plan_blocks").select("id", { count: "exact", head: true }).eq("plan_date", yesterday).in("status", ["planned", "in_progress"]),
    ctx.db.from("dismissed_suggestions").select("key"),
    ctx.db.from("tasks").select("id,title,due_at,estimate_minutes").is("parent_task_id", null).in("status", ["todo", "in_progress", "blocked"]).not("due_at", "is", null).order("due_at").limit(1).maybeSingle(),
    ctx.db.from("tasks").select("title").in("status", ["todo", "in_progress", "blocked"]),
  ]);
  const day = dayFrom(src, today);
  const dismissed = new Set(((dismissedRes.data ?? []) as { key: string }[]).map((d) => d.key));

  // ---- the summary: today's tasks (due today, or with a block today) and planned time by part of day
  const todayTasks = new Map<string, boolean>();
  for (const t of (dueTodayRes.data ?? []) as Pick<Task, "id" | "status">[]) todayTasks.set(t.id, t.status === "done");
  const blockTaskIds = [...new Set(day.items.filter((i) => i.taskId).map((i) => i.taskId!))].filter((id) => !todayTasks.has(id));
  if (blockTaskIds.length) {
    const { data } = await ctx.db.from("tasks").select("id,status,parent_task_id").in("id", blockTaskIds).neq("status", "cancelled");
    for (const t of (data ?? []) as Pick<Task, "id" | "status" | "parent_task_id">[]) if (!t.parent_task_id) todayTasks.set(t.id, t.status === "done");
  }
  const planned: Record<DayPart, number> = { morning: 0, afternoon: 0, evening: 0 };
  for (const it of day.items) {
    for (let t = it.startMs; t < it.endMs; t += 15 * 60000) planned[partOf(z.minuteOfDay(t))] += Math.min(15, (it.endMs - t) / 60000);
  }
  const firstName = profile.display_name?.trim().split(/\s+/)[0] ?? null;
  const summary = homeSummary([...todayTasks.values()].map((done) => ({ done })), planned);

  // ---- the day bar: wake-up to bedtime when known, else 7 AM – 11 PM
  const awake = awakeSpan(profile, today, zone);
  const barStart = awake?.start ?? DateTime.fromISO(`${today}T07:00`, { zone }).toMillis();
  const barEnd = awake?.end ?? DateTime.fromISO(`${today}T23:00`, { zone }).toMillis();
  const span = barEnd - barStart;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - barStart) / span) * 100));
  const barItems = day.items.filter((i) => i.endMs > barStart && i.startMs < barEnd);
  const nowIn = nowMs >= barStart && nowMs <= barEnd;
  const current = day.items.find((i) => i.startMs <= nowMs && i.endMs > nowMs) ?? null;
  const next = day.items.find((i) => i.startMs > nowMs) ?? null;
  const ticks = [barStart, barStart + span / 3, barStart + (2 * span) / 3, barEnd].map((ms) => {
    const d = DateTime.fromMillis(ms, { zone });
    const rounded = d.minute >= 30 ? d.plus({ hours: 1 }).startOf("hour") : d.startOf("hour");
    return rounded.hour === 12 ? "Noon" : rounded.toFormat("h a");
  });

  // ---- continue: an open focus session, else the latest one with progress, else the next due task
  type Cont = { label: string; title: string; sub: string; taskId: string; minutes: number | null; live?: boolean };
  let cont: Cont | null = null;
  const openFocus = focusOpenRes.data as { id: string; started_at: string; task_id: string | null; tasks: { title: string } | null } | null;
  if (openFocus) {
    cont = { label: "Focusing now", title: openFocus.tasks?.title ?? "Focus", sub: `Started ${formatTime(openFocus.started_at, zone)}.`, taskId: openFocus.task_id ?? "", minutes: null, live: true };
  } else {
    type LastRow = { ended_at: string; actual_minutes: number | null; task_id: string; tasks: Pick<Task, "id" | "title" | "status" | "estimate_minutes"> | null };
    const last = ((lastFocusRes.data ?? []) as unknown as LastRow[]).find((r) => r.tasks && !["done", "cancelled"].includes(r.tasks.status));
    if (last?.tasks) {
      const { data: step } = await ctx.db.from("tasks").select("title").eq("parent_task_id", last.tasks.id).in("status", ["todo", "in_progress", "blocked"]).order("created_at").limit(1).maybeSingle();
      const worked = lastWorkedText(Date.parse(last.ended_at), last.actual_minutes, nowMs, z.hourOf, z.sameDay, z.yesterday);
      const stepText = step?.title ? ` Next step: ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}.` : "";
      cont = { label: "Pick up where you left off", title: last.tasks.title, sub: `${worked}${stepText}`, taskId: last.tasks.id, minutes: last.tasks.estimate_minutes ? Math.min(last.tasks.estimate_minutes, 50) : 25 };
    } else if (nextDueRes.data) {
      const t = nextDueRes.data as Pick<Task, "id" | "title" | "due_at" | "estimate_minutes">;
      const due = DateTime.fromISO(t.due_at!, { zone });
      const when = due.hasSame(now, "day") ? `today at ${due.toFormat("h:mm a")}` : due < now ? `${due.toFormat("ccc")} — it's overdue` : due.toFormat("cccc");
      cont = { label: "Next up", title: t.title, sub: `Due ${when}.`, taskId: t.id, minutes: t.estimate_minutes ? Math.min(t.estimate_minutes, 50) : 25 };
    }
  }
  // ---- one insight, from a fixed list, in this order
  let insight: InsightView | null = null;
  const briefing = briefingRes.data as Briefing | null;
  if (profile.onboarding_status === "skipped") insight = { kind: "setup" };
  else if (briefing) insight = { kind: "briefing", id: briefing.id, title: briefing.title, body: briefing.body };
  else if ((unmarkedRes.count ?? 0) > 0 && !dismissed.has(`unmarked:${yesterday}`)) insight = { kind: "unmarked", key: `unmarked:${yesterday}`, count: unmarkedRes.count ?? 0, date: yesterday };
  else {
    // An occasion on the calendar in the next 7 days with no open task that mentions it.
    const openTitles = ((openTasksRes.data ?? []) as { title: string }[]).map((t) => t.title.toLowerCase());
    for (let d = 0; d < 7 && !insight; d++) {
      const date = now.plus({ days: d }).toISODate()!;
      for (const it of dayFrom(src, date).items) {
        if (it.kind !== "event" || !OCCASION.test(it.title)) continue;
        const key = `event_without_task:${it.id}:${date}`;
        if (dismissed.has(key)) continue;
        const who = it.title.replace(/['’]s\b.*$/i, "").replace(OCCASION, "").trim().toLowerCase();
        const words = [who, ...it.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !OCCASION.test(w))].filter(Boolean);
        if (openTitles.some((t) => words.some((w) => t.includes(w)))) continue;
        const dayName = d === 0 ? "today" : d === 1 ? "tomorrow" : DateTime.fromISO(date, { zone }).toFormat("cccc");
        insight = { kind: "occasion", key, text: `${it.title} is on your calendar ${d <= 1 ? dayName : `for ${dayName}`} and there's no task for it yet. Add one?`, ask: `${it.title} is ${dayName}. Add a task so I'm ready for it.` };
        break;
      }
    }
  }

  const ringC = 2 * Math.PI * 15;
  const hasWakeBed = !!wakeBed(profile);

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col items-center pb-6 pt-2 md:pt-10">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-260px] -z-10 h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--navi-text)_10%,transparent)_0%,color-mix(in_srgb,var(--navi-text)_3%,transparent)_38%,transparent_70%)]" />
      <Stone size={120} lit className="mt-2" />
      <div aria-hidden="true" className="mt-3 h-3.5 w-[104px] rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--navi-mid)_18%,transparent)_0%,transparent_70%)]" />

      <h1 className="mt-6 max-w-[720px] text-center text-[28px] font-semibold leading-[1.22] tracking-[-0.025em] md:text-[34px]">
        <span className="text-text">{greeting(firstName, now.hour)}</span>
        <br />
        <Sentence line={summary} />
      </h1>

      {barItems.length > 0 ? (
        <section aria-label="Your day" className="mt-10 flex w-full max-w-[760px] flex-col gap-3">
          <div className="flex justify-between px-0.5 text-[12.5px] text-dim" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
          <div
            role="img"
            aria-label={`Your day: ${barItems.map((i) => `${i.title} ${formatTime(i.start!, zone)}`).join(", ")}`}
            className="relative h-[46px] overflow-hidden rounded-[23px] border border-white/[0.06] bg-white/[0.045]"
          >
            {barItems.map((i) => {
              const color = i.spaceId && src.spaces.get(i.spaceId) ? spaceColor(src.spaces.get(i.spaceId)!) : i.kind === "block" ? "#A7EBC0" : "#C8C8CE";
              const left = pct(i.startMs);
              const width = Math.max(1.5, pct(i.endMs) - left);
              return (
                <span
                  key={`${i.kind}${i.id}`}
                  className="absolute bottom-1.5 top-1.5 block overflow-hidden text-ellipsis whitespace-nowrap rounded-[17px] leading-[34px] px-3 text-[12.5px]"
                  style={{ left: `${left}%`, width: `${width}%`, background: `color-mix(in srgb, ${color} 24%, transparent)`, color: `color-mix(in srgb, ${color} 55%, white)` }}
                  title={`${i.title}, ${formatTime(i.start!, zone)}–${formatTime(i.end!, zone)}`}
                >
                  {width > 4 ? i.title : ""}
                </span>
              );
            })}
            {nowIn && <span className="absolute bottom-0 top-0 w-0.5 bg-text" style={{ left: `${pct(nowMs)}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-[18px] gap-y-1 px-0.5 text-[12.5px] text-dim">
            <span>Now {now.toFormat("h:mm a")}</span>
            <span aria-hidden="true">·</span>
            <span>{current ? `${current.title} until ${formatTime(current.end!, zone)}` : next ? `Free until ${formatTime(next.start!, zone)}` : "Nothing else planned today"}</span>
            <span className="flex-1" />
            <Link href="/planner" className="text-[var(--navi-text)] hover:underline">Open my day →</Link>
          </div>
        </section>
      ) : (
        <p className="mt-8 text-[15px] text-dim">
          Your day is open. <Link href="/planner" className="text-[var(--navi-text)] hover:underline">Open my day →</Link>
        </p>
      )}

      {cont && (
        <section aria-label={cont.label} className="mt-[26px] flex w-full max-w-[760px] flex-wrap items-center gap-[18px] rounded-[22px] border border-white/[0.07] bg-white/[0.05] px-[22px] py-5">
          <svg width="46" height="46" viewBox="0 0 36 36" aria-hidden="true" className="hidden sm:block">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--navi-text)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${cont.live ? ringC : ringC * 0.4} ${ringC}`} transform="rotate(-90 18 18)" />
          </svg>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[12.5px] font-medium text-[var(--navi-text)]">{cont.label}</span>
            <span className="text-[17px] font-semibold tracking-[-0.01em]">{cont.title}</span>
            <span className="text-[#8E8E96]">{cont.sub}</span>
          </div>
          {cont.live ? (
            <Link href="/focus" className="flex h-11 items-center rounded-[22px] bg-text px-5 font-semibold text-black">Back to focus</Link>
          ) : (
            cont.taskId && <StartFocusButton taskId={cont.taskId} minutes={cont.minutes} />
          )}
        </section>
      )}

      {insight && (
        <div className="mt-4 w-full max-w-[760px]">
          <Insight insight={insight} />
        </div>
      )}
      {!hasWakeBed && profile.onboarding_status === "completed" && !insight && (
        <p className="mt-4 text-[13px] text-dim">Add your wake-up and bedtime in <Link href="/settings" className="underline">Settings</Link> and Navi can count your free time.</p>
      )}

      <div className="h-16 flex-1" />
      <HomeComposer />
    </div>
  );
}

import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { PlanBlock, Task, Workspace } from "@/lib/types";
import { tasksHeadline } from "@/lib/sentences";
import { spaceColor } from "@/lib/space-color";
import { TaskBoard, type TaskGroup, type Nudge } from "@/components/tasks/task-board";
import { QuickAddBar } from "@/components/tasks/quick-add-bar";

export const metadata = { title: "Tasks · Navi" };

/**
 * The tabs. "Someday" is the lowest priority (priority 4) with no due date:
 * there is no separate column for it. Everything else open and undated is
 * "Anytime".
 */
const TABS = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "anytime", label: "Anytime" },
  { key: "someday", label: "Someday" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const OPEN = ["todo", "in_progress", "blocked"];
const END_OF_DAY = (iso: string, zone: string) => {
  const d = DateTime.fromISO(iso, { zone });
  return d.hour === 23 && d.minute === 59;
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string; space?: string; open?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const zone = ctx.timezone;
  const tab: Tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "today") as Tab;
  const now = DateTime.now().setZone(zone);
  const today = now.toISODate()!;
  const dayStart = now.startOf("day").toISO()!;
  const dayEnd = now.endOf("day");

  const [openRes, doneTodayRes, blocksRes, spacesRes, dismissedRes] = await Promise.all([
    ctx.db.from("tasks").select("*").in("status", OPEN).is("parent_task_id", null).order("due_at", { ascending: true, nullsFirst: false }).order("created_at"),
    ctx.db.from("tasks").select("*").eq("status", "done").is("parent_task_id", null).gte("completed_at", dayStart),
    ctx.db.from("plan_blocks").select("task_id,starts_at,status").eq("plan_date", today).not("task_id", "is", null).order("starts_at"),
    ctx.db.from("workspaces").select("id,name,color").eq("status", "active").order("sort_order").order("created_at"),
    ctx.db.from("dismissed_suggestions").select("key").like("key", "old_task:%"),
  ]);
  const spaces = (spacesRes.data ?? []) as Pick<Workspace, "id" | "name" | "color">[];
  const space = sp.space ? (spaces.find((s) => s.id === sp.space) ?? null) : null;
  const inSpace = (t: Task) => !space || t.workspace_id === space.id;
  const open = ((openRes.data ?? []) as Task[]).filter(inSpace);
  const doneToday = ((doneTodayRes.data ?? []) as Task[]).filter(inSpace);

  // A task's time today: its first plan block today, else its due time if due today (not "end of day").
  const blockStart = new Map<string, string>();
  for (const b of (blocksRes.data ?? []) as Pick<PlanBlock, "task_id" | "starts_at" | "status">[]) {
    if (b.task_id && !blockStart.has(b.task_id) && !["skipped", "missed"].includes(b.status)) blockStart.set(b.task_id, b.starts_at);
  }
  const dueMs = (t: Task) => (t.due_at ? Date.parse(t.due_at) : null);
  const isToday = (t: Task) => blockStart.has(t.id) || (dueMs(t) != null && dueMs(t)! <= dayEnd.toMillis());
  const todayOpen = open.filter(isToday);
  const todayDone = doneToday.filter((t) => blockStart.has(t.id) || (dueMs(t) != null && dueMs(t)! <= dayEnd.toMillis()) || !t.due_at);

  let shown: Task[] = [];
  const groups: TaskGroup[] = [];
  if (tab === "today") {
    shown = [...todayOpen, ...todayDone];
    const timeOf = (t: Task): number | null => {
      const b = blockStart.get(t.id);
      if (b) return Date.parse(b);
      if (t.due_at && dueMs(t)! >= Date.parse(dayStart) && !END_OF_DAY(t.due_at, zone)) return dueMs(t);
      return null;
    };
    const overdue = todayOpen.filter((t) => !blockStart.has(t.id) && dueMs(t)! < Date.parse(dayStart));
    const rest = shown.filter((t) => !overdue.includes(t));
    const parts: { key: TaskGroup["key"]; label: string; test: (min: number) => boolean }[] = [
      { key: "morning", label: "This morning", test: (m) => m < 12 * 60 },
      { key: "afternoon", label: "This afternoon", test: (m) => m >= 12 * 60 && m < 17 * 60 },
      { key: "evening", label: "This evening", test: (m) => m >= 17 * 60 },
    ];
    if (overdue.length) groups.push({ key: "overdue", label: "Overdue", ids: overdue.map((t) => t.id) });
    const timed = rest.filter((t) => timeOf(t) != null).sort((a, b) => timeOf(a)! - timeOf(b)!);
    for (const p of parts) {
      const ids = timed.filter((t) => {
        const d = DateTime.fromMillis(timeOf(t)!, { zone });
        return p.test(d.hour * 60 + d.minute);
      });
      if (ids.length) groups.push({ key: p.key, label: p.label, ids: ids.map((t) => t.id) });
    }
    const untimed = rest.filter((t) => timeOf(t) == null);
    if (untimed.length) groups.push({ key: "anytime", label: "Anytime today", ids: untimed.map((t) => t.id) });
  } else if (tab === "upcoming") {
    shown = open.filter((t) => !isToday(t) && t.due_at);
    const byDay = new Map<string, string[]>();
    for (const t of shown) {
      const d = DateTime.fromISO(t.due_at!, { zone });
      const days = Math.round(d.startOf("day").diff(now.startOf("day"), "days").days);
      const label = days === 1 ? "Tomorrow" : days < 7 ? d.toFormat("cccc") : d.toFormat("cccc, LLL d");
      byDay.set(label, [...(byDay.get(label) ?? []), t.id]);
    }
    for (const [label, ids] of byDay) groups.push({ key: "date", label, ids });
  } else if (tab === "anytime") {
    shown = open.filter((t) => !t.due_at && t.priority < 4 && !blockStart.has(t.id));
    if (shown.length) groups.push({ key: "list", label: "", ids: shown.map((t) => t.id) });
  } else {
    shown = open.filter((t) => !t.due_at && t.priority === 4 && !blockStart.has(t.id));
    if (shown.length) groups.push({ key: "list", label: "", ids: shown.map((t) => t.id) });
  }

  // Steps (subtasks) of everything shown, plus the "opened from search" task if it's elsewhere.
  const ids = shown.map((t) => t.id);
  let extra: Task | null = null;
  if (sp.open && !ids.includes(sp.open)) {
    const { data } = await ctx.db.from("tasks").select("*").eq("id", sp.open).maybeSingle();
    if (data) {
      const t = data as Task;
      const target = t.parent_task_id ?? t.id;
      if (!ids.includes(target)) {
        const { data: parent } = t.parent_task_id ? await ctx.db.from("tasks").select("*").eq("id", target).maybeSingle() : { data: t };
        if (parent) {
          extra = parent as Task;
          groups.unshift({ key: "list", label: "From search", ids: [extra.id] });
          shown.push(extra);
          ids.push(extra.id);
        }
      }
    }
  }
  const stepsRes = ids.length ? await ctx.db.from("tasks").select("*").in("parent_task_id", ids).neq("status", "cancelled").order("created_at") : { data: [] };
  const steps: Record<string, Task[]> = {};
  for (const s of (stepsRes.data ?? []) as Task[]) (steps[s.parent_task_id!] ??= []).push(s);

  // One nudge, at most: a task waiting 14+ days with no steps and not dismissed before.
  const dismissed = new Set(((dismissedRes.data ?? []) as { key: string }[]).map((d) => d.key));
  let nudge: Nudge | null = null;
  const oldCandidates = open.filter((t) => Date.parse(t.created_at) <= now.minus({ days: 14 }).toMillis() && !dismissed.has(`old_task:${t.id}`));
  if (oldCandidates.length) {
    const withSteps = new Set<string>();
    const { data: stepParents } = await ctx.db.from("tasks").select("parent_task_id").in("parent_task_id", oldCandidates.map((t) => t.id));
    for (const r of (stepParents ?? []) as { parent_task_id: string }[]) withSteps.add(r.parent_task_id);
    const old = oldCandidates.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).find((t) => !withSteps.has(t.id));
    if (old) {
      const weeks = Math.floor((now.toMillis() - Date.parse(old.created_at)) / (7 * 86400000));
      nudge = { key: `old_task:${old.id}`, title: old.title, waited: weeks >= 2 ? `${weeks === 2 ? "two" : weeks === 3 ? "three" : weeks === 4 ? "four" : weeks} weeks` : "two weeks" };
    }
  }

  const tabLabel = TABS.find((t) => t.key === tab)!.label;
  const headline =
    tab === "today"
      ? tasksHeadline(todayOpen.map((t) => ({ title: t.title, estimate: t.estimate_minutes })), todayDone.length)
      : [{ text: shown.length === 0 ? "Nothing here." : `${shown.length} ${tab === "upcoming" ? "coming up" : shown.length === 1 ? "task" : "tasks"}.`, strong: true }];
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { tab: tab === "today" ? null : tab, space: sp.space ?? null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return q ? `/tasks?${q}` : "/tasks";
  };
  const spaceList = spaces.map((s) => ({ id: s.id, name: s.name, color: spaceColor(s) }));

  return (
    <div className="mx-auto flex w-full max-w-[740px] flex-col pb-10 md:pt-8">
      <header>
        <div className="flex items-baseline gap-3.5">
          <h1 className="text-[34px] font-bold leading-none tracking-[-0.03em]">
            <span className="sr-only">Tasks: </span>
            {tabLabel}
          </h1>
          <span className="text-[15px] text-dim">{now.toFormat("cccc, LLL d")}</span>
        </div>
        <p className="mt-2 text-[17px] font-medium leading-snug tracking-[-0.01em]">
          {headline.map((s, i) => (
            <span key={i} className={s.strong ? "text-text" : "text-[#8E8E96]"}>{s.text}</span>
          ))}
        </p>
      </header>

      <nav aria-label="Which tasks" className="mt-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key === "today" ? null : t.key, open: null })} aria-current={t.key === tab ? "page" : undefined} className="chip h-[34px]">
            {t.label}
          </Link>
        ))}
        {space && (
          <Link href={href({ space: null })} className="chip h-[34px] gap-2" aria-label={`Showing ${space.name} only. Show all spaces`}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: spaceColor(space) }} aria-hidden="true" />
            {space.name}
            <span aria-hidden="true" className="text-dim">×</span>
          </Link>
        )}
      </nav>

      <QuickAddBar zone={zone} spaces={spaceList} defaultSpaceId={space?.id ?? null} someday={tab === "someday"} />

      <TaskBoard
        zone={zone}
        tasks={shown}
        steps={steps}
        groups={groups}
        spaces={spaceList}
        initialOpen={sp.open ?? null}
        nudge={nudge}
        emptyText={
          tab === "today" ? "Nothing due today. Add something above, or tell Navi what's on your mind."
          : tab === "upcoming" ? "Nothing coming up with a date."
          : tab === "anytime" ? "No undated tasks."
          : "Nothing parked for someday. Tasks set to the lowest priority show here."
        }
      />
    </div>
  );
}

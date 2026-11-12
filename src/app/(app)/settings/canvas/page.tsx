import Link from "next/link";
import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import { GROUP, SectionHead } from "@/components/settings-ui";
import { CourseControls, DuplicateChoice, HideButton } from "./controls";

export const metadata = { title: "Canvas · Settings · Navi" };

type Item = {
  id: string;
  kind: "assignment" | "event";
  title: string;
  description: string | null;
  url: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  all_day_date: string | null;
  state: "active" | "removed";
  source_status: string;
  hidden: boolean;
  hidden_reason: string | null;
  course_id: string | null;
  possible_duplicate_task_id: string | null;
  missing_count: number;
};

// Imported Canvas items and the person's choices about them. Everything here
// is read through the person's own (RLS) client; changes go through the
// ownership-checked server actions. Canvas text is shown as plain text only.
export default async function CanvasPage() {
  const ctx = await requireCtx();
  const zone = ctx.timezone;
  const now = DateTime.now().setZone(zone);
  const [{ data: conns }, { data: courses }, { data: items }, { data: runs }, { data: spaces }, { data: projects }] = await Promise.all([
    ctx.db.from("integration_connections").select("id,display_host").eq("provider", "canvas"),
    ctx.db.from("external_courses").select("id,name,excluded,workspace_id,project_id").order("name"),
    ctx.db.from("external_items").select("id,kind,title,description,url,location,starts_at,ends_at,all_day,all_day_date,state,source_status,hidden,hidden_reason,course_id,possible_duplicate_task_id,missing_count").gte("starts_at", now.minus({ days: 14 }).toISO()!).order("starts_at").limit(400),
    ctx.db.from("integration_sync_runs").select("id,trigger,status,started_at,finished_at,counts,error").order("started_at", { ascending: false }).limit(10),
    ctx.db.from("workspaces").select("id,name").eq("status", "active").order("sort_order"),
    ctx.db.from("projects").select("id,name").in("status", ["active", "paused"]).order("name"),
  ]);
  const back = <Link href="/settings#services" className="muted text-sm hover:text-text">← Settings</Link>;
  if (!conns?.length) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {back}
        <h1 className="h1">Canvas</h1>
        <p className="muted">Canvas isn&apos;t connected. <Link className="underline underline-offset-2" href="/settings#services">Connect it in Settings</Link>.</p>
      </div>
    );
  }
  const all = (items ?? []) as Item[];
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));
  const dupIds = all.filter((i) => i.hidden && i.hidden_reason === "duplicate" && i.state === "active").map((i) => i.possible_duplicate_task_id).filter((x): x is string => !!x);
  const { data: dupTasks } = dupIds.length ? await ctx.db.from("tasks").select("id,title").in("id", dupIds) : { data: [] };
  const dupTitle = new Map((dupTasks ?? []).map((t) => [t.id, t.title]));
  const options = [
    ...(spaces ?? []).map((s) => ({ value: `w:${s.id}`, label: s.name, group: "Spaces" as const })),
    ...(projects ?? []).map((p) => ({ value: `p:${p.id}`, label: p.name, group: "Projects" as const })),
  ];
  const when = (i: Item) => {
    if (i.all_day && i.all_day_date) {
      const d = DateTime.fromISO(i.all_day_date, { zone }).toFormat("ccc LLL d");
      return i.kind === "assignment" ? `Due ${d}, end of day` : `${d}, all day`;
    }
    const s = DateTime.fromISO(i.starts_at).setZone(zone);
    if (i.kind === "assignment") return `Due ${s.toFormat("ccc LLL d, h:mm a")}`;
    const e = i.ends_at ? DateTime.fromISO(i.ends_at).setZone(zone) : null;
    return `${s.toFormat("ccc LLL d, h:mm a")}${e && e > s ? `–${e.toFormat("h:mm a")}` : ""}`;
  };
  const badge = (i: Item) => {
    const c = i.course_id ? courseById.get(i.course_id) : null;
    if (i.state === "removed") return "deleted in Canvas";
    if (i.source_status === "cancelled") return "cancelled in Canvas";
    if (c?.excluded) return "course excluded";
    if (i.hidden) return i.hidden_reason === "duplicate" ? "waiting for you" : "hidden";
    if (i.missing_count > 0) return "missing from last sync";
    return null;
  };
  const dups = all.filter((i) => i.hidden && i.hidden_reason === "duplicate" && i.state === "active");
  const groups = new Map<string, Item[]>();
  for (const i of all) {
    const key = i.course_id ? (courseById.get(i.course_id)?.name ?? "Other") : "No course";
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const countBy = new Map<string, number>();
  for (const i of all) if (i.course_id) countBy.set(i.course_id, (countBy.get(i.course_id) ?? 0) + 1);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-9">
      <header className="flex flex-col gap-2">
        {back}
        <h1 className="h1">Canvas</h1>
        <p className="muted text-sm">
          From {conns.map((c) => c.display_host).join(", ")}. Canvas sets titles and due dates; you decide everything else (done, priority, estimates, when to work on it). Canvas only shares the last 30 days and the next year, and not its To Do list.
        </p>
      </header>

      {dups.length > 0 && (
        <section id="decide" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="dup-h">
          <SectionHead id="dup-h" title="Already on your list?" desc="These look like tasks you added yourself. Navi didn't merge them." />
          <ul className={GROUP}>
            {dups.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 px-4 py-3.5 sm:px-5">
                <span className="text-[15px] font-medium">{i.title}</span>
                <span className="muted text-[13px]">{when(i)} · looks like your task “{dupTitle.get(i.possible_duplicate_task_id ?? "") ?? "(deleted)"}”</span>
                <DuplicateChoice id={i.id} title={i.title} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="courses-h">
        <SectionHead id="courses-h" title="Courses" desc="Exclude ones you don't need (clubs, old courses). Linking a course to a space or project files its tasks there." />
        <div className={GROUP}>
          {(courses ?? []).length === 0 && <p className="muted px-4 py-3.5 text-sm sm:px-5">No courses found in your feed yet.</p>}
          {(courses ?? []).map((c) => (
            <CourseControls key={c.id} id={c.id} name={`${c.name}${countBy.get(c.id) ? ` (${countBy.get(c.id)})` : ""}`} excluded={c.excluded} link={c.project_id ? `p:${c.project_id}` : c.workspace_id ? `w:${c.workspace_id}` : ""} options={options} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="items-h">
        <SectionHead id="items-h" title="Imported items" desc="From two weeks ago onward. Hiding sets an item's task or event aside; Show brings it back." />
        {all.length === 0 && <p className="muted text-sm">Nothing imported in this range.</p>}
        {[...groups].map(([name, list]) => (
          <div key={name} className="flex flex-col gap-1.5">
            <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-dim">{name}</h3>
            <ul className={GROUP}>
              {list.map((i) => {
                const b = badge(i);
                return (
                  <li key={i.id} className={`flex flex-col gap-1 px-4 py-3 sm:px-5 ${b ? "opacity-70" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="break-words text-[15px] font-medium">{i.title}</span>
                        <span className="muted text-[13px]">
                          {i.kind === "assignment" ? "Assignment" : "Event"} · {when(i)}
                          {i.location ? ` · ${i.location}` : ""}
                          {b ? <span className="badge ml-2">{b}</span> : null}
                        </span>
                      </span>
                      {i.state === "active" && i.hidden_reason !== "duplicate" && <HideButton id={i.id} hidden={i.hidden} title={i.title} />}
                    </div>
                    {(i.description || i.url) && (
                      <details className="text-[13px]">
                        <summary className="muted cursor-pointer">Details from Canvas</summary>
                        {i.description && <p className="mt-1 whitespace-pre-line break-words">{i.description}</p>}
                        {i.url && <a className="mt-1 inline-block underline underline-offset-2" href={i.url} target="_blank" rel="noopener noreferrer nofollow">Open in Canvas</a>}
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="runs-h">
        <SectionHead id="runs-h" title="Sync history" />
        <ul className={`${GROUP} text-[13px]`}>
          {(runs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
              <span>{DateTime.fromISO(r.started_at).setZone(zone).toFormat("LLL d, h:mm a")} · {r.trigger === "schedule" ? "automatic" : r.trigger === "connect" ? "first import" : "refresh"}</span>
              <span className={r.status === "failed" ? "text-danger" : "muted"}>{r.status === "failed" ? `failed: ${r.error ?? ""}` : r.status === "partial" ? "finished with warnings" : r.status === "running" ? "running" : "ok"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

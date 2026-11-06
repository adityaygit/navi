import { requireCtx } from "@/server/context";
import type { Memory } from "@/lib/types";
import { GROUP, SectionHead } from "@/components/settings-ui";
import { MemoryItem, AddMemory } from "./memory-item";

export const metadata = { title: "Memory · Navi" };

const KINDS: [Memory["kind"], string, string][] = [
  ["profile", "About you", "Preferences, routines and facts about you."],
  ["project", "Projects", "Decisions and context for your projects."],
  ["episodic", "Events", "Meaningful things that happened and how they went."],
  ["behavioral", "Patterns", "Patterns Navi noticed. These are inferences until you confirm them."],
];

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const showAll = sp.show === "all";
  let q = ctx.db.from("memories").select("*, projects(name)").order("updated_at", { ascending: false });
  if (!showAll) q = q.eq("status", "active");
  const { data } = await q;
  const memories = (data ?? []) as (Memory & { projects: { name: string } | null })[];
  const active = memories.filter((m) => m.status === "active");
  const unconfirmed = active.filter((m) => m.origin !== "stated" && !m.last_confirmed_at).length;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-9">
      <header className="flex flex-col gap-3">
        <h1 className="h1">Memory</h1>
        <p className="muted max-w-prose text-[15px]">Everything Navi remembers about you, where it came from, and how sure it is. Correct or delete anything; Navi uses only what&apos;s here.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="num">{active.length} {active.length === 1 ? "memory" : "memories"} in use</span>
          {unconfirmed > 0 && <span className="badge badge-warn num">{unconfirmed} inferred, not confirmed yet</span>}
          <a href={showAll ? "/memory" : "/memory?show=all"} className="btn btn-ghost btn-sm -ml-3 text-muted">{showAll ? "Hide corrected & rejected" : "Show corrected & rejected"}</a>
        </div>
        <div className="mt-1"><AddMemory /></div>
      </header>
      {KINDS.map(([kind, title, desc]) => {
        const list = memories.filter((m) => m.kind === kind);
        return (
          <section key={kind} aria-labelledby={`mem-${kind}`} className="flex flex-col gap-3">
            <SectionHead id={`mem-${kind}`} title={title} desc={desc} aside={list.length > 0 ? <span className="num dim text-sm">{list.length}</span> : undefined} />
            {list.length === 0 ? (
              <p className="surf muted px-4 py-4 text-sm sm:px-5">Nothing yet.</p>
            ) : (
              <ul className={GROUP}>{list.map((m) => <MemoryItem key={m.id} memory={m} projectName={m.projects?.name ?? null} />)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

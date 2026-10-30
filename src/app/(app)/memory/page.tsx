import { requireCtx } from "@/server/context";
import type { Memory } from "@/lib/types";
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
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="h1">Memory</h1>
        <p className="muted text-sm">Everything Navi remembers about you, where it came from, and how sure it is. Correct or delete anything; Navi uses only what's here.</p>
        <a href={showAll ? "/memory" : "/memory?show=all"} className="btn btn-ghost btn-sm mt-2">{showAll ? "Hide corrected & rejected" : "Show corrected & rejected"}</a>
      </header>
      <AddMemory />
      {KINDS.map(([kind, title, desc]) => {
        const list = memories.filter((m) => m.kind === kind);
        return (
          <section key={kind} aria-labelledby={`mem-${kind}`} className="flex flex-col gap-2">
            <div>
              <h2 id={`mem-${kind}`} className="h2">{title}</h2>
              <p className="muted text-xs">{desc}</p>
            </div>
            {list.length === 0 ? <p className="muted text-sm">Nothing yet.</p> : (
              <ul className="flex flex-col gap-2">{list.map((m) => <MemoryItem key={m.id} memory={m} projectName={m.projects?.name ?? null} />)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

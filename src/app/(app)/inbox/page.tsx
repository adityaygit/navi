import { requireCtx } from "@/server/context";
import type { Proposal } from "@/lib/types";
import { ProposalCard } from "@/components/proposal-card";
import { InboxBulk } from "./bulk";

export const metadata = { title: "Inbox · Navi" };

export default async function InboxPage() {
  const ctx = await requireCtx();
  const [proposalsRes, tasksRes, capturesRes] = await Promise.all([
    ctx.db.from("proposals").select("*").in("status", ["pending", "deferred"]).is("batch", null).order("created_at", { ascending: false }),
    ctx.db.from("tasks").select("id,title").in("status", ["todo", "in_progress", "blocked"]).order("updated_at", { ascending: false }).limit(100),
    ctx.db.from("captures").select("id,raw_text,status,error,captured_at,source").order("captured_at", { ascending: false }).limit(10),
  ]);
  const all = (proposalsRes.data ?? []) as Proposal[];
  const pending = all.filter((p) => p.status === "pending");
  const deferred = all.filter((p) => p.status === "deferred");
  const openTasks = tasksRes.data ?? [];
  const captures = capturesRes.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="h1">Review inbox</h1>
        <p className="muted text-sm">Suggestions Navi pulled from what you captured or said. Nothing here is a commitment until you accept it.</p>
      </header>
      {pending.length === 0 ? (
        <p className="notice">Inbox zero. Use “+ Capture” or tell Navi what's on your mind.</p>
      ) : (
        <>
          <InboxBulk ids={pending.map((p) => p.id)} />
          <div className="flex flex-col gap-3">
            {pending.map((p) => <ProposalCard key={p.id} proposal={p} zone={ctx.timezone} openTasks={openTasks} />)}
          </div>
        </>
      )}
      {deferred.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Later ({deferred.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {deferred.map((p) => <ProposalCard key={p.id} proposal={p} zone={ctx.timezone} openTasks={openTasks} />)}
          </div>
        </details>
      )}
      {captures.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Recent captures (your original words)</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {captures.map((c) => (
              <li key={c.id} className="border-b border-border pb-2 last:border-0">
                <div className="whitespace-pre-wrap">{c.raw_text}</div>
                <div className="muted text-xs">
                  {new Date(c.captured_at).toLocaleString()} · {c.source}
                  {c.status === "needs_ai" && " · split by basic rules (AI unavailable), check carefully"}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

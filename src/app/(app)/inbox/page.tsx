import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import type { Proposal } from "@/lib/types";
import { ProposalCard, type ProposalArea } from "@/components/proposal-card";
import { Pebble } from "@/components/pebble";
import { InboxBulk } from "./bulk";

export const metadata = { title: "Inbox · Navi" };

type Capture = { id: string; raw_text: string; status: string; error: string | null; captured_at: string; source: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage() {
  const ctx = await requireCtx();
  const [proposalsRes, tasksRes, capturesRes, wsRes, refsRes] = await Promise.all([
    ctx.db.from("proposals").select("*").in("status", ["pending", "deferred"]).is("batch", null).order("created_at", { ascending: false }),
    ctx.db.from("tasks").select("id,title").in("status", ["todo", "in_progress", "blocked"]).order("updated_at", { ascending: false }).limit(100),
    ctx.db.from("captures").select("id,raw_text,status,error,captured_at,source").order("captured_at", { ascending: false }).limit(10),
    ctx.db.from("workspaces").select("id,name,color"),
    // Area proposals other items may point at by ref_key (accepted ones resolve to a real area).
    ctx.db.from("proposals").select("ref_key,payload,result_id").eq("kind", "workspace").not("ref_key", "is", null),
  ]);
  const all = (proposalsRes.data ?? []) as Proposal[];
  const pending = all.filter((p) => p.status === "pending");
  const deferred = all.filter((p) => p.status === "deferred");
  const openTasks = tasksRes.data ?? [];
  const recent = (capturesRes.data ?? []) as Capture[];

  // The captures these suggestions came from, so each group shows your own words first.
  const recentIds = new Set(recent.map((c) => c.id));
  const missing = [...new Set(pending.map((p) => p.capture_id).filter((id): id is string => Boolean(id) && !recentIds.has(id!)))];
  const extra = missing.length ? (((await ctx.db.from("captures").select("id,raw_text,status,error,captured_at,source").in("id", missing)).data ?? []) as Capture[]) : [];
  const captureById = new Map([...recent, ...extra].map((c) => [c.id, c]));

  // Which life area each suggestion would land in, when it says.
  const wsById = new Map((wsRes.data ?? []).map((w) => [w.id as string, { name: w.name as string, color: (w.color as string | null) ?? null }]));
  const wsByRef = new Map(
    (refsRes.data ?? []).map((r) => {
      const real = r.result_id ? wsById.get(r.result_id as string) : undefined;
      const pl = (r.payload ?? {}) as Record<string, unknown>;
      return [r.ref_key as string, real ?? { name: String(pl.name ?? "New area"), color: typeof pl.color === "string" ? pl.color : null }];
    }),
  );
  const areaOf = (p: Proposal): ProposalArea | null => {
    const pl = p.payload as Record<string, unknown>;
    if (typeof pl.workspace_id === "string") return wsById.get(pl.workspace_id) ?? null;
    const ref = pl.workspace_ref;
    if (typeof ref !== "string" || !ref) return null;
    return (UUID.test(ref) ? wsById.get(ref) : wsByRef.get(ref)) ?? null;
  };

  // Group by where they came from: one capture, a chat, or anywhere else.
  const groups: { key: string; capture: Capture | null; label: string; items: Proposal[] }[] = [];
  for (const p of pending) {
    const cap = p.capture_id ? captureById.get(p.capture_id) ?? null : null;
    const key = cap ? `c:${cap.id}` : p.conversation_id ? "chat" : "other";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, capture: cap, label: cap ? "" : key === "chat" ? "From your chats with Navi" : "Other suggestions", items: [] };
      groups.push(g);
    }
    g.items.push(p);
  }
  const statedIds = pending.filter((p) => p.origin === "stated").map((p) => p.id);
  const when = (iso: string) => DateTime.fromISO(iso).setZone(ctx.timezone).toFormat("ccc LLL d, h:mm a");
  const n = pending.length;

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 md:gap-12">
      <header className="flex flex-col gap-5">
        <h1 className="h1">Review inbox</h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-3.5">
            <Pebble size={40} mood={n ? "ask" : "done"} />
            <p className="text-[17px] leading-snug">
              <span className="font-semibold">{n ? `${n} thing${n === 1 ? "" : "s"} to review.` : "All caught up."}</span>{" "}
              <span className="muted">Nothing here is on your plan until you accept it.</span>
            </p>
          </div>
          {n > 0 && <InboxBulk ids={pending.map((p) => p.id)} statedIds={statedIds.length && statedIds.length < n ? statedIds : []} />}
        </div>
      </header>

      {n === 0 ? (
        <p className="notice">Inbox zero. Use “+ Capture” or tell Navi what&apos;s on your mind.</p>
      ) : (
        <div className="flex flex-col gap-12">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.capture ? `From your capture, ${when(g.capture.captured_at)}` : g.label} className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
              <div className="lg:sticky lg:top-24 lg:self-start">
                {g.capture ? (
                  <figure className="flex flex-col gap-2.5 border-l-2 border-white/20 pl-4">
                    <figcaption className="text-[13px] text-dim">
                      Your {g.capture.source === "voice" ? "voice note" : "capture"} · {when(g.capture.captured_at)}
                    </figcaption>
                    <blockquote className="whitespace-pre-wrap text-[17px] italic leading-relaxed text-[#e4e5e8]">“{g.capture.raw_text}”</blockquote>
                    {g.capture.status === "needs_ai" && <p className="text-[13px] text-recovery">Split by basic rules (AI unavailable), so check these carefully.</p>}
                  </figure>
                ) : (
                  <div className="flex flex-col gap-1">
                    <h2 className="eyebrow">{g.label}</h2>
                    <p className="text-sm text-dim">Each card quotes the words it came from.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {g.items.map((p) => <ProposalCard key={p.id} proposal={p} zone={ctx.timezone} openTasks={openTasks} area={areaOf(p)} />)}
              </div>
            </section>
          ))}
          <p className="text-[13px] text-dim lg:pl-[340px]">
            Solid card: you said it. Dashed card: Navi&apos;s guess, worth a closer look.
          </p>
        </div>
      )}

      {(deferred.length > 0 || recent.length > 0) && (
        <div className="flex flex-col gap-4">
          {deferred.length > 0 && (
            <details className="card md:p-6">
              <summary className="cursor-pointer text-[17px] font-medium">Later ({deferred.length})</summary>
              <div className="mt-5 flex flex-col gap-4">
                {deferred.map((p) => <ProposalCard key={p.id} proposal={p} zone={ctx.timezone} openTasks={openTasks} area={areaOf(p)} />)}
              </div>
            </details>
          )}
          {recent.length > 0 && (
            <details className="card md:p-6">
              <summary className="cursor-pointer text-[17px] font-medium">Recent captures (your original words)</summary>
              <ul className="mt-4 flex flex-col divide-y divide-white/[0.08] text-[15px]">
                {recent.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 py-3.5">
                    <div className="whitespace-pre-wrap">{c.raw_text}</div>
                    <div className="text-[13px] text-dim">
                      {when(c.captured_at)} · {c.source}
                      {c.status === "needs_ai" && " · split by basic rules (AI unavailable), check carefully"}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

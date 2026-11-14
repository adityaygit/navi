import { DateTime } from "luxon";
import { requireCtx } from "@/server/context";
import { ProposalCard } from "@/components/proposal-card";
import { loadInbox } from "@/server/domain/inbox";
import { Pebble } from "@/components/pebble";
import { InboxBulk } from "./bulk";

export const metadata = { title: "Inbox · Navi" };

export default async function InboxPage() {
  const ctx = await requireCtx();
  const { pending, deferred, openTasks, recent, groups, areaOf } = await loadInbox(ctx);
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

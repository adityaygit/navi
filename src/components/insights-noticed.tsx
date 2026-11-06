import Link from "next/link";
import { Pebble } from "@/components/pebble";
import { ActionButton } from "@/components/action-button";
import { planWeekAction } from "@/app/(app)/actions";
import type { Learning, Noticed } from "./insights-week";

/** "Navi noticed": real findings from the week, with an action only where one exists. */
export function NaviNoticed({ items, enoughData, planFrom }: { items: Noticed[]; enoughData: boolean; planFrom: string | null }) {
  const [first, ...rest] = items;
  return (
    <section aria-labelledby="noticed-h" className="lg flex flex-col gap-4 p-5 md:p-[22px]">
      <div className="flex items-start gap-3.5">
        <Pebble size={48} mood={first ? "nudge" : "idle"} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="noticed-h" className="eyebrow">Navi noticed</h2>
          <p className="text-[17px] leading-normal md:text-lg">
            {first
              ? first.text
              : enoughData
                ? "Nothing stood out this week: no task kept getting skipped, and nothing points at an overloaded week ahead."
                : "Not enough days yet to see patterns. Keep marking how your blocks went; Navi only points things out once there's real evidence."}
          </p>
        </div>
      </div>
      {first?.action && <NoticedAction action={first.action} planFrom={planFrom} primary />}
      {rest.length > 0 && (
        <ul className="flex flex-col divide-hair border-t border-border">
          {rest.map((n) => (
            <li key={n.key} className="flex flex-col gap-2 py-3 text-[15px] leading-normal">
              <p>{n.text}</p>
              {n.action && <NoticedAction action={n.action} planFrom={planFrom} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NoticedAction({ action, planFrom, primary = false }: { action: NonNullable<Noticed["action"]>; planFrom: string | null; primary?: boolean }) {
  const cls = primary ? "btn btn-primary w-full" : "btn btn-sm self-start";
  if (action === "plan-week") {
    if (!planFrom) return null;
    return (
      <div className={primary ? "[&>span]:w-full" : ""}>
        <ActionButton className={cls} action={planWeekAction} args={[planFrom]} showResult>Plan next week</ActionButton>
      </div>
    );
  }
  if (action === "tasks") return <Link href="/tasks" className={cls}>Open your tasks</Link>;
  return <Link href="/projects" className={cls}>Open projects</Link>;
}

const SURE = {
  confirmed: { word: "You confirmed", cls: "badge-ok" },
  fairly: { word: "Fairly sure", cls: "badge-ok" },
  checking: { word: "Still checking", cls: "badge-warn" },
} as const;

/** Behavioural memories, read-only here; corrected or deleted in Memory. */
export function NaviLearning({ items }: { items: Learning[] }) {
  return (
    <section aria-labelledby="learning-h" className="surf px-5 py-1.5 md:px-[22px]">
      <div className="flex items-center justify-between gap-3 py-3.5">
        <h2 id="learning-h" className="eyebrow">What Navi is learning</h2>
        <Link href="/memory" className="btn btn-ghost btn-sm -mr-3 text-muted">All memory</Link>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-border py-4 text-[15px] text-muted">Nothing yet. A pattern is saved here only after it shows up in your weekly reviews with real evidence, and you can correct or delete it in Memory.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 border-t border-border py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-base">{m.content}</span>
                <span className="text-[13px] text-dim">{m.evidence}</span>
              </div>
              <span className={`badge ${SURE[m.sure].cls} whitespace-nowrap`}>{SURE[m.sure].word}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

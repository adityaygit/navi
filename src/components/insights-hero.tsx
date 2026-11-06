import Link from "next/link";
import { statusWord, type FollowThrough } from "@/lib/follow-through";
import { hm } from "./insights-week";

const TONE_BADGE = { good: "badge-ok", okay: "badge-warn", low: "badge-danger", none: "" } as const;

/**
 * The top of Insights: the week's follow-through score on the dawn photo,
 * the change on the week before (only when both weeks have a score), one
 * plain sentence, and the three parts with how each is worked out.
 */
export function InsightsHero({
  ft,
  previous,
  current,
  rangeLabel,
  prevHref,
  nextHref,
  minutes,
  enough,
}: {
  ft: FollowThrough;
  /** Last week's score, when it has one. */
  previous: number | null;
  current: boolean;
  rangeLabel: string;
  prevHref: string;
  nextHref: string | null;
  minutes: { planned: number; done: number; partial: number };
  enough: { days: number; blocks: number; needDays: number; needBlocks: number };
}) {
  const delta = ft.score !== null && previous !== null ? ft.score - previous : null;
  const word = statusWord(ft.score);
  return (
    <section aria-labelledby="ft-h" className="relative -mx-4 -mt-4 overflow-hidden md:mx-0 md:mt-0 md:rounded-[14px] md:border md:border-border">
      <div aria-hidden className="absolute inset-0 bg-cover bg-[30%_50%]" style={{ backgroundImage: "url(/img/wall-dawn.jpg)" }} />
      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.5)_45%,#060608_100%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.35)_100%)]" />
      <div className="relative flex flex-col gap-6 px-5 pb-5 pt-5 md:p-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[15px] font-semibold text-text md:text-base">Insights</h1>
          <nav aria-label="Week" className="glass flex h-11 items-center rounded-full">
            <Link href={prevHref} aria-label="Previous week" className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-[#d8d9dc] hover:bg-white/10">‹</Link>
            <span className="num px-1 text-sm">{rangeLabel}</span>
            {nextHref ? (
              <Link href={nextHref} aria-label="Next week" className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-[#d8d9dc] hover:bg-white/10">›</Link>
            ) : (
              <span aria-hidden className="flex h-11 w-11 items-center justify-center text-lg text-white/25">›</span>
            )}
          </nav>
        </div>

        <div className="flex flex-col gap-6 pt-16 md:flex-row md:flex-wrap md:items-end md:justify-between md:pt-10">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="ft-h" className="text-[15px] font-normal text-[#d8d9dc] md:text-base">Follow-through {current ? "this week" : "that week"}</h2>
            {ft.score !== null ? (
              <div className="flex flex-wrap items-end gap-3.5">
                <span className="gh num display text-[96px] leading-[0.9] md:text-[120px] md:leading-[0.85]" aria-hidden>{ft.score}</span>
                <span className="sr-only">{ft.score} out of 100, {word.word}.</span>
                {delta !== null && (
                  <span className={`pill-status mb-2.5 ${delta > 0 ? "border-focus/40 text-focus" : delta < 0 ? "border-clash/40 text-clash" : "border-white/20 text-muted"}`}>
                    <span className="dot h-1.5 w-1.5 bg-current" aria-hidden />
                    {delta > 0 ? `Up ${delta}` : delta < 0 ? `Down ${-delta}` : "Same as the week before"}
                    {delta !== 0 && <span className="sr-only"> on the week before, which scored {previous}</span>}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="gh display text-5xl md:text-6xl">Not enough days yet</span>
                <span className="text-[15px] text-[#d8d9dc]">
                  A score needs {enough.needDays} days with marked blocks and {enough.needBlocks} planned blocks. So far: {enough.days} day{enough.days === 1 ? "" : "s"}, {enough.blocks} block{enough.blocks === 1 ? "" : "s"}.
                </span>
              </div>
            )}
            <p className="max-w-xl text-[17px] leading-snug text-[#c9cacd] md:text-[19px]">
              {minutes.planned > 0 ? (
                <>
                  You finished <span className="num text-text">{hm(minutes.done)}</span> of the <span className="num text-text">{hm(minutes.planned)}</span> you planned
                  {minutes.partial > 0 && <>, plus <span className="num text-text">{hm(minutes.partial)}</span> partly done</>}.
                </>
              ) : (
                <>Nothing was planned in blocks {current ? "this week yet" : "that week"}.</>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <ul className="grid grid-cols-3 gap-2.5 md:flex md:gap-2.5">
              {ft.parts.map((p) => {
                const s = statusWord(p.value);
                return (
                  <li key={p.key} className="lg flex min-w-0 flex-col items-center gap-1.5 px-2 py-3.5 md:min-w-[120px] md:items-start md:px-[18px]">
                    <span className="text-[13px] text-[#d8d9dc]">{p.label}</span>
                    <span className="num text-[30px] font-semibold leading-none tracking-[-0.03em] md:text-[32px]">{p.value ?? "–"}</span>
                    <span className={`badge ${TONE_BADGE[s.tone]} whitespace-nowrap`}>{s.tone === "none" ? "No data" : s.word}</span>
                  </li>
                );
              })}
            </ul>
            <details className="group text-sm md:max-w-[400px]">
              <summary className="cursor-pointer select-none text-[#d8d9dc] underline decoration-white/30 underline-offset-4 hover:text-text">How it's worked out</summary>
              <div className="well mt-2 flex flex-col gap-2 bg-black/60 p-3.5 text-[#d8d9dc]">
                {ft.parts.map((p) => (
                  <p key={p.key}>
                    <span className="font-semibold text-text">{p.label}{p.value !== null ? ` ${p.value}` : ""}.</span> {p.how}
                    {p.value === null && " Nothing to measure this from yet."}
                  </p>
                ))}
                <p className="text-muted">The score is the average of the parts that have data, and only appears once the week has enough marked days.</p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}

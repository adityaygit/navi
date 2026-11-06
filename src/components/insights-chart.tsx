import { chartLabel, hm, hmTight, type DayBar } from "./insights-week";

/**
 * Planned vs done for 7 days: the outlined bar is what was planned, the fill
 * inside is what got marked done (a fainter band on top for partly done).
 * Fell short (a block skipped with no outside reason) is drawn in the clash
 * colour, a rest day as a short recovery-yellow bar. Pure: no data fetching,
 * so the weekly story can reuse it.
 */
function Amount({ m, compact }: { m: number; compact: boolean }) {
  if (compact) return <>{hmTight(m)}</>;
  return (
    <>
      <span className="md:hidden">{hmTight(m)}</span>
      <span className="hidden md:inline">{hm(m)}</span>
    </>
  );
}

export function PlannedDoneChart({ bars, compact = false }: { bars: DayBar[]; compact?: boolean }) {
  const max = Math.max(60, ...bars.map((b) => b.planned));
  const best = bars.filter((b) => b.done > 0).sort((a, b) => b.done - a.done)[0]?.date;
  const has = (k: DayBar["kind"]) => bars.some((b) => b.kind === k);
  const anyPartial = bars.some((b) => b.partial > 0);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-white/50" aria-hidden />Planned</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#f2f2f2]" aria-hidden />Done</li>
        {anyPartial && <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-white/35" aria-hidden />Partly done</li>}
        {has("short") && <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-clash" aria-hidden />Fell short</li>}
        {has("rest") && <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-recovery" aria-hidden />Rest</li>}
      </ul>
      <div role="img" aria-label={chartLabel(bars)}>
        <div className={`grid grid-cols-7 items-end gap-2 md:gap-4 ${compact ? "h-[170px]" : "h-[170px] md:h-[250px]"}`} aria-hidden>
          {bars.map((b) => {
            const short = b.kind === "short";
            const label =
              b.kind === "rest" ? <span className="text-recovery">Rest</span>
              : b.kind === "none" ? <span className="text-dim">–</span>
              : short ? (
                <span className="text-clash">
                  <Amount m={b.done} compact={compact} />
                  <span className={compact ? "hidden" : "hidden md:inline"}> of {hm(b.planned)}</span>
                </span>
              )
              : <span className={b.date === best ? "font-semibold text-text" : "text-muted"}><Amount m={b.done} compact={compact} /></span>;
            return (
              <div key={b.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
                <span className="num max-w-full truncate text-[11px] leading-4 md:text-xs">{label}</span>
                {b.kind === "rest" ? (
                  <div className="h-1.5 w-full rounded bg-recovery" />
                ) : b.kind === "none" ? (
                  <div className="h-0.5 w-full rounded bg-white/15" />
                ) : (
                  <div
                    className={`flex w-full flex-col justify-end overflow-hidden rounded-[5px] border bg-white/[0.03] ${short ? "border-clash/70" : "border-white/40"}`}
                    style={{ height: `calc((100% - 22px) * ${Math.max(0.04, b.planned / max)})` }}
                  >
                    {b.partial > 0 && <div className={short ? "bg-clash/35" : "bg-white/35"} style={{ height: `${(b.partial / b.planned) * 100}%` }} />}
                    {b.done > 0 && <div className={short ? "bg-clash" : b.date === best ? "bg-[#f2f2f2]" : "bg-[#d8d9dc]"} style={{ height: `${(b.done / b.planned) * 100}%` }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[13px] md:gap-4" aria-hidden>
          {bars.map((b) => (
            <span key={b.date} className={`flex flex-col items-center ${b.kind === "short" ? "text-clash" : b.kind === "rest" ? "text-recovery" : b.date === best ? "font-semibold text-text" : "text-muted"}`}>
              <span className={compact ? "" : "md:hidden"}>{b.letter}</span>
              <span className={compact ? "hidden" : "hidden md:inline"}>{b.short}</span>
              {b.isToday && <span className="mt-0.5 h-1 w-1 rounded-full bg-current" />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

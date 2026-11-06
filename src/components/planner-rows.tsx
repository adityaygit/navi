import Link from "next/link";
import { AreaMeta, TimelineShell, type TimelineInfo } from "@/components/plan-block";

// plan-block is a client module, so its helpers can't be called from here.
const durationText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

// Planner-only timeline pieces. Plan blocks themselves use PlanBlockRow's
// timeline look (shared with Today); these are the entries around them.

const CARD = {
  fixed: "bg-[#f0f0f0] text-[#060608]",
  flex: "border-[1.5px] border-flex bg-[rgba(143,184,255,0.06)]",
  recovery: "border-[1.5px] border-recovery bg-[rgba(242,196,107,0.06)]",
} as const;
const KIND_TEXT = { fixed: "text-[#3a3b40]", flex: "text-flex", recovery: "text-recovery" } as const;

/**
 * An event or timed routine (not a plan block, so no outcome buttons). The one
 * `.badge` says whether its time is really fixed: "fixed", "external" or "routine".
 */
export function PlannerFixedRow({ title, label, timeline }: { title: string; label: string; timeline: TimelineInfo }) {
  const dark = timeline.kind === "fixed";
  return (
    <li className="flex gap-3">
      <TimelineShell start={timeline.start} meridiem={timeline.meridiem}>
        <div className={`flex min-w-0 flex-1 items-center gap-3 rounded-[14px] px-3.5 py-3 ${CARD[timeline.kind]}`}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[16px] font-semibold leading-snug break-words">{title}</span>
            <AreaMeta area={timeline.area} rest={`${timeline.range} · ${durationText(timeline.minutes)}`} dark={dark} />
          </div>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {timeline.marker && (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${dark ? "bg-[#060608] text-fixed" : "bg-[#f0f0f0] text-[#060608]"}`}>{timeline.marker}</span>
            )}
            <span className={`badge bg-transparent p-0 text-[11px] uppercase tracking-[0.06em] ${KIND_TEXT[timeline.kind]}`}>{label}</span>
          </span>
        </div>
      </TimelineShell>
    </li>
  );
}

/** Nothing scheduled for a while: dashed, so it reads as open time rather than a plan. */
export function PlannerGapRow({ start, meridiem, minutes }: { start: string; meridiem: string; minutes: number }) {
  return (
    <li className="flex gap-3">
      <TimelineShell start={start} meridiem={meridiem}>
        <div className="flex min-h-11 flex-1 items-center rounded-[14px] border border-dashed border-[#3a3c42] px-3.5 text-[14px] text-muted">
          <span className="num">{durationText(minutes)} free</span>
        </div>
      </TimelineShell>
    </li>
  );
}

/** Where "now" falls between today's entries. */
export function PlannerNowRow({ start, meridiem }: { start: string; meridiem: string }) {
  return (
    <li className="flex items-center gap-3" aria-label={`Now, ${start} ${meridiem}`}>
      <span className="num w-11 shrink-0 text-right text-[13px] font-semibold leading-tight text-text md:w-14" aria-hidden>
        {start}
        <span className="block text-[11px] font-normal text-muted">{meridiem}</span>
      </span>
      <span className="flex flex-1 items-center gap-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-text" />
        <span className="h-px flex-1 bg-white/55" />
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-text">Now</span>
      </span>
    </li>
  );
}

export type StripDay = {
  date: string;
  weekday: string;
  dayNum: string;
  label: string;
  href: string;
  selected: boolean;
  today: boolean;
  fixed: number;
  flexible: number;
  due: number;
  risk: boolean;
};

/** Seven days at a glance; each opens that day. Dots: fixed, flexible, deadline at risk. */
export function PlannerWeekStrip({ days }: { days: StripDay[] }) {
  return (
    <nav aria-label="Days" className="grid grid-cols-7 gap-1 sm:gap-2">
      {days.map((d) => (
        <Link
          key={d.date}
          href={d.href}
          aria-current={d.selected ? "date" : undefined}
          className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-[16px] border transition-colors ${
            d.selected
              ? "border-transparent bg-[#f2f2f2] text-[#060608]"
              : d.today
                ? "border-white/30 text-text hover:bg-white/[0.06]"
                : "border-transparent text-muted hover:bg-white/[0.06]"
          }`}
        >
          <span className={`text-[12px] ${d.selected ? "font-semibold" : ""}`}>{d.weekday}</span>
          <span className={`num text-[19px] leading-none ${d.selected ? "font-bold" : "text-text"}`}>{d.dayNum}</span>
          {/* Named by its visible text first, so voice control ("tap Sat 7") still works. */}
          <span className="sr-only">, {d.label}</span>
          <span className="flex h-1.5 gap-[3px]" aria-hidden>
            {d.fixed > 0 && <span className={`h-1.5 w-1.5 rounded-full ${d.selected ? "bg-[#3a3b40]" : "bg-[#f0f0f0]"}`} />}
            {d.flexible > 0 && <span className={`h-1.5 w-1.5 rounded-full ${d.selected ? "bg-[#2f62c9]" : "bg-flex"}`} />}
            {d.risk && <span className={`h-1.5 w-1.5 rounded-full ${d.selected ? "bg-[#c8332d]" : "bg-clash"}`} />}
          </span>
        </Link>
      ))}
    </nav>
  );
}

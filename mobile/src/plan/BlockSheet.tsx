import type { MDayItem } from "@shared/mobile-api-types";
import { clockAmPm, range, weekday } from "../data/time";
import { feel } from "../native/haptics";
import { Sheet } from "../ui/Sheet";
import { glass, ink, meaning } from "../theme/tokens";
import { LockIcon, dueLabel } from "./DayView";

// One block, opened from the day: what it is, whether Navi may move it, and
// the few things you'd do with it. Fixed things say so plainly.

type Props = {
  item: MDayItem;
  date: string;
  tz: string;
  isToday: boolean;
  due: { at: string; hard: boolean } | undefined;
  onClose: () => void;
  onFocus: (it: MDayItem) => void;
  onOutcome: (it: MDayItem, status: "done" | "planned") => void;
  onAsk: (prompt: string, send?: boolean) => void;
};

export function BlockSheet({ item: it, date, tz, isToday, due, onClose, onFocus, onOutcome, onAsk }: Props) {
  const fixed = it.look === "fixed";
  const canFocus = !!it.taskId && isToday && !it.done && it.open;
  const isBlock = it.kind === "block";
  const where = [it.space?.name, it.recurring ? "Repeats" : null].filter(Boolean).join(" · ");
  const btn: React.CSSProperties = { ...glass, height: 54, borderRadius: 27, fontSize: 16, fontWeight: 600, textAlign: "center" };

  return (
    <Sheet label={it.title} onClose={onClose} floating style={{ padding: "6px 20px 20px", gap: 18 }}>
      {(close) => (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h2 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.03em" }}>{it.title}</h2>
            <span style={{ fontSize: 17, fontWeight: 500, color: ink.muted }}>
              {isToday ? "" : `${weekday(date)} · `}
              {range(it.start, it.end, tz)}
              {where ? ` · ${where}` : ""}
            </span>
          </div>
          {fixed ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 18, background: "rgba(17,20,26,0.05)" }}>
              <LockIcon c={ink.text} size={13} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>Fixed. Navi won't move this. You can.</span>
            </div>
          ) : it.reason || it.assumed ? (
            <p style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: 1.4, color: ink.muted }}>{it.assumed ? "Navi put this in time it assumed was free." : it.reason}</p>
          ) : null}
          {due?.hard && !it.done ? (
            <span style={{ alignSelf: "flex-start", height: 30, padding: "0 12px", borderRadius: 15, background: meaning.deadlineBg, color: meaning.deadline, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center" }}>
              {dueLabel(due.at, tz)} · moving it needs your OK
            </span>
          ) : null}
          <div className="pairs" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {canFocus ? (
              <button type="button" onClick={() => { feel("select"); close(); onFocus(it); }} style={{ ...btn, background: ink.text, color: ink.onCta, border: "none", boxShadow: "none", backdropFilter: "none", WebkitBackdropFilter: "none" }}>
                Start focus
              </button>
            ) : null}
            {isBlock ? (
              <button type="button" onClick={() => { close(); onOutcome(it, it.done ? "planned" : "done"); }} style={btn}>
                {it.done ? "Not done" : "Done"}
              </button>
            ) : null}
            <button type="button" onClick={() => { close(); onAsk(fixed ? `Change the time of “${it.title}” (${clockAmPm(it.start, tz)}).` : `Move “${it.title}” to a better time.`, true); }} style={btn}>
              {fixed ? "Change time" : "Move it"}
            </button>
            <button type="button" onClick={() => { close(); onAsk(`About “${it.title}” at ${clockAmPm(it.start, tz)}: `); }} style={btn}>
              Ask Navi
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

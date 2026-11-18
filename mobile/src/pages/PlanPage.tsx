import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { MLine, MTaskItem, MDayItem } from "@shared/mobile-api-types";
import { planActions, useDay, useInbox, useTasks, useWeek } from "../data/plan";
import { addDays, clockAmPm, dayNum, weekday, weekdayShort } from "../data/time";
import { feel } from "../native/haptics";
import { getSetting, setSetting, subscribeSettings } from "../native/settings";
import { DayView, LockIcon, type DueMap } from "../plan/DayView";
import { BlockSheet } from "../plan/BlockSheet";
import { WeekView } from "../plan/WeekView";
import { TasksView } from "../plan/TasksView";
import { InboxSheet, type DoneRow } from "../plan/InboxSheet";
import { AskBar, type AskRequest } from "../shell/AskSheet";
import type { FocusTarget } from "../focus/Focus";
import { useToast } from "../ui/Toast";
import { useExit } from "../ui/useExit";
import { useSheetDrag } from "../ui/Sheet";
import { Layer } from "../ui/Layer";
import { useOnline } from "../data/offline";
import { ease, glass, glassStrong, ink, meaning, type Palette } from "../theme/tokens";

// Plan (M6): the day's name (tap for another day) and one sentence about it,
// Day · Week · List in a glass switch, "N need OK" when something waits for
// you, then the day itself. Plain page: no sky here.

type View = "day" | "week" | "tasks";
const VIEWS: { v: View; t: string }[] = [
  { v: "day", t: "Day" },
  { v: "week", t: "Week" },
  { v: "tasks", t: "List" },
];
const SEG = 70;

type Props = {
  palette: Palette;
  active: boolean;
  onAsk: (r: AskRequest) => void;
  onVoice: () => void;
  onFocus: (f: FocusTarget) => void;
  version?: number;
  /** Bumped by the header's Inbox button. */
  inboxSignal?: number;
  /** Tells the header how much waits in Inbox, and whether anything needs your OK. */
  onWaiting?: (n: number, needsOk: boolean) => void;
};

function Line({ line }: { line: MLine | undefined }) {
  if (!line?.length) return null;
  return <>{line.map((s, i) => (s.strong ? <span key={i} className="em" style={{ color: ink.text }}>{s.text}</span> : <span key={i}>{s.text}</span>))}</>;
}

const useLockTipSeen = () => useSyncExternalStore(subscribeSettings, () => getSetting("lockTipSeen"));

export function PlanPage({ palette: P, active, onAsk, onVoice, onFocus, version = 0, inboxSignal = 0, onWaiting }: Props) {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxDone, setInboxDone] = useState<DoneRow[]>([]);
  const [opened, setOpened] = useState<MDayItem | null>(null);
  const day = useDay(date);
  const week = useWeek(date);
  const tasks = useTasks(view === "tasks");
  const inbox = useInbox();
  const toast = useToast();
  const tipSeen = useLockTipSeen();

  // Something outside Plan changed the day (a focus session ended): reload.
  useEffect(() => {
    if (version) {
      void day.refresh();
      void tasks.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const d = day.data;
  const tz = d?.timezone ?? week.data?.timezone ?? "UTC";
  const today = d?.isToday ? d.date : new Date().toISOString().slice(0, 10);
  const shownDate = d?.date ?? date ?? today;
  const title = view === "tasks" ? "Your list" : view === "week" ? "This week" : d?.isToday || (!d && !date) ? "Today" : shownDate === addDays(today, 1) ? "Tomorrow" : weekday(shownDate);
  const approvals = inbox.data?.counts.approvals ?? 0;
  const waiting = approvals + (inbox.data?.counts.proposals ?? 0);
  useEffect(() => {
    onWaiting?.(waiting, !!approvals);
  }, [waiting, approvals, onWaiting]);
  useEffect(() => {
    if (inboxSignal) setInboxOpen(true);
  }, [inboxSignal]);

  // Hard deadlines by task, from the week (the day view doesn't carry them).
  const due: DueMap = useMemo(() => {
    const m: DueMap = new Map();
    week.data?.days.find((x) => x.date === shownDate)?.due.forEach((x) => m.set(x.id, { at: x.due_at, hard: x.due_is_hard }));
    return m;
  }, [week.data, shownDate]);

  const contextName = view === "tasks" ? "your list" : view === "week" ? "this week" : d?.isToday ? "today" : weekday(shownDate);
  const ask = (prompt?: string, send?: boolean) => onAsk({ context: contextName, viewing: `Plan, ${view === "day" ? weekday(shownDate) : view === "tasks" ? "list" : "week"}`, prompt, send });

  const online = useOnline();
  const savedAt = view === "day" ? day.savedAt : view === "week" ? week.savedAt : tasks.savedAt;
  const openItems = d ? d.items.filter((i) => !i.done).length : 0;
  const clashes = d?.overlaps.length ?? 0;
  // A packed day: lots on it, or a clash on an already full day.
  const packed = view === "day" && !!d?.isToday && (openItems >= 9 || (clashes > 0 && openItems >= 7));

  const showTip = active && view === "day" && !tipSeen && !!d?.items.some((i) => i.look === "fixed");
  const hideTip = () => {
    feel("select");
    setSetting("lockTipSeen", true);
  };

  const onPlace = async (taskId: string, start: string, minutes: number, t: string) => {
    feel("success");
    try {
      await planActions.placeTask(taskId, start, minutes);
      toast(`${t} added at ${clockAmPm(start, tz)}`);
      void day.refresh();
      void week.refresh();
    } catch (e) {
      feel("warning");
      toast(`Couldn't add it: ${(e as Error).message}`);
    }
  };
  const onOutcome = async (it: MDayItem, status: "done" | "planned") => {
    feel(status === "done" ? "success" : "undo");
    try {
      await planActions.blockOutcome(it.id, { status });
      void day.refresh();
      if (status === "done")
        toast(`${it.title} done`, {
          accent: P.accent,
          undo: () => void planActions.blockOutcome(it.id, { status: "planned" }).then(() => day.refresh()),
        });
    } catch (e) {
      feel("warning");
      toast(`Couldn't save that: ${(e as Error).message}`);
    }
  };
  const onToggle = async (t: MTaskItem, done: boolean) => {
    try {
      if (done) await planActions.completeTask(t.id);
      else await planActions.uncompleteTask(t.id);
      if (done)
        toast(`${t.title} done`, {
          accent: P.accent,
          undo: () => void planActions.uncompleteTask(t.id).then(() => tasks.refresh()),
        });
    } catch (e) {
      feel("warning");
      toast(`Couldn't save that: ${(e as Error).message}`);
      void tasks.refresh();
    }
  };
  // Past-due Canvas items: the person says they're handed in (read back by the server).
  const onHandedIn = async (ids: string[]) => {
    try {
      const r = await planActions.triage({ decision: "handed_in", ids });
      feel(r.notChanged ? "warning" : "success");
      toast(r.notChanged ? `${r.changed} marked done, ${r.notChanged} didn't save. Try again.` : `${r.changed} marked handed in`, { accent: P.accent });
    } catch (e) {
      feel("warning");
      toast(`Couldn't save that: ${(e as Error).message}`);
    } finally {
      void day.refresh();
      void tasks.refresh();
    }
  };
  const focusOn = (it: MDayItem) => onFocus({ title: it.title, taskId: it.taskId, blockId: it.kind === "block" ? it.id : null, minutes: it.minutes, space: it.space?.name ?? null });

  const err = view === "day" ? day.error : view === "week" ? week.error : tasks.error;
  const loadingFirst = view === "day" ? !day.data : view === "week" ? !week.data : !tasks.data;
  const vi = VIEWS.findIndex((x) => x.v === view);

  const summary =
    view === "day" ? (
      <Line line={d?.headline} />
    ) : view === "week" ? (
      <Line line={week.data?.headline} />
    ) : tasks.data ? (
      <>
        <span className="em" style={{ color: ink.text }}>{tasks.data.today.length} left today.</span>
        {tasks.data.needsTime.length ? ` ${tasks.data.needsTime.length} still need a time.` : ""}
      </>
    ) : null;

  return (
    <div style={{ position: "absolute", inset: 0, background: ink.bg }}>
      <div className="scroll" style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 72px) 0 150px", boxSizing: "border-box" }}>
        <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ margin: "0 4px", display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`${title}. Pick a day`}
              disabled={view !== "day"}
              onClick={() => {
                feel("select");
                setPicker(true);
              }}
              style={{ alignSelf: "flex-start", minHeight: 44, display: "flex", alignItems: "center", gap: 8 }}
            >
              <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.035em" }}>{title}</h1>
              {view === "day" ? (
                <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" style={{ marginTop: 4 }}>
                  <path d="M5 8l5 5 5-5" fill="none" stroke={ink.text} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
            <p key={view + shownDate} style={{ margin: 0, minHeight: 24, fontSize: 17, lineHeight: 1.4, fontWeight: 500, color: "#1F2430", animation: "nFade 0.3s ease both" }}>{summary}</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div role="tablist" aria-label="Plan view" style={{ ...glass, position: "relative", height: 46, padding: 4, borderRadius: 23, display: "flex", boxSizing: "border-box" }}>
              <span aria-hidden="true" style={{ position: "absolute", top: 4, left: 4, width: SEG, height: 36, borderRadius: 18, background: "#FFFFFF", boxShadow: "0 2px 8px rgba(36,62,110,0.16)", transform: `translateX(${vi * SEG}px)`, transition: `transform 0.35s ${ease}` }} />
              {VIEWS.map((x) => {
                const sel = view === x.v;
                return (
                  <button key={x.v} type="button" role="tab" aria-selected={sel} onClick={() => { if (!sel) { feel("select"); setView(x.v); } }} style={{ position: "relative", width: SEG, height: 36, borderRadius: 18, fontSize: 15, fontWeight: sel ? 700 : 600, color: sel ? ink.text : ink.muted, textAlign: "center", transition: "color 0.25s" }}>
                    {x.t}
                  </button>
                );
              })}
            </div>
            {approvals ? (
              <button type="button" onClick={() => { feel("select"); setInboxOpen(true); }} style={{ height: 46, padding: "0 16px", borderRadius: 23, background: ink.text, color: ink.onCta, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", animation: "nFade 0.3s ease both" }}>
                {approvals} need{approvals === 1 ? "s" : ""} OK
              </button>
            ) : null}
          </div>

          {!online || savedAt ? (
            <span role="status" style={{ ...glass, alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 17, display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#A3A8BF" }} />
              {savedAt ? `Offline · as of ${new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "Offline · changes need a connection"}
            </span>
          ) : null}
          {packed ? (
            <div style={{ ...glass, borderRadius: 22, padding: "12px 10px 12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>
                Packed day · {openItems} things{clashes ? `, ${clashes === 1 ? "1 clash" : `${clashes} clashes`}` : ""}
              </span>
              <button type="button" onClick={() => ask(`My day is packed (${openItems} things${clashes ? `, ${clashes} clash${clashes === 1 ? "" : "es"}` : ""}). Help me lighten it.`, true)} style={{ flex: "none", height: 40, padding: "0 14px", borderRadius: 20, background: ink.text, color: ink.onCta, fontSize: 15, fontWeight: 600 }}>
                Lighten it
              </button>
            </div>
          ) : null}
          {showTip ? (
            <div style={{ borderRadius: 22, padding: "14px 12px 14px 16px", background: ink.raised, border: `1px solid ${ink.edge}`, display: "flex", alignItems: "center", gap: 12, animation: `nRise 0.35s ${ease} both` }}>
              <LockIcon c={ink.text} size={14} />
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>Locked means fixed. Navi plans around it, never moves it.</span>
              <button type="button" onClick={hideTip} style={{ ...glass, flex: "none", height: 40, padding: "0 14px", borderRadius: 20, fontSize: 15, fontWeight: 600 }}>Got it</button>
            </div>
          ) : null}
        </div>

        <div key={view + (date ?? "") + (loadingFirst ? "-wait" : "")} style={{ marginTop: 18, animation: "nFade 0.3s ease both" }}>
          {loadingFirst && !err ? <Skeleton /> : null}
          {err && loadingFirst ? <p style={{ margin: 0, padding: "0 20px", fontSize: 16, fontWeight: 500, color: meaning.slipping }}>Couldn't load your plan. It'll come back when you're online.</p> : null}
          {view === "day" && d ? <DayView day={d} due={due} h={{ onPlace, onOpen: setOpened, onAsk: (prompt, send) => ask(prompt, send), onFocus: focusOn, onHandedIn }} /> : null}
          {view === "week" && week.data ? <WeekView week={week.data} onOpenDay={(dt) => { setDate(dt); setView("day"); }} /> : null}
          {view === "tasks" && tasks.data ? <TasksView groups={tasks.data} tz={tz} onToggle={onToggle} onAsk={(p, send) => ask(p, send)} onHandedIn={onHandedIn} /> : null}
        </div>
      </div>

      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: "calc(var(--sat) + 78px)", background: "linear-gradient(180deg, #FBFBFD 0%, #FBFBFD 62%, rgba(251,251,253,0) 100%)", pointerEvents: "none" }} />
      {active ? <AskBar palette={P} text={`Ask about ${contextName}`} onOpen={() => ask()} onVoice={onVoice} /> : null}
      {picker ? <DayPicker selected={shownDate} today={today} onPick={(dt) => { setDate(dt === today ? null : dt); setView("day"); }} onClose={() => setPicker(false)} /> : null}
      {opened && d ? (
        <BlockSheet item={opened} date={d.date} tz={tz} isToday={d.isToday} due={opened.taskId ? due.get(opened.taskId) : undefined} onClose={() => setOpened(null)} onFocus={focusOn} onOutcome={(it, s) => void onOutcome(it, s)} onAsk={(p, s) => ask(p, s)} />
      ) : null}
      {inboxOpen ? (
        <InboxSheet
          inbox={inbox.data}
          done={inboxDone}
          onDone={setInboxDone}
          onClose={() => setInboxOpen(false)}
          onChanged={() => {
            void inbox.refresh();
            void day.refresh();
            void week.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[72, 64, 120, 88].map((h, i) => (
        <span key={i} style={{ marginLeft: 58, height: h, borderRadius: 20, background: i % 2 ? "rgba(17,20,26,0.04)" : "rgba(17,20,26,0.06)" }} />
      ))}
    </div>
  );
}

/** Seven days from yesterday. Pushing it back up closes it. */
function DayPicker({ selected, today, onPick, onClose }: { selected: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const { closing, close } = useExit(220);
  const drag = useSheetDrag(onClose, "up");
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 1));
  return (
    <Layer>
      <button ref={drag.scrim} type="button" aria-label="Close" tabIndex={-1} onClick={() => close(onClose)} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(20,30,52,0.18)", animation: closing ? "nFadeOut 0.22s ease both" : "nFade 0.25s ease backwards" }} />
      <div ref={drag.wrap} style={{ position: "absolute", inset: 0, zIndex: 11, pointerEvents: "none" }}>
        <section
          role="dialog"
          aria-label="Pick a day"
          {...drag.handlers}
          style={{ ...glassStrong, pointerEvents: "auto", position: "absolute", left: 8, right: 8, top: "calc(var(--sat) + 62px)", borderRadius: 30, padding: "18px 14px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 30px 60px rgba(20,30,52,0.2)", transformOrigin: "30% 0", animation: closing ? "nFadeOut 0.22s ease both" : `nGrow 0.28s ${ease} both`, touchAction: "none" }}
        >
          <h2 style={{ margin: "0 6px", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Pick a day</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
            {days.map((dt) => {
              const on = dt === selected;
              return (
                <button key={dt} type="button" aria-pressed={on} onClick={() => { feel("select"); close(() => { onClose(); onPick(dt); }); }} style={{ height: 72, borderRadius: 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: on ? ink.text : "transparent", color: on ? ink.onCta : ink.text, transition: "background-color 0.2s" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: on ? ink.onCta : ink.faint }}>{dt === today ? "Today" : weekdayShort(dt)}</span>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{dayNum(dt)}</span>
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: "rgba(17,20,26,0.22)" }} />
        </section>
      </div>
    </Layer>
  );
}

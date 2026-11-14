import { useState } from "react";
import type { MLine, MTaskItem, MDayItem } from "@shared/mobile-api-types";
import { planActions, useDay, useInbox, useTasks, useWeek } from "../data/plan";
import { addDays, clockAmPm, dayNum, monthDay, weekday, weekdayShort } from "../data/time";
import { feel } from "../native/haptics";
import { DayView } from "../plan/DayView";
import { WeekView } from "../plan/WeekView";
import { TasksView } from "../plan/TasksView";
import { InboxSheet } from "../plan/InboxSheet";
import { AskBar, type AskRequest } from "../shell/AskSheet";
import { useToast } from "../ui/Toast";
import { useExit } from "../ui/useExit";
import { ease, ink, meaning, type Palette } from "../theme/tokens";

type View = "day" | "week" | "tasks";
const VIEWS: { v: View; t: string }[] = [
  { v: "day", t: "Day" },
  { v: "week", t: "Week" },
  { v: "tasks", t: "Tasks" },
];

type Props = { palette: Palette; active: boolean; onAsk: (r: AskRequest) => void; onVoice: () => void };

function Line({ line }: { line: MLine | undefined }) {
  if (!line?.length) return null;
  return (
    <>
      {line.map((s, i) => (
        <span key={i} style={{ color: s.strong ? ink.text : ink.faint }}>{s.text}</span>
      ))}
    </>
  );
}

export function PlanPage({ palette: P, active, onAsk, onVoice }: Props) {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const day = useDay(date);
  const week = useWeek(date);
  const tasks = useTasks(view === "tasks");
  const inbox = useInbox();
  const toast = useToast();

  const d = day.data;
  const shownDate = d?.date ?? date ?? new Date().toISOString().slice(0, 10);
  const title = view === "tasks" ? "Tasks" : view === "week" ? "This week" : d?.isToday ? weekday(shownDate) : weekday(shownDate);
  const sub = view === "tasks" ? "" : view === "week" && week.data ? `${monthDay(week.data.start)} – ${dayNum(week.data.end)}` : monthDay(shownDate);
  const waiting = (inbox.data?.counts.approvals ?? 0) + (inbox.data?.counts.proposals ?? 0);
  const contextName = view === "tasks" ? "your tasks" : view === "week" ? "this week" : weekday(shownDate);

  const ask = (prompt?: string, send?: boolean) => onAsk({ context: contextName, viewing: `Plan, ${view === "day" ? weekday(shownDate) : view}`, prompt, send });

  const onPlace = async (taskId: string, start: string, minutes: number, t: string) => {
    feel("success");
    try {
      await planActions.placeTask(taskId, start, minutes);
      toast(`${t} added at ${clockAmPm(start, d?.timezone ?? "UTC")}`);
      void day.refresh();
    } catch (e) {
      feel("warning");
      toast(`Couldn't add it: ${(e as Error).message}`);
    }
  };
  const onOutcome = async (it: MDayItem, status: "done" | "skipped") => {
    feel("success");
    try {
      await planActions.blockOutcome(it.id, { status });
      void day.refresh();
      toast(`${it.title} marked done`, {
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

  const err = view === "day" ? day.error : view === "week" ? week.error : tasks.error;
  const loadingFirst = view === "day" ? !day.data : view === "week" ? !week.data : !tasks.data;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div className="scroll" style={{ position: "absolute", inset: 0, padding: "calc(var(--sat) + 54px) 0 150px", boxSizing: "border-box" }}>
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 460, background: P.scene, pointerEvents: "none" }} />
        <div style={{ position: "relative", padding: "0 8px 0 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button type="button" aria-haspopup="dialog" aria-label={`${title}${sub ? ", " + sub : ""}. Pick a day`} disabled={view === "tasks"} onClick={() => { feel("select"); setPicker(true); }} style={{ minHeight: 48, display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</span>
            {sub ? <span style={{ fontSize: 17, color: ink.faint }}>{sub}</span> : null}
          </button>
          <button type="button" aria-label={waiting ? `Inbox, ${waiting} waiting` : "Inbox"} onClick={() => { feel("select"); setInboxOpen(true); }} style={{ width: 48, height: 48, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", color: ink.soft }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13l2.5 8v6H3v-6z" /></svg>
            {waiting ? <span aria-hidden="true" style={{ position: "absolute", top: 5, right: 3, minWidth: 20, height: 20, padding: "0 6px", boxSizing: "border-box", borderRadius: 10, border: "2px solid #000", background: inbox.data?.counts.approvals ? meaning.needsOk : P.accent, color: "#00140A", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{waiting}</span> : null}
          </button>
        </div>

        <div role="group" aria-label="View" style={{ position: "relative", margin: "12px 20px 0", height: 40, padding: 4, boxSizing: "border-box", borderRadius: 20, background: "rgba(255,255,255,0.06)", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, left: 4, width: "calc((100% - 8px) / 3)", borderRadius: 16, background: "rgba(255,255,255,0.14)", transform: `translateX(${VIEWS.findIndex((x) => x.v === view) * 100}%)`, transition: `transform 0.32s ${ease}` }} />
          {VIEWS.map((x) => (
            <button key={x.v} type="button" aria-pressed={view === x.v} onClick={() => { if (view !== x.v) { feel("select"); setView(x.v); } }} style={{ position: "relative", borderRadius: 16, fontSize: 15, fontWeight: view === x.v ? 600 : 500, color: view === x.v ? ink.text : ink.faint, textAlign: "center", transition: "color 0.25s" }}>
              {x.t}
            </button>
          ))}
        </div>

        <div key={view + (date ?? "")} style={{ position: "relative", animation: "nFade 0.3s ease both" }}>
          <p style={{ margin: "20px 0 0", padding: "0 20px", fontSize: 17, lineHeight: 1.45, color: ink.faint, minHeight: 25 }}>
            {view === "day" ? <Line line={d?.headline} /> : view === "week" ? <Line line={week.data?.headline} /> : tasks.data ? <><span style={{ color: ink.text }}>{tasks.data.today.length} left today.</span> {tasks.data.needsTime.length ? `${tasks.data.needsTime.length} still need a time.` : ""}</> : null}
          </p>
          {inbox.data?.counts.approvals && view === "day" ? (
            <button type="button" onClick={() => setInboxOpen(true)} style={{ margin: "20px 20px 0", width: "calc(100% - 40px)", minHeight: 60, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderRadius: 16, background: "rgba(244,179,122,0.10)" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: "#F8D2B0" }}>{inbox.data.counts.approvals} need{inbox.data.counts.approvals === 1 ? "s" : ""} your OK</span>
                <span style={{ fontSize: 13, color: "#CDB39C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inbox.data.approvals.map((a) => a.subject).join(" · ")}</span>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={meaning.needsOk} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          ) : null}
          <div style={{ marginTop: 20 }}>
            {loadingFirst && !err ? <Skeleton /> : null}
            {err && loadingFirst ? <p style={{ margin: 0, padding: "0 20px", fontSize: 15, color: meaning.slipping }}>Couldn't load your plan. Pull Navi back up when you're online.</p> : null}
            {view === "day" && d ? <DayView day={d} P={P} h={{ onPlace, onOutcome, onAsk: (prompt) => ask(prompt, /\.$/.test(prompt)) }} /> : null}
            {view === "week" && week.data ? <WeekView week={week.data} onOpenDay={(dt) => { setDate(dt); setView("day"); }} /> : null}
            {view === "tasks" && tasks.data ? <TasksView groups={tasks.data} onToggle={onToggle} /> : null}
          </div>
        </div>
      </div>

      {active ? <AskBar palette={P} text={`Ask about ${contextName}…`} onOpen={() => ask()} onVoice={onVoice} /> : null}
      {picker ? <DayPicker selected={shownDate} today={d?.isToday ? d.date : new Date().toISOString().slice(0, 10)} onPick={(dt) => { setDate(dt); setView("day"); }} onClose={() => setPicker(false)} /> : null}
      {inboxOpen ? <InboxSheet palette={P} inbox={inbox.data} onClose={() => setInboxOpen(false)} onChanged={() => { void inbox.refresh(); void day.refresh(); }} /> : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[72, 52, 144, 96].map((h, i) => (
        <span key={i} style={{ marginLeft: 52, height: h, borderRadius: 16, background: `rgba(255,255,255,${i % 2 ? 0.05 : 0.07})` }} />
      ))}
    </div>
  );
}

function DayPicker({ selected, today, onPick, onClose }: { selected: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const { closing, close } = useExit(220);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 1));
  return (
    <>
      <button type="button" aria-label="Close" onClick={() => close(onClose)} style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.55)", animation: closing ? "nFadeOut 0.22s ease both" : "nFade 0.25s ease both" }} />
      <section aria-label="Pick a day" style={{ position: "absolute", left: 12, right: 12, top: "calc(var(--sat) + 106px)", zIndex: 11, borderRadius: 24, background: "#151517", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 30px 60px rgba(0,0,0,0.6)", padding: 12, display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, transformOrigin: "30% 0", animation: closing ? `nFadeOut 0.22s ease both` : `nGrow 0.26s ${ease} both` }}>
        {days.map((dt) => {
          const on = dt === selected;
          return (
            <button key={dt} type="button" aria-pressed={on} onClick={() => { feel("select"); close(() => { onClose(); onPick(dt); }); }} style={{ height: 64, borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: on ? ink.text : "transparent", color: on ? "#000" : dt === today ? ink.text : ink.soft }}>
              <span style={{ fontSize: 12 }}>{dt === today ? "Today" : weekdayShort(dt)}</span>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{dayNum(dt)}</span>
            </button>
          );
        })}
      </section>
    </>
  );
}

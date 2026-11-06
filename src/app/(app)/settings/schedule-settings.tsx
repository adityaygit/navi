"use client";
import { useState, useTransition } from "react";
import type { AvailabilityWindow, Profile } from "@/lib/types";
import { updateProfileAction } from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { GROUP, Row, SectionHead, Switch } from "@/components/settings-ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export function ScheduleSettings({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.display_name ?? "");
  const [timezone, setTimezone] = useState(profile.timezone);
  const [quietStart, setQuietStart] = useState(hhmm(profile.quiet_hours_start));
  const [quietEnd, setQuietEnd] = useState(hhmm(profile.quiet_hours_end));
  const [morning, setMorning] = useState(hhmm(profile.morning_briefing_time));
  const [evening, setEvening] = useState(hhmm(profile.evening_review_time));
  const [weekly, setWeekly] = useState(profile.weekly_review_day);
  const [enabled, setEnabled] = useState(profile.briefings_enabled);
  const [windows, setWindows] = useState<AvailabilityWindow[]>(profile.availability.map((w) => ({ ...w, start: hhmm(w.start), end: hhmm(w.end) })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timezone];

  const updateWindow = (i: number, patch: Partial<AvailabilityWindow>) => setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <form
      id="schedule"
      className="flex scroll-mt-24 flex-col gap-3"
      aria-labelledby="sched-h"
      onSubmit={(e) => {
        e.preventDefault();
        if ((quietStart && !quietEnd) || (!quietStart && quietEnd)) { setMsg({ ok: false, text: "Set both quiet-hours times, or clear both." }); return; }
        start(async () => {
          const r = await updateProfileAction({
            display_name: name || null,
            timezone,
            quiet_hours_start: quietStart || null,
            quiet_hours_end: quietEnd || null,
            morning_briefing_time: morning,
            evening_review_time: evening,
            weekly_review_day: weekly,
            briefings_enabled: enabled,
            availability: windows.filter((w) => w.days.length && w.start < w.end),
          });
          setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
          if (r.ok) announceChange();
        });
      }}
    >
      <SectionHead id="sched-h" title="You & your schedule" />
      <div className={GROUP}>
        <Row label="Name" htmlFor="s-name"><input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Row>
        <Row label="Time zone" htmlFor="s-tz">
          <select id="s-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Row>
      </div>

      <fieldset className="mt-3 flex min-w-0 flex-col gap-2">
        <legend className="mb-2 px-1 text-[15px] font-semibold">When you&apos;re free for flexible work</legend>
        <div className={GROUP}>
          <p className="muted px-4 py-3 text-[13px] sm:px-5">Navi only schedules flexible work inside these windows, around your fixed commitments.</p>
          {windows.length === 0 && <p className="px-4 py-3 text-sm text-recovery sm:px-5">No availability set, so Navi won&apos;t schedule flexible work.</p>}
          {windows.map((w, i) => (
            <div key={i} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:flex-row md:items-center md:justify-between">
              <div className="grid grid-cols-7 gap-1 md:flex" role="group" aria-label={`Days for window ${i + 1}`}>
                {DAYS.map((d, di) => (
                  <button key={d} type="button" aria-pressed={w.days.includes(di)} className={`btn btn-sm px-0 md:w-11 ${w.days.includes(di) ? "btn-primary" : ""}`} onClick={() => updateWindow(i, { days: w.days.includes(di) ? w.days.filter((x) => x !== di) : [...w.days, di].sort() })}>{d}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`w-s-${i}`}>From</label>
                <input id={`w-s-${i}`} type="time" className="input min-w-0 flex-1 md:w-36 md:flex-none" value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })} />
                <span aria-hidden className="dim">–</span>
                <label className="sr-only" htmlFor={`w-e-${i}`}>To</label>
                <input id={`w-e-${i}`} type="time" className="input min-w-0 flex-1 md:w-36 md:flex-none" value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })} />
                <button type="button" className="btn btn-ghost btn-sm w-11 shrink-0 px-0 text-muted" aria-label={`Remove window ${i + 1}`} title="Remove" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>
                  <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
          <div className="px-2 py-1.5 sm:px-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWindows((ws) => [...ws, { days: [1, 2, 3, 4, 5], start: "16:00", end: "20:00" }])}>+ Add window</button>
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-3 flex min-w-0 flex-col gap-2">
        <legend className="mb-2 px-1 text-[15px] font-semibold">Quiet hours</legend>
        <div className={GROUP}>
          <Row label="No notifications" hint={!quietStart ? "Not set. Navi won't assume quiet hours for you." : "Nothing is pushed to your devices in this window."}>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="q-s" className="label text-xs">From</label><input id="q-s" type="time" className="input" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></div>
              <div><label htmlFor="q-e" className="label text-xs">Until</label><input id="q-e" type="time" className="input" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></div>
            </div>
          </Row>
        </div>
      </fieldset>

      <fieldset className="mt-3 flex min-w-0 flex-col gap-2">
        <legend className="mb-2 px-1 text-[15px] font-semibold">Briefings &amp; reviews</legend>
        <div className={GROUP}>
          <Row label="Morning briefing" htmlFor="b-m"><input id="b-m" type="time" required className="input" value={morning} onChange={(e) => setMorning(e.target.value)} /></Row>
          <Row label="Evening review" htmlFor="b-e"><input id="b-e" type="time" required className="input" value={evening} onChange={(e) => setEvening(e.target.value)} /></Row>
          <Row label="Weekly review day" htmlFor="b-w">
            <select id="b-w" className="input" value={weekly} onChange={(e) => setWeekly(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </Row>
          <Switch id="b-auto" checked={enabled} onChange={setEnabled} label="Generate briefings and reviews automatically" />
        </div>
      </fieldset>

      <div className="flex items-center gap-3 px-1 pt-1">
        <button className="btn btn-primary min-w-28" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-focus" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

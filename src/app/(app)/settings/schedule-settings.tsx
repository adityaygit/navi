"use client";
import { useState, useTransition } from "react";
import type { AvailabilityWindow, Profile } from "@/lib/types";
import { updateProfileAction } from "../actions";
import { announceChange } from "@/lib/offline-queue";

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
      className="card flex flex-col gap-4"
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
      <h2 id="sched-h" className="h2">You & your schedule</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="s-name" className="label">Name</label><input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label htmlFor="s-tz" className="label">Time zone</label>
          <select id="s-tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label">When you're free for flexible work</legend>
        <p className="muted text-xs">Navi only schedules flexible work inside these windows, around your fixed commitments.</p>
        {windows.length === 0 && <p className="notice notice-warn text-sm">No availability set, so Navi won't schedule flexible work.</p>}
        {windows.map((w, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label={`Days for window ${i + 1}`}>
              {DAYS.map((d, di) => (
                <button key={d} type="button" aria-pressed={w.days.includes(di)} className={`btn btn-sm ${w.days.includes(di) ? "btn-primary" : ""}`} onClick={() => updateWindow(i, { days: w.days.includes(di) ? w.days.filter((x) => x !== di) : [...w.days, di].sort() })}>{d}</button>
              ))}
            </div>
            <label className="sr-only" htmlFor={`w-s-${i}`}>From</label>
            <input id={`w-s-${i}`} type="time" className="input w-36" value={w.start} onChange={(e) => updateWindow(i, { start: e.target.value })} />
            <span aria-hidden>–</span>
            <label className="sr-only" htmlFor={`w-e-${i}`}>To</label>
            <input id={`w-e-${i}`} type="time" className="input w-36" value={w.end} onChange={(e) => updateWindow(i, { end: e.target.value })} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn btn-sm self-start" onClick={() => setWindows((ws) => [...ws, { days: [1, 2, 3, 4, 5], start: "16:00", end: "20:00" }])}>+ Add window</button>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="label">Quiet hours (no notifications)</legend>
        <div><label htmlFor="q-s" className="label text-xs">From</label><input id="q-s" type="time" className="input" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></div>
        <div><label htmlFor="q-e" className="label text-xs">Until</label><input id="q-e" type="time" className="input" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></div>
        {!quietStart && <p className="muted text-xs sm:col-span-2">Not set. Navi won't assume quiet hours for you.</p>}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="label">Briefings & reviews</legend>
        <div><label htmlFor="b-m" className="label text-xs">Morning briefing</label><input id="b-m" type="time" required className="input" value={morning} onChange={(e) => setMorning(e.target.value)} /></div>
        <div><label htmlFor="b-e" className="label text-xs">Evening review</label><input id="b-e" type="time" required className="input" value={evening} onChange={(e) => setEvening(e.target.value)} /></div>
        <div><label htmlFor="b-w" className="label text-xs">Weekly review day</label>
          <select id="b-w" className="input" value={weekly} onChange={(e) => setWeekly(Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Generate briefings and reviews automatically</label>
      </fieldset>

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

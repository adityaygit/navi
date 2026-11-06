"use client";
import { useState, useTransition, type CSSProperties } from "react";
import { Pebble } from "@/components/pebble";
import { GROUP, SectionHead } from "@/components/settings-ui";
import { NAVI_COLORS, naviColor, naviColorVars, type NaviColorKey } from "@/lib/navi-colors";
import { connectionError } from "@/lib/connection";
import { announceChange } from "@/lib/offline-queue";
import { setNaviColorAction } from "./navi-color-actions";

const vars = (key: NaviColorKey) => naviColorVars(key) as CSSProperties;

/** Pick Navi's colour: preview it on a big Pebble, then keep it. Saving recolours Pebble across the app. */
export function NaviColorPicker({ saved }: { saved: NaviColorKey }) {
  const [current, setCurrent] = useState(saved);
  const [picked, setPicked] = useState(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const color = naviColor(picked);
  const changed = picked !== current;

  function keep() {
    setMsg(null);
    start(async () => {
      const r = await setNaviColorAction(picked).catch(() => ({ ok: false as const, error: connectionError() }));
      if (r.ok) {
        setCurrent(picked);
        setMsg({ ok: true, text: `Navi is ${color.name} now, everywhere.` });
        announceChange();
      } else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <section id="colour" aria-labelledby="colour-h" className="flex scroll-mt-24 flex-col gap-3">
      <SectionHead id="colour-h" title="Navi's colour" desc="Only Navi changes colour. Plan colours like fixed, flexible and at risk keep their meaning." />
      <div className={GROUP}>
        <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-8 text-center sm:flex-row sm:gap-7 sm:px-6 sm:py-6 sm:text-left" style={vars(picked)}>
          <Pebble size={116} float label={`Navi in ${color.name}`} />
          <div className="flex flex-col gap-1">
            <p className="text-[22px] font-semibold tracking-[-0.02em]" style={{ color: "var(--navi-text)" }}>{color.name}</p>
            <p className="muted text-sm">
              {changed ? `Previewing ${color.name}. Navi stays ${naviColor(current).name} until you keep it.` : `Pebble, Navi's replies and the things waiting on you use ${color.name}.`}
            </p>
          </div>
        </div>

        <fieldset className="px-2 py-2 sm:px-3">
          <legend className="sr-only">Navi's colour</legend>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
            {NAVI_COLORS.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[12px] border border-transparent px-1 pb-2.5 pt-3 text-[13px] text-muted transition-colors hover:bg-white/[0.04] has-[:checked]:border-white/25 has-[:checked]:bg-white/[0.07] has-[:checked]:text-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-flex motion-reduce:transition-none"
              >
                <input type="radio" name="navi-colour" value={c.key} checked={picked === c.key} onChange={() => { setPicked(c.key); setMsg(null); }} className="sr-only" />
                <span style={vars(c.key)} className="[&_.pebble-eye]:animate-none!">
                  <Pebble size={44} />
                </span>
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p role={msg && !msg.ok ? "alert" : "status"} className={`text-sm ${msg && !msg.ok ? "text-danger" : "muted"}`}>
            {msg ? msg.text : changed ? "Not kept yet." : `${naviColor(current).name} is Navi's colour.`}
          </p>
          {changed && (
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { setPicked(current); setMsg(null); }}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={keep}>{pending ? "Keeping…" : `Keep ${color.name}`}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

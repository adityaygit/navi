import { useEffect, useMemo, useRef, useState } from "react";
import type { MMe, MSettingsPatch } from "@shared/mobile-api-types";
import { NAVI_COLORS } from "@shared/navi-colors";
import { saveSettings, useProfile, forgetMe } from "../data/me";
import { supabase } from "../auth/supabase";
import { config } from "../config";
import { feel } from "../native/haptics";
import { getSetting, setSetting } from "../native/settings";
import { canNotify, notificationsAvailable } from "../native/notify";
import { usePalette } from "../theme/colour";
import { ease, ink, meaning } from "../theme/tokens";
import { Stone } from "../ui/Stone";
import { useExit } from "../ui/useExit";
import { useHideToast, useToast } from "../ui/Toast";
import { ColourPicker } from "./ColourPicker";
import { PasswordSheet } from "./PasswordSheet";
import { Group, RadioRow, Row, SelectRow, SwitchRow, TimeRow, card } from "./parts";
import { skippedByQuiet, syncReminders } from "./reminders";

// Settings (M5). One scrolling page in the M4 look: who you are, Navi's
// colour, your day, briefings, how much Navi does alone, this phone, privacy,
// account. Every change saves at once and syncs with the website; a failed
// save rolls back and says why. Swipe from the left edge (or Back) to close.

const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function zoneLabel(z: string) {
  return z.replace(/_/g, " ").replace(/^.*\//, "");
}

export function Settings({ onClose }: { onClose: () => void }) {
  const P = usePalette();
  const me = useProfile();
  const toast = useToast();
  const hideToast = useHideToast();
  useEffect(() => hideToast(), [hideToast]);
  const { closing, close } = useExit(300);
  const [pw, setPw] = useState(false);
  const [haptics, setHaptics] = useState(getSetting("haptics"));
  const [reminders, setReminders] = useState(getSetting("reminders"));
  const panel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const shut = () => close(onClose);

  async function save(patch: MSettingsPatch, optimistic: Partial<MMe>, ok?: string) {
    feel("select");
    try {
      await saveSettings(patch, optimistic);
      if (ok) toast(ok, { accent: P.accent });
    } catch (e) {
      feel("warning");
      toast((e as Error).message || "Couldn't save that. Try again.", { accent: meaning.slipping });
    }
  }

  // Reminders follow briefing times and quiet hours whenever they change.
  useEffect(() => {
    void syncReminders(me);
  }, [me, reminders]);

  // Swipe from the left edge to go back, like any iPhone page.
  const drag = useRef<{ x: number; dx: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const x = e.touches[0].clientX;
    if (x < 28) drag.current = { x, dx: 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag.current || !panel.current) return;
    drag.current.dx = Math.max(0, e.touches[0].clientX - drag.current.x);
    panel.current.style.transition = "none";
    panel.current.style.transform = `translateX(${drag.current.dx}px)`;
  };
  const onTouchEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    if (d.dx > 110) {
      feel("pageSettle");
      panel.current.style.transition = `transform 0.24s ${ease}`;
      panel.current.style.transform = "translateX(100%)";
      window.setTimeout(onClose, 230);
    } else {
      panel.current.style.transition = `transform 0.3s ${ease}`;
      panel.current.style.transform = "translateX(0)";
    }
  };

  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    const all = Array.from(new Set([me?.timezone ?? phoneZone, phoneZone, ...list]));
    return all.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [me?.timezone]);

  const skipped = me ? skippedByQuiet(me) : [];

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20 }}>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: closing ? "nFadeOut 0.3s ease both" : "nFade 0.3s ease both" }} />
      <div
        ref={panel}
        role="dialog"
        aria-label="Settings"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ position: "absolute", inset: 0, background: ink.bg, display: "flex", flexDirection: "column", animation: closing ? `nRightOut 0.3s ${ease} both` : `nRight 0.38s ${ease} both`, boxShadow: "-20px 0 40px rgba(0,0,0,0.5)" }}
      >
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 360, background: P.scene, opacity: 0.7, pointerEvents: "none" }} />
        {/* Top bar */}
        <div style={{ position: "relative", zIndex: 1, flex: "none", height: "calc(var(--sat) + 52px)", boxSizing: "border-box", display: "flex", alignItems: "center", padding: "var(--sat) 8px 0", background: scrolled ? "rgba(0,0,0,0.72)" : "transparent", backdropFilter: scrolled ? "blur(20px)" : undefined, WebkitBackdropFilter: scrolled ? "blur(20px)" : undefined, transition: "background-color 0.2s" }}>
          <button type="button" onClick={() => { feel("select"); shut(); }} style={{ height: 44, display: "flex", alignItems: "center", gap: 4, padding: "0 10px 0 6px", fontSize: 17, color: P.accent }}>
            <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2 2 10l8 8" /></svg>
            Back
          </button>
          <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 14, textAlign: "center", fontSize: 17, fontWeight: 600, pointerEvents: "none", opacity: scrolled ? 1 : 0, transition: "opacity 0.2s" }}>Settings</span>
          <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: ink.line, opacity: scrolled ? 1 : 0, transition: "opacity 0.2s" }} />
        </div>

        <div onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 44)} style={{ position: "relative", flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "0 16px calc(var(--sab) + 40px)" }}>
          <h1 style={{ margin: "4px 4px 18px", fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em" }}>Settings</h1>

          {!me ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: ink.faint, fontSize: 15 }}>Loading your settings…</div>
          ) : (
            <>
              {/* You */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 16, borderRadius: 20, background: card }}>
                <Stone w={52} h={48} bg={P.stone} shadow={`0 10px 24px ${P.stoneShadow}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.displayName || "You"}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 15, color: ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.email}</p>
                </div>
              </div>
              <p style={{ margin: "10px 16px 0", fontSize: 13, lineHeight: 1.45, color: ink.dim }}>
                You can also change any of this by telling Navi, like <span style={{ color: ink.soft }}>"move my morning briefing to 7"</span>.
              </p>

              <ColourPicker
                me={me}
                onPick={(followsDay, key) => {
                  if (followsDay === me.colourFollowsDay && (!key || key === me.naviColor.key)) return;
                  const patch: MSettingsPatch = { colourFollowsDay: followsDay, ...(key ? { naviColor: key } : {}) };
                  void save(patch, { colourFollowsDay: followsDay, ...(key ? { naviColor: { ...me.naviColor, ...(colourOf(key) ?? {}) } } : {}) });
                }}
              />

              <Group label="Your day" foot="Navi only plans between waking up and bedtime, in your time zone.">
                <NameRow value={me.displayName ?? ""} onSave={(v) => save({ displayName: v || null }, { displayName: v || null }, "Name saved")} />
                <SelectRow label="Time zone" value={me.timezone} display={zoneLabel(me.timezone)} options={zones} onChange={(v) => save({ timezone: v }, { timezone: v }, `Time zone set to ${zoneLabel(v)}`)} />
                {me.timezone !== phoneZone ? (
                  <Row label={<span style={{ color: P.accent }}>Use this phone's ({zoneLabel(phoneZone)})</span>} onClick={() => save({ timezone: phoneZone }, { timezone: phoneZone }, `Time zone set to ${zoneLabel(phoneZone)}`)} />
                ) : null}
                <TimeRow label="Wake up" value={me.wakeBed?.wake ?? "07:00"} onChange={(v) => save({ wakeBed: { wake: v, bed: me.wakeBed?.bed ?? "23:00" } }, { wakeBed: { wake: v, bed: me.wakeBed?.bed ?? "23:00" } })} />
                <TimeRow label="Bedtime" value={me.wakeBed?.bed ?? "23:00"} onChange={(v) => save({ wakeBed: { wake: me.wakeBed?.wake ?? "07:00", bed: v } }, { wakeBed: { wake: me.wakeBed?.wake ?? "07:00", bed: v } })} />
              </Group>

              <Group
                label="Briefings"
                foot={
                  skipped.length
                    ? `Your ${skipped.join(" and ")} briefing falls in quiet hours, so it won't notify you. It still waits in Navi.`
                    : "A short plan each morning and a two-minute review each evening. Nothing notifies you during quiet hours."
                }
              >
                <SwitchRow label="Morning and evening briefings" on={me.briefings.enabled} accent={P.accent} onChange={(v) => save({ briefingsEnabled: v }, { briefings: { ...me.briefings, enabled: v } })} />
                <TimeRow label="Morning briefing" value={me.briefings.morning} disabled={!me.briefings.enabled} onChange={(v) => save({ morning: v }, { briefings: { ...me.briefings, morning: v } })} />
                <TimeRow label="Evening review" value={me.briefings.evening} disabled={!me.briefings.enabled} onChange={(v) => save({ evening: v }, { briefings: { ...me.briefings, evening: v } })} />
                <SwitchRow label="Quiet hours" sub={me.quietHours ? undefined : "Off"} on={!!me.quietHours} accent={P.accent} onChange={(v) => { const q = v ? { start: "22:00", end: "07:00" } : null; void save({ quietHours: q }, { quietHours: q }); }} />
                {me.quietHours ? (
                  <>
                    <TimeRow label="From" value={me.quietHours.start} onChange={(v) => save({ quietHours: { start: v, end: me.quietHours!.end } }, { quietHours: { start: v, end: me.quietHours!.end } })} />
                    <TimeRow label="Until" value={me.quietHours.end} onChange={(v) => save({ quietHours: { start: me.quietHours!.start, end: v } }, { quietHours: { start: me.quietHours!.start, end: v } })} />
                  </>
                ) : null}
              </Group>

              <Group label="When Navi changes things" foot="Anything that affects other people or outside services always waits for your OK.">
                <RadioRow label="Just do it" sub="Small changes happen at once, with Undo." on={me.autonomy === "auto"} accent={P.accent} onPick={() => me.autonomy !== "auto" && save({ autonomy: "auto" }, { autonomy: "auto" })} />
                <RadioRow label="Ask me first" sub="Every change waits for your OK." on={me.autonomy === "ask"} accent={P.accent} onPick={() => me.autonomy !== "ask" && save({ autonomy: "ask" }, { autonomy: "ask" })} />
              </Group>

              <Group label="This phone" foot={notificationsAvailable ? "These stay on this phone only." : "Reminders work in the Navi app on your phone."}>
                <SwitchRow
                  label="Briefing reminders"
                  sub="A notification at your briefing times"
                  on={reminders && me.briefings.enabled}
                  disabled={!notificationsAvailable || !me.briefings.enabled}
                  accent={P.accent}
                  onChange={async (v) => {
                    feel("select");
                    if (v && !(await canNotify())) {
                      toast("Notifications are off for Navi. Turn them on in your phone's Settings.", { accent: meaning.needsOk });
                      return;
                    }
                    setSetting("reminders", v);
                    setReminders(v);
                  }}
                />
                <SwitchRow
                  label="Vibration"
                  sub="Taps when you swipe, send, finish and hold to talk"
                  on={haptics}
                  accent={P.accent}
                  onChange={(v) => {
                    setSetting("haptics", v);
                    setHaptics(v);
                    if (v) feel("success");
                  }}
                />
              </Group>

              <Group label="Privacy">
                <Row label="Only you can read it" sub="Your data is locked to your account. No one else's account can read it." />
                <Row label="Conversations are saved, raw audio isn't" sub="Typed chats and voice transcripts are kept so Navi remembers context. Voice audio is processed, not stored." />
                <Row label="Who processes it" sub="Text by Anthropic (Claude API), voice by Google (Gemini Live API), under their API terms." />
                <Row label="Imported content is data" sub="What you import or capture is never treated as instructions to Navi." />
              </Group>

              <Group label="Account" foot="Connected services like Canvas, the AI budget and deleting your account are on the website for now.">
                <Row label="Password" value="Set or change" chevron onClick={() => { feel("select"); setPw(true); }} />
                <Row label="More settings on the website" chevron onClick={() => { feel("select"); window.open(`${config.apiBase}/settings`, "_blank"); }} />
                <Row label="Sign out" danger onClick={() => { feel("warning"); forgetMe(); void supabase.auth.signOut(); }} />
              </Group>

              <p style={{ margin: "28px 0 0", textAlign: "center", fontSize: 13, color: ink.dim }}>Navi 1.5</p>
            </>
          )}
        </div>
      </div>
      {pw ? <PasswordSheet palette={P} onClose={() => setPw(false)} onSaved={() => toast("Password saved. You can sign in with it now.", { accent: P.accent })} /> : null}
    </div>
  );
}

function NameRow({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="npress" style={{ position: "relative", minHeight: 52, display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", fontSize: 17 }}>
      <span style={{ flex: "none" }}>Name</span>
      <input
        value={v}
        placeholder="Your name"
        maxLength={120}
        autoComplete="name"
        enterKeyHint="done"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v.trim() !== value && onSave(v.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ flex: 1, minWidth: 0, textAlign: "right", background: "transparent", border: 0, outline: "none", fontSize: 17, color: ink.muted }}
      />
    </label>
  );
}

function colourOf(key: string) {
  const c = NAVI_COLORS.find((x) => x.key === key);
  return c ? { key: c.key, name: c.name, light: c.light, mid: c.mid, dark: c.dark, ink: c.ink, text: c.text } : null;
}

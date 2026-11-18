import { useEffect, useMemo, useState } from "react";
import type { MMe, MSettingsPatch } from "@shared/mobile-api-types";
import { saveSettings, useProfile, forgetMe } from "../data/me";
import { supabase } from "../auth/supabase";
import { config } from "../config";
import { feel } from "../native/haptics";
import { getSetting, setSetting } from "../native/settings";
import { canNotify, notificationsAvailable } from "../native/notify";
import { usePalette } from "../theme/colour";
import { ink, meaning } from "../theme/tokens";
import { HoldButton } from "../ui/HoldButton";
import { Pushed } from "../you/Pushed";
import { MemoryScreen } from "../you/Memory";
import { NotesScreen } from "../you/Notes";
import { ActivityScreen } from "../you/Activity";
import { SpacesScreen } from "../you/Spaces";
import { useHideToast, useToast } from "../ui/Toast";
import { PasswordSheet } from "./PasswordSheet";
import { Group, RadioRow, Row, SelectRow, SwitchRow, TimeRow, card } from "./parts";
import { skippedByQuiet, syncReminders } from "./reminders";

// Settings (M6 You). One scrolling page: who you are, what Navi keeps
// (memory, notes, activity, spaces), your day, briefings, how much Navi does alone, this phone, privacy,
// account. Every change saves at once and syncs with the website; a failed
// save rolls back and says why. Swipe from the left edge (or Back) to close.

const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function zoneLabel(z: string) {
  return z.replace(/_/g, " ").replace(/^.*\//, "");
}

export function Settings({ onClose, onSetup }: { onClose: () => void; onSetup?: () => void }) {
  const P = usePalette();
  const me = useProfile();
  const toast = useToast();
  const hideToast = useHideToast();
  useEffect(() => hideToast(), [hideToast]);
  const [pw, setPw] = useState(false);
  const [sub, setSub] = useState<null | "memory" | "notes" | "activity" | "spaces">(null);
  const [sky, setSky] = useState(getSetting("sky"));
  const [haptics, setHaptics] = useState(getSetting("haptics"));
  const [reminders, setReminders] = useState(getSetting("reminders"));

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

  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    const all = Array.from(new Set([me?.timezone ?? phoneZone, phoneZone, ...list]));
    return all.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [me?.timezone]);

  const skipped = me ? skippedByQuiet(me) : [];

  return (
    <>
      <Pushed title="Settings" onClose={onClose}>
        {() => (
          <>
          {!me ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: ink.faint, fontSize: 15 }}>Loading your settings…</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 22, background: card }}>
                <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 24, background: ink.text, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>{(me.displayName || me.email || "Y").slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.displayName || "You"}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 500, color: ink.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{me.email}</p>
                </div>
              </div>

              {me.onboarding.status === "skipped" && onSetup ? (
                <button type="button" onClick={() => { feel("select"); onSetup(); }} style={{ marginTop: 16, width: "100%", minHeight: 64, borderRadius: 22, background: ink.text, color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 17, fontWeight: 700 }}>
                  Finish setting up Navi
                  <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ) : null}

              <Group label="What Navi keeps" foot={<>You can also change any of this by telling Navi, like “move my morning briefing to 7”.</>}>
                <Row label="Memory" sub="What Navi knows about you" chevron onClick={() => { feel("select"); setSub("memory"); }} />
                <Row label="Notes" sub="Things you wanted to keep" chevron onClick={() => { feel("select"); setSub("notes"); }} />
                <Row label="Activity" sub="Everything that changed, with Undo" chevron onClick={() => { feel("select"); setSub("activity"); }} />
                <Row label="Spaces" sub="School, work, friends and the rest" chevron onClick={() => { feel("select"); setSub("spaces"); }} />
              </Group>

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
                  label="Sky backgrounds"
                  sub="Behind the greeting, Focus and stories"
                  on={sky}
                  accent={P.accent}
                  onChange={(v) => {
                    feel("select");
                    setSetting("sky", v);
                    setSky(v);
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
              </Group>
              <HoldButton
                ms={1200}
                doneFeel="warning"
                label="Hold to sign out"
                onDone={() => {
                  forgetMe();
                  void supabase.auth.signOut();
                }}
                onHint={(t) => toast(t)}
                fill="rgba(178,58,23,0.12)"
                style={{ marginTop: 24, width: "100%", height: 56, borderRadius: 28, background: card, color: meaning.slipping, fontSize: 17, fontWeight: 700, textAlign: "center" }}
              />

              <p style={{ margin: "24px 0 0", textAlign: "center", fontSize: 14, fontWeight: 500, color: ink.dim }}>Navi 1.5</p>
            </>
          )}
          </>
        )}
      </Pushed>
      {sub === "memory" ? <MemoryScreen onClose={() => setSub(null)} /> : null}
      {sub === "notes" ? <NotesScreen onClose={() => setSub(null)} /> : null}
      {sub === "activity" ? <ActivityScreen onClose={() => setSub(null)} /> : null}
      {sub === "spaces" ? <SpacesScreen onClose={() => setSub(null)} /> : null}
      {pw ? <PasswordSheet palette={P} onClose={() => setPw(false)} onSaved={() => toast("Password saved. You can sign in with it now.", { accent: P.accent })} /> : null}
    </>
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

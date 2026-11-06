import type { CSSProperties } from "react";
import Link from "next/link";
import { requireCtx, getProfile } from "@/server/context";
import { canApproveBudgetOverride, getBudgetStatus } from "@/server/ai/budget";
import { aiAvailability, modelFor, voiceAvailability } from "@/server/ai/config";
import { serverEnv } from "@/lib/env";
import { integrations } from "@/server/integrations";
import { pushConfigured } from "@/server/jobs/notify";
import { naviColorVars } from "@/lib/navi-colors";
import { Pebble } from "@/components/pebble";
import { GROUP, Row, SectionHead } from "@/components/settings-ui";
import { ScheduleSettings } from "./schedule-settings";
import { PushSettings } from "./push-settings";
import { BudgetOverride, DangerZone } from "./misc-settings";
import { PasswordSettings } from "./password-settings";
import { NaviColorPicker } from "./navi-color-picker";
import { savedNaviColor } from "./navi-color";
import { ActionButton } from "@/components/action-button";
import { restartOnboardingAction } from "../actions";

export const metadata = { title: "Settings · Navi" };

const SECTIONS: [string, string][] = [
  ["schedule", "You & your schedule"],
  ["colour", "Navi's colour"],
  ["notifications", "Notifications"],
  ["budget", "AI & testing budget"],
  ["privacy", "Privacy & your data"],
  ["services", "Connected services"],
  ["password", "Password"],
  ["delete", "Delete account"],
];

const details = "group [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:items-center [&_summary]:justify-between [&_summary]:gap-3 [&_summary]:px-4 [&_summary]:py-3.5 [&_summary]:text-[15px] [&_summary]:font-medium sm:[&_summary]:px-5 [&_summary::-webkit-details-marker]:hidden";

function DisclosureMark() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim transition-transform group-open:rotate-90 motion-reduce:transition-none">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const profile = await getProfile(ctx);
  const [budget, usageRes, subsRes, notifRes, { data: claims }] = await Promise.all([
    getBudgetStatus(),
    ctx.db.from("ai_usage").select("provider,model,purpose,cost_usd,input_tokens,output_tokens,audio_seconds,created_at").order("created_at", { ascending: false }).limit(20),
    ctx.db.from("push_subscriptions").select("id,user_agent,created_at,last_success_at,last_error"),
    ctx.db.from("notifications").select("id,title,status,last_error,created_at,sent_at,deliver_after").order("created_at", { ascending: false }).limit(10),
    ctx.db.auth.getClaims(),
  ]);
  const ai = aiAvailability();
  const voice = voiceAvailability();
  const email = (claims?.claims?.email as string | undefined) ?? "";
  const color = savedNaviColor(profile.preferences);
  const meter = budget.exceeded ? "bg-clash" : budget.warn ? "bg-recovery" : "bg-[#f2f2f2]";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-8 flex flex-col gap-0.5 pt-[88px] text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className={`block rounded-[8px] px-3 py-1.5 hover:bg-white/[0.05] hover:text-text ${id === "delete" ? "text-clash" : "text-muted"}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-9">
        <header className="flex flex-col gap-5">
          <h1 className="h1">Settings</h1>
          <div className="surf flex items-center gap-4 px-4 py-4 sm:px-5">
            <span style={naviColorVars(color) as CSSProperties}><Pebble size={48} /></span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[17px] font-semibold">{profile.display_name || "You"}</p>
              <p className="muted truncate text-sm">Signed in as {email}</p>
            </div>
          </div>
          <p className="muted -mt-2 px-1 text-sm">You can also change any of this by telling Navi.</p>
        </header>

        <ScheduleSettings profile={profile} />

        <NaviColorPicker saved={color} />

        <section id="notifications" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="notif-h">
          <SectionHead id="notif-h" title="Notifications" desc="Briefings, reviews and deadline reminders go to devices you turn on, never during your quiet hours." />
          <div className={GROUP}>
            <PushSettings configured={pushConfigured()} />
            <Row label="On iPhone" hint="Add Navi to your Home Screen first (Share → Add to Home Screen), open it from there, then turn on notifications." />
            <details className={details}>
              <summary>Delivery diagnostics <DisclosureMark /></summary>
              <div className="flex flex-col gap-4 px-4 pb-4 text-sm sm:px-5">
                <div className="flex flex-col gap-1.5">
                  <p className="font-medium">Subscribed devices <span className="num muted">({subsRes.data?.length ?? 0})</span></p>
                  <ul className="muted flex flex-col gap-1 text-[13px]">
                    {(subsRes.data ?? []).length === 0 && <li>None on this account yet.</li>}
                    {(subsRes.data ?? []).map((s) => (
                      <li key={s.id} className="break-words">{(s.user_agent ?? "Unknown device").slice(0, 80)} · added {new Date(s.created_at).toLocaleDateString()} · {s.last_success_at ? `last delivered ${new Date(s.last_success_at).toLocaleString()}` : "never delivered yet"}{s.last_error ? ` · last error: ${s.last_error}` : ""}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="font-medium">Recent notifications</p>
                  <ul className="muted flex flex-col gap-1 text-[13px]">
                    {(notifRes.data ?? []).length === 0 && <li>None yet.</li>}
                    {(notifRes.data ?? []).map((n) => <li key={n.id} className="break-words">{n.title} · {n.status.replace(/_/g, " ")}{n.sent_at ? ` at ${new Date(n.sent_at).toLocaleString()}` : ""}{n.last_error ? ` · ${n.last_error}` : ""}</li>)}
                  </ul>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section id="budget" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="ai-h">
          <SectionHead id="ai-h" title="AI & testing budget" />
          <div className={GROUP}>
            <Row label="Text AI">
              <p className="text-sm sm:text-right">
                {ai.mode === "anthropic" ? "Claude API connected" : ai.mode === "devsim" ? "Development simulator (not a real AI model)" : <span className="text-recovery">Unavailable: {ai.reason}</span>}
                {ai.mode === "anthropic" && <span className="muted block text-[13px]">everyday <code>{modelFor("fast")}</code> · planning <code>{modelFor("planner")}</code></span>}
              </p>
            </Row>
            <Row label="Voice">
              <p className="break-words text-sm sm:text-right">{voice.ready ? <>Gemini Live <span className="muted block text-[13px]"><code>{voice.model}</code></span></> : <span className="text-recovery">Unavailable: {voice.reason}</span>}</p>
            </Row>
            <div className="flex flex-col gap-2.5 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[15px] font-medium">Today <span className="muted text-[13px] font-normal">{budget.day}, resets {budget.resetsAt}</span></p>
                <p className="num text-sm">
                  ≈${budget.spentUsd.toFixed(4)} <span className="muted">of ${budget.capUsd.toFixed(2)}</span>
                  {budget.overrideUsd ? <span className="muted"> (includes +${budget.overrideUsd.toFixed(2)} override)</span> : null}
                </p>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`${Math.round(Math.min(1, budget.ratio) * 100)}% of today's budget used`}>
                <div className={`h-full rounded-full ${meter}`} style={{ width: `${Math.min(100, budget.ratio * 100)}%` }} />
              </div>
              <p className="muted text-[13px] leading-snug">
                Costs are estimated locally from each provider response&apos;s token/audio counts at published prices, and can lag or differ from your actual bill. Navi warns at {Math.round(serverEnv.budgetWarnRatio() * 100)}% and stops new AI calls at the cap. This guard can&apos;t absolutely prevent charges: also set spend limits in the Anthropic Console and Google AI Studio / Cloud billing.
              </p>
            </div>
            <div className="px-4 py-3.5 sm:px-5">
              {canApproveBudgetOverride(email) ? (
                <BudgetOverride exceeded={budget.exceeded} />
              ) : (
                <p className="muted text-[13px]">The daily budget is shared by everyone on this Navi. Only the budget owner can raise it.</p>
              )}
            </div>
            <details className={details}>
              <summary>Your recent AI calls <DisclosureMark /></summary>
              <ul className="muted flex flex-col gap-1 px-4 pb-4 text-[13px] sm:px-5">
                {(usageRes.data ?? []).length === 0 && <li>None yet.</li>}
                {(usageRes.data ?? []).map((u, i) => <li key={i} className="num break-words">{new Date(u.created_at).toLocaleString()} · {u.purpose} · {u.model} · {u.input_tokens}/{u.output_tokens} tokens{u.audio_seconds ? ` · ${Math.round(u.audio_seconds)}s audio` : ""} · ≈${Number(u.cost_usd).toFixed(5)}</li>)}
              </ul>
            </details>
          </div>
        </section>

        <section id="privacy" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="priv-h">
          <SectionHead id="priv-h" title="Privacy & your data" />
          <div className={GROUP}>
            <Row wide label="Only you can read it" hint="Your data is stored in your Navi database with row-level security: only your account can read it." />
            <Row wide label="Conversations are saved, raw audio isn't" hint="Typed conversations and voice transcripts are saved so Navi can remember context. Raw voice audio is streamed to the voice provider for processing and is not stored by Navi." />
            <Row wide label="Who processes it" hint="Text AI is processed by Anthropic (Claude API). Voice is processed by Google (Gemini Live API). Provider retention follows their API terms; Google's free tier may use data to improve its products, so use a paid Gemini tier for private voice use." />
            <Row wide label="Imported content is data" hint="Imported or captured content is treated as data, never as instructions to Navi." />
            <div className="flex flex-wrap gap-2 px-4 py-3.5 sm:px-5">
              <a className="btn btn-sm" href="/api/export">Export all my data (JSON)</a>
              <ActionButton className="btn btn-sm" action={restartOnboardingAction}>Redo setup conversation</ActionButton>
              <Link className="btn btn-sm" href="/onboarding">Open setup</Link>
            </div>
          </div>
        </section>

        <section id="services" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="int-h">
          <SectionHead id="int-h" title="Connected services" desc="Not part of V1 yet. Navi's own planner and calendar work without them. When connected, anything that affects other people or outside systems will still require your approval." />
          <ul className={GROUP}>
            {integrations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-medium">{i.name}</span>
                  <span className="muted text-[13px]">{i.description}</span>
                </span>
                <span className={`badge shrink-0 ${i.isConnected() ? "badge-ok" : ""}`}>{i.isConnected() ? "connected" : "not connected"}</span>
              </li>
            ))}
          </ul>
        </section>

        <PasswordSettings />

        <DangerZone email={email} />
      </div>
    </div>
  );
}

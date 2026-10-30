import Link from "next/link";
import { requireCtx, getProfile } from "@/server/context";
import { getBudgetStatus } from "@/server/ai/budget";
import { aiAvailability, modelFor, voiceAvailability } from "@/server/ai/config";
import { serverEnv } from "@/lib/env";
import { integrations } from "@/server/integrations";
import { pushConfigured } from "@/server/jobs/notify";
import { ScheduleSettings } from "./schedule-settings";
import { PushSettings } from "./push-settings";
import { BudgetOverride, DangerZone } from "./misc-settings";
import { ActionButton } from "@/components/action-button";
import { restartOnboardingAction } from "../actions";

export const metadata = { title: "Settings · Navi" };

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

  return (
    <div className="flex flex-col gap-5">
      <h1 className="h1">Settings</h1>
      <p className="muted text-sm">Signed in as {email}. You can also change any of this by telling Navi.</p>

      <ScheduleSettings profile={profile} />

      <section className="card flex flex-col gap-2" aria-labelledby="notif-h">
        <h2 id="notif-h" className="h2">Notifications</h2>
        <p className="muted text-sm">Briefings, reviews and deadline reminders are pushed to devices you enable, never during your quiet hours. On iPhone, add Navi to your Home Screen first (Share → Add to Home Screen), open it from there, then enable notifications.</p>
        <PushSettings configured={pushConfigured()} />
        <details>
          <summary className="cursor-pointer text-sm font-medium">Delivery diagnostics</summary>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <div>
              <div className="font-medium">Subscribed devices ({subsRes.data?.length ?? 0})</div>
              <ul className="muted text-xs">
                {(subsRes.data ?? []).map((s) => (
                  <li key={s.id}>{(s.user_agent ?? "Unknown device").slice(0, 80)} · added {new Date(s.created_at).toLocaleDateString()} · {s.last_success_at ? `last delivered ${new Date(s.last_success_at).toLocaleString()}` : "never delivered yet"}{s.last_error ? ` · last error: ${s.last_error}` : ""}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium">Recent notifications</div>
              <ul className="muted text-xs">
                {(notifRes.data ?? []).length === 0 && <li>None yet.</li>}
                {(notifRes.data ?? []).map((n) => <li key={n.id}>{n.title} · {n.status.replace(/_/g, " ")}{n.sent_at ? ` at ${new Date(n.sent_at).toLocaleString()}` : ""}{n.last_error ? ` · ${n.last_error}` : ""}</li>)}
              </ul>
            </div>
          </div>
        </details>
      </section>

      <section id="budget" className="card flex flex-col gap-2" aria-labelledby="ai-h">
        <h2 id="ai-h" className="h2">AI & testing budget</h2>
        <p className="text-sm">
          Status: {ai.mode === "anthropic" ? "Claude API connected" : ai.mode === "devsim" ? "Development simulator (not a real AI model)" : `Unavailable: ${ai.reason}`}
          {ai.mode === "anthropic" && <> · everyday: <code>{modelFor("fast")}</code> · planning: <code>{modelFor("planner")}</code></>}
        </p>
        <p className="text-sm">Voice: {voice.ready ? <>Gemini Live (<code>{voice.model}</code>)</> : `Unavailable: ${voice.reason}`}</p>
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="font-medium">Today ({budget.day}, resets {budget.resetsAt})</div>
          <div>≈${budget.spentUsd.toFixed(4)} of ${budget.capUsd.toFixed(2)} {budget.overrideUsd ? `(includes +$${budget.overrideUsd.toFixed(2)} override)` : ""}</div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface"><div className={`h-full ${budget.exceeded ? "bg-danger" : budget.warn ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, budget.ratio * 100)}%` }} /></div>
          <p className="muted mt-2 text-xs">
            Costs are estimated locally from each provider response's token/audio counts at published prices, and can lag or differ from your actual bill. Navi warns at {Math.round(serverEnv.budgetWarnRatio() * 100)}% and stops new AI calls at the cap. This guard can't absolutely prevent charges: also set spend limits in the Anthropic Console and Google AI Studio / Cloud billing.
          </p>
        </div>
        <BudgetOverride exceeded={budget.exceeded} />
        <details>
          <summary className="cursor-pointer text-sm font-medium">Your recent AI calls</summary>
          <ul className="muted mt-2 text-xs">
            {(usageRes.data ?? []).length === 0 && <li>None yet.</li>}
            {(usageRes.data ?? []).map((u, i) => <li key={i}>{new Date(u.created_at).toLocaleString()} · {u.purpose} · {u.model} · {u.input_tokens}/{u.output_tokens} tokens{u.audio_seconds ? ` · ${Math.round(u.audio_seconds)}s audio` : ""} · ≈${Number(u.cost_usd).toFixed(5)}</li>)}
          </ul>
        </details>
      </section>

      <section className="card flex flex-col gap-2" aria-labelledby="priv-h">
        <h2 id="priv-h" className="h2">Privacy</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>Your data is stored in your Navi database with row-level security: only your account can read it.</li>
          <li>Conversations (typed and voice transcripts) are saved so Navi can remember context. Raw voice audio is streamed to the voice provider for processing and is not stored by Navi.</li>
          <li>Text AI is processed by Anthropic (Claude API). Voice is processed by Google (Gemini Live API). Provider retention follows their API terms; Google's free tier may use data to improve its products, so use a paid Gemini tier for private voice use.</li>
          <li>Imported or captured content is treated as data, never as instructions to Navi.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-sm" href="/api/export">Export all my data (JSON)</a>
          <ActionButton className="btn btn-sm" action={() => restartOnboardingAction()}>Redo setup conversation</ActionButton>
          <Link className="btn btn-sm" href="/onboarding">Open setup</Link>
        </div>
      </section>

      <section className="card flex flex-col gap-2" aria-labelledby="int-h">
        <h2 id="int-h" className="h2">Connected services</h2>
        <p className="muted text-sm">Not part of V1 yet. Navi's own planner and calendar work without them. When connected, anything that affects other people or outside systems will still require your approval.</p>
        <ul className="text-sm">{integrations.map((i) => <li key={i.id} className="flex gap-2"><span className="flex-1">{i.name} <span className="muted">— {i.description}</span></span><span className="badge">{i.isConnected() ? "connected" : "not connected"}</span></li>)}</ul>
      </section>

      <DangerZone />
    </div>
  );
}

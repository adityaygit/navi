"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import type { Message, Proposal } from "@/lib/types";
import type { ActionView } from "@/lib/actions";
import type { WelcomeStep } from "@/lib/onboarding";
import type { Line } from "@/lib/sentences";
import { Chat } from "@/components/chat";
import { Stone } from "@/components/shell/stone";
import { ProposalCard, proposalSummary, titleOf } from "@/components/proposal-card";
import {
  completeOnboardingAction,
  finishTalkAction,
  restartOnboardingAction,
  saveBasicsAction,
  saveWelcomeStepAction,
  skipWelcomeAction,
} from "@/app/(app)/client-actions";
import { announceChange } from "@/lib/offline-queue";
import { enablePush, pushSupport, type PushSupport } from "@/lib/push-client";

export type PlanRow =
  | { kind: "now"; time: string; label: string }
  | { kind: "item"; time: string; title: string; sub: string; color: string; style: "fixed" | "flex" | "routine"; past: boolean; placed: boolean };

type AiStatus = { ready: boolean; mode: string; reason?: string };
type Props = {
  step: WelcomeStep;
  firstName: string | null;
  naviVars: React.CSSProperties;
  zone: string;
  basics?: { name: string; timezone: string; wake: string; bed: string };
  notify?: { wake: string; bed: string | null; evening: string; pushConfigured: boolean };
  talk?: { messages: Message[]; actions: Record<string, ActionView>; undone: string[]; proposals: Proposal[]; ai: AiStatus; voice: { ready: boolean; reason?: string } };
  plan?: { headline: Line; rows: PlanRow[] };
};

const DOT_STEPS: WelcomeStep[] = ["hello", "basics", "talk", "review", "notify"];
const primary = "flex h-[54px] items-center justify-center rounded-[27px] bg-text px-10 text-[16px] font-semibold text-black disabled:opacity-50";
const secondary = "flex h-[54px] items-center justify-center rounded-[27px] bg-white/[0.07] px-6 text-[16px] font-medium text-text hover:bg-white/[0.1] disabled:opacity-50";

/** "07:00" → "7:00 AM" */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function Welcome(props: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, then?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "That didn't go through. Try again.");
      if (then) then();
      else router.refresh();
    });
  const later = () => run(() => skipWelcomeAction(props.step), () => router.push("/"));
  const stepIndex = props.step === "plan" ? DOT_STEPS.length : DOT_STEPS.indexOf(props.step);

  return (
    <div className="relative flex min-h-dvh flex-col bg-black" style={props.naviVars}>
      <header className="flex h-20 shrink-0 items-center px-6 md:px-10">
        <div className="flex flex-1 items-center gap-2.5">
          <Stone size={18} />
          <span className="text-[16px] font-bold">Navi</span>
        </div>
        <ol className="flex gap-1.5" aria-label={`Step ${Math.min(stepIndex + 1, DOT_STEPS.length)} of ${DOT_STEPS.length}`}>
          {DOT_STEPS.map((s, i) => (
            <li key={s} className={`h-[3px] w-7 rounded-full ${i <= stepIndex ? "bg-text" : "bg-white/15"}`} aria-hidden="true" />
          ))}
        </ol>
        <div className="flex flex-1 justify-end">
          {props.step !== "plan" && props.step !== "notify" && (
            <button type="button" onClick={later} disabled={pending} className="text-[14px] text-dim hover:text-text">Do this later</button>
          )}
        </div>
      </header>
      {error && <p role="alert" className="mx-auto mb-2 max-w-[560px] rounded-[14px] border border-[rgba(255,143,138,0.4)] bg-[rgba(255,143,138,0.08)] px-4 py-2.5 text-[14px]">{error}</p>}
      <main className="flex flex-1 flex-col">
        {props.step === "hello" && <Hello firstName={props.firstName} pending={pending} onNext={() => run(() => saveWelcomeStepAction("basics"))} />}
        {props.step === "basics" && props.basics && <Basics initial={props.basics} pending={pending} onSave={(b) => run(() => saveBasicsAction(b))} />}
        {props.step === "talk" && props.talk && <Talk {...props.talk} firstName={props.firstName} zone={props.zone} pending={pending} onEnough={() => run(() => finishTalkAction())} />}
        {props.step === "review" && props.talk && (
          <Review
            proposals={props.talk.proposals}
            zone={props.zone}
            pending={pending}
            onKeepTalking={() => run(async () => { const r = await restartOnboardingAction(); if (!r.ok) return r; return saveWelcomeStepAction("talk"); })}
            onActivate={(ids) =>
              run(async () => {
                const r = await completeOnboardingAction(ids);
                if (r.ok) announceChange();
                return r;
              })
            }
          />
        )}
        {props.step === "notify" && props.notify && <Notify {...props.notify} pending={pending} onDone={() => run(() => saveWelcomeStepAction("plan"))} />}
        {props.step === "plan" && props.plan && <FirstPlan {...props.plan} firstName={props.firstName} pending={pending} onHome={() => run(() => saveWelcomeStepAction("done"), () => router.push("/"))} />}
      </main>
    </div>
  );
}

function Glow() {
  return <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[20%] -z-0 h-[700px] w-[1000px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--navi-text)_9%,transparent)_0%,transparent_65%)]" />;
}

function Hello({ firstName, pending, onNext }: { firstName: string | null; pending: boolean; onNext: () => void }) {
  return (
    <section className="relative flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
      <Glow />
      <Stone size={150} lit className="relative motion-safe:animate-[fadein_0.9s_ease-out]" />
      <div aria-hidden="true" className="relative mt-4 h-3 w-[110px] rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--navi-mid)_25%,transparent)_0%,transparent_70%)]" />
      <h1 className="relative mt-12 text-[40px] font-bold tracking-[-0.03em]">Hi{firstName ? `, ${firstName}` : ""}. I&apos;m Navi.</h1>
      <p className="relative mt-4 max-w-[500px] text-[18px] leading-relaxed text-muted">
        I help you plan your days and keep track of what matters. Let&apos;s set things up together. It takes about five minutes.
      </p>
      <button type="button" className={`${primary} relative mt-10`} onClick={onNext} disabled={pending} autoFocus>
        Let&apos;s go
      </button>
    </section>
  );
}

function Stepper({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  const [h, m] = value.split(":").map(Number);
  const total = h * 60 + m;
  const shift = (d: number) => {
    const t = (total + d + 1440) % 1440;
    onChange(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  };
  const [time, mer] = clock(value).split(" ");
  return (
    <div className="flex flex-1 flex-col gap-2">
      <span id={id} className="text-[14px] text-muted">{label}</span>
      <div role="group" aria-labelledby={id} className="flex h-[76px] items-center justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.05] px-3">
        <button type="button" aria-label={`${label}: 30 minutes earlier`} onClick={() => shift(-30)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-[20px]">−</button>
        <output aria-live="polite" className="text-[30px] font-semibold tabular-nums">{time} <span className="text-[15px] font-medium text-dim">{mer}</span></output>
        <button type="button" aria-label={`${label}: 30 minutes later`} onClick={() => shift(30)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-[20px]">+</button>
      </div>
    </div>
  );
}

function Basics({ initial, pending, onSave }: { initial: NonNullable<Props["basics"]>; pending: boolean; onSave: (b: { display_name: string; timezone: string; wake: string; bed: string }) => void }) {
  const [name, setName] = useState(initial.name);
  const [zone, setZone] = useState(initial.timezone);
  const [changing, setChanging] = useState(false);
  const [wake, setWake] = useState(initial.wake);
  const [bed, setBed] = useState(initial.bed);
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    // Detected from this browser; the person confirms it (shown, never silent).
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial.timezone === "UTC" && detected) setZone(detected);
    try {
      setZones((Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"));
    } catch {}
  }, [initial.timezone]);
  const city = zone.split("/").pop()!.replace(/_/g, " ");
  // The clock is only shown once in the browser (server and browser minutes can differ).
  const [localNow, setLocalNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setLocalNow(DateTime.now().setZone(zone).toFormat("h:mm a"));
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [zone]);
  return (
    <section className="mx-auto flex w-full max-w-[520px] flex-col px-6 pb-16 pt-8">
      <h1 className="text-center text-[40px] font-bold tracking-[-0.03em]">A few basics</h1>
      <p className="mt-2 text-center text-[17px] text-muted">So I get your days right from the start.</p>
      <form
        className="mt-10 flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ display_name: name.trim(), timezone: zone, wake, bed });
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="b-name" className="text-[14px] text-muted">What should I call you?</label>
          <input id="b-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" className="h-14 rounded-[18px] border border-white/[0.1] bg-white/[0.05] px-5 text-[17px] outline-none focus:border-[color-mix(in_srgb,var(--navi-text)_60%,transparent)]" />
          {initial.name && <span className="text-[13px] text-dim">From your account. Change it if you like.</span>}
        </div>
        <div className="flex flex-col gap-2">
          <span id="b-zone" className="text-[14px] text-muted">Your time zone</span>
          {changing && zones.length ? (
            <select aria-labelledby="b-zone" value={zone} onChange={(e) => { setZone(e.target.value); setChanging(false); }} className="h-14 rounded-[18px] border border-white/[0.1] bg-[#111113] px-4 text-[16px]">
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          ) : (
            <div className="flex h-14 items-center gap-3 rounded-[18px] border border-white/[0.1] bg-white/[0.05] pl-5 pr-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--navi-text)_25%,transparent)] text-[11px] text-[var(--navi-text)]" aria-hidden="true">✓</span>
              <span className="flex-1 text-[16px]">{city} {localNow && <span className="text-dim">· it&apos;s {localNow}</span>}</span>
              <button type="button" onClick={() => setChanging(true)} className="h-10 rounded-[20px] bg-white/[0.08] px-4 text-[15px]">Change</button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Stepper id="b-wake" label="Usually up at" value={wake} onChange={setWake} />
          <Stepper id="b-bed" label="Usually in bed by" value={bed} onChange={setBed} />
        </div>
        <p className="-mt-2 text-[13px] text-dim">I only plan between these times, and won&apos;t message you outside them.</p>
        <button type="submit" className={`${primary} self-center`} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </section>
  );
}

const TOPICS = [
  { key: "week", label: "Your week", kinds: ["workspace"] },
  { key: "fixed", label: "Fixed things", kinds: ["event", "routine"] },
  { key: "toward", label: "What you're working toward", kinds: ["goal", "project"] },
  { key: "mind", label: "What's on your mind", kinds: ["task", "reminder", "memory", "note", "question"] },
];

function Talk({
  messages,
  actions,
  undone,
  proposals,
  ai,
  voice,
  firstName,
  zone,
  pending,
  onEnough,
}: NonNullable<Props["talk"]> & { firstName: string | null; zone: string; pending: boolean; onEnough: () => void }) {
  const router = useRouter();
  const kinds = new Set(proposals.map((p) => p.kind));
  const done = TOPICS.map((t) => t.kinds.some((k) => kinds.has(k as Proposal["kind"])));
  const current = done.indexOf(false);
  // "just added": items whose kind+title weren't in the list before this refresh.
  const keyOf = (p: Proposal) => `${p.kind}:${titleOf(p).toLowerCase()}`;
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [lastProposals, setLastProposals] = useState(proposals);
  if (lastProposals !== proposals) {
    const before = new Set(lastProposals.map(keyOf));
    setLastProposals(proposals);
    setFresh(new Set(proposals.map(keyOf).filter((k) => !before.has(k))));
  }

  const group = (ks: string[]) => proposals.filter((p) => ks.includes(p.kind));
  const spaces = group(["workspace"]);
  const sections: [string, Proposal[]][] = [
    ["Fixed things and routines", group(["event", "routine"])],
    ["Goals and projects", group(["goal", "project"])],
    ["Tasks", group(["task", "reminder"])],
    ["Things Navi will remember", group(["memory", "note", "question"])],
  ];
  const intro = `Tell me about a normal week${firstName ? `, ${firstName}` : ""}. What's fixed — classes, shifts, plans with people?`;

  return (
    <section className="mx-auto flex w-full max-w-[1360px] flex-1 gap-10 px-6 pb-8 md:h-[calc(100dvh-5rem)] md:px-10">
      <div className="flex min-h-[70dvh] min-w-0 flex-1 flex-col">
        <ul className="mb-4 flex flex-wrap justify-center gap-2" aria-label="Topics">
          {TOPICS.map((t, i) => (
            <li key={t.key} className={`flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] ${done[i] ? "bg-[color-mix(in_srgb,var(--navi-text)_10%,transparent)] text-[var(--navi-text)]" : i === current ? "bg-white/[0.1] font-medium text-text" : "bg-white/[0.04] text-dim"}`}>
              {done[i] && <span aria-hidden="true">✓</span>}
              {t.label}
              {done[i] && <span className="sr-only"> (covered)</span>}
            </li>
          ))}
        </ul>
        <div className="mx-auto flex min-h-0 w-full max-w-[680px] flex-1 flex-col">
          {!ai.ready && (
            <p className="mb-3 rounded-[14px] border border-[rgba(242,196,107,0.35)] bg-[rgba(242,196,107,0.07)] p-3.5 text-[14px]" role="status">
              Navi&apos;s AI isn&apos;t available right now, so it can&apos;t talk this through. You can still write it all down: send it, and it&apos;s saved and set up once the AI is back. Or choose “Do this later”.
            </p>
          )}
          <Chat
            kind="onboarding"
            variant="panel"
            initialMessages={messages}
            initialActions={actions}
            initialUndone={undone}
            ai={ai}
            voice={voice}
            placeholder="Reply, or talk…"
            onReply={() => router.refresh()}
            emptyState={
              <div className="m-auto flex max-w-[560px] flex-col items-center gap-5 py-8 text-center">
                <Stone size={70} lit />
                <p className="text-[22px] font-semibold leading-snug tracking-[-0.01em]">{intro}</p>
                <p className="text-[15px] text-muted">Talk or type, as messy as you like. Nothing is set up until you review it.</p>
              </div>
            }
          />
        </div>
      </div>

      <aside aria-label="What Navi's picked up" className="hidden w-[400px] shrink-0 flex-col rounded-[28px] border border-white/[0.08] bg-[#0B0B0C] p-[22px] lg:flex">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">What Navi&apos;s picked up</h2>
          {proposals.length > 0 && <span className="text-[13px] text-dim">{proposals.length} so far</span>}
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
          {proposals.length === 0 ? (
            <div className="flex h-full flex-col">
              <p className="text-[14px] leading-relaxed text-dim">Things you mention show up here as you go, each with the words they came from.</p>
              <p className="m-auto text-[14px] text-dim">Nothing yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {spaces.length > 0 && (
                <div>
                  <h3 className="mb-2 text-[13px] text-dim">Spaces</h3>
                  <div className="flex flex-wrap gap-2">
                    {spaces.map((p) => (
                      <span key={p.id} className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[14px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: String((p.payload as Record<string, unknown>).color ?? "#9DB8FF") }} aria-hidden="true" />
                        {titleOf(p)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sections.map(([label, list]) =>
                list.length ? (
                  <div key={label}>
                    <h3 className="mb-2 text-[13px] text-dim">{label}</h3>
                    <ul className="flex flex-col gap-2">
                      {list.map((p) => {
                        const isNew = fresh.has(keyOf(p));
                        const sum = proposalSummary(p, zone);
                        return (
                          <li key={p.id} className={`rounded-[16px] px-3.5 py-3 ${isNew ? "border border-[color-mix(in_srgb,var(--navi-text)_30%,transparent)] bg-[color-mix(in_srgb,var(--navi-text)_6%,transparent)]" : "border border-transparent bg-white/[0.04]"}`}>
                            <div className="text-[15px] font-semibold">
                              {titleOf(p)}
                              {isNew && <span className="ml-2 text-[12px] font-medium text-[var(--navi-text)]">just added</span>}
                            </div>
                            {sum && <div className="mt-0.5 text-[13.5px] text-muted">{sum}</div>}
                            {p.source_excerpt && <div className="mt-0.5 text-[12.5px] italic text-dim">“{p.source_excerpt}”</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          )}
        </div>
        <button type="button" onClick={onEnough} disabled={pending} className="mt-4 flex h-[50px] items-center justify-center gap-2 rounded-[25px] bg-white/[0.07] text-[15px] font-semibold hover:bg-white/[0.1] disabled:opacity-50">
          That&apos;s enough for now <span aria-hidden="true">→</span>
        </button>
      </aside>
      {/* Narrow screens: no side list, but the way forward is still here. */}
      <div className="fixed inset-x-6 bottom-28 flex justify-center lg:hidden">
        {proposals.length > 0 && (
          <button type="button" onClick={onEnough} disabled={pending} className="h-11 rounded-[22px] bg-white/[0.08] px-5 text-[14px] font-semibold">
            Review {proposals.length} item{proposals.length === 1 ? "" : "s"} →
          </button>
        )}
      </div>
    </section>
  );
}

const REVIEW_GROUPS: [string, Proposal["kind"][]][] = [
  ["Spaces", ["workspace"]],
  ["Fixed things and routines", ["event", "routine"]],
  ["Goals and projects", ["goal", "project"]],
  ["Tasks", ["task", "reminder"]],
  ["Your schedule", ["preference"]],
  ["Things Navi will remember", ["memory", "note", "question"]],
];

function Review({ proposals, zone, pending, onKeepTalking, onActivate }: { proposals: Proposal[]; zone: string; pending: boolean; onKeepTalking: () => void; onActivate: (ids: string[]) => void }) {
  // Things Navi wasn't sure about start unchecked.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.filter((p) => p.origin === "stated" || p.confidence >= 0.5).map((p) => p.id)));
  const [editing, setEditing] = useState<string | null>(null);
  const groups = useMemo(() => REVIEW_GROUPS.map(([label, kinds]) => [label, proposals.filter((p) => kinds.includes(p.kind))] as const).filter(([, l]) => l.length), [proposals]);
  const toggle = (id: string, v: boolean) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  return (
    <section className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col px-6 pb-36 pt-2">
      <h1 className="text-[34px] font-bold tracking-[-0.03em]">Here&apos;s what I&apos;d set up</h1>
      <p className="mt-2 text-[16px] text-muted">Nothing is real until you turn it on. Things I wasn&apos;t sure about start unchecked. Click any item to change it.</p>
      {proposals.length === 0 && <p className="mt-10 text-[16px] text-dim">Nothing to review yet. Keep talking, or choose “Do this later”.</p>}
      <div className="mt-6 columns-1 gap-4 md:columns-2">
        {groups.map(([label, list]) => (
          <section key={label} aria-label={label} className="mb-4 break-inside-avoid rounded-[22px] border border-white/[0.07] bg-white/[0.04] p-5">
            <h2 className="mb-3 text-[13.5px] text-dim">{label}</h2>
            <ul className="flex flex-col gap-1">
              {list.map((p) => {
                const on = selected.has(p.id);
                const sum = proposalSummary(p, zone);
                const unsure = p.origin === "inferred" && p.confidence < 0.5;
                return (
                  <li key={p.id} className="flex flex-col">
                    <div className="flex items-start gap-3 rounded-[12px] py-1.5">
                      <input type="checkbox" checked={on} onChange={(e) => toggle(p.id, e.target.checked)} aria-label={`Turn on “${titleOf(p)}”`} className="mt-1 h-[18px] w-[18px] shrink-0 accent-[var(--navi-text)]" />
                      <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id}>
                        <span className={`text-[15px] font-semibold ${on ? "text-text" : "text-[#8E8E96]"}`}>{titleOf(p)}</span>
                        <span className="text-[13.5px] text-dim">{unsure && p.source_excerpt ? `You said “${p.source_excerpt}”` : sum || (p.source_excerpt ? `From “${p.source_excerpt}”` : "")}</span>
                      </button>
                    </div>
                    {editing === p.id && (
                      <div className="mb-2 mt-1">
                        <ProposalCard proposal={p} zone={zone} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div className="fixed inset-x-4 bottom-6 z-20 mx-auto flex max-w-[1080px] flex-wrap items-center gap-3 rounded-[32px] border border-white/[0.08] bg-[#1C1C1F] py-2 pl-6 pr-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        <span className="flex-1 text-[14px] text-muted">Unchecked items wait in your Inbox. Nothing is lost.</span>
        <button type="button" className="h-12 rounded-[24px] bg-white/[0.07] px-5 text-[15px] font-medium" onClick={onKeepTalking} disabled={pending}>Keep talking</button>
        <button type="button" className="h-12 rounded-[24px] bg-[var(--navi-text)] px-6 text-[15px] font-semibold text-[var(--navi-ink)] disabled:opacity-50" onClick={() => onActivate([...selected])} disabled={pending || selected.size === 0}>
          {pending ? "Turning on…" : `Turn on ${selected.size} and plan my week`}
        </button>
      </div>
    </section>
  );
}

function Notify({ wake, bed, evening, pushConfigured, pending, onDone }: NonNullable<Props["notify"]> & { pending: boolean; onDone: () => void }) {
  const [state, setState] = useState<PushSupport | "checking">("checking");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushSupport().then(setState).catch(() => setState("unsupported"));
  }, []);
  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next === "on") onDone();
      else setMsg(next === "denied" ? "Notifications are blocked for this site. You can allow them in your browser's site settings, then turn them on in Settings." : "Notifications weren't turned on.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  };
  const rows = [
    { icon: "☀", title: "Morning briefing", sub: "When you wake up: today's plan and anything due", time: clock(wake) },
    { icon: "☾", title: "Evening wrap-up", sub: "What got done, and a look at tomorrow", time: clock(evening) },
    ...(bed ? [{ icon: "◌", title: "Quiet hours", sub: "From your bedtime to when you wake up", time: `${clock(bed)} – ${clock(wake)}` }] : []),
  ];
  const canPush = pushConfigured && (state === "off" || state === "on");
  return (
    <section className="mx-auto flex w-full max-w-[600px] flex-col items-center px-6 pb-16 pt-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--navi-text)_10%,transparent)] text-[var(--navi-text)]" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
      </span>
      <h1 className="mt-7 text-[36px] font-bold tracking-[-0.03em]">Can I check in with you?</h1>
      <p className="mt-2 text-[17px] text-muted">A short note to start the day and one to wrap it up. Nothing else unless you ask.</p>
      <ul className="mt-8 flex w-full flex-col gap-3 text-left">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-4 rounded-[20px] border border-white/[0.08] bg-white/[0.04] px-5 py-4">
            <span className="w-5 text-center text-[16px] text-[var(--navi-text)]" aria-hidden="true">{r.icon}</span>
            <span className="flex flex-1 flex-col">
              <span className="text-[15px] font-semibold">{r.title}</span>
              <span className="text-[13.5px] text-dim">{r.sub}</span>
            </span>
            <span className="rounded-[18px] bg-white/[0.07] px-4 py-2 text-[14px] font-semibold tabular-nums">{r.time}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 self-start text-[13px] text-dim">Change these any time in Settings.</p>
      <div className="mt-4 w-full rounded-[20px] border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-left text-[14px] leading-relaxed text-muted">
        <div className="font-semibold text-[var(--navi-text)]">Navi never</div>
        <div>messages anyone for you without asking first</div>
        <div>shares or sells your data</div>
        <div>keeps voice recordings. Only the text of what you said is saved.</div>
      </div>
      {msg && <p role="status" className="mt-4 text-[14px] text-muted">{msg}</p>}
      {!pushConfigured && <p className="mt-4 text-[14px] text-dim">Notifications aren&apos;t set up on this server yet. Your briefings still appear on Home.</p>}
      {state === "needs-install" && <p className="mt-4 text-[14px] text-dim">On iPhone, add Navi to your Home Screen first (Share → Add to Home Screen), then turn notifications on in Settings.</p>}
      {state === "denied" && <p className="mt-4 text-[14px] text-dim">Notifications are blocked for Navi in this browser. Allow them in the site settings, then turn them on in Settings.</p>}
      {state === "unsupported" && <p className="mt-4 text-[14px] text-dim">This browser can&apos;t show notifications. Your briefings still appear on Home.</p>}
      <div className="mt-8 flex gap-3">
        {canPush && state !== "on" && (
          <button type="button" className={primary} onClick={() => void turnOn()} disabled={busy || pending}>
            {busy ? "Asking…" : "Turn on notifications"}
          </button>
        )}
        <button type="button" className={canPush && state !== "on" ? secondary : primary} onClick={onDone} disabled={busy || pending}>
          {canPush && state !== "on" ? "Not now" : "Continue"}
        </button>
      </div>
    </section>
  );
}

function FirstPlan({ headline, rows, firstName, pending, onHome }: NonNullable<Props["plan"]> & { firstName: string | null; pending: boolean; onHome: () => void }) {
  const placed = rows.filter((r) => r.kind === "item" && r.placed).length;
  return (
    <section className="relative mx-auto flex w-full max-w-[760px] flex-col items-center px-6 pb-16 pt-2">
      <Glow />
      <div className="relative flex items-center gap-5">
        <Stone size={62} lit />
        <h1 className="text-[34px] font-bold tracking-[-0.03em]">You&apos;re set{firstName ? `, ${firstName}` : ""}. Here&apos;s today.</h1>
      </div>
      <p className="relative mt-3 text-center text-[18px]">
        {headline.map((s, i) => <span key={i} className={s.strong ? "text-text" : "text-muted"}>{s.text}</span>)}
      </p>
      <ol className="relative mt-8 flex w-full max-w-[560px] flex-col gap-2.5">
        {rows.map((r, i) =>
          r.kind === "now" ? (
            <li key={`now${i}`} className="flex items-center gap-4">
              <span className="w-14 text-right text-[13.5px] font-semibold tabular-nums">{r.time}</span>
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20"><span className="h-2 w-2 rounded-full bg-text" /></span>
              <span className="text-[14px] text-muted">{r.label}</span>
            </li>
          ) : (
            <li key={`${r.title}${i}`} className="flex items-center gap-4" style={{ opacity: r.past ? 0.45 : 1 }}>
              <span className="w-14 text-right text-[13.5px] text-dim tabular-nums">{r.time}</span>
              <span className="h-4 w-4 shrink-0 rounded-full" style={r.style === "fixed" ? { background: r.color } : { border: `1.5px ${r.style === "routine" ? "dashed" : "solid"} ${r.color}` }} aria-hidden="true" />
              <span className={`flex flex-1 flex-col rounded-[16px] px-4 py-2.5 ${r.placed ? "border border-[color-mix(in_srgb,var(--navi-text)_25%,transparent)] bg-[color-mix(in_srgb,var(--navi-text)_7%,transparent)]" : "bg-white/[0.04]"}`}>
                <span className="text-[15px] font-semibold">{r.title}</span>
                <span className="text-[13px] text-dim">{r.sub}</span>
              </span>
            </li>
          ),
        )}
        {rows.length === 0 && <li className="text-center text-[15px] text-dim">Nothing on today yet. Your week is ready when things come up.</li>}
      </ol>
      {placed > 0 && <p className="relative mt-6 text-center text-[14px] text-dim">Navi placed {placed === 1 ? "one thing" : `${placed} things`} in your free time. Move {placed === 1 ? "it" : "them"} anytime, or ask Navi to.</p>}
      <button type="button" className={`${primary} relative mt-8`} onClick={onHome} disabled={pending}>Go to Home</button>
    </section>
  );
}

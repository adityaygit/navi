import type { ReactNode } from "react";

// Building blocks for the iOS-settings-like pages (Settings, More, Memory,
// Activity): a titled section, a hairline-divided group, and rows inside it.
// No hooks, so server and client components can both use them.

export const GROUP = "surf divide-hair";

export function SectionHead({ id, title, desc, tone, aside }: { id: string; title: ReactNode; desc?: ReactNode; tone?: "danger"; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className={`text-[19px] font-semibold tracking-[-0.02em] ${tone === "danger" ? "text-clash" : "gh"}`}>{title}</h2>
        {desc && <p className="muted max-w-prose text-sm">{desc}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A label (and optional hint) on the left, the control on the right; stacked on phones. */
export function Row({ label, htmlFor, hint, children, wide = false }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children?: ReactNode; wide?: boolean }) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div className={`grid gap-2 px-4 py-3.5 sm:items-center sm:gap-6 sm:px-5 ${wide ? "" : "sm:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"}`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label {...(htmlFor ? { htmlFor } : {})} className="text-[15px] font-medium text-text">{label}</Label>
        {hint && <span className="muted text-[13px] leading-snug">{hint}</span>}
      </div>
      {children !== undefined && <div className="min-w-0">{children}</div>}
    </div>
  );
}

/** An on/off switch backed by a real checkbox (role="switch"). */
export function Switch({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (on: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4 px-4 py-3 sm:px-5">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[15px] font-medium text-text">{label}</span>
        {hint && <span className="muted text-[13px] leading-snug">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden className="h-[30px] w-[50px] rounded-full border border-white/25 bg-white/10 transition-colors peer-checked:border-transparent peer-checked:bg-[#f2f2f2] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-flex peer-disabled:opacity-50 motion-reduce:transition-none" />
        <span aria-hidden className="pointer-events-none absolute left-[4px] top-[4px] h-[22px] w-[22px] rounded-full bg-[#d6d7da] shadow transition-transform peer-checked:translate-x-5 peer-checked:bg-[#060608] motion-reduce:transition-none" />
      </span>
    </label>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

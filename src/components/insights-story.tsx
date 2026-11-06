"use client";
import { useEffect, useRef, useState } from "react";
import { Pebble } from "@/components/pebble";
import { PlannedDoneChart } from "./insights-chart";
import type { DayBar } from "./insights-week";

export type StorySlide =
  | { kind: "score"; title: string; body: string; big: string }
  | { kind: "text"; title: string; body: string }
  | { kind: "noticed"; title: string; body: string }
  | { kind: "chart"; title: string; body: string; bars: DayBar[] };

/**
 * The weekly report, one insight per screen with a segmented progress bar.
 * Every slide is built on the server from recorded data; this only shows them.
 * A native modal dialog: focus moves in and back, Escape closes, arrow keys step.
 */
export function InsightsStory({ slides, rangeLabel, autoOpen = false }: { slides: StorySlide[]; rangeLabel: string; autoOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(autoOpen);
  const last = slides.length - 1;
  const slide = slides[Math.min(i, last)];

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!slides.length) return null;
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)));

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => { setI(0); setOpen(true); }}>
        Play the weekly report
      </button>
      <dialog
        ref={ref}
        aria-labelledby="story-title"
        onClose={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(i + 1);
          if (e.key === "ArrowLeft") go(i - 1);
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-text backdrop:bg-black/80 md:m-auto md:h-[min(820px,92dvh)] md:max-w-[440px] md:rounded-[22px]"
      >
        {open && (
          <div className="relative flex h-full flex-col gap-4 overflow-y-auto bg-[#060608] px-5 pb-6 pt-[calc(env(safe-area-inset-top)+20px)] md:border md:pt-4 md:border-border md:rounded-[22px]">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(100%_100%_at_50%_0%,color-mix(in_srgb,var(--navi-mid)_22%,transparent),transparent_70%)]" />
            <div className="relative flex items-center gap-3.5">
              <button type="button" className="btn h-11 w-11 shrink-0 px-0" aria-label="Close report" onClick={() => setOpen(false)}>
                <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
              <div className="flex flex-1 gap-1.5" role="progressbar" aria-label="Weekly report" aria-valuemin={1} aria-valuemax={slides.length} aria-valuenow={i + 1} aria-valuetext={`Screen ${i + 1} of ${slides.length}`}>
                {slides.map((_, n) => (
                  <span key={n} className={`h-1 flex-1 rounded-full ${n <= i ? "bg-text" : "bg-white/20"}`} />
                ))}
              </div>
            </div>

            <p className="relative mt-6 text-center text-xs uppercase tracking-[0.1em] text-navi-text">{rangeLabel}</p>
            <div className="relative flex flex-1 flex-col items-center justify-center gap-5 text-center" aria-live="polite">
              {slide.kind === "score" && <span className="gh num display text-[120px] leading-none" aria-hidden>{slide.big}</span>}
              {slide.kind === "noticed" && <Pebble size={72} mood="nudge" />}
              <h2 id="story-title" className={slide.kind === "noticed" ? "eyebrow" : "text-[26px] leading-tight tracking-[-0.01em]"}>{slide.title}</h2>
              {slide.kind === "chart" && <div className="w-full text-left"><PlannedDoneChart bars={slide.bars} compact /></div>}
              {slide.body && <p className={slide.kind === "noticed" ? "text-xl leading-normal" : "text-base leading-relaxed text-[#d8d9dc]"}>{slide.body}</p>}
            </div>

            <div className="relative flex gap-2.5">
              <button type="button" className="btn flex-1" onClick={() => go(i - 1)} disabled={i === 0}>Back</button>
              {i < last ? (
                <button type="button" className="btn btn-primary flex-[2]" onClick={() => go(i + 1)}>Continue</button>
              ) : (
                <button type="button" className="btn btn-primary flex-[2]" onClick={() => setOpen(false)}>Done</button>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

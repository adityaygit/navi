// Beacon presence: one stone, lit by context. Images share framing, so states crossfade in place.
import React, { useEffect, useRef, useState } from 'react';
import { CAPTURE, Wave } from './product.jsx';
import { BeaconMark } from './icons.jsx';

export const STATES = [
  { id: 'rest', img: 'beacon-rest.jpg', label: 'Resting', color: '#cfc9bf', line: 'Quiet hours hold. Nothing is sent, nothing is planned without you.', meta: 'Quiet hours · 22:00–06:00' },
  { id: 'listen', img: 'beacon-listen.jpg', label: 'Listening', color: '#9cc3ff', line: 'Real-time voice. Talk over it at any point and it stops to listen.', meta: 'Voice · live' },
  { id: 'think', img: 'beacon-listen.jpg', label: 'Thinking', color: '#b9d2ff', line: 'Checks your actual plan, inbox and memory before it answers, never just the chat.', meta: 'Reading plan · inbox · memory', think: true },
  { id: 'guide', img: 'beacon-dawn.jpg', label: 'Guiding', color: '#ffc58a', line: 'The 06:00 briefing: what is fixed today, what is at risk, what did not fit.', meta: 'Morning briefing · 06:00' },
  { id: 'confirm', img: 'beacon-confirm.jpg', label: 'Confirming', color: '#8fe0b4', line: 'Every change it makes lands in Activity, with Undo next to it.', meta: 'Activity · 2 changes · Undo' },
  { id: 'evening', img: 'beacon-evening.jpg', label: 'Reviewing', color: '#c2a8ff', line: 'The 21:00 review compares the plan with what happened, then proposes tomorrow.', meta: 'Evening review · 21:00' },
];

export function Presence() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(!CAPTURE);
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(ref.current); return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || !visible || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setI((v) => (v + 1) % STATES.length), 3600);
    return () => clearTimeout(t);
  }, [i, auto, visible]);
  useEffect(() => { (window.__navi = window.__navi || {}).presence = setI; }, []);
  const s = STATES[i];
  const imgs = [...new Set(STATES.map((x) => x.img))];
  return (
    <div className="presence" ref={ref} style={{ '--state': s.color }}>
      <div className={`stone${s.think ? ' thinking' : ''}`} aria-hidden="true">
        {imgs.map((im) => <img key={im} src={`./img/${im}`} alt="" className={im === s.img ? 'on' : ''} />)}
        <div className="stone-pool" />
        <div className="stone-seam" />
      </div>
      <div className="presence-side">
        <div className="presence-now mono"><BeaconMark size={16} glow={s.color} /><span>{s.meta}</span>{(s.id === 'listen' || s.id === 'think') && <Wave bars={18} />}</div>
        <ol className="states" role="tablist" aria-label="Beacon states">
          {STATES.map((x, k) => (
            <li key={x.id}>
              <button role="tab" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => { setI(k); setAuto(false); }}>
                <span className="st-dot" style={{ background: x.color }} />
                <span className="st-label">{x.label}</span>
                <span className="st-line">{x.line}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

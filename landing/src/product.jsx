// Navi product UI, built as real components (no screenshots).
import React, { useEffect, useRef, useState } from 'react';
import * as I from './icons.jsx';

export const CAPTURE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture');

/** Runs `fn` once when the element first enters the viewport (skipped in capture mode). */
export function useInView(fn, opts = { threshold: 0.45 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (CAPTURE || !ref.current || !('IntersectionObserver' in window)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { fn(); io.disconnect(); } }, opts);
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return ref;
}

const Dot = ({ c }) => <span className="dot" style={{ background: c }} />;
const STATUS = { focus: '#3ad389', fixed: '#f0f0f0', flex: '#70b8ff', recovery: '#ffca16', risk: '#ff9592', memory: '#baa7ff' };

/* ---------------- Hero: conversation + day plan in one window ---------------- */
// Hours 09–17. Before approval the moved client call clashes with the admin batch; after it, admin
// leaves for Thursday and a short review with Sam appears.
const H_START = 9, H_COUNT = 8, H_PX = 56;
const BASE = [
  { id: 'dentist', t: 9.5, d: 0.75, title: 'Dentist', kind: 'fixed', time: '09:30' },
  { id: 'deck', t: 11, d: 1.5, title: 'Finish the Q4 deck', kind: 'focus', time: '11:00' },
  { id: 'lunch', t: 13, d: 1, title: 'Lunch with Ana', kind: 'fixed', time: '13:00' },
  { id: 'walk', t: 16.75, d: 0.5, title: 'Short walk', kind: 'rec', time: '16:45' },
];
const BEFORE = [
  { id: 'client', t: 15, d: 1, title: 'Client call', kind: 'fixed clash', time: '15:00', side: 'l' },
  { id: 'admin', t: 15, d: 1, title: 'Admin batch', kind: 'flex clash', time: '15:00', side: 'r' },
];
const AFTER = [
  { id: 'client', t: 15, d: 1, title: 'Client call', kind: 'fixed', time: '15:00' },
  { id: 'review', t: 16.1, d: 0.5, title: 'Deck review with Sam', kind: 'flex new', time: '16:05' },
];

export function HeroApp() {
  const [applied, setApplied] = useState(false);
  const [pressing, setPressing] = useState(false);
  const ref = useInView(() => {
    setTimeout(() => setPressing(true), 1900);
    setTimeout(() => { setPressing(false); setApplied(true); }, 2300);
  });
  const items = BASE.concat(applied ? AFTER : BEFORE);
  return (
    <div className="hb-win" ref={ref}>
      <div className="hb-bar">
        <span className="hb-ws">Personal</span>
        <span className="small hb-date">Tuesday 4 November</span>
        <span className="small hb-clock">09:41</span>
      </div>
      <div className="hb-body">
        <section className="hb-day">
          <div className="hb-head">
            <div>
              <div className="hb-title">Today</div>
              <div className="small hb-summary">6h 20m planned · 2h 10m free · 3 fixed</div>
            </div>
            <div className="small hb-legend">
              <span><i className="k-fixed-dot" />Fixed</span><span><i className="k-flex-dot" />Flexible</span><span><i className="k-focus-dot" />Focus</span><span><i className="k-rec-dot" />Recovery</span>
            </div>
          </div>
          <div className="hb-tl" style={{ height: H_COUNT * H_PX }}>
            {Array.from({ length: H_COUNT + 1 }, (_, k) => (
              <div className="hb-hr" key={k} style={{ top: k * H_PX }}><span className="small">{String(H_START + k).padStart(2, '0')}:00</span></div>
            ))}
            <div className="hb-now" style={{ top: (9.68 - H_START) * H_PX }} />
            {items.map((p) => (
              <div key={p.id} className={`hb-blk ${p.kind}${p.side ? ` side-${p.side}` : ''}`} style={{ top: (p.t - H_START) * H_PX + 2, height: p.d * H_PX - 4 }}>
                <span className="t">{p.title}</span><span className="m small">{p.time}</span>
              </div>
            ))}
          </div>
        </section>
        <aside className="hb-chat">
          <div className="hb-me"><span className="small hb-voice">Voice · 0:07</span>My two o’clock moved to three, and I still have to get the deck to Sam today.</div>
          <div className="hb-navi">The client call now sits at 15:00, so the admin batch can wait until Thursday morning. I kept your focus block for the deck and added a short review with Sam.</div>
          <div className={`hb-change${applied ? ' done' : ''}`}>
            <div className="small hb-change-h"><span>{applied ? 'Applied' : 'Proposed change'}</span><span className={applied ? 'ok' : ''}>{applied ? '2 of 2' : 'Needs your OK'}</span></div>
            <div className="hb-row"><span>Admin batch</span><span className="small"><s>15:00</s> <span className="to">Thu 09:00</span></span></div>
            <div className="hb-row"><span>Deck review with Sam</span><span className="small to">New · 16:05</span></div>
            <div className="hb-actions">
              {applied
                ? <span className="hb-btn ok"><I.Check size={12} /> Approved</span>
                : <><button className={`hb-btn w${pressing ? ' press' : ''}`} onClick={() => setApplied(true)}>Approve</button><button className="hb-btn">Edit</button></>}
            </div>
          </div>
          <div className="hb-ask"><span>Ask Navi, or hold to talk</span><span className="hb-mic"><I.Mic size={15} /></span></div>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Set-up: transcript → proposal ---------------- */
export function SetupTranscript() {
  const lines = [
    ['00:04', 'I work at a design studio, Monday to Thursday. Fridays are mine.'],
    ['00:11', 'I want the gym three mornings a week, before work if I can.'],
    ['00:19', 'My portfolio site has to be live by the end of March.'],
    ['00:26', 'And I keep forgetting to call my mum on Sundays.'],
  ];
  return (
    <div className="transcript">
      <div className="tr-head">
        <span className="live"><span className="pulse" />Listening</span>
        <Wave bars={28} />
        <span className="mono muted">00:31</span>
      </div>
      <ol className="tr-lines">
        {lines.map(([t, s]) => <li key={t}><span className="mono muted">{t}</span><p>{s}</p></li>)}
      </ol>
    </div>
  );
}

export function Wave({ bars = 24, live = true }) {
  return (
    <span className={`wave${live ? ' live' : ''}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, k) => <i key={k} style={{ height: 4 + Math.round(Math.abs(Math.sin(k * 1.7) * 14 + Math.sin(k * 0.6) * 6)), animationDelay: `${(k % 7) * 0.11}s` }} />)}
    </span>
  );
}

const PROPOSAL = [
  ['Workspaces', [['Studio', 'Mon–Thu, 09:30–18:00'], ['Personal', 'Fridays and weekends']]],
  ['Routine', [['Gym', 'Mon · Wed · Fri, 07:30 · flexible']]],
  ['Goal', [['Portfolio site live', 'By 31 March · 3 milestones']]],
  ['Commitment', [['Call Mum', 'Sundays, 18:00 · fixed · reminder at 17:30']]],
  ['First plan', [['This week', '4 focus blocks, 3 gym sessions, 1 call']]],
];
export function SetupProposal() {
  const [on, setOn] = useState(() => PROPOSAL.flatMap(([, r]) => r.map(() => true)));
  let idx = -1;
  const count = on.filter(Boolean).length;
  return (
    <div className="card proposal-card">
      <div className="pc-head">
        <div><div className="pc-title">Here is what I’ll set up</div><div className="mono muted">From a 31-second conversation</div></div>
        <span className="chip-status mono"><Dot c={STATUS.recovery} />Draft</span>
      </div>
      {PROPOSAL.map(([group, rows]) => (
        <div className="pc-group" key={group}>
          <div className="pc-label mono">{group}</div>
          {rows.map(([name, detail]) => {
            const k = ++idx;
            return (
              <label className="pc-row" key={name}>
                <input type="checkbox" id={`pc-${k}`} checked={on[k]} onChange={() => setOn((v) => v.map((x, j) => (j === k ? !x : x)))} />
                <span className="box" aria-hidden="true"><I.Check size={11} /></span>
                <span className="pc-name">{name}</span>
                <span className="pc-detail">{detail}</span>
                <span className="pc-edit" aria-hidden="true"><I.Pencil size={13} /></span>
              </label>
            );
          })}
        </div>
      ))}
      <div className="pc-foot">
        <span className="mono muted">Nothing is created until you approve it.</span>
        <button className="btn-pill">Activate {count} items</button>
      </div>
    </div>
  );
}

/* ---------------- Planner: fixed vs flexible week ---------------- */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const H0 = 7, HP = 32;
const WEEK = [
  [0, 9.5, 1, 'Studio stand-up', 'fixed'], [0, 11, 2.5, 'Brand system', 'focus'], [0, 7.5, 1, 'Gym', 'recovery'],
  [1, 9.5, 0.75, 'Dentist', 'fixed'], [1, 11, 1.5, 'Q4 deck', 'focus'], [1, 13, 1, 'Lunch, Ana', 'fixed'], [1, 15, 1, 'Client call', 'fixed'],
  [2, 7.5, 1, 'Gym', 'recovery'], [2, 10, 3, 'Portfolio: case study', 'focus'], [2, 15, 1.5, 'Studio review', 'fixed'],
  [3, 9, 1, 'Admin batch', 'flex'], [3, 14, 1, 'Crit', 'fixed'],
  [4, 7.5, 1, 'Gym', 'recovery'], [4, 10, 3, 'Portfolio: site build', 'focus', 'move'], [4, 15, 2, 'Errands', 'flex'],
  [5, 10, 2.5, 'Hike', 'recovery'], [6, 11, 1, 'Weekly review', 'flex'], [6, 18, 0.75, 'Call Mum', 'fixed'],
];
export function WeekPlanner() {
  const [landed, setLanded] = useState(false);
  const ref = useInView(() => setTimeout(() => setLanded(true), 900), { threshold: 0.5 });
  return (
    <div className="week" ref={ref}>
      <div className="week-bar">
        <div><span className="pc-title">Week of 3 November</span> <span className="mono muted">· 31h planned · 6h slack</span></div>
        <div className={`toast${landed ? ' in' : ''}`}><Dot c={STATUS.fixed} /><span>New fixed event</span><span className="mono">Fri 10:00 · Investor coffee</span></div>
      </div>
      <div className="week-grid">
        <div className="wk-hours">{Array.from({ length: 13 }, (_, k) => <span key={k} className="mono" style={{ top: k * HP }}>{String(H0 + k).padStart(2, '0')}</span>)}</div>
        {DAYS.map((d, di) => (
          <div className="wk-col" key={d}>
            <div className={`wk-day mono${di === 1 ? ' today' : ''}`}>{d} {3 + di}</div>
            <div className="wk-slots" style={{ height: 13 * HP }}>
              {WEEK.filter((e) => e[0] === di).map(([, t, h, n, k, move]) => {
                const top = (move && landed ? 13.5 : t) - H0;
                return <div key={n + t} className={`wblk k-${k}${move && landed ? ' moved' : ''}`} style={{ top: top * HP + 1, height: h * HP - 3 }}><span>{n}</span>{move && landed && <em className="mono">moved from 10:00</em>}</div>;
              })}
              {di === 4 && <div className={`wblk k-fixed incoming${landed ? ' in' : ''}`} style={{ top: (10 - H0) * HP + 1, height: 1 * HP - 3 }}><span>Investor coffee</span></div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Voice: transcript with tool calls ---------------- */
export function VoiceLog() {
  const rows = [
    ['you', 'Can we push the gym on Wednesday to the evening? I’ve got an early flight.'],
    ['tool', 'calendar.move', 'Gym · Wed 07:30 → Wed 18:30'],
    ['navi', 'Done. Your flight is at 08:10, so I also moved your briefing to 05:30 that day.'],
    ['you', 'Thanks. Remind me to send Priya the photos when I land.'],
    ['tool', 'inbox.capture', '“Send Priya the photos” · needs review'],
    ['tool', 'memory.save', 'Prefers gym before work, evenings when travelling'],
  ];
  return (
    <div className="vlog">
      {rows.map((r, k) => r[0] === 'tool'
        ? <div className="vrow tool mono" key={k}><span className="arrow">→</span><span className="fn">{r[1]}</span><span className="arg">{r[2]}</span></div>
        : <div className={`vrow ${r[0]}`} key={k}><span className="who mono">{r[0] === 'you' ? 'You' : 'Navi'}</span><p>{r[1]}</p></div>)}
    </div>
  );
}

/* ---------------- Three small cards ---------------- */
export function BriefingVis() {
  return (
    <div className="vis brief">
      <div className="brief-top"><span className="mono">06:00</span><span className="muted">Good morning, Maya</span></div>
      <Wave bars={40} />
      <ul>
        <li><Dot c={STATUS.fixed} />Dentist at 9:30, leave by 9:05</li>
        <li><Dot c={STATUS.focus} />Deck in your 11:00 focus block</li>
        <li><Dot c={STATUS.recovery} />Run before it rains at 8</li>
      </ul>
    </div>
  );
}
export function InboxVis() {
  return (
    <div className="vis inbox">
      <div className="ib-src"><span className="ava ava-mic"><I.Mic size={13} /></span><span><b>Your voice note</b><span className="muted"> · 08:12</span></span></div>
      <div className="ib-quote">“Priya wants the photos by Wednesday, and dinner on Friday still works.”</div>
      {[['Send Priya the photos', 'Due Wed', STATUS.risk], ['Dinner with Priya', 'Fri 19:30', STATUS.fixed]].map(([t, d, c]) => (
        <div className="ib-row" key={t}><Dot c={c} /><span>{t}</span><span className="mono muted">{d}</span><span className="ib-act"><button className="btn-xs">Add</button><button className="btn-xs ghost">Skip</button></span></div>
      ))}
    </div>
  );
}
export function MemoryVis() {
  return (
    <div className="vis memory">
      {[['Prefers gym before work', 'voice · 2 Nov'], ['Mum: call Sundays after 6', 'set-up · 1 Nov'], ['Best focus: 10:00–12:30', 'learned · 3 weeks']].map(([f, s], k) => (
        <div className={`mem${k === 2 ? ' edit' : ''}`} key={f}>
          <span className="mem-f">{f}{k === 2 && <span className="caret" />}</span>
          <span className="mono muted">{s}</span>
          <I.Pencil size={12} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- Evening review ---------------- */
export function ReviewSheet() {
  return (
    <div className="card review-sheet">
      <div className="rs-head"><span className="mono muted">Evening review · Tue 21:00</span><span className="chip-status mono"><Dot c={STATUS.focus} />Ready</span></div>
      <p className="rs-sum">You finished the deck and both calls. The run slipped, and two admin tasks have now moved twice.</p>
      {[
        ['kept', STATUS.focus, 'Deck sent to Sam', 'Kept'],
        ['moved', STATUS.flex, 'Admin batch → Thu 09:00, a 30-minute block before your first call', 'Moved twice'],
        ['risk', STATUS.risk, 'Photos for Priya, due tomorrow; reminder set for 20:00', 'At risk'],
        ['rec', STATUS.recovery, 'Three late nights. Tomorrow ends at 18:00, no evening work', 'Recovery'],
      ].map(([k, c, t, s]) => (
        <div className="rs-row" key={k}><Dot c={c} /><span>{t}</span><span className="mono muted">{s}</span></div>
      ))}
      <div className="rs-foot"><button className="btn-pill">Accept plan for Wednesday</button><button className="btn-ghost-sm">Adjust</button></div>
    </div>
  );
}

/* ---------------- Control: what Navi may do ---------------- */
export function ControlTable() {
  const rows = [
    ['Reorder flexible work in your plan', 'On its own', STATUS.focus],
    ['Save something it learned to memory', 'On its own, always editable', STATUS.focus],
    ['Move a fixed event', 'Asks first', STATUS.recovery],
    ['Accept or decline an invitation', 'Asks first', STATUS.recovery],
    ['Send an email or message for you', 'Asks every time', STATUS.risk],
  ];
  return (
    <div className="ctable" role="table" aria-label="What Navi can do">
      <div className="ct-row ct-h mono" role="row"><span role="columnheader">Action</span><span role="columnheader">Permission</span></div>
      {rows.map(([a, p, c]) => <div className="ct-row" role="row" key={a}><span role="cell">{a}</span><span role="cell" className="mono"><Dot c={c} />{p}</span></div>)}
    </div>
  );
}

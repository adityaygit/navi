import React, { useEffect, useRef, useState } from 'react';
import * as I from './icons.jsx';
import { HeroWindow, HeroCards, PlannerCard, CommitmentsCard, BalanceCard, WeekWindow, LineChart } from './mockups.jsx';

const img = (name) => `./img/${name}`;

const CAPTURE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture');
const hooks = (typeof window !== 'undefined' && (window.__navi = window.__navi || {})) || {};

function useCycle(n, ms, enabled = true, name) {
  const [i, setI] = useState(0);
  useEffect(() => { if (name) hooks[name] = setI; }, [name]);
  useEffect(() => {
    if (!enabled || CAPTURE) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, enabled, i]);
  return [i, setI];
}

function Nav() {
  const links = [['Features', true], ['Pricing'], ['Updates'], ['Voice'], ['App']];
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a className="logo" href="#" aria-label="Navi home"><I.Logo /></a>
        <ul className="nav-links">
          {links.map(([l, menu]) => (
            <li key={l}><a href="#">{l}{menu && <I.Chevron />}</a></li>
          ))}
        </ul>
        <div className="nav-pill">
          <span>Navi is in early access</span>
          <a className="btn-white" href="#start">Join waitlist</a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="device reveal">
          <div className="device-screen">
            <div className="device-wall" style={{ backgroundImage: `url(${img('wall-dawn.jpg')})` }} />
            <div className="device-window"><HeroWindow /></div>
          </div>
          <HeroCards />
          <div className="device-fade" />
        </div>
        <div className="hero-copy reveal">
          <p className="hero-kicker">Navi</p>
          <h1 className="display">Your life, finally in order.</h1>
        </div>
      </div>
    </section>
  );
}

function Highlights() {
  const track = useRef(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const items = [
    { w: 652, cap: 'A planner that plans with you', el: <PlannerCard /> },
    { w: 458, cap: 'Commitments, kept in view', el: <CommitmentsCard /> },
    { w: 458, cap: 'Focus and recovery, compared', el: <BalanceCard /> },
    { w: 458, cap: 'Reviews you can trust', el: <BalanceCard alt /> },
  ];
  const onScroll = () => {
    const t = track.current; if (!t) return;
    setEdge({ start: t.scrollLeft < 8, end: t.scrollLeft + t.clientWidth > t.scrollWidth - 8 });
  };
  const go = (dir) => track.current?.scrollBy({ left: dir * 478, behavior: 'smooth' });
  return (
    <section className="hl" aria-labelledby="hl-label">
      <div className="container">
        <div className="hl-head reveal">
          <div>
            <p className="hl-label" id="hl-label">Highlights</p>
            <p className="hl-text">Navi is one home for the plans, promises, and routines that usually live in your head. Tell it what is going on and it builds a realistic day, checks in honestly, and adapts when life shifts.</p>
          </div>
          <div className="hl-arrows">
            <button className="round-btn" aria-label="Previous" disabled={edge.start} onClick={() => go(-1)}><I.Chevron dir="left" size={14} /></button>
            <button className="round-btn" aria-label="Next" disabled={edge.end} onClick={() => go(1)}><I.Chevron dir="right" size={14} /></button>
          </div>
        </div>
      </div>
      <div className="hl-track reveal" ref={track} onScroll={onScroll}>
        {items.map((it) => (
          <div className="hl-item" key={it.cap} style={{ width: it.w }}>
            <div className="hl-card">{it.el}</div>
            <p className="hl-cap">{it.cap}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const DOCK = [
  [I.Home, 'Today at a glance', 'Your plan, open commitments, and briefings in a single view. It re-plans itself whenever the day changes.'],
  [I.Compass, 'Goals and direction', 'Long-term goals broken into the next few steps, so every week moves something that matters forward.'],
  [I.Calendar, 'Week planner', 'Fixed events and flexible work laid out together, with focus blocks and recovery time protected.'],
  [I.Bookmark, 'Projects', 'Every project with its next action, its notes, and the commitments that depend on it.'],
  [I.Inbox, 'Review inbox', 'New commitments Navi noticed wait here until you approve, edit, or dismiss them.'],
  [I.Mic, 'Voice', 'Talk through your day out loud. Navi listens, updates the plan, and keeps the transcript.'],
  [I.Gear, 'Settings', 'Briefing times, quiet hours, and exactly what Navi may do on its own.'],
];

function Dock() {
  const [active, setActive] = useCycle(DOCK.length, 3200, true, 'dock');
  const [, title, body] = DOCK[active];
  const iconX = 180 + active * 105; // icon center relative to stage (dock left 122 + pad 18 + half button 40)
  return (
    <section className="dock-sec">
      <div className="container">
        <h2 className="display reveal">One calm place for everything.</h2>
        <div className="dock-stage reveal">
          <div className="sculpture" style={{ backgroundImage: `url(${img('sculpture.jpg')})` }} aria-hidden="true" />
          <div className="dock" role="tablist" aria-label="Navi sections">
            <div className="dock-bar">
              {DOCK.map(([Icon, t], k) => (
                <button key={t} role="tab" aria-selected={k === active} aria-label={t} className={`dock-btn${k === active ? ' active' : ''}`} onClick={() => setActive(k)}>
                  <Icon size={38} />
                </button>
              ))}
            </div>
            <div className="dock-search" aria-hidden="true"><I.Search size={40} /></div>
          </div>
          <div className="leader" style={{ left: iconX, top: 383, height: 132, borderLeftWidth: 1 }} />
          <div className="leader" style={{ left: iconX, top: 515, width: 870 - iconX, borderTopWidth: 1 }} />
          <div className="annot" key={active}>
            <h3 className="fade-swap">{title}</h3>
            <p className="fade-swap">{body}</p>
          </div>
          <div className="floor" />
        </div>
      </div>
    </section>
  );
}

const PALETTE = ['#e9e3d6', '#3a6df0', '#d84a3a', '#f2c94c', '#7c5cff', '#2bb673', '#ff7a1a', '#14a3c7', '#b83280', '#9aa5b1', '#56ccf2', '#c0392b'];
function Orbit({ ring }) {
  const rows = [
    [200, 5], [0, 7], [56, 13], [112, 15], [168, 15], [224, 15], [280, 13], [336, 11], [392, 7],
  ];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const glyphs = 'ABDEFGHJKMNPRSTVWXZ';
  return (
    <div className="orbit" aria-hidden="true">
      {rows.map(([top, n], r) => (
        <div className="orbit-row" key={r} style={{ top: r === 0 ? 0 : top }}>
          {Array.from({ length: n }, (_, k) => {
            const c = PALETTE[Math.floor(rnd() * PALETTE.length)];
            const g = glyphs[Math.floor(rnd() * glyphs.length)];
            return <div className="chip" key={k}><i style={{ background: c, color: c === '#e9e3d6' || c === '#f2c94c' ? '#111' : '#fff' }}>{g}</i><span /></div>;
          })}
        </div>
      ))}
      <div className="ring" style={{ '--ring': ring }}><div className="ring-core"><I.Logo /></div></div>
    </div>
  );
}

const RINGS = ['#479ffa', '#4ebe96', '#c9f53b'];
function Rotator() {
  const [slide, setSlide] = useCycle(3, 5200, true, 'slide');
  const [ring, setRing] = useState(0);
  useEffect(() => { hooks.ring = setRing; }, []);
  useEffect(() => { if (slide !== 2 || CAPTURE) return; setRing(0); const t = setInterval(() => setRing((v) => (v + 1) % 3), 1600); return () => clearInterval(t); }, [slide]);
  const slides = [
    { cls: 'ember', h: 'Briefings at sunrise.', p: 'Every morning at six, Navi reads you a short plan for the day, then checks in at nine with a two-minute review. Hear it while you get ready, or read it in under a minute.' },
    { cls: 'frost', h: 'Routines that hold.', p: 'Build habits around the life you actually have. Navi spots missed days early and adjusts the routine before it quietly falls apart.' },
    { cls: 'volt', h: 'Connected to your tools.', p: 'Bring in your calendar, mail, and notes. Navi keeps commitments, routines, and goals current across every one of them.' },
  ];
  return (
    <section className="rot" aria-roledescription="carousel" aria-label="Navi features">
      {slides.map((s, k) => (
        <div className={`rot-slide${k === slide ? ' on' : ''}`} key={s.h} aria-hidden={k !== slide}>
          <div className="rot-head">
            <a className="rot-link" href="#">Learn more <I.Chevron dir="right" /></a><br />
            <h2 className={`display ${s.cls}`}>{s.h}</h2>
            <p className="lede">{s.p}</p>
          </div>
          {k === 0 && (<>
            <div className="portrait" style={{ backgroundImage: `url(${img('portrait.jpg')})` }} />
            <div className="notif-stack" />
            <div className="notif">
              <div className="notif-icon"><I.Logo width="14" height="16" /></div>
              <div className="notif-text"><b>Morning briefing</b> is ready for you · 6:00 AM</div>
              <span className="notif-btn"><I.Play size={14} /> Listen now</span>
            </div>
          </>)}
          {k === 1 && (
            <div className="routines">
              {[['Morning run', 'Mon · Wed · Fri', 0.82], ['Read 20 pages', 'Every night', 0.64], ['Inbox zero', 'Weekdays, 4 PM', 0.91], ['Call home', 'Sundays', 0.5]].map(([t, w, v]) => (
                <div className="ui-card" key={t} style={{ padding: '18px 20px', height: 96 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 600 }}><span>{t}</span><span style={{ color: '#7d8fb3' }}>{Math.round(v * 100)}%</span></div>
                  <div style={{ fontSize: 11, color: '#6b6b6b', marginTop: 4 }}>{w}</div>
                  <div style={{ height: 4, borderRadius: 4, background: '#222', marginTop: 16 }}><div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,#b6d6ff,#4c5677)' }} /></div>
                </div>
              ))}
            </div>
          )}
          {k === 2 && <Orbit ring={RINGS[ring]} />}
        </div>
      ))}
    </section>
  );
}

function Monitor() {
  return (
    <section className="mon-sec">
      <div className="container center">
        <h2 className="display solid reveal">See the whole week at once.</h2>
        <p className="lede reveal">Navi lays fixed commitments and flexible work side by side, so focus time and rest both land on the calendar early.</p>
        <div className="monitor reveal">
          <div className="mon-bezel">
            <div className="mon-screen" style={{ backgroundImage: `url(${img('wall-lake.jpg')})` }}>
              <div className="mon-menubar"><b>Navi</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><span style={{ marginLeft: 'auto' }}>Tue Nov 4 9:41 AM</span></div>
              <div className="mon-window"><WeekWindow /></div>
            </div>
          </div>
          <div className="mon-stand" />
        </div>
      </div>
    </section>
  );
}

function Keys() {
  const [pressed, setPressed] = useState(false);
  useEffect(() => { if (CAPTURE) return; const t = setInterval(() => { setPressed(true); setTimeout(() => setPressed(false), 260); }, 2600); return () => clearInterval(t); }, []);
  return (
    <div className="keys" aria-hidden="true">
      <div className={`key key-wide${pressed ? ' pressed' : ''}`}><span className="key-sym">⌘</span><span className="key-word">command</span></div>
      <div className={`key key-sq${pressed ? ' pressed' : ''}`} style={{ transitionDelay: pressed ? '60ms' : '0ms' }}>K</div>
    </div>
  );
}

function Envelope() {
  return (
    <svg width="92" height="104" viewBox="0 0 92 104" aria-hidden="true">
      <defs>
        <linearGradient id="env" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d6d6d" /><stop offset="1" stopColor="#2a2a2a" /></linearGradient>
        <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9a9a9a" /><stop offset="1" stopColor="#5a5a5a" /></linearGradient>
      </defs>
      <rect x="20" y="6" width="52" height="66" rx="6" fill="url(#paper)" />
      {[18, 28, 38, 48].map((y, k) => <rect key={y} x="28" y={y} width={k % 2 ? 26 : 36} height="5" rx="2.5" fill="#cfcfcf" opacity=".85" />)}
      <path d="M4 50 46 76 88 50V96a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z" fill="url(#env)" stroke="#8a8a8a" strokeOpacity=".5" />
      <path d="M4 96 38 70M88 96 54 70" stroke="#999" strokeOpacity=".5" />
    </svg>
  );
}

function usePanelScroll() {
  const wrap = useRef(null), bodyRef = useRef(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const w = wrap.current, b = bodyRef.current; if (!w || !b) return;
      const r = w.getBoundingClientRect();
      const range = w.offsetHeight - 703;
      const p = Math.min(Math.max(22 - r.top, 0), range);
      const tmax = Math.max(b.offsetHeight - (703 - 34), 0);
      setT(range > 0 ? (p / range) * tmax : 0);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  return { wrap, bodyRef, t };
}

function Band() {
  const [tab, setTab] = useState(0);
  const { wrap, bodyRef, t } = usePanelScroll();
  return (
    <section className="band">
      <div className="container">
        <div className="cmd reveal">
          <div>
            <h2 className="display">Capture anything, instantly.</h2>
            <p className="lede">Press two keys to add a task, move a meeting, or ask what comes next, in plain language. No menus, no forms.</p>
          </div>
          <Keys />
        </div>
        <div className="weekly reveal">
          <div className="wk-card">
            <Envelope />
            <div>
              <div className="wk-meta">Navi weekly review · Sunday, Nov 9</div>
              <div className="wk-title">A strong week, one loose end</div>
              <div className="wk-ex">You closed 23 tasks and kept 9 of 10 commitments. The one that slipped, the insurance call, is now on Monday with a reminder.</div>
            </div>
          </div>
          <div className="weekly-copy">
            <h2 className="display">Sundays, sorted.</h2>
            <p className="lede">Each Sunday evening, Navi sums up what you finished, what slipped, and what deserves room next week. <b>Five minutes to read</b>, then Monday starts clear.</p>
          </div>
        </div>

        <div className="review center">
          <span className="soon reveal">Coming soon</span>
          <h2 className="display reveal">Reviews that keep you honest.</h2>
          <p className="lede reveal">Navi compares what you planned with what really happened, then suggests fair, specific adjustments. No guilt, just a next step.</p>
        </div>
        <div className="panel-wrap" ref={wrap}>
          <div className="panel-sticky">
            <div className="panel-move" style={{ position: 'absolute', inset: 0, transform: `translateY(${-t}px)` }}>
              <span className="callout" style={{ right: 'calc(100% + 30px)', top: 140 }}><span style={{ textAlign: 'right', marginRight: 8 }}>The day,<br />summarized</span><span className="tick" /><span className="dash" /><span className="end" /></span>
              <span className="callout" style={{ right: 'calc(100% + 30px)', top: 218 }}><span style={{ textAlign: 'right', marginRight: 8 }}>Suggested<br />next steps</span><span className="tick" /><span className="dash" /><span className="end" /></span>
              <span className="callout" style={{ left: 'calc(100% - 72px)', top: 508 }}><span className="end" /><span className="dash" style={{ width: 92 }} /><span className="tick" /><span style={{ marginLeft: 8 }}>Trends over time</span></span>
            </div>
            <div className="panel">
            <div className="panel-bar">
              <I.Close size={14} />
              <span style={{ marginLeft: 19 }}>Generated at 9:00 PM</span>
              <div className="tabs" role="tablist">
                {['Review', 'Commitments', 'Insights'].map((t, k) => <button key={t} role="tab" aria-selected={k === tab} className={`tab${k === tab ? ' on' : ''}`} onClick={() => setTab(k)}>{t}</button>)}
              </div>
            </div>
              <div className="panel-move" ref={bodyRef} style={{ transform: `translateY(${-t}px)` }}>
            <div className="panel-body" style={{ textAlign: 'left' }}>
              <span className="ui-tag"><span className="ui-dot" style={{ background: '#4ebe96' }}>✓</span>Today</span>
              <h4>Evening review</h4>
              <p><span style={{ color: '#6f6f6f' }}>Tuesday, Nov 4.</span> You finished the proposal draft and both calls, skipped the run, and pushed two admin tasks for the second day in a row.</p>
              <div className="chips">
                {['Move admin to Thu morning', 'Shorter run tomorrow', 'Protect Friday focus'].map((c) => <span className="chip2" key={c}><I.Sliders size={12} />{c}</span>)}
              </div>
              <div className="chart-card">
                <div style={{ position: 'absolute', left: 40, top: 36, fontSize: 14, fontWeight: 600, display: 'flex', gap: 12, alignItems: 'center' }}><I.Chevron dir="left" /> 7-day focus hours</div>
                <div style={{ position: 'absolute', left: 525, top: 96, height: 26, padding: '0 10px', borderRadius: 6, background: '#1b1b1b', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>Focus <span style={{ color: '#d6d6d6' }}>18.5h</span></div>
                <LineChart w={590} h={290} x={40} y={110} seed={11} trend={1.4} color="#e8e8e8" />
              </div>
              <h4 style={{ marginTop: 42, fontSize: 17 }}>What to adjust tomorrow:</h4>
              <ul className="bul">
                <li><b>Admin is stuck.</b> Two small tasks have moved twice; a 30-minute block before your first call clears both of them.</li>
                <li><b>Energy dips after 3 PM.</b> Your best work this week happened before lunch, so tomorrow’s hardest task now starts at 10.</li>
                <li><b>Recovery needs room.</b> Three late nights in a row, so the optional meetup has moved to next week.</li>
                <li><b>One promise at risk.</b> You told Sam the photos would arrive by Wednesday; a reminder is set for 8 PM tomorrow.</li>
              </ul>
              <p style={{ marginTop: 30, lineHeight: '30px' }}>Overall, a solid day. Protecting your mornings is working, and tomorrow’s plan leaves an hour of slack in case something runs over.</p>
              <div className="stat-card">
                <div><div style={{ fontSize: 12, fontWeight: 600 }}><span style={{ color: '#4ebe96' }}>●</span> Focus streak <span style={{ color: '#6b6b6b', fontWeight: 400 }}>this month</span></div><div style={{ fontSize: 22, fontWeight: 600, marginTop: 8 }}>12<span style={{ color: '#6b6b6b' }}> days</span></div></div>
                <div style={{ textAlign: 'right' }}><LineChart w={84} h={24} seed={4} trend={2} color="#4ebe96" /><div style={{ fontSize: 11, color: '#4ebe96', marginTop: 10, fontWeight: 600 }}>+3 vs last week</div></div>
              </div>
            </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="cta" id="start">
      <div className="container">
        <div className="cta-note reveal">Free during early access.</div>
        <h2 className="display reveal">Start with one conversation.</h2>
        <p className="lede reveal">Tell Navi about your life once. It builds the plan and keeps it current.</p>
        <a className="btn-ghost reveal" href="#start">Join the waitlist</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>© 2026 Navi</span>
        <nav aria-label="Footer">
          <a href="#">Home</a><a href="#">Features</a><a href="#">Updates</a><a href="#">Download</a>
          <span className="sep" />
          <a href="#">Privacy</a><a href="#">Terms</a>
        </nav>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Highlights />
        <Dock />
        <Rotator />
        <Monitor />
        <Band />
        <Cta />
      </main>
      <Footer />
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import * as I from './icons.jsx';
import { CAPTURE, HeroApp, SetupTranscript, SetupProposal, WeekPlanner, VoiceLog, BriefingVis, InboxVis, MemoryVis, ReviewSheet, ControlTable, Wave } from './product.jsx';

const img = (name) => `./img/${name}`;
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

function EmailPill({ id, label = 'Join early access' }) {
  const [sent, setSent] = useState(false);
  return (
    <form className="email" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
      <label htmlFor={id} className="sr">Email address</label>
      <input id={id} type="email" required placeholder="you@example.com" disabled={sent} />
      <button className="btn-pill" type="submit" disabled={sent}>{sent ? 'You’re on the list' : label}</button>
    </form>
  );
}

function Nav() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="#" className="wordmark" aria-label="Navi home"><I.Wordmark /></a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#setup">How it works</a><a href="#planner">Planner</a><a href="#voice">Voice</a><a href="#control">Privacy</a>
        </nav>
        <div className="nav-right">
          <a href="#" className="nav-signin">Sign in</a>
          <a href="#start" className="btn-pill sm">Join early access</a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hb">
      <div className="hb-sky" style={{ backgroundImage: `url(${img('horizon.jpg')})` }} aria-hidden="true" />
      <div className="container hb-inner">
        <div className="hb-hero reveal">
          <h1 className="serif hb-h">A calmer way<br />to <em>run</em> your life.</h1>
          <p className="lead">Navi learns your life in one conversation, then plans your days with you, keeps your commitments honest, and reviews your week.</p>
          <EmailPill id="email-hero" />
        </div>
        <div className="reveal"><HeroApp /></div>
      </div>
    </section>
  );
}

function Chapter({ id, eyebrow, title, children, className = '' }) {
  return (
    <section id={id} className={`chapter ${className}`}>
      <div className="container">
        <div className="ch-head reveal">
          <p className="eyebrow mono">{eyebrow}</p>
          <h2 className="serif ch-title">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

function Setup() {
  return (
    <section id="setup" className="setup">
      <div className="container setup-grid">
        <div className="setup-copy reveal">
          <p className="eyebrow mono">Set-up</p>
          <h2 className="serif ch-title">Tell it about your life <em>once</em>.</h2>
          <p className="body">No forms and no templates. Describe your week out loud or in writing. Navi turns it into real workspaces, routines, goals and commitments, plus a first plan, and shows you all of it before anything is created.</p>
          <SetupTranscript />
        </div>
        <div className="reveal"><SetupProposal /></div>
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
function Rock() {
  // Protected section. 860–1186px: the stage scales as one unit. Below 860px: CSS mobile arrangement,
  // with the dock scaled to the screen width via --ds.
  const wrap = useRef(null);
  const [w, setW] = useState(1186);
  useEffect(() => {
    const fit = () => setW(wrap.current?.clientWidth || 1186);
    fit(); addEventListener('resize', fit); return () => removeEventListener('resize', fit);
  }, []);
  const mobile = w < 860;
  const s = mobile ? 1 : Math.min(1, w / 1186);
  return (
    <div className={`rock-wrap${mobile ? ' rock-m' : ''}`} ref={wrap} style={{ height: !mobile && s < 1 ? 1020 * s : undefined, '--ds': Math.min(1, (w - 32) / 892) }}>
      <div className="rock-scale" style={s < 1 ? { transform: `scale(${s})`, width: 1186 } : undefined}>
        <Dock />
      </div>
    </div>
  );
}

function Planner() {
  return (
    <section id="planner" className="planner">
      <div className="container">
        <div className="center-head reveal">
          <p className="eyebrow mono">Planner</p>
          <h2 className="serif ch-title">Fixed where it must be.<br /><em>Flexible</em> everywhere else.</h2>
          <p className="body">Appointments and promises hold their place. Focus work, errands and recovery move around them, so a new meeting reshapes the week instead of breaking it.</p>
        </div>
        <div className="planner-frame reveal" style={{ backgroundImage: `url(${img('wall-highland.jpg')})` }}>
          <WeekPlanner />
        </div>
      </div>
    </section>
  );
}

function Voice() {
  return (
    <section id="voice" className="voice">
      <div className="container voice-grid">
        <figure className="voice-photo reveal" style={{ backgroundImage: `url(${img('portrait.jpg')})` }}>
          <figcaption className="voice-live"><span className="live"><span className="pulse" />Live</span><Wave bars={22} /><span className="mono muted">02:14</span></figcaption>
        </figure>
        <div className="voice-copy reveal">
          <p className="eyebrow mono">Voice</p>
          <h2 className="serif ch-title">Talk it <em>through</em>.</h2>
          <p className="body">Real-time, two-way voice that shares one history with your typed chats. Navi acts while you talk, and every change shows up as a line you can check or undo.</p>
          <VoiceLog />
        </div>
      </div>
    </section>
  );
}

function Details() {
  const cards = [
    ['Morning and evening briefings', 'A spoken plan at 06:00 and a short review at 21:00. Both times are yours to change, and quiet hours are respected.', <BriefingVis key="b" />],
    ['A review inbox for new commitments', 'Promises Navi notices in email and conversation wait here as suggestions until you add or skip them.', <InboxVis key="i" />],
    ['Memory you can read and edit', 'Everything Navi knows about you sits in one plain list, with where it learned it. Change a line and the plan follows.', <MemoryVis key="m" />],
  ];
  return (
    <section className="details">
      <div className="container">
        <h2 className="serif ch-title center reveal">Small things, handled <em>well</em>.</h2>
        <div className="cards3">
          {cards.map(([t, b, v]) => (
            <article className="card dcard reveal" key={t}>
              {v}
              <h3>{t}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Accountability() {
  const stats = [['9/10', 'commitments kept'], ['11.5h', 'focused work'], ['4', 'recovery blocks protected'], ['1', 'promise at risk, flagged early']];
  return (
    <section className="acct">
      <div className="container acct-grid">
        <div className="reveal">
          <p className="eyebrow mono">Reviews</p>
          <h2 className="serif ch-title">Strict, but <em>fair</em>.</h2>
          <p className="body">Every evening Navi compares the plan with what really happened. It names what slipped and why, then proposes specific changes for tomorrow. It never guilt-trips, and it always offers a next step.</p>
          <dl className="stats">
            {stats.map(([n, l]) => <div key={l}><dt className="serif">{n}</dt><dd>{l}</dd></div>)}
          </dl>
          <p className="mono fine">Example week</p>
        </div>
        <div className="reveal"><ReviewSheet /></div>
      </div>
    </section>
  );
}

function Control() {
  const facts = [[I.Mic, 'Transcripts are saved, raw audio is not', 'Voice is turned into text for your history, and the recording is discarded.'], [I.Moon, 'Quiet hours you choose', 'No notifications or briefings inside them, unless you say otherwise.'], [I.Lock, 'Your data stays yours', 'Export or delete your plans, memory and history at any time.']];
  return (
    <section id="control" className="control">
      <div className="container">
        <div className="control-grid">
          <div className="reveal">
            <p className="eyebrow mono">Control</p>
            <h2 className="serif ch-title">You stay in <em>charge</em>.</h2>
            <p className="body">Navi works on its own inside your plan. Anything that reaches other people or changes something fixed waits for your approval.</p>
          </div>
          <div className="reveal"><ControlTable /></div>
        </div>
        <div className="facts reveal">
          {facts.map(([Ic, t, b]) => <div className="fact" key={t}><Ic size={18} /><h3>{t}</h3><p>{b}</p></div>)}
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="close" id="start">
      <div className="close-horizon" style={{ backgroundImage: `url(${img('wall-dawn.jpg')})` }} aria-hidden="true" />
      <div className="container close-inner reveal">
        <h2 className="serif close-h">Begin with one <em>conversation</em>.</h2>
        <p className="body">Tell Navi about your week. It builds the plan and keeps it current.</p>
        <EmailPill id="email-close" />
      </div>
    </section>
  );
}

function Footer() {
  const cols = [['Product', ['Planner', 'Voice', 'Reviews', 'Memory']], ['Company', ['About', 'Updates', 'Careers']], ['Legal', ['Privacy', 'Terms', 'Security']]];
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div><I.Wordmark /><p className="muted">A personal operating system for calmer weeks.</p></div>
          {cols.map(([h, ls]) => <div key={h}><h4 className="mono">{h}</h4>{ls.map((l) => <a href="#" key={l}>{l}</a>)}</div>)}
        </div>
        <div className="footer-bottom mono"><span>© 2026 Navi</span><span>Made for people with too many tabs open</span></div>
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
        <Setup />
        <Rock />
        <Planner />
        <Voice />
        <Details />
        <Accountability />
        <Control />
        <Close />
      </main>
      <Footer />
    </>
  );
}

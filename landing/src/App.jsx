import React, { useEffect, useRef, useState } from 'react';
import * as I from './icons.jsx';
import { CAPTURE, HeroApp, SetupTranscript, SetupProposal, VoiceLog, MemoryVis, ReviewSheet, ControlTable } from './product.jsx';
import { Presence } from './beacon.jsx';

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

function EmailPill({ id, label = 'Request an invite' }) {
  const [sent, setSent] = useState(false);
  return (
    <form className="email" onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
      <label htmlFor={id} className="sr">Email address</label>
      <input id={id} type="email" required placeholder="you@example.com" disabled={sent} />
      <button className="btn-pill" type="submit" disabled={sent}>{sent ? 'Noted' : label}</button>
      {sent && <span className="email-note mono" role="status">This preview doesn’t collect emails yet.</span>}
    </form>
  );
}


function Nav() {
  return (
    <header className="nav">
      <div className="container nav-inner">
        <a href="#top" className="wordmark" aria-label="Navi home"><I.BeaconWordmark glow="#ffc58a" /></a>
        <nav className="nav-links" aria-label="Primary">
          <a href="#how">How it works</a><a href="#day">Your day</a><a href="#presence">Voice</a><a href="#control">Control</a>
        </nav>
        <div className="nav-right">
          <a href="#start" className="btn-pill sm">Request an invite</a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero3" id="top">
      <picture className="hero3-art" aria-hidden="true">
        <source media="(max-width: 760px)" srcSet={img('beacon-hero-m.jpg')} />
        <img src={img('beacon-hero.jpg')} alt="" />
      </picture>
      <div className="container hero3-inner">
        <p className="eyebrow mono reveal">Personal AI · invite-only early access</p>
        <h1 className="serif hero3-h reveal">A quiet guide<br />for a full <em>life</em>.</h1>
        <p className="lead reveal">Navi learns how your life works in one conversation, plans each day with you, and helps you follow through, adjusting when things change.</p>
        <div className="hero3-cta reveal">
          <EmailPill id="email-hero" />
          <a className="text-link" href="#how">See how it works <I.Arrow size={14} /></a>
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="how">
      <div className="container">
        <div className="how-head reveal">
          <p className="eyebrow mono">From words to a plan</p>
          <h2 className="serif ch-title">Say it the way you’d <em>say</em> it.</h2>
          <p className="body">Describe your week out loud or in writing. Navi turns it into workspaces, routines, goals, commitments and a first plan. Each item shows the words it came from and whether you said it or Navi inferred it. Nothing exists until you approve it.</p>
        </div>
        <div className="how-grid">
          <div className="reveal"><SetupTranscript /></div>
          <div className="reveal"><SetupProposal /></div>
        </div>
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


function Day() {
  return (
    <section id="day" className="day3">
      <div className="container">
        <div className="center-head reveal">
          <p className="eyebrow mono">Your day</p>
          <h2 className="serif ch-title">When the day moves,<br />the plan <em>moves</em> with it.</h2>
          <p className="body">Fixed things stay where they are. Flexible work, focus and recovery re-route around them. Navi explains the change and waits for your OK before it touches anything you marked fixed.</p>
        </div>
        <div className="day3-frame reveal" style={{ backgroundImage: `url(${img('wall-highland.jpg')})` }}>
          <HeroApp />
        </div>
      </div>
    </section>
  );
}

function PresenceSection() {
  return (
    <section id="presence" className="presence-sec">
      <div className="container">
        <div className="presence-head reveal">
          <p className="eyebrow mono">Presence</p>
          <h2 className="serif ch-title">Always there. Rarely <em>loud</em>.</h2>
          <p className="body">Black stays constant. Navi’s light changes with what it is doing, so you can tell at a glance whether it is listening, working or waiting for you.</p>
        </div>
        <div className="reveal"><Presence /></div>
        <div className="voice-row reveal">
          <div>
            <h3 className="sub">Talk, type, or both</h3>
            <p className="body">Voice and text share one history. Ask out loud on a walk, finish in chat at your desk; the changes it made are listed either way.</p>
          </div>
          <VoiceLog />
        </div>
      </div>
    </section>
  );
}

function Loop() {
  const plan = [['09:30', 'Dentist', 'fixed'], ['11:00', 'Finish the Q4 deck', 'focus'], ['15:00', 'Client call', 'fixed'], ['16:15', 'Deck review with Sam', 'flex']];
  return (
    <section className="loop">
      <div className="container">
        <h2 className="serif ch-title loop-title reveal">It remembers, plans, and <em>checks in</em>.</h2>
        <div className="loop-grid">
          <div className="loop-col reveal">
            <span className="mono loop-n">Memory</span>
            <h3 className="sub">Knows what matters to you</h3>
            <p>Everything Navi has learned sits in one readable list, with where it learned it. Correct a line or delete it and the next plan follows.</p>
            <MemoryVis />
          </div>
          <div className="loop-col reveal">
            <span className="mono loop-n">Plan</span>
            <h3 className="sub">Plans with real time</h3>
            <p>It never invents free time, never moves a fixed item on its own, and never marks your work done for you.</p>
            <ul className="mini-plan">
              {plan.map(([t, n, k]) => <li key={n} className={`k-${k}`}><span className="mono">{t}</span>{n}</li>)}
            </ul>
          </div>
          <div className="loop-col reveal">
            <span className="mono loop-n">Review</span>
            <h3 className="sub">Strict, but fair</h3>
            <p>Each evening it compares the plan with what happened. Interruptions and rest don’t count against you; slipped promises are named, with a next step.</p>
            <ul className="mini-review">
              <li><span className="dot" style={{ background: '#3ad389' }} />Deck sent to Sam<span className="mono">Kept</span></li>
              <li><span className="dot" style={{ background: '#70b8ff' }} />Admin batch<span className="mono">Moved twice</span></li>
              <li><span className="dot" style={{ background: '#ff9592' }} />Photos for Priya<span className="mono">At risk</span></li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Control() {
  const facts = [[I.Clock, 'Undo what it did', 'Every change Navi makes is listed in Activity and can be reverted.'], [I.Mic, 'Transcripts, not recordings', 'Voice is saved as text in your history; the raw audio is not kept.'], [I.Moon, 'Quiet hours you set', 'No briefings or notifications inside them.'], [I.Lock, 'Yours to take or delete', 'Export everything or delete your account from Settings.']];
  return (
    <section id="control" className="control">
      <div className="container">
        <div className="control-grid">
          <div className="reveal">
            <p className="eyebrow mono">Control</p>
            <h2 className="serif ch-title">You stay in <em>charge</em>.</h2>
            <p className="body">Navi works on its own inside your plan. Anything consequential, like moving something fixed, deleting, or finishing work, waits for your approval.</p>
          </div>
          <div className="reveal"><ControlTable /></div>
        </div>
        <div className="facts facts4 reveal">
          {facts.map(([Ic, t, b]) => <div className="fact" key={t}><Ic size={18} /><h3>{t}</h3><p>{b}</p></div>)}
        </div>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="close3" id="start">
      <div className="container close3-inner">
        <img className="close3-stone reveal" src={img('beacon-dawn.jpg')} alt="" aria-hidden="true" />
        <h2 className="serif close-h reveal">Start with one <em>conversation</em>.</h2>
        <p className="body reveal">Navi is in invite-only early access. Leave your email and tell it about your week when your invite arrives.</p>
        <div className="reveal"><EmailPill id="email-close" /></div>
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
          <div><I.BeaconWordmark /><p className="muted">A personal operating system for calmer weeks.</p></div>
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
        <How />
        <Rock />
        <Day />
        <PresenceSection />
        <Loop />
        <Control />
        <Close />
      </main>
      <Footer />
    </>
  );
}

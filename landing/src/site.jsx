import React, { useEffect, useState } from 'react';
import * as I from './icons.jsx';

// Shared pieces for every page: routing, nav, page header, FAQ, join block, footer.

export const img = (name) => `${import.meta.env.BASE_URL}img/${name}`;
export const CONTACT = 'support@mail.meetnavi.app';

// ---------- routing ----------
// The app build (base "/landing/") is served at real paths like /guides/voice.
// The artifact preview (base "./") can only use a plain #hash, so pages live at #p-guides--voice there.
export const PATH_MODE = import.meta.env.BASE_URL.startsWith('/');
const toHash = (p) => (p === '/' ? 'home' : 'p-' + p.slice(1).replace(/\//g, '--'));
const fromHash = (h) => (h.startsWith('p-') ? '/' + h.slice(2).replace(/--/g, '/') : '/');
const isRouteHash = (h) => h === '' || h === 'home' || h.startsWith('p-');
export const href = (p) => (PATH_MODE ? p : '#' + toHash(p));

function readPath() {
  if (PATH_MODE) return location.pathname.replace(/\/+$/, '') || '/';
  return fromHash(location.hash.slice(1));
}
export function useRoute() {
  const [path, setPath] = useState(readPath);
  useEffect(() => {
    if (PATH_MODE) return;
    // In-page anchors (#start, #planner) don't change the page.
    const on = () => { const h = location.hash.slice(1); if (!isRouteHash(h)) return; setPath(readPath()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return path;
}

// True on the real app (and local dev), false inside the artifact preview.
export const onNavi = () => /(^|\.)meetnavi\.app$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/.test(location.hostname);

// ---------- email signup ----------
export function EmailPill({ id, label = 'Join early access' }) {
  // Posts to the Navi app's waitlist API on the same site. The artifact preview can't reach it,
  // so a failed request says so instead of pretending.
  const [state, setState] = useState('idle');
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState('sending');
    try {
      const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), website: f.get('website') }) });
      setState(res.ok ? 'sent' : res.status === 400 ? 'invalid' : onNavi() ? 'error' : 'offline');
    } catch { setState(onNavi() ? 'error' : 'offline'); }
  };
  const note = { sent: 'Check your inbox for a short application.', invalid: 'That email address doesn’t look right.', error: 'Something went wrong on our side. Try again in a minute.', offline: 'Couldn’t reach Navi from this preview. Sign-up works on the live site.' }[state];
  return (
    <form className="email" onSubmit={submit}>
      <label htmlFor={id} className="sr">Email address</label>
      <input id={id} name="email" type="email" required placeholder="you@example.com" disabled={state === 'sent'} />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 0, height: 0, opacity: 0 }} />
      <button className="btn-pill" type="submit" disabled={state === 'sending' || state === 'sent'}>{state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : label}</button>
      {note && <span className="email-note" role="status">{note}</span>}
    </form>
  );
}

// ---------- nav ----------
export const NAV = [['/how-it-works', 'How it works'], ['/features', 'Features'], ['/guides', 'Guides'], ['/privacy-and-control', 'Privacy'], ['/about', 'About']];
const isActive = (path, p) => path === p || path.startsWith(p + '/');

export function Nav({ path }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle('drawer-open', open);
    if (!open) return;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [open]);
  return (
    <header className={`nav${open ? ' is-open' : ''}`}>
      <div className="nav-fade" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="container nav-inner">
        <a href={href('/')} className="wordmark" aria-label="Navi home"><I.Wordmark /></a>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map(([p, l]) => <a key={p} href={href(p)} aria-current={isActive(path, p) ? 'page' : undefined}>{l}</a>)}
        </nav>
        <div className="nav-right">
          <a href="/login" className="nav-signin">Sign in</a>
          <a href="#start" className="btn-pill sm nav-join">Join early access</a>
          <button className="nav-menu" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="nav-drawer" onClick={() => setOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? <path d="M4 4l10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : <path d="M2.5 6h13M2.5 12h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
            </svg>
          </button>
        </div>
      </div>
      <div className="drawer" id="nav-drawer" hidden={!open}>
        <nav aria-label="Menu">
          <a href={href('/')} aria-current={path === '/' ? 'page' : undefined}>Home</a>
          {NAV.map(([p, l]) => <a key={p} href={href(p)} aria-current={isActive(path, p) ? 'page' : undefined}>{l}</a>)}
        </nav>
        <div className="drawer-foot">
          <a href="#start" className="btn-pill" onClick={() => setOpen(false)}>Join early access</a>
          <a href="/login" className="drawer-signin">Sign in</a>
        </div>
      </div>
    </header>
  );
}

// ---------- page building blocks ----------
export function PageHero({ image, eyebrow, title, lead, children }) {
  return (
    <section className="ph">
      {image && <div className="ph-sky" style={{ backgroundImage: `url(${img(image)})` }} aria-hidden="true" />}
      <div className="container ph-inner">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="serif ph-h">{title}</h1>
        {lead && <p className="lead ph-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

export function Faq({ items, title = 'Questions' }) {
  return (
    <section className="faq">
      <div className="container faq-grid">
        <h2 className="serif ch-title">{title}</h2>
        <div className="faq-list">
          {items.map(([q, a]) => (
            <details key={q}>
              <summary>{q}<span aria-hidden="true" /></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Close({ title = <>Begin with one <em>conversation</em>.</>, body = 'Tell Navi about your week. It builds the plan and keeps it current.' }) {
  return (
    <section className="close" id="start">
      <div className="close-horizon" style={{ backgroundImage: `url(${img('wall-dawn.jpg')})` }} aria-hidden="true" />
      <div className="container close-inner reveal">
        <h2 className="serif close-h">{title}</h2>
        <p className="body">{body}</p>
        <EmailPill id="email-close" />
      </div>
    </section>
  );
}

export function Footer() {
  const cols = [
    ['Product', [['/how-it-works', 'How it works'], ['/features', 'Features'], ['/guides', 'Guides']]],
    ['Company', [['/about', 'About'], [`mailto:${CONTACT}`, 'Contact']]],
    ['Legal', [['/privacy-and-control', 'Privacy & control'], ['/terms', 'Terms']]],
  ];
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div><I.Wordmark /><p className="muted">A personal operating system for calmer weeks.</p></div>
          {cols.map(([h, ls]) => <div key={h}><h4 className="mono">{h}</h4>{ls.map(([p, l]) => <a href={p.startsWith('/') ? href(p) : p} key={l}>{l}</a>)}</div>)}
        </div>
        <div className="footer-bottom mono"><span>© 2026 Navi</span><span>Made for people with too many tabs open</span></div>
      </div>
    </footer>
  );
}

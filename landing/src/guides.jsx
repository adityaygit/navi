import React, { useMemo, useState } from 'react';
import * as I from './icons.jsx';
import { PageHero, Close, href, CONTACT } from './site.jsx';

// Guides: illustrative screens (the app UI is being redesigned, so these show the intended flow, not pixel-exact screens).

function Phone({ title, back = 'Settings', children }) {
  return (
    <div className="mk" aria-hidden="true">
      <div className="mk-status"><span>9:41</span><span className="mk-island" /><span>●●●</span></div>
      <div className="mk-bar">{back && <span className="mk-back"><I.Chevron dir="left" size={12} />{back}</span>}<b>{title}</b></div>
      <div className="mk-body">{children}</div>
    </div>
  );
}
const Toggle = ({ on }) => <span className={`mk-tg${on ? ' on' : ''}`}><i /></span>;
const Row = ({ label, sub, right, hl }) => <div className={`mk-row${hl ? ' hl' : ''}`}><div><span>{label}</span>{sub && <small>{sub}</small>}</div>{right}</div>;

const SCREENS = {
  install: (
    <Phone title="meetnavi.app" back={null}>
      <div className="mk-page"><I.Logo /><b>Navi</b><small>Signed in as you@example.com</small></div>
      <div className="mk-sheet">
        <div className="mk-sheet-h">Share</div>
        <Row label="Copy" right={<I.Bookmark size={16} />} />
        <Row label="Add to Reading List" right={<I.Bookmark size={16} />} />
        <Row hl label="Add to Home Screen" right={<I.Plus size={16} />} />
        <Row label="Find on Page" right={<I.Search size={16} />} />
      </div>
    </Phone>
  ),
  notifications: (
    <Phone title="Notifications">
      <div className="mk-group">
        <Row label="Notifications on this iPhone" sub="Allowed" right={<Toggle on />} hl />
      </div>
      <div className="mk-label">Send me</div>
      <div className="mk-group">
        <Row label="Morning briefing" sub="06:00" right={<Toggle on />} />
        <Row label="Evening check-in" sub="21:00" right={<Toggle on />} />
        <Row label="Deadline reminders" right={<Toggle on />} />
        <Row label="Weekly review" sub="Sundays" right={<Toggle />} />
      </div>
      <span className="mk-btn ghost">Send a test notification</span>
    </Phone>
  ),
  voice: (
    <Phone title="Navi" back="Today">
      <div className="mk-msg me">Move the gym to tomorrow morning and push the budget draft to after lunch.</div>
      <div className="mk-msg">Done. Gym is tomorrow 07:00. Budget draft moved to 14:00–16:00. Your 15:00 call stays where it is.</div>
      <div className="mk-voice"><span className="mk-wave">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${6 + ((i * 7) % 16)}px` }} />)}</span><span>Listening…</span><span className="mk-btn sm">Done</span></div>
    </Phone>
  ),
  quiet: (
    <Phone title="Quiet hours">
      <div className="mk-group">
        <Row label="Quiet hours" right={<Toggle on />} />
        <Row label="From" right={<b className="mk-val">22:00</b>} hl />
        <Row label="Until" right={<b className="mk-val">07:00</b>} hl />
      </div>
      <div className="mk-label">Days</div>
      <div className="mk-days">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className={i < 7 ? 'on' : ''}>{d}</span>)}</div>
      <div className="mk-group"><Row label="Let deadline reminders through" right={<Toggle />} /></div>
    </Phone>
  ),
  week: (
    <Phone title="Your first week" back="Today">
      {[['Mon', 'Setup conversation', true], ['Mon', 'Review the proposal', true], ['Tue', 'First morning briefing', true], ['Tue', 'First evening check-in', false], ['Wed–Sat', 'Capture, plan, check in', false], ['Sun', 'First weekly review', false]].map(([d, t, done]) => (
        <div className={`mk-step${done ? ' done' : ''}`} key={t}><span className="mk-dot">{done && <I.Check size={11} />}</span><div><small>{d}</small><span>{t}</span></div></div>
      ))}
    </Phone>
  ),
  inbox: (
    <Phone title="Inbox" back="Today">
      <div className="mk-card">
        <small>From your voice note · 08:12</small>
        <b>Call the dentist about Friday</b>
        <q>“oh and I need to call the dentist before Friday”</q>
        <div className="mk-actions"><span className="mk-btn sm">Add</span><span className="mk-btn sm ghost">Edit</span><span className="mk-btn sm ghost">Skip</span></div>
      </div>
      <div className="mk-card dim">
        <small>From chat · yesterday</small>
        <b>Send Sam the deck notes</b>
        <div className="mk-actions"><span className="mk-btn sm ghost">Merge with “Deck review”</span></div>
      </div>
    </Phone>
  ),
  review: (
    <Phone title="Weekly review" back="Today">
      <div className="mk-stats"><div><b>9/10</b><small>kept</small></div><div><b>11.5h</b><small>focus</small></div><div><b>4</b><small>rest blocks</small></div></div>
      <div className="mk-label">Slipped</div>
      <div className="mk-card"><b>Budget draft</b><small>Reason: took longer than estimated</small></div>
      <div className="mk-label">Next week</div>
      <div className="mk-card"><b>Plan 3h for the budget, not 2h</b><div className="mk-actions"><span className="mk-btn sm">Accept</span><span className="mk-btn sm ghost">Change</span></div></div>
    </Phone>
  ),
  broke: (
    <Phone title="Today" back={null}>
      <div className="mk-label">What happened?</div>
      <div className="mk-group">
        <Row label="I’m running late" />
        <Row label="Something urgent came up" hl />
        <Row label="I need to rest" />
      </div>
      <div className="mk-label">New plan for the rest of today</div>
      <div className="mk-card"><small>15:00 · fixed</small><b>Client call</b></div>
      <div className="mk-card"><small>16:30 · moved from 14:00</small><b>Budget draft</b></div>
      <span className="mk-btn">Use this plan</span>
    </Phone>
  ),
  data: (
    <Phone title="Your data">
      <div className="mk-group">
        <Row label="Export all my data" sub="One file with everything" right={<I.Arrow size={16} />} hl />
      </div>
      <div className="mk-label">Memory</div>
      <div className="mk-group"><Row label="See what Navi remembers" right={<I.Chevron dir="right" />} /></div>
      <div className="mk-label">Danger zone</div>
      <div className="mk-group"><Row label={<span className="mk-danger">Delete account</span>} sub="Type DELETE to confirm" /></div>
    </Phone>
  ),
};

export const GUIDES = [
  { slug: 'install-on-iphone', cat: 'Getting started', mins: 2, screen: 'install', title: 'Add Navi to your iPhone home screen', summary: 'Install Navi from Safari so it opens full screen and can send notifications.',
    steps: [['Open Navi in Safari', 'Go to meetnavi.app in Safari and sign in. Other browsers on iPhone can’t install web apps.'], ['Tap Share', 'It’s the square with an arrow at the bottom of the screen.'], ['Tap Add to Home Screen', 'Scroll down the list if you don’t see it. Keep the name “Navi” and tap Add.'], ['Open Navi from your home screen', 'From now on, use the icon. It opens full screen and stays signed in.']],
    tips: ['Notifications on iPhone only work once Navi is on your home screen.', 'On Android, open the browser menu and choose Install app.'] },
  { slug: 'notifications', cat: 'Getting started', mins: 2, screen: 'notifications', title: 'Turn on notifications', summary: 'Get your morning briefing, evening check-in and reminders as notifications.',
    steps: [['Open Settings → Notifications', 'In Navi, tap your profile, then Notifications.'], ['Turn on notifications for this device', 'Your phone asks for permission. Tap Allow.'], ['Choose what to get', 'Briefings, check-ins, deadline reminders and the weekly review each have their own switch.'], ['Send a test', 'Tap Send a test notification to check it arrives.']],
    tips: ['Each device is set up separately, so turn it on for your laptop too if you want it there.', 'Nothing is sent during your quiet hours.'] },
  { slug: 'first-week', cat: 'Getting started', mins: 4, screen: 'week', title: 'Your first week with Navi', summary: 'What to expect from setup to your first weekly review.',
    steps: [['Day one: the setup conversation', 'Tell Navi about work, commitments, goals and routines. Ten to fifteen minutes is plenty.'], ['Day one: review the proposal', 'Keep, edit or skip each item. Your first plan appears once you accept.'], ['Every morning and evening', 'Read the morning briefing. At night, mark what happened. This is what makes tomorrow’s plan better.'], ['End of the week: your first review', 'See what you kept and what slipped, and accept the changes that make sense.']],
    tips: ['The first few days are the least accurate. Navi learns from every check-in.', 'You can redo the setup conversation from Settings at any time.'] },
  { slug: 'voice', cat: 'Everyday', mins: 2, screen: 'voice', title: 'Talk to Navi by voice', summary: 'Plan, capture and change things out loud, in real time.',
    steps: [['Tap the microphone', 'It’s at the bottom of every screen. The microphone only turns on when you tap.'], ['Talk normally', 'Say what you want, the way you’d say it to a person: “move the gym to tomorrow”.'], ['Interrupt any time', 'Start talking while Navi is speaking and it stops to listen.'], ['Tap Done', 'The conversation is saved as text in your history, next to your typed messages.']],
    tips: ['Navi keeps the transcript, not the recording.', 'Headphones help in noisy places.'] },
  { slug: 'review-inbox', cat: 'Everyday', mins: 2, screen: 'inbox', title: 'Clear your review inbox', summary: 'Decide what happens to the commitments Navi notices.',
    steps: [['Open Inbox', 'New suggestions show a count next to Inbox.'], ['Read where it came from', 'Each card shows your original words and when you said them.'], ['Add, edit, merge or skip', 'Add makes it a task. Edit lets you fix it first. Merge joins it to a task you already have. Skip removes it.']],
    tips: ['Nothing in the inbox is part of your plan until you add it.', 'Clearing it once a day takes under a minute.'] },
  { slug: 'when-plans-break', cat: 'Everyday', mins: 2, screen: 'broke', title: 'When your day falls apart', summary: 'Re-plan the rest of the day in a few taps.',
    steps: [['Tap My plan broke', 'It’s on the Today screen.'], ['Say what happened', 'Running late, something urgent, or you need rest. Add a note if you like.'], ['Check the new plan', 'Fixed commitments stay put. Flexible work moves into the time that’s left, or to tomorrow.'], ['Tap Use this plan', 'Or adjust anything first.']],
    tips: ['A broken day isn’t a failure in your review. Navi records the reason.'] },
  { slug: 'quiet-hours', cat: 'Everyday', mins: 1, screen: 'quiet', title: 'Set quiet hours', summary: 'Choose when Navi stays silent.',
    steps: [['Open Settings → Quiet hours', 'Turn quiet hours on.'], ['Pick the hours', 'For example 22:00 until 07:00.'], ['Choose the days', 'Every day, or just some.'], ['Decide about deadlines', 'Leave deadline reminders off to keep quiet hours completely quiet.']],
    tips: ['A briefing due during quiet hours is sent when they end.'] },
  { slug: 'weekly-review', cat: 'Reviews', mins: 3, screen: 'review', title: 'Do your weekly review', summary: 'Ten minutes that make next week easier.',
    steps: [['Open the review', 'Navi sends it on the day you chose. You can also open it from Today.'], ['Look at what you kept', 'Commitments kept, focus hours and protected rest.'], ['Read what slipped and why', 'Each miss shows the reason you gave, or asks for one.'], ['Accept or change the proposals', 'Navi suggests specific changes, like longer estimates or a different day. Pick the ones that fit.']],
    tips: ['Change your review day in Settings → Briefings & reviews.'] },
  { slug: 'export-or-delete', cat: 'Your data', mins: 1, screen: 'data', title: 'Export or delete your data', summary: 'Download everything, or remove your account for good.',
    steps: [['Open Settings → Your data', 'Everything about your data lives here.'], ['Export all my data', 'You get one file with your plans, tasks, conversations and memories.'], ['Delete your account', 'Type DELETE to confirm. Your account and everything in it is removed permanently.']],
    tips: ['Export first if you might want your history later. Deleting can’t be undone.'] },
];
const CATS = ['All', ...new Set(GUIDES.map((g) => g.cat))];

export function Guides() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return GUIDES.filter((g) => (cat === 'All' || g.cat === cat) && (!t || (g.title + ' ' + g.summary + ' ' + g.steps.flat().join(' ')).toLowerCase().includes(t)));
  }, [q, cat]);
  return (
    <>
      <PageHero image="page-guides.jpg" eyebrow="Guides" title={<>Short guides for<br />getting things <em>done</em>.</>} lead="How to install Navi, talk to it, and get the most out of your briefings and reviews.">
        <div className="gsearch">
          <I.Search size={16} />
          <label htmlFor="guide-q" className="sr">Search the guides</label>
          <input id="guide-q" type="search" placeholder="Search the guides" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </PageHero>
      <section className="glist">
        <div className="container">
          <div className="gcats" role="group" aria-label="Filter by topic">
            {CATS.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          {list.length ? (
            <div className="gcards">
              {list.map((g) => (
                <a className="gcard" key={g.slug} href={href('/guides/' + g.slug)}>
                  <small>{g.cat} · {g.mins} min</small>
                  <h2>{g.title}</h2>
                  <p>{g.summary}</p>
                  <span className="gcard-go">Read the guide <I.Arrow size={14} /></span>
                </a>
              ))}
            </div>
          ) : (
            <div className="gempty"><h2>No guide matches “{q}”.</h2><p>Try another word, or email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we’ll write one.</p></div>
          )}
        </div>
      </section>
      <Close title={<>Ready when <em>you</em> are.</>} body="Join early access and try it on your own week." />
    </>
  );
}

export function Guide({ slug }) {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) return <Guides />;
  const related = GUIDES.filter((x) => x.cat === g.cat && x.slug !== g.slug).slice(0, 3);
  return (
    <>
      <section className="gpage">
        <div className="container">
          <a className="crumb" href={href('/guides')}><I.Chevron dir="left" size={12} />All guides</a>
          <div className="gpage-grid">
            <div>
              <p className="eyebrow">{g.cat} · {g.mins} min</p>
              <h1 className="serif gpage-h">{g.title}</h1>
              <p className="lead">{g.summary}</p>
              <ol className="gsteps">
                {g.steps.map(([t, b]) => <li key={t}><h2>{t}</h2><p>{b}</p></li>)}
              </ol>
              {g.tips?.length > 0 && <div className="gtips"><h3>Good to know</h3><ul>{g.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>}
            </div>
            <figure className="gscreen">
              {SCREENS[g.screen]}
              <figcaption>Illustration. Screens may look slightly different in the app.</figcaption>
            </figure>
          </div>
          {related.length > 0 && (
            <div className="grelated">
              <h2>More in {g.cat}</h2>
              <div className="gcards">
                {related.map((r) => <a className="gcard" key={r.slug} href={href('/guides/' + r.slug)}><small>{r.mins} min</small><h2>{r.title}</h2><p>{r.summary}</p></a>)}
              </div>
            </div>
          )}
          <p className="ghelp">Still stuck? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        </div>
      </section>
    </>
  );
}

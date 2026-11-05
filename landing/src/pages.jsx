import React from 'react';
import * as I from './icons.jsx';
import { PageHero, Faq, Close, href, CONTACT } from './site.jsx';
import { SetupTranscript, SetupProposal, WeekPlanner, VoiceLog, BriefingVis, InboxVis, MemoryVis, ReviewSheet, ControlTable } from './product.jsx';

// Two-column row used on the content pages: words on one side, a product visual on the other.
function Row({ id, eyebrow, title, children, vis, flip }) {
  return (
    <section id={id} className={`prow${flip ? ' flip' : ''}`}>
      <div className="container prow-grid">
        <div className="prow-text reveal">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="serif prow-h">{title}</h2>
          {children}
        </div>
        {vis && <div className="prow-vis reveal">{vis}</div>}
      </div>
    </section>
  );
}
const Bullets = ({ items }) => <ul className="ticks">{items.map((t) => <li key={t}><I.Check size={14} />{t}</li>)}</ul>;

// ---------- How it works ----------
export function HowItWorks() {
  return (
    <>
      <PageHero image="page-how.jpg" eyebrow="How it works" title={<>From one conversation<br />to a calmer <em>week</em>.</>} lead="Navi learns how your life is set up, proposes a plan you check line by line, then keeps that plan honest every day." />
      <Row eyebrow="Step 1 · About ten minutes" title="Tell Navi about your life." vis={<SetupTranscript />}>
        <p className="body">Talk or type, whichever is easier. Navi asks about your work hours, the things that can’t move, what you’re trying to get done, and when you have energy. You can ramble. It sorts it out.</p>
        <Bullets items={['Voice and text share one history', 'Skip any question you don’t want to answer', 'Come back and add more whenever you like']} />
      </Row>
      <Row flip eyebrow="Step 2 · You decide" title="Check what it proposes." vis={<SetupProposal />}>
        <p className="body">Navi lays out the workspaces, projects, routines, goals and commitments it heard, each with the words it came from. Keep, edit or skip each one. Nothing is created until you say so.</p>
        <Bullets items={['Every item shows the sentence it came from', 'Edit names, times and estimates before you accept', 'Skipped items are forgotten, not stored']} />
      </Row>
      <Row eyebrow="Step 3 · Your first plan" title="Get a plan built around what can’t move." vis={<WeekPlanner />}>
        <p className="body">Fixed commitments stay where they are. Flexible work fills the open time around them, with focus blocks for deep work and recovery time so the day stays doable.</p>
      </Row>
      <Row flip eyebrow="Every day" title="A briefing in the morning, a check-in at night." vis={<BriefingVis />}>
        <p className="body">At 06:00 Navi tells you what today looks like. At 21:00 it asks how it went and adjusts tomorrow. Both times are yours to change, and nothing arrives during your quiet hours.</p>
        <Bullets items={['Capture anything by voice or text, any time', 'New promises Navi notices wait in your inbox for review', 'If the day breaks, Navi re-plans the rest of it']} />
      </Row>
      <Row eyebrow="Every week" title="A review that’s strict, but fair." vis={<ReviewSheet />}>
        <p className="body">Once a week Navi shows what you kept, what slipped and why, then proposes specific changes. Patterns it notices become memories you can read, correct or delete.</p>
      </Row>
      <Faq items={[
        ['How long does setup take?', 'Most people finish the first conversation in ten to fifteen minutes. You can stop halfway and pick up later.'],
        ['Do I have to talk out loud?', 'No. Typing works exactly the same, and both end up in the same history.'],
        ['What if Navi gets something wrong?', 'Edit or skip it in the proposal. After that, anything can be changed in the app, and recent changes can be undone from your activity.'],
        ['Will Navi do things without asking?', 'It can rearrange your own plan within the limits you set. Anything that reaches other people, or moves something fixed, waits for your approval.'],
        ['Can I change the briefing times?', 'Yes. Morning and evening times, quiet hours and your weekly review day are all in Settings.'],
      ]} />
      <Close />
    </>
  );
}

// ---------- Features ----------
const FEATURES = [
  ['planner', 'Planner', 'Fixed things stay fixed.', 'A day and week planner that knows the difference between a meeting and a task you could do any time. Flexible work moves around commitments, and focus and recovery time get protected blocks.', ['Fixed vs. flexible commitments', 'Focus blocks for deep work', 'Recovery time that doesn’t get scheduled over'], <WeekPlanner key="v" />],
  ['voice', 'Voice', 'Talk it through, out loud.', 'Real-time, two-way voice. Interrupt whenever you like. Say “move the gym to tomorrow” and watch it happen. Voice and text share one conversation.', ['Real-time conversation, not dictation', 'Transcripts saved, raw audio not kept', 'Works from the home screen on your phone'], <VoiceLog key="v" />],
  ['accountability', 'Accountability', 'Strict, but fair.', 'Navi compares the plan with what really happened, names what slipped and asks why. It never guilt-trips and always offers a next step.', ['Honest scoring of kept commitments', 'Reasons recorded, not just misses', 'Promises at risk flagged early'], <ReviewSheet key="v" />],
  ['briefings', 'Briefings & reviews', 'Start and end the day on purpose.', 'A morning briefing, an evening check-in and a weekly review, at times you choose. Quiet hours are always respected.', ['06:00 and 21:00 by default', 'Weekly review on the day you pick', 'Push notifications, only if you opt in'], <BriefingVis key="v" />],
  ['memory', 'Memory', 'Memory you can read and edit.', 'Everything Navi knows about you sits in one plain list, with where it learned it. Change a line and the plan follows.', ['Every memory shows its source', 'Correct or delete anything', 'Rejected memories are never used'], <MemoryVis key="v" />],
  ['inbox', 'Review inbox', 'New promises wait for your yes.', 'Commitments Navi picks out of your notes, voice captures and chats land here as suggestions. Add, edit, merge or skip them.', ['Nothing is added without review', 'Your original words are kept', 'Merge duplicates in one tap'], <InboxVis key="v" />],
];
export function Features() {
  return (
    <>
      <PageHero image="page-features.jpg" eyebrow="Features" title={<>Everything a week<br />needs. <em>Nothing</em> it doesn’t.</>} lead="Planning, voice, reviews and memory in one place, sharing the same picture of your life.">
        <nav className="chips" aria-label="Features on this page">
          {FEATURES.map(([id, name]) => <a key={id} href={`#${id}`}>{name}</a>)}
          <a href="#phone">On your phone</a>
        </nav>
      </PageHero>
      {FEATURES.map(([id, eyebrow, title, body, bullets, vis], i) => (
        <Row key={id} id={id} eyebrow={eyebrow} title={title} vis={vis} flip={i % 2 === 1}>
          <p className="body">{body}</p>
          <Bullets items={bullets} />
        </Row>
      ))}
      <section id="phone" className="phone-band">
        <div className="container">
          <p className="eyebrow">On your phone</p>
          <h2 className="serif ch-title">Lives on your home screen.</h2>
          <div className="facts">
            {[[I.Phone, 'Install from Safari', 'Add Navi to your iPhone home screen. It opens full screen, like any other app.'], [I.Cloud, 'Capture offline', 'Write something down on the train. It syncs as soon as you’re back online.'], [I.Bell, 'Notifications you opt into', 'Briefings and reminders arrive as notifications, never inside quiet hours.']].map(([Ic, t, b]) => (
              <div className="fact" key={t}><Ic size={18} /><h3>{t}</h3><p>{b}</p></div>
            ))}
          </div>
        </div>
      </section>
      <section className="later">
        <div className="container later-grid">
          <div>
            <p className="eyebrow">Not yet</p>
            <h2 className="serif prow-h">Coming later.</h2>
            <p className="body">We’d rather tell you now than have you find out after signing up.</p>
          </div>
          <ul className="later-list">
            <li><b>Calendar and email connections</b><span>Navi can’t read or write your Google or Outlook calendar or inbox yet.</span></li>
            <li><b>Google sign-in</b><span>For now you sign in with your email.</span></li>
            <li><b>App Store apps</b><span>Navi runs as a web app you install from the browser.</span></li>
          </ul>
        </div>
      </section>
      <Close />
    </>
  );
}

// ---------- Privacy & control ----------
export function Privacy() {
  const blocks = [
    ['What Navi keeps', ['Your account email', 'Your plans, tasks, projects, goals and routines', 'Your conversations with Navi, including voice transcripts', 'Memories, each with where Navi learned it', 'A log of what changed and who changed it, so it can be undone']],
    ['What Navi never keeps', ['Raw voice recordings. Audio is turned into text and discarded', 'Your password in readable form', 'Anything you skipped during setup']],
    ['Who can see it', ['Only you. Each person’s data is walled off at the database level', 'Navi is invite-only while in early access', 'Nobody at Navi reads your plans or conversations to improve the product']],
    ['Who processes it', ['Text conversations are processed by Anthropic’s Claude API', 'Voice conversations are processed by Google’s Gemini API', 'Only what’s needed to answer is sent, and it isn’t used to advertise to you']],
  ];
  return (
    <>
      <PageHero image="page-privacy.jpg" eyebrow="Privacy & control" title={<>Your life is <em>yours</em>.<br />Navi just helps run it.</>} lead="What Navi stores, who can see it, and the things it will never do without asking you first." />
      <section className="pblocks">
        <div className="container pblocks-grid">
          {blocks.map(([h, items]) => (
            <article className="pblock reveal" key={h}>
              <h2>{h}</h2>
              <ul>{items.map((t) => <li key={t}>{t}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>
      <Row eyebrow="Approval" title="Anything that leaves Navi waits for your yes." vis={<ControlTable />}>
        <p className="body">Navi works on its own inside your plan: moving flexible tasks, protecting focus time, drafting tomorrow. Anything that reaches other people, costs money, or moves something fixed is shown to you first.</p>
      </Row>
      <section className="pcontrols">
        <div className="container">
          <p className="eyebrow">Your controls</p>
          <h2 className="serif ch-title">Change your mind any time.</h2>
          <div className="facts">
            {[[I.Moon, 'Quiet hours', 'Pick the hours when Navi stays silent. Briefings wait until they end.'], [I.Lock, 'Export everything', 'Download all of your data as one file whenever you like.'], [I.Mic, 'Delete your account', 'Permanently removes your account and everything in it.']].map(([Ic, t, b]) => (
              <div className="fact" key={t}><Ic size={18} /><h3>{t}</h3><p>{b}</p></div>
            ))}
          </div>
          <div className="report">
            <div><h3>Found a security problem?</h3><p>Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We’ll get back to you quickly.</p></div>
            <a className="btn-ghost" href={href('/terms')}>Read the terms</a>
          </div>
        </div>
      </section>
      <Close />
    </>
  );
}

// ---------- About ----------
export function About() {
  const principles = [
    ['You check it before it exists.', 'Navi proposes. You decide. Nothing in your life gets created, moved or sent on a guess.'],
    ['Fixed things are fixed.', 'A plan that ignores your real commitments isn’t a plan. Navi builds around what can’t move.'],
    ['Strict, but fair.', 'Being honest about what slipped is kind. Guilt isn’t. Every miss comes with a next step.'],
    ['Rest is part of the plan.', 'Recovery time is scheduled and protected like anything else.'],
    ['Say what’s missing.', 'If Navi can’t do something yet, it says so, here and in the app.'],
  ];
  return (
    <>
      <PageHero image="page-about.jpg" eyebrow="About" title={<>Most plans don’t fail.<br />They just stop being <em>true</em>.</>} lead="Calendars, to-do lists and notes each hold a piece of your week. None of them notice when the day changes. Navi exists to keep one plan true from Monday to Sunday." />
      <section className="principles">
        <div className="container">
          <p className="eyebrow">What we believe</p>
          <div className="pr-list">
            {principles.map(([t, b]) => <div className="pr reveal" key={t}><h3 className="serif">{t}</h3><p>{b}</p></div>)}
          </div>
        </div>
      </section>
      <section className="access">
        <div className="container">
          <p className="eyebrow">Early access</p>
          <h2 className="serif ch-title">Opening to a small group at a time.</h2>
          <ol className="access-steps">
            <li><b>Ask for access</b><span>Leave your email. You’ll get a link to a short form.</span></li>
            <li><b>Tell us a little about you</b><span>Five quick questions about how you’d use Navi. About two minutes.</span></li>
            <li><b>Get your invite</b><span>When there’s room, you’ll get an email with a link that signs you straight in.</span></li>
          </ol>
          <div className="report">
            <div><h3>Say hello</h3><p>Questions, ideas or a bug: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p></div>
          </div>
        </div>
      </section>
      <Close />
    </>
  );
}

// ---------- Terms (placeholder) ----------
const TERMS = [
  ['Using Navi', 'By creating an account or using Navi, you agree to these terms. If you don’t agree, please don’t use Navi. You need to be old enough to enter a contract where you live.'],
  ['Early access', 'Navi is in early access. Features may change, break or be removed, and access is by invitation. We may pause or end early access at any time. During early access, Navi is free.'],
  ['Your account', 'Keep your sign-in details to yourself and tell us if you think someone else has used your account. You’re responsible for what happens under your account.'],
  ['Your content', 'You own what you put into Navi: your plans, notes, conversations and memories. You give us permission to store and process it only so we can run Navi for you. You can export or delete it at any time.'],
  ['AI output', 'Navi uses AI models to plan, summarise and suggest. They can be wrong. Check anything important, and don’t treat Navi as medical, legal, financial or other professional advice.'],
  ['Acceptable use', 'Don’t use Navi to break the law, harm others, try to get into accounts or systems that aren’t yours, overload the service, or copy or resell it.'],
  ['Third-party services', 'Navi relies on outside providers, including Anthropic and Google for AI processing. Their part of the service is also covered by their own terms.'],
  ['Ending things', 'You can stop using Navi and delete your account whenever you like. We may suspend or close accounts that break these terms.'],
  ['No guarantees', 'Navi is provided “as is”, without warranties of any kind. To the extent the law allows, we aren’t liable for indirect or consequential losses, or for missed plans or commitments.'],
  ['Changes', 'We may update these terms. If the change is significant, we’ll tell you by email or in the app before it takes effect.'],
  ['Contact', `Questions about these terms: ${CONTACT}`],
];
export function Terms() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms of use" lead="Last updated 5 November 2026." />
      <section className="doc">
        <div className="container">
          <p className="draft" role="note"><b>Draft.</b> These are placeholder terms written in plain language. They haven’t been reviewed by a lawyer and will be replaced before Navi opens more widely.</p>
          {TERMS.map(([h, b], i) => <div className="doc-sec" key={h}><h2>{i + 1}. {h}</h2><p>{b}</p></div>)}
          <p className="doc-more">See also <a href={href('/privacy-and-control')}>Privacy &amp; control</a>.</p>
        </div>
      </section>
    </>
  );
}

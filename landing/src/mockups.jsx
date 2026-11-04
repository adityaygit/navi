// Navi product mockups drawn with HTML/SVG (no screenshots).
import React from 'react';
import * as I from './icons.jsx';

function walk(n, seed, trend = 1, vol = 1) {
  let s = seed * 7919 + 13; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts = []; let v = 0;
  for (let i = 0; i < n; i++) { v += (r() - 0.47) * vol + trend * 0.02; pts.push(v); }
  return pts;
}
export function LineChart({ w, h, x = 0, y = 0, seed = 1, trend = 1, color = '#ddd', n = 120, vol = 1, width = 1.3, fill, style }) {
  const p = walk(n, seed, trend, vol);
  const min = Math.min(...p), max = Math.max(...p);
  const d = p.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * h).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} style={{ position: x || y ? 'absolute' : 'static', left: x, top: y, overflow: 'visible', ...style }} aria-hidden="true">
      {fill && <path d={`${d}L${w},${h}L0,${h}Z`} fill={fill} />}
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" />
    </svg>
  );
}

const AREAS = [['Health', '+12%', 0.8], ['Work', '+8%', 0.7], ['Home', '+6%', 0.55], ['Learning', '+5%', 0.5], ['Friends', '-2%', 0.3], ['Admin', '-4%', 0.25], ['Money', '-6%', 0.2], ['Rest', '-9%', 0.15]];

export function HeroWindow() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '29px 0 0 27px', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>6h 20m</span>
        <span style={{ fontSize: 15, color: '#cfcfcf', letterSpacing: '-0.02em' }}>4 focus blocks</span>
        <span className="pill-up">+3 done</span>
      </div>
      <div style={{ display: 'flex', gap: 34, marginTop: 4 }} className="ui-meta"><span>Planned today</span><span>Deep work</span></div>
      <LineChart w={370} h={110} x={27} y={88} seed={3} trend={1.2} color="#d8d8d8" width={1.1} />
      <LineChart w={370} h={90} x={27} y={112} seed={9} trend={0.6} color="#6f6f6f" width={1} />
      <div style={{ position: 'absolute', left: 27, top: 232, width: 395, display: 'flex', alignItems: 'center', gap: 12, fontSize: 9.5, color: '#666' }}>
        <span style={{ borderLeft: '2px solid #888', paddingLeft: 6 }}>Focus</span>
        <span style={{ borderLeft: '2px solid #555', paddingLeft: 6 }}>Energy</span>
        <span style={{ borderLeft: '2px solid #a33', paddingLeft: 6, color: '#7a3434' }}>Recovery</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}>{['D', 'W', 'M', 'Q'].map((t) => <span key={t}>{t}</span>)}<span style={{ color: '#ddd', background: '#1c1c1c', borderRadius: 4, padding: '1px 5px' }}>Y</span></span>
      </div>
      <div style={{ position: 'absolute', left: 27, top: 272, width: 395, borderRadius: 10, background: '#0e0e0e', padding: '14px 18px' }}>
        {AREAS.map(([n, d, v]) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', height: 22.4, fontSize: 9.5, color: '#9a9a9a' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid #3a3a3a', marginRight: 8 }} />
            <span style={{ flex: 1 }}>{n}</span>
            <span style={{ width: 44, color: d.startsWith('-') ? '#c05858' : '#4ebe96' }}>{d}</span>
            <span style={{ width: 90, height: 6, borderRadius: 2, background: `repeating-linear-gradient(90deg, ${d.startsWith('-') ? '#5a2a2a' : '#1f4d3c'} 0 2px, transparent 2px 4px)`, opacity: 0.4 + v }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Recap({ tag, color, meta, children, strong, height }) {
  return (
    <div className="ui-card" style={{ height, padding: '24px 28px', background: strong ? 'linear-gradient(100deg,#1d1f24 0%,#15171b 60%,#20242c 100%)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span className="ui-tag"><span className="ui-dot" style={{ background: color }}>{strong ? <I.Logo width="7" height="8" /> : ''}</span>{tag}</span>
        <span className="ui-meta" style={{ marginLeft: 'auto' }}>{meta}</span>
      </div>
      <div style={{ marginTop: 20, fontSize: strong ? 12.5 : 12, lineHeight: strong ? '19.5px' : '20px', fontWeight: strong ? 600 : 400, color: strong ? '#eaeaea' : '#bdbdbd', maxWidth: 450 }}>{children}</div>
    </div>
  );
}

export function HeroCards() {
  return (
    <div className="hero-cards">
      <Recap tag="Morning briefing" color="#e9e9e9" meta="Spoken at 6:00 AM" strong height={150}>
        Three fixed commitments today, starting with the dentist at 9:30. The proposal draft fits best in your 11:00 focus block, and the evening is clear, so a run at six keeps the streak alive. <u style={{ color: '#9a9a9a', fontWeight: 500 }}>Open plan</u>
      </Recap>
      <Recap tag="Work" color="#7aa7ff" meta="Today · Just now" height={131}>
        Proposal draft moved to 11:00 after your call ran long. Two smaller tasks shifted to Thursday so the afternoon stays realistic.
      </Recap>
      <Recap tag="Health" color="#4ebe96" meta="Today · 2 min ago" height={124}>
        Recovery is trending low after three late nights. Navi suggests a lighter afternoon and lights-out by eleven.
      </Recap>
    </div>
  );
}

export function PlannerCard() {
  const blocks = [[0, 18, 'Dentist', '#3b3b3b', 'Fixed'], [26, 30, 'Proposal draft', '#244a3c', 'Focus'], [60, 10, 'Lunch with Ana', '#3b3b3b', 'Fixed'], [74, 14, 'Admin batch', '#2b2f3a', 'Flexible'], [92, 12, 'Run', '#4a2f22', 'Recovery']];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,#1a1a1a 0,#0b0b0b 9%)' }}>
      <div style={{ position: 'absolute', left: 56, top: 50, right: -20, bottom: -10, borderRadius: 12, background: '#0c0c0c', border: '1px solid #1c1c1c', boxShadow: 'rgba(0,0,0,.8) 0 0 44px' }}>
        <div style={{ display: 'flex', gap: 6, padding: '9px 10px' }}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />)}</div>
        <div style={{ padding: '12px 46px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 10 }}>
          <I.Chevron dir="left" size={10} /><span style={{ width: 18, height: 18, borderRadius: 5, background: '#4ebe96', display: 'grid', placeItems: 'center', color: '#000' }}><I.Logo width="8" height="10" /></span>
          <span><b>Tuesday</b><br /><span style={{ color: '#666' }}>November 4</span></span>
        </div>
        <div style={{ padding: '10px 62px 0', fontSize: 15, fontWeight: 600 }}>6h 20m <span style={{ color: '#4ebe96', fontSize: 9 }}>+40m vs plan</span></div>
        <div style={{ position: 'absolute', left: 62, right: 160, top: 130, height: 175 }}>
          {[0, 1, 2, 3, 4].map((k) => <div key={k} style={{ position: 'absolute', left: 0, right: 0, top: k * 40, borderTop: '1px solid #151515', fontSize: 8, color: '#444' }}>{9 + k * 2}:00</div>)}
          {blocks.map(([t, h, n, c, kind], k) => (
            <div key={n} style={{ position: 'absolute', left: 40 + (k % 2) * 8, right: 0, top: t * 1.65, height: h * 1.6, borderRadius: 5, background: c, padding: '3px 8px', fontSize: 8.5, color: '#ddd', display: 'flex', justifyContent: 'space-between' }}><span>{n}</span><span style={{ color: '#8a8a8a' }}>{kind}</span></div>
          ))}
        </div>
        <div style={{ position: 'absolute', right: 0, top: 120, width: 140, height: 180, borderRadius: 10, background: '#000', border: '1px solid #181818', padding: 12, fontSize: 8, color: '#777', lineHeight: '13px' }}>
          <div style={{ color: '#aaa', marginBottom: 10 }}>Briefing</div>
          <div style={{ borderLeft: '2px solid #333', paddingLeft: 8, color: '#bbb' }}>Busy morning, open afternoon. Draft first, errands after three, run at six.</div>
        </div>
        <div style={{ position: 'absolute', left: 62, right: 20, top: 335, height: 44, borderRadius: 8, background: '#101010', display: 'flex', justifyContent: 'space-around', alignItems: 'center', fontSize: 8, color: '#666' }}>
          {[['Tasks', '12'], ['Done', '7'], ['Focus', '3h'], ['Meetings', '2'], ['Energy', 'Med'], ['Sleep', '6.4h'], ['Steps', '8.1k']].map(([a, b]) => <span key={a} style={{ textAlign: 'center' }}>{a}<br /><b style={{ color: '#ddd', fontSize: 9 }}>{b}</b></span>)}
        </div>
      </div>
    </div>
  );
}

const PEOPLE = [['Dinner with Priya', 'Friday, 7:30 PM', 'Keep', 'PS', '#5b6cff'], ['Dentist check-up', 'Tomorrow, 9:30 AM', 'Keep', 'DR', '#2bb673'], ['Gym with Sam', 'Mon · Wed · Fri', 'Move', 'SK', '#e0525f'], ['Pay rent', 'Due Nov 30', 'Keep', 'RT', '#c9a227'], ["Mom's birthday call", 'Sunday', 'Keep', 'MA', '#b83280']];
export function CommitmentsCard() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 60% at 40% 105%, rgba(150,40,50,.55) 0%, rgba(80,20,25,.25) 40%, transparent 70%), #0b0b0b' }}>
      {PEOPLE.map(([n, d, a, ini, c], k) => (
        <div key={n} style={{ position: 'absolute', left: 38, right: 40, top: 44 + k * 103, height: 70, display: 'flex', alignItems: 'center', borderBottom: k < 4 ? '1px solid rgba(255,255,255,.05)' : 0, paddingBottom: 30, boxSizing: 'content-box', opacity: k === 4 ? 0.45 : 1 }}>
          <span style={{ width: 66, height: 66, borderRadius: '50%', display: 'grid', placeItems: 'center', background: k < 4 ? `#1a1a1a url(./img/avatar-${k + 1}.jpg) center/cover` : `radial-gradient(circle at 35% 30%, ${c}, #111 120%)`, fontSize: 18, fontWeight: 600, color: '#fff', border: '2px solid #222', boxShadow: 'rgba(0,0,0,.6) 0 4px 14px' }}>{k < 4 ? '' : ini}</span>
          <span style={{ marginLeft: 22, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{n}</span>
            <span style={{ display: 'block', fontSize: 15, color: '#8a8a8a', marginTop: 4 }}>{d}</span>
          </span>
          <span style={{ padding: '4px 10px', borderRadius: 5, fontSize: 13, fontWeight: 600, background: a === 'Keep' ? 'rgba(78,190,150,.14)' : 'rgba(224,82,95,.16)', color: a === 'Keep' ? '#4ebe96' : '#e0525f' }}>{a}</span>
        </div>
      ))}
    </div>
  );
}

export function BalanceCard({ alt }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0b0b0b' }}>
      <div style={{ position: 'absolute', left: 37, top: 40, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#bdbdbd' }}>
        <span style={{ width: 3, height: 18, background: '#ff9f6a', borderRadius: 2 }} /><span style={{ width: 3, height: 18, background: '#ddd', borderRadius: 2, marginLeft: -4 }} />{alt ? 'Kept commitments' : 'Focus hours'}
      </div>
      <LineChart w={420} h={60} x={37} y={160} seed={alt ? 21 : 5} trend={0.2} vol={1.4} color="#ff9f6a" />
      <LineChart w={420} h={40} x={37} y={320} seed={alt ? 8 : 14} trend={0.8} color="#e6e6e6" />
      <div style={{ position: 'absolute', left: 32, bottom: 34, display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 10, background: '#2a2a2a' }}>
        {(alt ? ['Week', 'Month'] : ['Focus', 'Rest']).map((t) => <span key={t} style={{ padding: '6px 12px', borderRadius: 7, background: '#3a3a3a', fontSize: 12, fontWeight: 600, color: '#ddd' }}>{t}</span>)}
        <span style={{ padding: '0 10px', fontSize: 15 }}>{alt ? 'over time' : 'balance'}</span>
      </div>
    </div>
  );
}

const DAYS = ['Mon 3', 'Tue 4', 'Wed 5', 'Thu 6', 'Fri 7', 'Sat 8', 'Sun 9'];
const EVENTS = [[0, 1, 2, 'Team sync', '#2b2f3a'], [0, 3, 3, 'Deep work', '#1f4d3c'], [1, 0.5, 1.5, 'Dentist', '#3b3b3b'], [1, 2.5, 3, 'Proposal', '#1f4d3c'], [1, 7, 1.2, 'Run', '#4a2f22'], [2, 1, 4, 'Focus: launch plan', '#1f4d3c'], [2, 6, 1, 'Call home', '#3a2b44'], [3, 0, 1.5, 'Admin', '#2b2f3a'], [3, 3, 2, 'Workshop', '#3b3b3b'], [4, 1, 3, 'Deep work', '#1f4d3c'], [4, 5.5, 2, 'Dinner, Priya', '#3a2b44'], [5, 2, 2.5, 'Hike', '#4a2f22'], [6, 3, 1.5, 'Weekly review', '#2b3a4a'], [6, 6, 2, 'Rest', '#4a2f22']];
export function WeekWindow() {
  return (
    <div style={{ position: 'absolute', inset: 0, padding: '22px 26px', fontSize: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>This week</span><span className="ui-meta">Nov 3 – 9</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{['Fixed', 'Flexible', 'Focus', 'Recovery'].map((t, k) => <span key={t} className="ui-tag" style={{ paddingLeft: 8, background: ['#2a2a2a', '#22262f', '#173a2e', '#3a2418'][k] }}>{t}</span>)}</span>
      </div>
      <div style={{ position: 'absolute', left: 26, right: 26, top: 64, bottom: 24, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
        {DAYS.map((d, k) => (
          <div key={d} style={{ position: 'relative', borderRadius: 8, background: k === 1 ? '#0d0f0e' : '#080808', border: '1px solid #141414' }}>
            <div style={{ padding: '8px 10px', color: k === 1 ? '#fff' : '#777', fontWeight: 600 }}>{d}</div>
            {EVENTS.filter((e) => e[0] === k).map(([, s, h, n, c]) => (
              <div key={n + s} style={{ position: 'absolute', left: 6, right: 6, top: 36 + s * 44, height: h * 42, borderRadius: 6, background: c, padding: '6px 8px', color: '#ddd', fontSize: 9.5 }}>{n}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

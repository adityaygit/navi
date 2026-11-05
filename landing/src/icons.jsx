// Monoline icons (1.6px stroke) drawn for this page.
const S = ({ size = 24, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);
export const Logo = (p) => (
  <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true" {...p}>
    <path d="M11 1.5 20 24.5 11 19.2 2 24.5Z" fill="currentColor" />
    <path d="M11 1.5V19.2L2 24.5Z" fill="#000" opacity=".28" />
  </svg>
);
export const Chevron = ({ dir = 'down', size = 12 }) => {
  const d = { down: 'M6 9l6 6 6-6', right: 'M9 6l6 6-6 6', left: 'M15 6l-6 6 6 6' }[dir];
  return <S size={size} strokeWidth="2.2"><path d={d} /></S>;
};
export const Home = (p) => <S {...p}><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" fill="currentColor" stroke="none" /></S>;
export const Compass = (p) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="m15 9-1.8 4.2L9 15l1.8-4.2z" /></S>;
export const Calendar = (p) => <S {...p}><rect x="4.5" y="5.5" width="15" height="14" rx="2" /><path d="M8.5 3.5v3M15.5 3.5v3" /><text x="12" y="16.4" textAnchor="middle" fontSize="7" fontFamily="Instrument Sans, sans-serif" fill="currentColor" stroke="none" fontWeight="600">4</text></S>;
export const Bookmark = (p) => <S {...p}><path d="M6.5 4.5h11v15l-5.5-3.5-5.5 3.5z" /><path d="M10 8.5h4" /></S>;
export const Inbox = (p) => <S {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20" /></S>;
export const Mic = (p) => <S {...p}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3" /></S>;
export const Gear = (p) => <S {...p}><path d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6z" /><circle cx="12" cy="12" r="2.8" /></S>;
export const Search = (p) => <S {...p}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></S>;
export const Play = (p) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="m10.2 8.8 4.6 3.2-4.6 3.2z" /></S>;
export const Close = (p) => <S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>;
export const Sliders = (p) => <S {...p}><path d="M4 8h10M18 8h2M4 16h3M11 16h9" /><circle cx="16" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></S>;
export const Expand = (p) => <S {...p}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></S>;
export const Sparkle = (p) => <S {...p}><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /></S>;
export const Check = (p) => <S {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></S>;
export const Pencil = (p) => <S {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></S>;
export const Arrow = (p) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const Plus = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const Clock = (p) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></S>;
export const Lock = (p) => <S {...p}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></S>;
export const Moon = (p) => <S {...p}><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></S>;
export const Mail = (p) => <S {...p}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></S>;
export const Wordmark = (p) => (
  <svg width="74" height="22" viewBox="0 0 74 22" aria-hidden="true" {...p}>
    <path d="M9 1.5 16.5 20.5 9 16.2 1.5 20.5Z" fill="currentColor" />
    <path d="M9 1.5V16.2L1.5 20.5Z" fill="#000" opacity=".3" />
    <text x="24" y="16.5" fontFamily="Instrument Sans, sans-serif" fontSize="17" fontWeight="600" letterSpacing="-0.3" fill="currentColor">Navi</text>
  </svg>
);

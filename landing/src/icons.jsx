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

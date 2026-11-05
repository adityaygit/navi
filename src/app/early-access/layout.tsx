import Link from "next/link";
import { Instrument_Sans } from "next/font/google";

// Public early-access pages: black, single sans, like the landing page. Font is self-hosted at build time (CSP allows only 'self').
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${sans.className} min-h-dvh bg-black text-[#f2f2f2]`}>
      <header className="mx-auto flex h-16 max-w-xl items-center px-6">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
          <svg width="15" height="18" viewBox="0 0 22 26" aria-hidden="true"><path d="M11 1.5 20 24.5 11 19.2 2 24.5Z" fill="#f2f2f2" /><path d="M11 1.5V19.2L2 24.5Z" fill="#000" opacity=".3" /></svg>
          Navi
        </Link>
      </header>
      <main className="mx-auto max-w-xl px-6 pb-24 pt-16">{children}</main>
    </div>
  );
}

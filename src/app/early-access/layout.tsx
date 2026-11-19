import type { Viewport } from "next";
import Link from "next/link";
import "./sky.css";

export const viewport: Viewport = { themeColor: "#FBFBFD", colorScheme: "light" };

// Public early-access pages, in the website's light "Sky" design.
export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sky">
      <header className="sky-hdr">
        <Link href="/" className="sky-logo" aria-label="Navi home"><span aria-hidden="true" /></Link>
        <Link href="/login" className="sky-btn sky-btn-line" style={{ height: 44, padding: "0 20px", fontSize: 15 }}>Sign in</Link>
      </header>
      {children}
    </div>
  );
}

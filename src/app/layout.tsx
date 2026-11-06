import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

// Instrument Sans, self-hosted (OFL), the same face as the landing page.
const instrument = localFont({
  src: "./fonts/InstrumentSans-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: "Navi",
  description: "Your AI-native personal operating system",
  applicationName: "Navi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Navi", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060608",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next.js can
  // stamp the proxy's CSP nonce onto its inline scripts (static pages can't).
  await headers();
  return (
    <html lang="en" className={instrument.variable}>
      <body className="relative min-h-dvh antialiased">{children}</body>
    </html>
  );
}

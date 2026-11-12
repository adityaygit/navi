import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

// Figtree, self-hosted (OFL, see fonts/Figtree-OFL.txt): the approved Navi 1.5 face.
const figtree = localFont({
  src: "./fonts/Figtree-latin-wght.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-figtree",
});

export const metadata: Metadata = {
  title: "Navi",
  description: "Your AI-native personal operating system",
  applicationName: "Navi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Navi", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: [{ url: "/icons/favicon-32.png", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next.js can
  // stamp the proxy's CSP nonce onto its inline scripts (static pages can't).
  await headers();
  return (
    <html lang="en" className={figtree.variable}>
      <body className="relative min-h-dvh antialiased">{children}</body>
    </html>
  );
}

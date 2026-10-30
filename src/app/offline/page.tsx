import Link from "next/link";

export const metadata = { title: "Offline · Navi" };

// Public, static, contains no personal data: safe to precache.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-5">
      <h1 className="h1">You're offline</h1>
      <p className="muted">Navi needs a connection for this page. Captures you make offline are saved on this device and sync automatically when you reconnect.</p>
      <Link href="/" className="btn btn-primary">Try again</Link>
    </main>
  );
}

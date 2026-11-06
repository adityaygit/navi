import Link from "next/link";
import { Pebble } from "@/components/pebble";

export const metadata = { title: "Offline · Navi" };

// Public, static, contains no personal data: safe to precache.
export default function OfflinePage() {
  return (
    <main className="relative z-[1] mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 px-6 text-center safe-top">
      <Pebble size={88} mood="quiet" />
      <div className="flex flex-col gap-2">
        <h1 className="h1">You&apos;re offline</h1>
        <p className="muted text-[15px] leading-relaxed">Navi needs a connection for this page. Captures you make offline are saved on this device and sync automatically when you reconnect.</p>
      </div>
      <Link href="/" className="btn btn-primary min-w-40">Try again</Link>
    </main>
  );
}

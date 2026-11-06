import Link from "next/link";
import { Pebble } from "@/components/pebble";

/** The landing page's horizon, darkened, behind the public pages (sign-in, early access). */
export function HorizonBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-black">
      <div className="absolute inset-x-0 top-0 h-[min(78vh,760px)] bg-[url(/img/horizon.jpg)] bg-cover bg-[center_70%]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.2)_32%,rgba(0,0,0,0.72)_62%,#000_80%)]" />
    </div>
  );
}

/** Pebble and the Navi wordmark, linking home. */
export function Wordmark({ glow = false }: { glow?: boolean }) {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-[19px] font-semibold tracking-[-0.02em] text-[#f2f2f2]">
      <Pebble size={34} glow={glow} />
      Navi
    </Link>
  );
}

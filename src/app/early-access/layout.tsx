import { HorizonBackdrop, Wordmark } from "../login/backdrop";

// Public early-access pages: black with the landing page's horizon, one card in the middle.
export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh text-[#f2f2f2]">
      <HorizonBackdrop />
      <header className="relative z-[1] mx-auto flex h-16 max-w-xl items-center justify-center px-4 safe-top">
        <Wordmark />
      </header>
      <main className="relative z-[1] mx-auto max-w-[560px] px-4 pb-24 pt-[8vh]">
        <div className="rounded-[20px] border border-white/10 bg-[rgba(10,11,14,0.78)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_40px_100px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-10">{children}</div>
      </main>
    </div>
  );
}

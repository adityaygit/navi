import Link from "next/link";
import { LoginForm } from "./login-form";
import { HorizonBackdrop, Wordmark } from "./backdrop";
import { publicEnv } from "@/lib/env";
import { loginErrorMessage, safeNext } from "@/lib/safe-next";

export const metadata = { title: "Sign in · Navi" };

// Any fixed origin works for the check: a `next` that resolves anywhere else is rejected.
const CHECK_ORIGIN = "https://navi.invalid";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Error codes map to fixed messages; the query string's own text is never shown.
  const errorText = loginErrorMessage(typeof error === "string" ? error : null);
  return (
    <>
      <HorizonBackdrop />
      <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[400px] flex-col items-stretch justify-center gap-7 px-4 py-10 safe-top">
        <div className="flex justify-center"><Wordmark glow /></div>
        <div className="flex flex-col gap-6 rounded-[20px] border border-white/10 bg-[rgba(10,11,14,0.78)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_40px_100px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-8">
          <div className="flex flex-col gap-2 text-center">
            <h1 className="gh text-[28px] font-semibold leading-tight tracking-[-0.03em]">Sign in to Navi</h1>
            <p className="muted text-[15px]">Your personal operating system. Access is invite-only right now.</p>
          </div>
          {errorText && <p role="alert" className="notice notice-danger">{errorText}</p>}
          <LoginForm next={safeNext(typeof next === "string" ? next : null, CHECK_ORIGIN)} googleEnabled={publicEnv.googleAuthEnabled} />
        </div>
        <p className="muted text-center text-sm">
          No invite yet? <Link href="/early-access" className="font-medium text-text underline-offset-4 hover:underline">Request early access</Link>
        </p>
      </main>
    </>
  );
}

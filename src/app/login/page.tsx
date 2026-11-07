import Link from "next/link";
import { LoginForm } from "./login-form";
import { publicEnv } from "@/lib/env";
import { loginErrorMessage, safeNext } from "@/lib/safe-next";
import { naviColorVars } from "@/lib/navi-colors";

export const metadata = { title: "Sign in · Navi" };

// Any fixed origin works for the check: a `next` that resolves anywhere else is rejected.
const CHECK_ORIGIN = "https://navi.invalid";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Error codes map to fixed messages; the query string's own text is never shown.
  const errorText = loginErrorMessage(typeof error === "string" ? error : null);
  return (
    <div className="relative flex min-h-dvh flex-col bg-black" style={naviColorVars(null) as React.CSSProperties}>
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-120px] h-[640px] w-[980px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--navi-text)_8%,transparent)_0%,transparent_65%)]" />
      <main className="relative z-[1] mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center px-4 py-16">
        <LoginForm next={safeNext(typeof next === "string" ? next : null, CHECK_ORIGIN)} googleEnabled={publicEnv.googleAuthEnabled} error={errorText} />
      </main>
      <p className="relative z-[1] pb-10 text-center text-[13px] text-dim">
        Navi is invite-only for now. Not on the list? <Link href="/early-access" className="text-[var(--navi-text)] hover:underline">Join the waitlist</Link>
      </p>
    </div>
  );
}

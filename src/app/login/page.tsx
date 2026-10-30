import { LoginForm } from "./login-form";
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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10 safe-top">
      <div>
        <h1 className="h1">Navi</h1>
        <p className="muted mt-1">Your personal operating system. Access is invite-only right now.</p>
      </div>
      {errorText && <p role="alert" className="notice notice-danger">{errorText}</p>}
      <LoginForm next={safeNext(typeof next === "string" ? next : null, CHECK_ORIGIN)} googleEnabled={publicEnv.googleAuthEnabled} />
    </main>
  );
}

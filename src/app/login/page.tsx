import { LoginForm } from "./login-form";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Sign in · Navi" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10 safe-top">
      <div>
        <h1 className="h1">Navi</h1>
        <p className="muted mt-1">Your personal operating system. Access is invite-only right now.</p>
      </div>
      {error && <p role="alert" className="notice notice-danger">{error}</p>}
      <LoginForm next={next && next.startsWith("/") ? next : "/"} googleEnabled={publicEnv.googleAuthEnabled} />
    </main>
  );
}

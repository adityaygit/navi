import { useEffect } from "react";
import { useSession } from "./auth/useSession";
import { SignIn } from "./auth/SignIn";
import { Shell } from "./shell/Shell";
import { boot } from "./native/boot";

export function App() {
  const session = useSession();
  useEffect(() => {
    if (session !== undefined) void boot();
  }, [session]);
  // Dev-only: look at the signed-in screens in a browser without an account.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview")) return <Shell />;
  if (session === undefined) return null; // the splash is still up
  return session ? <Shell key={session.user.id} /> : <SignIn />;
}

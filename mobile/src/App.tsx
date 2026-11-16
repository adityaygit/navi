import { useCallback, useEffect, useState } from "react";
import { useSession } from "./auth/useSession";
import { SignIn } from "./auth/SignIn";
import { Shell } from "./shell/Shell";
import { setOfflineOwner } from "./data/offline";
import { Opening } from "./shell/Opening";
import { boot } from "./native/boot";

// Plays once per cold launch (a reload in the browser counts as one).
let openingPlayed = false;

export function App() {
  const session = useSession();
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has("preview");
  const skipOpening = preview && new URLSearchParams(location.search).has("noopening");
  const [opening, setOpening] = useState(!openingPlayed && !skipOpening);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (session !== undefined) void boot();
    // The offline queue and cache belong to whoever is signed in.
    setOfflineOwner(session?.user.id ?? (preview ? "preview" : null));
  }, [session, preview]);

  const onReveal = useCallback(() => setRevealing(true), []);
  const onDone = useCallback(() => {
    openingPlayed = true;
    setOpening(false);
  }, []);

  // Dev-only: look at the signed-in screens (or, with ?preview=signin, sign in) in a browser without an account.
  const content = preview ? (new URLSearchParams(location.search).get("preview") === "signin" ? <SignIn /> : <Shell />) : session === undefined ? null : session ? <Shell key={session.user.id} /> : <SignIn />;
  const ready = preview || session !== undefined;

  return (
    <>
      <div style={{ position: "absolute", inset: 0, animation: opening && revealing ? "opHomeUp 1s cubic-bezier(0.2, 0.9, 0.25, 1) both" : undefined, opacity: opening && !revealing ? 0 : undefined }}>{content}</div>
      {opening ? <Opening ready={ready} onReveal={onReveal} onDone={onDone} /> : null}
    </>
  );
}

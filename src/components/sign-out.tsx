"use client";

/** Signs out and clears this device's cached private pages first. */
export function SignOutButton({ className = "btn btn-ghost btn-sm w-full justify-start" }: { className?: string }) {
  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={() => {
        navigator.serviceWorker?.controller?.postMessage("clear-private-cache");
        try {
          localStorage.removeItem("navi:capture-draft");
          localStorage.removeItem("navi:chat-draft:chat");
          localStorage.removeItem("navi:chat-draft:onboarding");
        } catch {}
      }}
    >
      <button className={className}>Sign out</button>
    </form>
  );
}

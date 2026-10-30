"use client";
import { clearDevicePrivateData } from "@/lib/device-privacy";

/** Signs out and clears this device's cached private pages first. */
export function SignOutButton({ className = "btn btn-ghost btn-sm w-full justify-start" }: { className?: string }) {
  return (
    <form
      action="/auth/signout"
      method="post"
      // Unsent offline captures stay on the device, tagged as this person's,
      // and sync when they sign in again; nobody else sees or sends them.
      onSubmit={clearDevicePrivateData}
    >
      <button className={className}>Sign out</button>
    </form>
  );
}

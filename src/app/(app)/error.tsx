"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";

// Shown in place of a screen that failed to load or render. Never shows the
// error's text (in production it is generic anyway); the reference code
// (digest) matches the server log.
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  useEffect(() => {
    console.error(error);
    heading.current?.focus();
  }, [error]);
  return (
    <section role="alert" aria-labelledby="app-error-title" className="mx-auto flex max-w-md flex-col gap-3 p-6">
      <h1 id="app-error-title" ref={heading} tabIndex={-1} className="h2">
        This screen couldn&apos;t load
      </h1>
      <p>Something went wrong on our side or the connection dropped. Your saved data is safe.</p>
      {digest && <p className="muted text-sm">Reference: {digest}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link className="btn" href="/">
          Go to Today
        </Link>
      </div>
    </section>
  );
}

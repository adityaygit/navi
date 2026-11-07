"use client";
import { useEffect } from "react";

// Last-resort screen when the root layout itself fails. It replaces the whole
// document, so it carries its own minimal, neutral styles (the app's CSS isn't
// loaded here) and follows the system light/dark setting. No error text is
// shown; the reference code (digest) matches the server log.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", colorScheme: "light dark", lineHeight: 1.5 }}>
        <title>Navi: something went wrong</title>
        <main role="alert" style={{ maxWidth: "28rem", margin: "0 auto", padding: "2rem 1rem" }}>
          <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.5rem" }}>Navi couldn&apos;t load</h1>
          <p style={{ margin: "0 0 1rem" }}>Something went wrong on our side or the connection dropped. Your saved data is safe.</p>
          {digest && <p style={{ margin: "0 0 1rem", opacity: 0.7, fontSize: "0.875rem" }}>Reference: {digest}</p>}
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "0.625rem 1rem", minHeight: "44px", cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

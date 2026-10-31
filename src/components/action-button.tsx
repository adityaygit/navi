"use client";
import { useState, useTransition } from "react";
import { announceChange } from "@/lib/offline-queue";
import { connectionError } from "@/lib/connection";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Button that runs a server action, shows progress and surfaces errors. */
export function ActionButton<A extends unknown[]>({
  action,
  args,
  children,
  className = "btn btn-sm",
  confirm,
  label,
  showResult = false,
}: {
  /** A server action (or, in client components, any async function). */
  action: (...args: A) => Promise<Result | unknown>;
  /** Arguments for the action. Must be serializable when used from a server component. */
  args?: A;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  label?: string;
  /** Show the action's result message after it succeeds (e.g. what a re-plan placed, moved and couldn't fit). */
  showResult?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={className}
        aria-label={label}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          setResult(null);
          start(async () => {
            try {
              const r = (await action(...((args ?? []) as A))) as Result;
              if (r && "ok" in r && !r.ok) setError(r.error);
              else {
                if (showResult && r && "message" in r && r.message) setResult(r.message);
                announceChange();
              }
            } catch {
              setError(connectionError());
            }
          });
        }}
      >
        {pending ? "…" : children}
      </button>
      {error && <span role="alert" className="mt-1 max-w-xs text-xs text-danger">{error}</span>}
      {showResult && <span role="status" className={result ? "notice mt-1 max-w-sm text-xs" : "sr-only"}>{result}</span>}
    </span>
  );
}

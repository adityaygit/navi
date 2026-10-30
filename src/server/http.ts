import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/server/context";

/** An error whose message was written for the person using the app (safe to show). */
export class UserFacingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Uniform JSON error handling for route handlers. Database and provider error
 * text is logged server-side only; in production the client gets a generic
 * message plus a short reference code to match against the log.
 */
export function apiError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  if (err instanceof UserFacingError) return NextResponse.json({ error: err.message }, { status: err.status });
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[api error ${ref}]`, err);
  const detail = process.env.NODE_ENV === "production" ? null : err instanceof Error ? err.message : null;
  return NextResponse.json({ error: detail ?? `Something went wrong on the server (ref ${ref}).`, code: ref }, { status: 500 });
}

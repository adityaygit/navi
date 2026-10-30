import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/server/context";

/** Uniform JSON error handling for route handlers. */
export function apiError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
}

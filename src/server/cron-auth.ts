import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/** Scheduler calls carry "Authorization: Bearer $CRON_SECRET" (Vercel Cron, Trigger.dev). */
export function cronAuthorized(request: Request): boolean {
  const secret = serverEnv.cronSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

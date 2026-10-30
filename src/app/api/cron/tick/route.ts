import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { tickAll } from "@/server/jobs/tick";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = serverEnv.cronSecret();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Called every 5–15 minutes by Trigger.dev (trigger/tick.ts) or any cron.
// Vercel Cron sends GET with "Authorization: Bearer $CRON_SECRET".
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary = await tickAll(createSupabaseAdmin());
  return NextResponse.json({ ok: true, ms: Date.now() - started, users: summary });
}

export const GET = handle;
export const POST = handle;

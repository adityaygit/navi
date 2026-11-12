import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/server/cron-auth";
import { tickAll } from "@/server/jobs/tick";

export const maxDuration = 300;


// Called every 5–15 minutes by Trigger.dev (trigger/tick.ts) or any cron.
// Vercel Cron sends GET with "Authorization: Bearer $CRON_SECRET".
async function handle(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary = await tickAll(createSupabaseAdmin());
  return NextResponse.json({ ok: true, ms: Date.now() - started, users: summary });
}

export const GET = handle;
export const POST = handle;

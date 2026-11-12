import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { cronAuthorized } from "@/server/cron-auth";
import { syncDueConnections } from "@/server/integrations/feed-sync";

export const maxDuration = 300;

// Refreshes calendar-feed connections that are due (every 6 hours each, sooner
// with backoff after a failure). Called every 30 minutes by Trigger.dev
// (trigger/integrations-sync.ts), with Vercel Cron as a fallback. Safe to call
// repeatedly or concurrently: each connection is claimed with a lease first.
async function handle(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const result = await syncDueConnections(createSupabaseAdmin(), { limit: 50, concurrency: 4, deadlineMs: 240_000 });
  return NextResponse.json({ ok: true, ms: Date.now() - started, ...result });
}

export const GET = handle;
export const POST = handle;

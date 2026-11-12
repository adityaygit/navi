import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { linearWebhookSecret } from "@/server/linear/config";
import { freshTimestamp, handleLinearWebhook, verifyLinearSignature } from "@/server/linear/webhook";

// Linear app webhook (optional, for future real-time sync). Public path (no
// session): authenticity comes from the HMAC signature. Without
// LINEAR_WEBHOOK_SECRET it's switched off. Answers within Linear's 5 s limit:
// it only flags connections for the next scheduled sync.
export async function POST(request: NextRequest) {
  const secret = linearWebhookSecret();
  if (!secret) return NextResponse.json({ error: "Linear webhooks are not enabled" }, { status: 404 });
  const raw = await request.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (!verifyLinearSignature(raw, request.headers.get("linear-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!freshTimestamp(payload.webhookTimestamp)) return NextResponse.json({ error: "Stale delivery" }, { status: 401 });
  const outcome = await handleLinearWebhook(createSupabaseAdmin(), payload, process.env.LINEAR_CLIENT_ID?.trim() || null);
  return NextResponse.json({ ok: true, outcome });
}

import { NextResponse } from "next/server";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { pushConfigured, sendToSubscriptions } from "@/server/jobs/notify";

// Sends a test push to all of the user's devices and reports exactly what happened.
export async function POST() {
  try {
    const ctx = await requireApiCtx();
    if (!pushConfigured()) return NextResponse.json({ ok: false, error: "Push isn't configured on the server (VAPID keys missing)." }, { status: 503 });
    const r = await sendToSubscriptions(ctx.db, ctx.userId, { title: "Navi test notification", body: "Push notifications are working on this device.", url: "/settings", tag: `test:${Date.now()}` });
    if (r.none) return NextResponse.json({ ok: false, error: "No devices are subscribed. Enable notifications on this device first." }, { status: 400 });
    return NextResponse.json({ ok: r.sent > 0, ...r });
  } catch (err) {
    return apiError(err);
  }
}

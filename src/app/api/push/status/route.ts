import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { pushConfigured } from "@/server/jobs/notify";
import { deviceLabel, pushServiceLabel } from "@/lib/push-diagnostics";

// Delivery diagnostics for Settings: the user's registered devices and what
// happened to recent notifications. POST so this device can say which
// subscription is its own without putting the endpoint in a URL.
const Body = z.object({ endpoint: z.string().max(2000).nullish() });

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const { endpoint } = Body.parse(await request.json().catch(() => ({})));
    const [subs, notes] = await Promise.all([
      ctx.db.from("push_subscriptions").select("id,endpoint,user_agent,created_at,last_success_at,last_error").eq("user_id", ctx.userId).order("created_at", { ascending: false }),
      ctx.db.from("notifications").select("id,kind,title,status,attempts,last_error,created_at,deliver_after,sent_at").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(8),
    ]);
    if (subs.error) throw new Error(subs.error.message);
    if (notes.error) throw new Error(notes.error.message);
    const devices = (subs.data ?? []).map((s) => ({
      id: s.id as string,
      service: pushServiceLabel(s.endpoint),
      device: deviceLabel(s.user_agent),
      addedAt: s.created_at as string,
      lastSuccessAt: (s.last_success_at as string | null) ?? null,
      lastError: (s.last_error as string | null) ?? null,
      thisDevice: Boolean(endpoint) && s.endpoint === endpoint,
    }));
    return NextResponse.json({
      configured: pushConfigured(),
      thisDeviceRegistered: devices.some((d) => d.thisDevice),
      devices,
      recent: notes.data ?? [],
    });
  } catch (err) {
    return apiError(err);
  }
}

// Remove one of the user's registered devices (e.g. an old phone).
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const { error } = await ctx.db.from("push_subscriptions").delete().eq("user_id", ctx.userId).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

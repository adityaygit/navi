import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { pushEndpointAllowed } from "@/lib/push-endpoint";

const Body = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(4).max(200) }),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const sub = Body.parse(await request.json());
    if (!pushEndpointAllowed(sub.endpoint)) {
      return NextResponse.json({ error: "That isn't a supported browser push service." }, { status: 400 });
    }
    // Endpoint is globally unique; re-subscribing on the same device replaces the old row.
    await ctx.db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    const { error } = await ctx.db.from("push_subscriptions").insert({
      user_id: ctx.userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await request.json());
    await ctx.db.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

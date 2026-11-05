import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/server/http";
import { requestAccess, waitlistDb } from "@/server/waitlist";

const Body = z.object({ email: z.string().max(254), website: z.string().max(200).optional() });

// Public: ask for early access. The reply is the same whatever happened, so this
// endpoint can't be used to find out who is on the list.
export async function POST(request: NextRequest) {
  try {
    const body = Body.parse(await request.json());
    if (body.website) return NextResponse.json({ ok: true }); // honeypot: bots fill hidden fields
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
    const result = await requestAccess(waitlistDb(), body.email, ip);
    if (result.outcome === "email_failed") console.error("[waitlist] application email failed");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    return apiError(err);
  }
}

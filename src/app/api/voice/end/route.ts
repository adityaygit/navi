import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { endVoiceSession } from "@/server/ai/budget";

const Body = z.object({ voiceSessionId: z.string().uuid() });

// The browser hung up (or replaced) a real-time voice session. The server
// measures how long it lasted from its own mint time and settles the budget
// reservation to max(reported, elapsed estimate) instead of the full reserve.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const b = Body.parse(await request.json());
    const result = await endVoiceSession(ctx.userId, b.voiceSessionId);
    return NextResponse.json({ ok: true, ended: result.ended });
  } catch (err) {
    return apiError(err);
  }
}

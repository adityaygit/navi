import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { voiceAvailability } from "@/server/ai/config";
import { assertBudget, BudgetExceededError } from "@/server/ai/budget";
import { buildVoiceSession, mintVoiceToken } from "@/server/ai/voice";

const Body = z.object({ kind: z.enum(["chat", "onboarding"]).default("chat"), resumeHandle: z.string().max(500).nullish(), probe: z.boolean().optional() });

// Starts (or resumes) a real-time voice session: returns a single-use
// ephemeral token, never the API key.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json().catch(() => ({})));
    const availability = voiceAvailability();
    if (!availability.ready) {
      return NextResponse.json({ error: availability.reason, fallback: "browser" }, { status: 503 });
    }
    try {
      // Reserve roughly ten minutes of two-way audio before allowing a session.
      await assertBudget(0.25);
    } catch (err) {
      if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, fallback: "none" }, { status: 402 });
      throw err;
    }
    // Availability check only: no token is minted.
    if (body.probe) return NextResponse.json({ ok: true });
    const { conversationId, config } = await buildVoiceSession(ctx, body.kind);
    const minted = await mintVoiceToken(config, body.resumeHandle);
    return NextResponse.json({ token: minted.token, model: minted.model, config: minted.config, conversationId });
  } catch (err) {
    return apiError(err);
  }
}

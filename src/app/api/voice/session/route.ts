import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { modelFor, voiceAvailability } from "@/server/ai/config";
import { assertBudget, BudgetExceededError, RateLimitedError, reserveVoiceSession, settleUsage, VOICE_RESERVE_USD } from "@/server/ai/budget";
import { buildVoiceSession, mintVoiceToken } from "@/server/ai/voice";

const Body = z.object({ kind: z.enum(["chat", "onboarding"]).default("chat"), resumeHandle: z.string().max(500).nullish(), probe: z.boolean().optional() });

// Starts (or resumes) a real-time voice session: returns a single-use
// ephemeral token, never the API key. Every minted token first reserves the
// cost of its whole lifetime (VOICE_TOKEN_MINUTES of two-way audio) against
// the daily budget, server-side, so spend doesn't depend on the browser
// reporting it; reported turns are reconciled against that reservation.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json().catch(() => ({})));
    const availability = voiceAvailability();
    if (!availability.ready) {
      return NextResponse.json({ error: availability.reason, fallback: "browser" }, { status: 503 });
    }
    // Availability check only: nothing is reserved or minted.
    if (body.probe) {
      try {
        await assertBudget(VOICE_RESERVE_USD);
      } catch (err) {
        if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, fallback: "none" }, { status: 402 });
        throw err;
      }
      return NextResponse.json({ ok: true });
    }
    let voiceSessionId: string;
    try {
      voiceSessionId = await reserveVoiceSession(ctx.userId, modelFor("voice"));
    } catch (err) {
      if (err instanceof BudgetExceededError) return NextResponse.json({ error: err.message, fallback: "none" }, { status: 402 });
      if (err instanceof RateLimitedError) return NextResponse.json({ error: err.message, fallback: "none" }, { status: 429 });
      throw err;
    }
    try {
      const { conversationId, config } = await buildVoiceSession(ctx, body.kind);
      const minted = await mintVoiceToken(config, body.resumeHandle);
      return NextResponse.json({ token: minted.token, model: minted.model, config: minted.config, conversationId, voiceSessionId });
    } catch (err) {
      // No token, no spend: release the reservation.
      await settleUsage(voiceSessionId, { costUsd: 0, ok: false }, modelFor("voice"));
      throw err;
    }
  } catch (err) {
    return apiError(err);
  }
}

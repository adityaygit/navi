import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { saveMessage } from "@/server/ai/chat";
import { getBudgetStatus, recordVoiceTurn } from "@/server/ai/budget";
import { modelFor, tokenCost, voiceCost } from "@/server/ai/config";

const Body = z.object({
  conversationId: z.string().uuid(),
  /** The id /api/voice/session returned with the token this turn ran on. */
  voiceSessionId: z.string().uuid().nullish(),
  userText: z.string().max(8000).default(""),
  assistantText: z.string().max(8000).default(""),
  toolEvents: z.array(z.object({ name: z.string().max(64), ok: z.boolean(), summary: z.string().max(500) })).max(20).default([]),
  inputAudioSeconds: z.number().min(0).max(3600).default(0),
  outputAudioSeconds: z.number().min(0).max(3600).default(0),
  /** Gemini Live usageMetadata, when the service sent it for this turn. */
  inputTokens: z.number().int().min(0).max(10_000_000).default(0),
  outputTokens: z.number().int().min(0).max(10_000_000).default(0),
  interrupted: z.boolean().default(false),
});

// Persists one completed voice turn's transcripts (never audio) into the shared
// conversation and records its estimated cost against the testing budget,
// reconciled with the session's up-front reservation (max of the two).
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const b = Body.parse(await request.json());
    const { data: conv } = await ctx.db.from("conversations").select("id").eq("id", b.conversationId).maybeSingle();
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    if (b.userText.trim()) await saveMessage(ctx, b.conversationId, "user", b.userText.trim(), "voice");
    if (b.assistantText.trim() || b.toolEvents.length) {
      await saveMessage(ctx, b.conversationId, "assistant", `${b.assistantText.trim()}${b.interrupted ? " …(interrupted)" : ""}`, "voice", b.toolEvents);
    }
    const model = modelFor("voice");
    await recordVoiceTurn({
      userId: ctx.userId,
      sessionId: b.voiceSessionId,
      model,
      inputAudioSeconds: b.inputAudioSeconds,
      outputAudioSeconds: b.outputAudioSeconds,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      // Audio minutes and token counts describe the same usage, so take the
      // larger estimate rather than adding them.
      price: (inSec, outSec, inTok, outTok) => Math.max(voiceCost(inSec, outSec), tokenCost(model, { input: inTok, output: outTok }).usd),
    });
    const budget = await getBudgetStatus();
    return NextResponse.json({ ok: true, budgetExceeded: budget.exceeded });
  } catch (err) {
    return apiError(err);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { nameNewChat, replyClientId, saveMessage, upsertMessage } from "@/server/ai/chat";
import { getBudgetStatus, recordVoiceTurn } from "@/server/ai/budget";
import { modelFor, tokenCost, voiceCost } from "@/server/ai/config";

const Body = z.object({
  conversationId: z.string().uuid(),
  /** The id /api/voice/session returned with the token this turn ran on. */
  voiceSessionId: z.string().uuid().nullish(),
  userText: z.string().max(8000).default(""),
  assistantText: z.string().max(8000).default(""),
  toolEvents: z
    .array(
      z.object({
        name: z.string().max(64),
        ok: z.boolean(),
        summary: z.string().max(500),
        // What the person sees for the step (plain words; see src/lib/plain-text.ts).
        display: z.string().max(300).optional(),
        detail: z.array(z.string().max(300)).max(40).optional(),
        plan: z.boolean().optional(),
        leftover: z.object({ line: z.string().max(300), options: z.array(z.string().max(400)).max(4) }).optional(),
        irreversible: z.boolean().optional(),
        unchanged: z.boolean().optional(),
        // Ids are only links: cards and Undo read the person's own rows under RLS.
        action_id: z.string().uuid().optional(),
        undo: z.array(z.string().uuid()).max(100).optional(),
      }),
    )
    .max(20)
    .default([]),
  inputAudioSeconds: z.number().min(0).max(3600).default(0),
  outputAudioSeconds: z.number().min(0).max(3600).default(0),
  /** Gemini Live usageMetadata, when the service sent it for this turn. */
  inputTokens: z.number().int().min(0).max(10_000_000).default(0),
  outputTokens: z.number().int().min(0).max(10_000_000).default(0),
  interrupted: z.boolean().default(false),
  /**
   * A uuid the device makes per turn and keeps until that turn is saved. Sent
   * again (a retry, possibly carrying the words that came after it), the
   * turn's messages are replaced rather than added, so it's saved once. Its
   * cost is only recorded again when the retry carries something new.
   */
  clientTurnId: z.string().uuid().nullish(),
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
    if (b.userText.trim()) await nameNewChat(ctx, b.conversationId, b.userText);
    const userText = b.userText.trim();
    const assistantText = `${b.assistantText.trim()}${b.interrupted ? " …(interrupted)" : ""}`;
    const hasReply = Boolean(b.assistantText.trim() || b.toolEvents.length);
    let changed = true;
    if (b.clientTurnId) {
      changed = false;
      if (userText) changed = (await upsertMessage(ctx, b.conversationId, "user", userText, "voice", [], b.clientTurnId)).changed || changed;
      if (hasReply) changed = (await upsertMessage(ctx, b.conversationId, "assistant", assistantText, "voice", b.toolEvents, replyClientId(b.clientTurnId))).changed || changed;
    } else {
      if (userText) await saveMessage(ctx, b.conversationId, "user", userText, "voice");
      if (hasReply) await saveMessage(ctx, b.conversationId, "assistant", assistantText, "voice", b.toolEvents);
    }
    // An exact repeat of a turn already saved: its cost was recorded with it.
    if (!changed && (userText || hasReply)) {
      const budget = await getBudgetStatus();
      return NextResponse.json({ ok: true, duplicate: true, budgetExceeded: budget.exceeded });
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

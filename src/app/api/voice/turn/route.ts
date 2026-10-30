import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { saveMessage } from "@/server/ai/chat";
import { getBudgetStatus, recordUsage } from "@/server/ai/budget";
import { modelFor, voiceCost } from "@/server/ai/config";

const Body = z.object({
  conversationId: z.string().uuid(),
  userText: z.string().max(8000).default(""),
  assistantText: z.string().max(8000).default(""),
  toolEvents: z.array(z.object({ name: z.string().max(64), ok: z.boolean(), summary: z.string().max(500) })).max(20).default([]),
  inputAudioSeconds: z.number().min(0).max(3600).default(0),
  outputAudioSeconds: z.number().min(0).max(3600).default(0),
  interrupted: z.boolean().default(false),
});

// Persists one completed voice turn's transcripts (never audio) into the shared
// conversation and records its estimated cost against the testing budget.
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
    if (b.inputAudioSeconds || b.outputAudioSeconds) {
      await recordUsage({
        userId: ctx.userId,
        provider: "google",
        model: modelFor("voice"),
        role: "voice",
        purpose: "voice",
        audioSeconds: b.inputAudioSeconds + b.outputAudioSeconds,
        costUsd: voiceCost(b.inputAudioSeconds, b.outputAudioSeconds),
      });
    }
    const budget = await getBudgetStatus();
    return NextResponse.json({ ok: true, budgetExceeded: budget.exceeded });
  } catch (err) {
    return apiError(err);
  }
}

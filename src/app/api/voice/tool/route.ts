import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";
import { runTool, toolsFor } from "@/server/ai/tools";

const Body = z.object({ conversationId: z.string().uuid(), name: z.string().max(64), args: z.record(z.string(), z.unknown()).nullish() });

// Executes a voice tool call server-side with the user's own permissions,
// through exactly the same tool registry as text chat.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json());
    const { data: conv } = await ctx.db.from("conversations").select("id,kind").eq("id", body.conversationId).maybeSingle();
    if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    // Only the tools this voice session was offered can run.
    if (!toolsFor(conv.kind === "onboarding" ? "onboarding" : "voice").some((t) => t.name === body.name)) {
      return NextResponse.json({ ok: false, summary: `“${body.name}” isn't available in this conversation.` }, { status: 400 });
    }
    if (body.name === "mark_onboarding_ready") {
      const { data: p } = await ctx.db.from("profiles").select("onboarding_conversation_id").eq("id", ctx.userId).single();
      if (p?.onboarding_conversation_id !== body.conversationId) return NextResponse.json({ ok: false, summary: "Not in onboarding" });
    }
    const result = await runTool({ ...ctx, actor: "navi", conversationId: body.conversationId }, body.name, body.args ?? {});
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { handleTurn } from "@/server/ai/chat";
import { apiError } from "@/server/http";

export const maxDuration = 120;

const Body = z.object({
  kind: z.enum(["chat", "onboarding"]).default("chat"),
  text: z.string().min(1).max(8000),
  modality: z.enum(["text", "voice"]).default("text"),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json());
    const result = await handleTurn(ctx, body);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}

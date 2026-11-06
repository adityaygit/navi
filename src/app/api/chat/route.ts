import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx, type Ctx } from "@/server/context";
import { handleTurn } from "@/server/ai/chat";
import { apiError } from "@/server/http";
import { CHAT_STREAM_CONTENT_TYPE, type ChatStreamEvent } from "@/lib/chat-stream";

export const maxDuration = 120;

const Body = z.object({
  kind: z.enum(["chat", "onboarding"]).default("chat"),
  text: z.string().min(1).max(8000),
  modality: z.enum(["text", "voice"]).default("text"),
  // A chat to continue; omitted (or null) starts a new chat. Ignored for onboarding.
  conversationId: z.string().uuid().nullish(),
  // Ask for live progress (see src/lib/chat-stream.ts) instead of one JSON reply.
  stream: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  let ctx: Ctx;
  let body: z.infer<typeof Body>;
  try {
    ctx = await requireApiCtx();
    body = Body.parse(await request.json());
  } catch (err) {
    return apiError(err);
  }
  const { stream: wantsStream, ...input } = body;
  if (!wantsStream && !(request.headers.get("accept") ?? "").includes(CHAT_STREAM_CONTENT_TYPE)) {
    try {
      return NextResponse.json(await handleTurn(ctx, input));
    } catch (err) {
      return apiError(err);
    }
  }

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      // Not awaited: events flow out while the turn runs. If the person leaves
      // mid-turn the work still finishes and is saved; it just isn't streamed.
      void (async () => {
        try {
          const result = await handleTurn(ctx, input, send);
          send({ type: "done", ...result });
        } catch (err) {
          // Same wording and status the JSON response would have used.
          const res = apiError(err);
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          send({ type: "error", message: detail.error ?? "Something went wrong on the server.", status: res.status });
        } finally {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {}
          }
        }
      })();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": `${CHAT_STREAM_CONTENT_TYPE}; charset=utf-8`,
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

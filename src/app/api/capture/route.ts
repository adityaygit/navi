import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { processCapture, saveCapture } from "@/server/domain/capture";
import { apiError } from "@/server/http";

export const maxDuration = 60;

const Body = z.object({
  client_id: z.string().min(8).max(100),
  raw_text: z.string().min(1).max(20000),
  source: z.enum(["text", "voice", "offline", "chat"]).default("text"),
  captured_at: z.string().nullish(),
});

// Stores the raw capture first (idempotent on client_id), then extracts
// proposals for the review inbox. Safe for the offline queue to retry.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json());
    const { capture, duplicate } = await saveCapture(ctx, body);
    if (duplicate && capture.status !== "pending") {
      return NextResponse.json({ capture_id: capture.id, duplicate: true, status: capture.status });
    }
    const result = await processCapture(ctx, capture.id);
    return NextResponse.json({ capture_id: capture.id, duplicate, ...result });
  } catch (err) {
    return apiError(err);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/server/http";
import { submitApplication, waitlistDb } from "@/server/waitlist";

const MESSAGES = {
  invalid: "This link isn’t valid. Ask for early access again to get a new one.",
  expired: "This link has expired. Ask for early access again to get a new one.",
  used: "This application has already been sent.",
} as const;

// Public: submit the application from the emailed link.
export async function POST(request: NextRequest) {
  try {
    const result = await submitApplication(waitlistDb(), await request.json());
    if (result.outcome === "applied" || result.outcome === "approved") return NextResponse.json({ ok: true, outcome: result.outcome });
    return NextResponse.json({ error: MESSAGES[result.outcome] }, { status: 410 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => i.message).join(". ") }, { status: 400 });
    return apiError(err);
  }
}

import { NextResponse } from "next/server";
import { requireApiCtx } from "@/server/context";
import { apiError } from "@/server/http";

const TABLES = ["profiles", "workspaces", "goals", "projects", "milestones", "tasks", "routines", "events", "plan_blocks", "focus_sessions", "plan_disruptions", "notes", "conversations", "messages", "captures", "proposals", "memories", "activity_log", "approvals", "briefings", "notifications", "ai_usage"];

// Full export of the signed-in user's data (RLS limits every query to them).
export async function GET() {
  try {
    const ctx = await requireApiCtx();
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: ctx.userId };
    for (const t of TABLES) {
      const { data, error } = await ctx.db.from(t).select("*").limit(50000);
      out[t] = error ? { error: error.message } : data;
    }
    return new NextResponse(JSON.stringify(out, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="navi-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

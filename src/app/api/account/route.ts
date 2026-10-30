import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/server/http";

// Permanently deletes the account. All user tables cascade from auth.users.
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const { confirm } = z.object({ confirm: z.literal("DELETE") }).parse(await request.json());
    void confirm;
    const admin = createSupabaseAdmin();
    const { error } = await admin.auth.admin.deleteUser(ctx.userId);
    if (error) throw new Error(error.message);
    await ctx.db.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

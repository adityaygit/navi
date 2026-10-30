import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { apiError } from "@/server/http";

const Body = z.object({ confirm: z.literal("DELETE"), email: z.string().max(320) });

// Permanently deletes the account. All user tables cascade from auth.users.
// Needs the typed confirmation plus the account's own email, so a stray or
// forged request can't wipe someone's data.
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireApiCtx();
    const body = Body.parse(await request.json());
    const { data } = await ctx.db.auth.getClaims();
    const email = String(data?.claims?.email ?? "").toLowerCase();
    if (!email || body.email.trim().toLowerCase() !== email) {
      return NextResponse.json({ error: "That email doesn't match this account." }, { status: 400 });
    }
    const admin = createSupabaseAdmin();
    const { error } = await admin.auth.admin.deleteUser(ctx.userId);
    if (error) throw new Error(error.message);
    await ctx.db.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

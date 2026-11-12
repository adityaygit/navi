"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApiCtx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { syncConnection } from "@/server/linear/sync";
import { disconnectLinear } from "@/server/linear/connections";

type Result = { ok: true; message?: string } | { ok: false; error: string };
const Id = z.string().uuid();

/** The connection must be the signed-in person's: checked with their own (RLS) client before any service-role work. */
async function ownConnection(connectionId: string) {
  const ctx = await requireApiCtx();
  const id = Id.parse(connectionId);
  const { data } = await ctx.db.from("integration_connections").select("id,status").eq("id", id).eq("provider", "linear").maybeSingle();
  if (!data) throw new Error("That Linear connection doesn't exist (or isn't yours).");
  return { ctx, connection: data as { id: string; status: string } };
}

export async function syncLinearAction(connectionId: string): Promise<Result> {
  try {
    const { connection } = await ownConnection(connectionId);
    if (connection.status !== "active") return { ok: false, error: "Reconnect Linear first: its access expired or was revoked." };
    const r = await syncConnection(createSupabaseAdmin(), connection.id, "manual");
    revalidatePath("/", "layout");
    if (r.ok) {
      const { imported, updated, detached, open } = r.stats;
      const changes = [imported && `${imported} new`, updated && `${updated} updated`, detached && `${detached} no longer assigned`].filter(Boolean).join(", ");
      return { ok: true, message: `Synced ${open} open issue${open === 1 ? "" : "s"}${changes ? ` (${changes})` : ", nothing new"}.` };
    }
    if ("skipped" in r) return r.skipped === "already_running" ? { ok: true, message: "A sync is already running; it'll finish in a moment." } : { ok: false, error: "Reconnect Linear first." };
    return { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function disconnectLinearAction(connectionId: string): Promise<Result> {
  try {
    const { ctx, connection } = await ownConnection(connectionId);
    const r = await disconnectLinear(createSupabaseAdmin(), ctx.userId, connection.id);
    revalidatePath("/", "layout");
    return { ok: true, message: r.revoked ? "Disconnected. Navi's access was revoked in Linear." : "Disconnected. Linear didn't confirm the revocation; you can also remove Navi under Linear → Settings → Connected applications." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Everything a domain operation needs: a client already scoped to the user
 * (RLS-enforced for interactive requests), the user's id, and who is acting.
 * Chat, voice and the dashboard all pass through the same Ctx so the AI can
 * only ever do what the signed-in user's database permissions allow.
 */
export type Ctx = {
  db: SupabaseClient;
  userId: string;
  actor: "user" | "navi" | "system";
  timezone: string;
  /** Set while handling a chat turn / capture so proposals link back to their source. */
  conversationId?: string;
  captureId?: string;
  /**
   * The person's own words in the current turn, as held by the server (the
   * chat message, or the voice transcript of this turn). Tools that act on the
   * user's say-so (complete_task) check against this, never against text the
   * model wrote.
   */
  userMessage?: string;
};

export class AuthError extends Error {}

export async function getCtx(): Promise<Ctx | null> {
  const db = await createSupabaseServer();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return { db, userId, actor: "user", timezone: profile?.timezone ?? "UTC" };
}

/** For pages: redirect to /login when signed out. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

/** For route handlers and server actions: throw instead of redirecting. */
export async function requireApiCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("Not signed in");
  return ctx;
}

export function asNavi(ctx: Ctx): Ctx {
  return { ...ctx, actor: "navi" };
}

export async function getProfile(ctx: Ctx): Promise<Profile> {
  const { data, error } = await ctx.db.from("profiles").select("*").eq("id", ctx.userId).single();
  if (error) throw new Error(`Could not load profile: ${error.message}`);
  return data as Profile;
}

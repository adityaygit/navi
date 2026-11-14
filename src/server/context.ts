import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseForToken, createSupabaseServer } from "@/lib/supabase/server";
import { bearerToken, hasBearer } from "@/server/cors";
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
  /**
   * Navi's autonomy setting for this turn. "ask": every change Navi would make
   * becomes an inline card first. Unset is treated as "auto".
   */
  autonomy?: "auto" | "ask";
  /** The constraint-first planner (profiles.preferences.planner_v2) is on for this person. Unset = look it up. */
  plannerV2?: boolean;
  /** Told about each activity-log entry written (so a tool call can offer Undo). */
  onActivity?: (entry: { id: string; reversible: boolean }) => void;
  /** Told about each action a step proposed (so its reply can show the card). */
  onAction?: (approvalId: string) => void;
};

export class AuthError extends Error {}

/**
 * The signed-in person, from either the web's session cookie or (the phone
 * app) an `Authorization: Bearer <Supabase access token>` header. A bearer
 * header always wins and never falls back to cookies: a bad or expired token
 * is "signed out". The token is verified (signature via the project's keys,
 * or with the Auth server) and must belong to a signed-in user.
 * `source`: the request's headers; by default the current request's.
 */
export async function getCtx(source?: Request | Headers): Promise<Ctx | null> {
  const hdrs = source instanceof Request ? source.headers : (source ?? (await headers()));
  const authorization = hdrs.get("authorization");
  let db: SupabaseClient;
  let userId: string | undefined;
  if (hasBearer(authorization)) {
    const token = bearerToken(authorization);
    if (!token) return null;
    db = createSupabaseForToken(token);
    const { data, error } = await db.auth.getClaims(token);
    if (error || data?.claims?.role !== "authenticated") return null;
    userId = data.claims.sub;
  } else {
    db = await createSupabaseServer();
    const { data } = await db.auth.getClaims();
    userId = data?.claims?.sub;
  }
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
export async function requireApiCtx(source?: Request | Headers): Promise<Ctx> {
  const ctx = await getCtx(source);
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

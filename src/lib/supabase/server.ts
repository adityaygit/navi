import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv, serverEnv } from "@/lib/env";

/** Request-scoped client acting as the signed-in user. RLS applies. */
export async function createSupabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Client acting as the holder of a Supabase access token (the phone app's
 * `Authorization: Bearer` header). The token rides in every request, so RLS
 * applies exactly as for a cookie session. Nothing is stored or refreshed:
 * the app refreshes its own session. `auth.getClaims()` with no argument
 * checks this token, so code that reads the signed-in user's claims works the
 * same for both kinds of client. Verify the token (getCtx does) before use.
 */
export function createSupabaseForToken(accessToken: string): SupabaseClient {
  const db = createPlainClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const getClaims = db.auth.getClaims.bind(db.auth);
  db.auth.getClaims = ((jwt?: string, options?: Parameters<typeof getClaims>[1]) => getClaims(jwt ?? accessToken, options)) as typeof db.auth.getClaims;
  return db;
}

/**
 * Service-role client. Bypasses RLS, so it must only be used by trusted server
 * code (scheduled jobs, budget accounting) that scopes every query by user_id.
 */
export function createSupabaseAdmin(): SupabaseClient {
  const key = serverEnv.supabaseServiceRoleKey();
  return createPlainClient(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

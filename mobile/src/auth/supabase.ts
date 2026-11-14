import { createClient, type Session } from "@supabase/supabase-js";
import { config } from "../config";

// The app signs in directly with Supabase (emailed code or password) and then
// sends the access token to the Navi server as a bearer token.
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "navi.auth" },
});

export async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type { Session };

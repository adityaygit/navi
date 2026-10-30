/**
 * Tests delete and recreate users with the service key, so they must only ever
 * run against the local Supabase stack. Run them via scripts/local-only.sh
 * when the environment also holds a hosted project's settings.
 */
export function assertLocalSupabase() {
  // Unset is fine (unit tests don't need Supabase); a non-local URL never is.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    throw new Error("Tests only run against local Supabase, but NEXT_PUBLIC_SUPABASE_URL is not local. Use scripts/local-only.sh <command>.");
  }
}

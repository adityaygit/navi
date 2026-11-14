// Build-time client config (mobile/.env.production for app builds, .env.development.local for dev).
function need(name: string, v: string | undefined): string {
  if (!v) throw new Error(`Missing ${name} in this build.`);
  return v;
}
export const config = {
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://www.meetnavi.app",
  supabaseUrl: need("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL as string | undefined),
  supabaseAnonKey: need("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined),
};

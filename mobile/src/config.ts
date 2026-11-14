// Build-time client config (mobile/.env.production for app builds, .env.local for dev).
export const config = {
  apiBase: (import.meta.env.VITE_API_BASE as string | undefined) ?? "https://www.meetnavi.app",
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
};

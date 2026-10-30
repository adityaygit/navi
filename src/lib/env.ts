// Central configuration. Public values are inlined by Next at build time;
// server values are read lazily so missing optional credentials degrade
// features honestly instead of crashing the whole app.

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  googleAuthEnabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

export const serverEnv = {
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,
  geminiApiKey: () => process.env.GEMINI_API_KEY || null,
  aiProvider: (): "anthropic" | "devsim" => {
    const value = process.env.NAVI_AI_PROVIDER === "devsim" ? "devsim" : "anthropic";
    // The simulator is a test double. Never allow it to masquerade as AI in production.
    if (value === "devsim" && process.env.NODE_ENV === "production" && process.env.NAVI_ALLOW_DEVSIM !== "true") {
      return "anthropic";
    }
    return value;
  },
  models: () => ({
    fast: process.env.NAVI_MODEL_FAST || "claude-haiku-5-5",
    planner: process.env.NAVI_MODEL_PLANNER || "claude-sonnet-5-5",
    plannerFallback: process.env.NAVI_MODEL_PLANNER_FALLBACK || "claude-haiku-5-5",
    voice: process.env.NAVI_MODEL_VOICE || "gemini-3.8-live",
  }),
  refusalFallbacks: () => (process.env.NAVI_REFUSAL_FALLBACKS ?? "default") !== "off",
  dailyBudgetUsd: () => Number(process.env.NAVI_DAILY_BUDGET_USD ?? "2") || 2,
  budgetWarnRatio: () => Number(process.env.NAVI_BUDGET_WARN_RATIO ?? "0.75") || 0.75,
  /** Who may raise the shared daily AI budget. Empty in production means nobody. */
  adminEmails: () => (process.env.NAVI_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  budgetTimezone: () => process.env.NAVI_BUDGET_TIMEZONE || "UTC",
  cronSecret: () => process.env.CRON_SECRET || null,
  vapidPrivateKey: () => process.env.VAPID_PRIVATE_KEY || null,
  vapidSubject: () => process.env.VAPID_SUBJECT || "mailto:owner@example.com",
};

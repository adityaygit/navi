import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/server/context";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { linearConfig } from "@/server/linear/config";
import { checkState, exchangeCode, InvalidGrantError, STATE_COOKIE, STATE_COOKIE_PATH } from "@/server/linear/oauth";
import { completeLinearConnection } from "@/server/linear/connections";
import { syncConnection } from "@/server/linear/sync";
import { settingsUrl, type LinearResult } from "@/server/linear/redirects";

export const maxDuration = 60;

// Step 2: Linear redirects here with ?code&state (or ?error). The state must
// match the encrypted cookie set by /connect for this same signed-in person.
// The code is exchanged for tokens server-to-server (client secret + PKCE
// verifier); tokens are encrypted and stored, then the first import runs.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const done = (result: LinearResult, extra?: Record<string, string>) => {
    const res = NextResponse.redirect(settingsUrl(origin, result, extra));
    // The state is single-use: always clear it.
    res.cookies.set(STATE_COOKIE, "", { path: STATE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings#services")}`, origin));
  const cfg = linearConfig();
  if (!cfg) return done("not_configured");

  const check = checkState(request.cookies.get(STATE_COOKIE)?.value, url.searchParams.get("state"), ctx.userId);
  // Check the state before anything else, even an error reply, so a forged callback can't drive the UI.
  if (!check.ok) return done("state");
  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  if (!code) return done("exchange");

  try {
    const tokens = await exchangeCode(cfg, code, check.verifier);
    const admin = createSupabaseAdmin();
    const connection = await completeLinearConnection(admin, ctx.userId, tokens);
    // First import right away, so the person lands on a filled task list. If it
    // fails, the connection is kept and the scheduler retries.
    const sync = await syncConnection(admin, connection.id, "connect");
    return done(sync.ok ? "connected" : "connected_sync_failed");
  } catch (err) {
    if (err instanceof InvalidGrantError) return done("exchange");
    console.error("[linear callback]", (err as Error).message);
    return done("error");
  }
}
